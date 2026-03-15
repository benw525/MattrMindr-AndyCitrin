const fs   = require("fs");
const path = require("path");
const pool = require("./db");

const TABLES_WITH_TEXT_PK = ["integration_configs"];

async function importTableData(client, tableName, rows) {
  if (!rows || rows.length === 0) return;

  const sampleRow = rows[0];
  const cols = Object.keys(sampleRow);

  const { rows: colTypes } = await client.query(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );
  const typeMap = {};
  for (const c of colTypes) typeMap[c.column_name] = c.data_type === "ARRAY" ? "array" : (c.udt_name === "jsonb" || c.udt_name === "json") ? "json" : "other";

  const hasId = cols.includes("id");
  const hasTextPk = TABLES_WITH_TEXT_PK.includes(tableName);

  let inserted = 0;
  for (const row of rows) {
    const values = cols.map((col) => {
      let val = row[col];
      if (val !== null && typeof val === "object" && !Buffer.isBuffer(val) && !(val instanceof Date)) {
        if (typeMap[col] === "json") {
          val = JSON.stringify(val);
        } else if (typeMap[col] === "array") {
        } else {
          val = JSON.stringify(val);
        }
      }
      return val;
    });

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const colList = cols.map((c) => `"${c}"`).join(", ");

    if (hasId || hasTextPk) {
      const pkCol = hasTextPk ? "key" : "id";
      await client.query(
        `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) ON CONFLICT (${pkCol}) DO NOTHING`,
        values
      );
    } else {
      await client.query(
        `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`,
        values
      );
    }
    inserted++;
  }

  if (hasId) {
    const ids = rows.map((r) => r.id).filter((id) => typeof id === "number");
    if (ids.length > 0) {
      const maxId = Math.max(...ids);
      const seqName = `${tableName}_id_seq`;
      await client.query("SAVEPOINT seq_check");
      try {
        await client.query(`SELECT setval('${seqName}', GREATEST($1, (SELECT COALESCE(max(id),0) FROM ${tableName})), true)`, [maxId]);
        await client.query("RELEASE SAVEPOINT seq_check");
        console.log(`  ${tableName}: ${inserted} rows imported, sequence set to ${maxId}`);
      } catch (_) {
        await client.query("ROLLBACK TO SAVEPOINT seq_check");
        console.log(`  ${tableName}: ${inserted} rows imported (no sequence)`);
      }
    } else {
      console.log(`  ${tableName}: ${inserted} rows imported`);
    }
  } else {
    console.log(`  ${tableName}: ${inserted} rows imported`);
  }
}

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

async function seed() {
  const seedDataPath = path.join(__dirname, "seed-data.json");
  if (!fs.existsSync(seedDataPath)) {
    console.error("seed-data.json not found. Run 'node server/export-data.js' first.");
    process.exit(1);
  }

  const seedData = JSON.parse(fs.readFileSync(seedDataPath, "utf8"));
  const seedTables = Object.keys(seedData);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    console.log("Disabling FK triggers...");
    const { rows: allTables } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    for (const t of allTables) {
      await client.query(`ALTER TABLE ${t.table_name} DISABLE TRIGGER ALL`);
    }

    console.log("Clearing existing data...");
    for (const t of allTables) {
      await client.query(`DELETE FROM ${t.table_name}`);
    }
    console.log("Data cleared.\n");

    const importOrder = [];
    for (const t of FK_SAFE_ORDER) {
      if (seedTables.includes(t)) importOrder.push(t);
    }
    for (const t of seedTables) {
      if (!importOrder.includes(t)) importOrder.push(t);
    }

    console.log(`Importing ${seedTables.length} tables...`);
    for (const tableName of importOrder) {
      await importTableData(client, tableName, seedData[tableName]);
    }

    console.log("\nRe-enabling FK triggers...");
    for (const t of allTables) {
      await client.query(`ALTER TABLE ${t.table_name} ENABLE TRIGGER ALL`);
    }

    await client.query("COMMIT");
    console.log("\nSeed complete — all data imported successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Seed error:", err); process.exit(1); });
