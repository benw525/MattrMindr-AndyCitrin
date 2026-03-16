const pool = require("./db");
const { execSync } = require("child_process");

const EXTRA_EXCLUDE_COLUMNS = {
  users: ["ms_access_token", "ms_refresh_token", "ms_token_expiry", "scribe_token", "voirdire_token"],
};

const FK_SAFE_ORDER = [
  "users",
  "contacts",
  "cases",
  "integration_configs",
  "permissions",
  "custom_task_flows",
  "custom_task_flow_steps",
  "custom_agents",
  "custom_reports",
  "custom_dashboard_widgets",
  "calendar_feeds",
  "document_folders",
  "transcript_folders",
  "trial_sessions",
  "contact_phones",
  "contact_notes",
  "contact_staff",
  "contact_case_links",
  "tasks",
  "deadlines",
  "case_notes",
  "case_activity",
  "case_links",
  "case_correspondence",
  "case_parties",
  "case_experts",
  "case_misc_contacts",
  "case_insurance",
  "case_insurance_policies",
  "case_medical_treatments",
  "case_liens",
  "case_damages",
  "case_negotiations",
  "case_expenses",
  "case_probation_violations",
  "case_documents",
  "case_filings",
  "case_transcripts",
  "case_voicemails",
  "doc_templates",
  "medical_records",
  "transcript_history",
  "linked_cases",
  "ai_training",
  "time_entries",
  "sms_configs",
  "sms_messages",
  "sms_watch_numbers",
  "sms_scheduled",
  "chat_channels",
  "chat_channel_members",
  "chat_groups",
  "chat_messages",
  "chat_typing",
  "unmatched_filings_emails",
  "client_portal_settings",
  "client_users",
  "client_messages",
  "task_flow_executions",
  "trial_witnesses",
  "trial_witness_documents",
  "trial_exhibits",
  "trial_jurors",
  "trial_jury_instructions",
  "trial_log_entries",
  "trial_motions",
  "trial_outlines",
  "trial_pinned_docs",
  "trial_timeline_events",
  "jury_analyses",
  "user_sessions",
];

