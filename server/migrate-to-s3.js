#!/usr/bin/env node
const pool = require("./db");
const { isR2Configured, uploadToR2 } = require("./r2");

const BATCH_SIZE = 10;
const DRY_RUN = process.argv.includes("--dry-run");

async function migrateTable({ table, idCol, dataCol, s3KeyCol, keyPrefix, filenameCol, mimeCol, defaultMime, defaultExt }) {
  const label = `${table}.${dataCol}`;
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM ${table} WHERE ${dataCol} IS NOT NULL AND ${s3KeyCol} IS NULL`
  );
  const total = parseInt(countRes.rows[0].count);
  if (total === 0) {
    console.log(`[${label}] Nothing to migrate (0 rows).`);
    return { table, migrated: 0, failed: 0, total: 0 };
  }
  console.log(`[${label}] ${total} rows to migrate${DRY_RUN ? " (DRY RUN)" : ""}...`);

  let migrated = 0;
  let failed = 0;
  let lastId = 0;

  while (true) {
    const cols = [idCol, dataCol];
    if (filenameCol) cols.push(filenameCol);
    if (mimeCol) cols.push(mimeCol);

    const { rows } = await pool.query(
      `SELECT ${cols.join(", ")} FROM ${table} WHERE ${dataCol} IS NOT NULL AND ${s3KeyCol} IS NULL AND ${idCol} > $1 ORDER BY ${idCol} LIMIT $2`,
      [lastId, BATCH_SIZE]
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const id = row[idCol];
      const buffer = row[dataCol];
      let filename = filenameCol ? row[filenameCol] : null;
      const mime = mimeCol ? row[mimeCol] : defaultMime;

      if (!filename) {
        const ext = defaultExt || "bin";
        filename = `file.${ext}`;
      }

      const key = `${keyPrefix}/${id}/${filename}`;

      if (DRY_RUN) {
        console.log(`  [DRY RUN] Would upload ${key} (${buffer.length} bytes)`);
        migrated++;
        continue;
      }

      try {
        await uploadToR2(key, buffer, mime || defaultMime || "application/octet-stream");
        await pool.query(`UPDATE ${table} SET ${s3KeyCol} = $1 WHERE ${idCol} = $2`, [key, id]);
        migrated++;
        if (migrated % 50 === 0) console.log(`  [${label}] ${migrated}/${total} migrated...`);
      } catch (err) {
        console.error(`  [${label}] Failed id=${id}: ${err.message}`);
        failed++;
      }
    }
    lastId = rows[rows.length - 1][idCol];
  }

  console.log(`[${label}] Done: ${migrated} migrated, ${failed} failed out of ${total}`);
  return { table, migrated, failed, total };
}

async function nullifyBytea({ table, dataCol, s3KeyCol }) {
  if (DRY_RUN) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM ${table} WHERE ${dataCol} IS NOT NULL AND ${s3KeyCol} IS NOT NULL`
    );
    console.log(`[${table}] Would NULL ${rows[0].count} BYTEA cells in ${dataCol} (DRY RUN)`);
    return;
  }
  const res = await pool.query(
    `UPDATE ${table} SET ${dataCol} = NULL WHERE ${dataCol} IS NOT NULL AND ${s3KeyCol} IS NOT NULL`
  );
  console.log(`[${table}] Nullified ${res.rowCount} BYTEA cells in ${dataCol}`);
}

async function main() {
  if (!isR2Configured()) {
    console.error("S3 is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET_NAME.");
    process.exit(1);
  }

  console.log(`=== S3 Migration ${DRY_RUN ? "(DRY RUN) " : ""}===`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log();

  const tables = [
    {
      table: "case_documents", idCol: "id", dataCol: "file_data", s3KeyCol: "s3_key",
      keyPrefix: "documents", filenameCol: "filename", mimeCol: "content_type",
      defaultMime: "application/octet-stream",
    },
    {
      table: "case_filings", idCol: "id", dataCol: "file_data", s3KeyCol: "s3_key",
      keyPrefix: "filings", filenameCol: "filename", mimeCol: "content_type",
      defaultMime: "application/pdf",
    },
    {
      table: "doc_templates", idCol: "id", dataCol: "docx_data", s3KeyCol: "s3_key",
      keyPrefix: "templates", filenameCol: "name", mimeCol: null,
      defaultMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      defaultExt: "docx",
    },
    {
      table: "case_voicemails", idCol: "id", dataCol: "audio_data", s3KeyCol: "s3_key",
      keyPrefix: "voicemails", filenameCol: null, mimeCol: "audio_mime",
      defaultMime: "audio/mpeg", defaultExt: "mp3",
    },
    {
      table: "users", idCol: "id", dataCol: "profile_picture", s3KeyCol: "s3_profile_picture_key",
      keyPrefix: "profile-pictures", filenameCol: null, mimeCol: "profile_picture_type",
      defaultMime: "image/jpeg", defaultExt: "jpg",
    },
    {
      table: "custom_agents", idCol: "id", dataCol: "instruction_file", s3KeyCol: "s3_instruction_key",
      keyPrefix: "custom-agents", filenameCol: "instruction_filename", mimeCol: null,
      defaultMime: "application/octet-stream",
    },
  ];

  const results = [];
  for (const cfg of tables) {
    try {
      const result = await migrateTable(cfg);
      results.push(result);
    } catch (err) {
      console.error(`[${cfg.table}] Migration error: ${err.message}`);
      results.push({ table: cfg.table, migrated: 0, failed: 0, total: 0, error: err.message });
    }
  }

  console.log("\n=== Migration Summary ===");
  for (const r of results) {
    const status = r.error ? `ERROR: ${r.error}` : `${r.migrated}/${r.total} migrated, ${r.failed} failed`;
    console.log(`  ${r.table}: ${status}`);
  }

  const shouldNullify = process.argv.includes("--nullify-bytea");
  if (shouldNullify) {
    console.log("\n=== Nullifying BYTEA columns ===");
    for (const cfg of tables) {
      try {
        await nullifyBytea(cfg);
      } catch (err) {
        console.error(`[${cfg.table}] Nullify error: ${err.message}`);
      }
    }
  } else {
    console.log("\nRun with --nullify-bytea to clear BYTEA data after confirming S3 uploads are correct.");
  }

  await pool.end();
  console.log("\nDone.");
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
