const pool = require("./db");

const TABLES = [
  { name: "tasks", bytea: [] },
  { name: "deadlines", bytea: [] },
  { name: "case_notes", bytea: [] },
  { name: "case_activity", bytea: [] },
  { name: "case_documents", bytea: ["file_data"] },
  { name: "case_filings", bytea: ["file_data"] },
  { name: "case_correspondence", bytea: [] },
  { name: "case_links", bytea: [] },
  { name: "case_parties", bytea: [] },
  { name: "case_experts", bytea: [] },
  { name: "case_misc_contacts", bytea: [] },
  { name: "case_insurance", bytea: [] },
  { name: "contact_notes", bytea: [] },
  { name: "contact_staff", bytea: [] },
  { name: "time_entries", bytea: [] },
  { name: "doc_templates", bytea: ["file_data"] },
  { name: "ai_training", bytea: [] },
];

async function exportData() {
  const data = {};
  for (const table of TABLES) {
    try {
      const { rows } = await pool.query(`SELECT * FROM ${table.name}`);
      if (rows.length === 0) continue;
      for (const row of rows) {
        for (const col of table.bytea) {
          if (row[col] && Buffer.isBuffer(row[col])) {
            row[col] = row[col].toString("base64");
            row[`__base64__${col}`] = true;
          }
        }
      }
      data[table.name] = rows;
      console.log(`${table.name}: ${rows.length} rows exported`);
    } catch (err) {
      console.log(`${table.name}: skipped (${err.message})`);
    }
  }

  const fs = require("fs");
  const path = require("path");
  const outPath = path.join(__dirname, "seed-data.json");
  fs.writeFileSync(outPath, JSON.stringify(data));
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`\nExported to seed-data.json (${sizeMB} MB)`);
  pool.end();
}

exportData().catch((err) => {
  console.error("Export error:", err);
  pool.end();
  process.exit(1);
});