function escapeSqlValue(val, dataType) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (Buffer.isBuffer(val)) return `'\\x${val.toString("hex")}'`;
  if (Array.isArray(val)) {
    const items = val.map(v => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
    return `'{${items}}'`;
  }
  if (dataType === "ARRAY") {
    return `'${String(val).replace(/'/g, "''")}'`;
  }
  if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

function dumpSchemaWithPgDump(outPath) {
  const dbUrl = process.env.DATABASE_URL;
  try {
    execSync(
      `pg_dump "${dbUrl}" --schema-only --no-owner --no-privileges --no-comments --format=plain > "${outPath}"`,
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    console.log("Schema exported via pg_dump --schema-only");
    return true;
  } catch (err) {
    console.error("ERROR: pg_dump is not available or failed:", err.message);
    console.error("pg_dump is required for a full schema+data export.");
    console.error("Install PostgreSQL client tools or use --json for a data-only export.");
    return false;
  }
}

async function exportData() {
  const format = process.argv.includes("--json") ? "json" : "sql";
  const { rows: allTables } = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
  );
  const allTableNames = allTables.map(r => r.table_name);

  const orderedTables = [];
  for (const t of FK_SAFE_ORDER) {
    if (allTableNames.includes(t)) orderedTables.push(t);
  }
  for (const t of allTableNames) {
    if (!orderedTables.includes(t)) orderedTables.push(t);
  }

  const fs = require("fs");
  const path = require("path");

  if (format === "json") {
    const data = {};
    let totalRows = 0;
    for (const tableName of orderedTables) {
      const { rows: colInfo } = await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [tableName]
      );
      const byteaCols = colInfo.filter(c => c.data_type === "bytea").map(c => c.column_name);
      const extraExclude = EXTRA_EXCLUDE_COLUMNS[tableName] || [];
      const excludeCols = [...byteaCols, ...extraExclude];
      let cols;
      if (excludeCols.length > 0) {
        const allCols = colInfo.map(c => c.column_name);
        cols = allCols.filter(c => !excludeCols.includes(c)).map(c => `"${c}"`).join(", ");
        if (byteaCols.length > 0) console.log(`${tableName}: auto-excluding BYTEA columns: ${byteaCols.join(", ")}`);
      } else {
        cols = "*";
      }
      const { rows } = await pool.query(`SELECT ${cols} FROM "${tableName}"`);
      if (rows.length === 0) { console.log(`${tableName}: 0 rows (empty)`); continue; }
      data[tableName] = rows;
      totalRows += rows.length;
      console.log(`${tableName}: ${rows.length} rows exported`);
    }
    const outPath = path.join(__dirname, "seed-data.json");
    fs.writeFileSync(outPath, JSON.stringify(data));
    const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
    console.log(`\nExported ${totalRows} total rows across ${Object.keys(data).length} tables`);
    console.log(`Saved to seed-data.json (${sizeMB} MB)`);
  } else {
    const outPath = path.join(__dirname, "export.sql");
    const schemaPath = path.join(__dirname, "export-schema.sql");

    const pgDumpOk = dumpSchemaWithPgDump(schemaPath);

    const stream = fs.createWriteStream(outPath);
    stream.write("-- Full database export generated on " + new Date().toISOString() + "\n");
    stream.write("-- Schema + data for import into AWS RDS PostgreSQL\n");
    stream.write("-- Import with: psql $DATABASE_URL < export.sql\n\n");
    stream.write("SET client_encoding = 'UTF8';\n");
    stream.write("SET standard_conforming_strings = on;\n");
    stream.write("SET check_function_bodies = false;\n\n");

    if (pgDumpOk && fs.existsSync(schemaPath)) {
      stream.write("-- ========================================\n");
      stream.write("-- SCHEMA (from pg_dump --schema-only)\n");
      stream.write("-- ========================================\n\n");
      const schemaContent = fs.readFileSync(schemaPath, "utf8");
      stream.write(schemaContent);
      stream.write("\n\n");
      fs.unlinkSync(schemaPath);
    } else {
      stream.end();
      console.error("\nExport aborted: pg_dump is required for a complete migration dump.");
      console.error("The export.sql file was not created.");
      console.error("Use --json for a data-only export if schema is handled separately.");
      try { fs.unlinkSync(outPath); } catch (_) {}
      pool.end();
      process.exit(1);
    }

    stream.write("-- ========================================\n");
    stream.write("-- DATA\n");
    stream.write("-- ========================================\n\n");
    stream.write("-- Disable FK checks during data import\n");
    stream.write("SET session_replication_role = 'replica';\n\n");

    let totalRows = 0;
    let tableCount = 0;

    for (const tableName of orderedTables) {
      const { rows: colInfo } = await pool.query(
        `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
        [tableName]
      );

      const includedCols = colInfo;
      const colNames = includedCols.map(c => c.column_name);
      const selectCols = colNames.map(c => `"${c}"`).join(", ");

      const { rows } = await pool.query(`SELECT ${selectCols} FROM "${tableName}"`);
      if (rows.length === 0) { console.log(`${tableName}: 0 rows (empty)`); continue; }

      stream.write(`-- Table: ${tableName} (${rows.length} rows)\n`);
      stream.write(`DELETE FROM "${tableName}";\n`);

      const quotedColNames = colNames.map(c => `"${c}"`).join(", ");
      const BATCH = 100;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        stream.write(`INSERT INTO "${tableName}" (${quotedColNames}) VALUES\n`);
        const valueRows = batch.map(row => {
          const vals = colNames.map((col, idx) => escapeSqlValue(row[col], includedCols[idx].data_type));
          return `  (${vals.join(", ")})`;
        });
        stream.write(valueRows.join(",\n") + ";\n");
      }

      const seqCheck = await pool.query(
        `SELECT pg_get_serial_sequence($1, 'id') as seq`,
        [`public.${tableName}`]
      ).catch(() => ({ rows: [{ seq: null }] }));

      if (seqCheck.rows[0]?.seq) {
        stream.write(`SELECT setval('${seqCheck.rows[0].seq}', (SELECT COALESCE(MAX(id), 1) FROM "${tableName}"));\n`);
      }

      stream.write("\n");
      totalRows += rows.length;
      tableCount++;
      console.log(`${tableName}: ${rows.length} rows exported`);
    }

    stream.write("-- Re-enable FK checks\n");
    stream.write("SET session_replication_role = 'origin';\n\n");

    stream.end();
    await new Promise(resolve => stream.on("finish", resolve));

    const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
    console.log(`\nExported ${totalRows} total rows across ${tableCount} tables`);
    console.log(`Saved to export.sql (${sizeMB} MB) — includes ${pgDumpOk ? "schema + data" : "data only (pg_dump unavailable)"}`);
    console.log("Import with: psql $DATABASE_URL < export.sql");
  }

  pool.end();
}

exportData().catch((err) => {
  console.error("Export error:", err);
  pool.end();
  process.exit(1);
});
