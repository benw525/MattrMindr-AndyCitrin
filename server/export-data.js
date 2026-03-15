const pool = require("./db");

const EXCLUDE_COLUMNS = {
  case_documents: ["file_data"],
  case_filings: ["file_data"],
  case_transcripts: ["audio_data", "video_data"],
  case_voicemails: ["audio_data"],
  custom_agents: ["instruction_file"],
  doc_templates: ["docx_data"],
  medical_records: ["file_data"],
  trial_timeline_events: ["file_data"],
  users: ["profile_picture", "ms_access_token", "ms_refresh_token", "ms_token_expiry", "scribe_token", "voirdire_token"],
};

const TABLES_IN_ORDER = [
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
];

async function exportData() {
  const data = {};
  let totalRows = 0;

  for (const tableName of TABLES_IN_ORDER) {
    const excludeCols = EXCLUDE_COLUMNS[tableName] || [];
    try {
      let cols = "*";
      if (excludeCols.length > 0) {
        const { rows: colInfo } = await pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
          [tableName]
        );
        const allCols = colInfo.map(c => c.column_name);
        cols = allCols.filter(c => !excludeCols.includes(c)).map(c => `"${c}"`).join(", ");
      }

      const { rows } = await pool.query(`SELECT ${cols} FROM ${tableName}`);
      if (rows.length === 0) continue;

      data[tableName] = rows;
      totalRows += rows.length;
      console.log(`${tableName}: ${rows.length} rows exported`);
    } catch (err) {
      console.log(`${tableName}: skipped (${err.message})`);
    }
  }

  const fs = require("fs");
  const path = require("path");
  const outPath = path.join(__dirname, "seed-data.json");
  fs.writeFileSync(outPath, JSON.stringify(data));
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`\nExported ${totalRows} total rows across ${Object.keys(data).length} tables`);
  console.log(`Saved to seed-data.json (${sizeMB} MB)`);
  pool.end();
}

exportData().catch((err) => {
  console.error("Export error:", err);
  pool.end();
  process.exit(1);
});
