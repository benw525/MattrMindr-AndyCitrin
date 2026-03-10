const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const cors = require("cors");
const path = require("path");
const pool = require("./db");

const authRoutes     = require("./routes/auth");
const usersRoutes    = require("./routes/users");
const casesRoutes    = require("./routes/cases");
const tasksRoutes    = require("./routes/tasks");
const deadlinesRoutes = require("./routes/deadlines");
const notesRoutes    = require("./routes/notes");
const linksRoutes    = require("./routes/links");
const activityRoutes = require("./routes/activity");
const contactsRoutes     = require("./routes/contacts");
const contactNotesRoutes     = require("./routes/contact-notes");
const contactStaffRoutes     = require("./routes/contact-staff");
const aiSearchRoutes         = require("./routes/ai-search");
const correspondenceRoutes   = require("./routes/correspondence");
const inboundEmailRoutes     = require("./routes/inbound-email");
const templatesRoutes        = require("./routes/templates");
const partiesRoutes          = require("./routes/parties");
const expertsRoutes          = require("./routes/experts");
const miscContactsRoutes     = require("./routes/misc-contacts");
const timeEntriesRoutes      = require("./routes/time-entries");
const aiAgentsRoutes         = require("./routes/ai-agents");
const caseDocumentsRoutes    = require("./routes/case-documents");
const filingsRoutes          = require("./routes/filings");
const aiTrainingRoutes       = require("./routes/ai-training");
const batchCasesRoutes       = require("./routes/batch-cases");
const calendarFeedsRoutes    = require("./routes/calendar-feeds");
const linkedCasesRoutes      = require("./routes/linked-cases");
const insuranceRoutes        = require("./routes/insurance");
const medicalTreatmentsRoutes = require("./routes/medical-treatments");
const liensRoutes            = require("./routes/liens");
const damagesRoutes          = require("./routes/damages");
const expensesRoutes         = require("./routes/expenses");
const negotiationsRoutes     = require("./routes/negotiations");
const smsRoutes              = require("./routes/sms");
const collaborateRoutes      = require("./routes/collaborate");
const transcriptsRoutes      = require("./routes/transcripts");
const trialCenterAiRoutes    = require("./routes/trial-center-ai");
const trialCenterRoutes      = require("./routes/trial-center");
const portalAuthRoutes       = require("./routes/portal-auth");
const portalCaseRoutes       = require("./routes/portal-case");
const portalAdminRoutes      = require("./routes/portal-admin");
const externalRoutes         = require("./routes/external");
const microsoftRoutes        = require("./routes/microsoft");
const onlyofficeRoutes       = require("./routes/onlyoffice");
const scribeRoutes           = require("./routes/scribe");
const voicemailsRoutes       = require("./routes/voicemails");
const deletedDataRoutes      = require("./routes/deleted-data");
const customReportsRoutes    = require("./routes/custom-reports");
const customAgentsBuilderRoutes = require("./routes/custom-agents-builder");
const { sendEmail }          = require("./email");

const app  = express();
const PORT = process.env.API_PORT || 3001;

const isProd = process.env.NODE_ENV === "production";

if (isProd) app.set("trust proxy", 1);

app.use(cors({
  origin: isProd ? [] : ["http://localhost:5000", "http://0.0.0.0:5000"],
  credentials: true,
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

app.use(session({
  store: new pgSession({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: true,
  }),
  name: "lextrack.sid",
  secret: process.env.SESSION_SECRET || "lextrack-dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "lax" : undefined,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use("/api/inbound-email", inboundEmailRoutes);

app.use("/api/auth",      authRoutes);
app.use("/api/users",     usersRoutes);
app.use("/api/cases",     casesRoutes);
app.use("/api/tasks",     tasksRoutes);
app.use("/api/deadlines", deadlinesRoutes);
app.use("/api/notes",     notesRoutes);
app.use("/api/links",     linksRoutes);
app.use("/api/activity",       activityRoutes);
app.use("/api/contacts",      contactsRoutes);
app.use("/api/contact-notes", contactNotesRoutes);
app.use("/api/contact-staff", contactStaffRoutes);
app.use("/api/ai-search",     aiSearchRoutes);
app.use("/api/correspondence", correspondenceRoutes);
app.use("/api/templates",      templatesRoutes);
app.use("/api/parties",        partiesRoutes);
app.use("/api/experts",        expertsRoutes);
app.use("/api/misc-contacts",  miscContactsRoutes);
app.use("/api/time-entries",   timeEntriesRoutes);
app.use("/api/ai-agents",     aiAgentsRoutes);
app.use("/api/case-documents", caseDocumentsRoutes);
app.use("/api/filings",        filingsRoutes);
app.use("/api/ai-training",    aiTrainingRoutes);
app.use("/api/batch-cases",    batchCasesRoutes);
app.use("/api/calendar-feeds", calendarFeedsRoutes);
app.use("/api/linked-cases", linkedCasesRoutes);
app.use("/api/insurance", insuranceRoutes);
app.use("/api/medical-treatments", medicalTreatmentsRoutes);
app.use("/api/liens", liensRoutes);
app.use("/api/damages", damagesRoutes);
app.use("/api/expenses", expensesRoutes);
app.use("/api/negotiations", negotiationsRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/collaborate", collaborateRoutes);
app.use("/api/transcripts", transcriptsRoutes);
app.use("/api/trial-center", trialCenterRoutes);
app.use("/api/trial-center/ai", trialCenterAiRoutes);
app.use("/api/portal/auth", portalAuthRoutes);
app.use("/api/portal/case", portalCaseRoutes);
app.use("/api/portal-admin", portalAdminRoutes);
app.use("/api/voicemails", voicemailsRoutes);
app.use("/api/deleted-data", deletedDataRoutes);
app.use("/api/custom-reports", customReportsRoutes);
app.use("/api/custom-agents-builder", customAgentsBuilderRoutes);
app.use("/api/microsoft", microsoftRoutes);
app.use("/api/onlyoffice", onlyofficeRoutes);
app.use("/api/scribe", scribeRoutes);

const externalCorsOrigins = process.env.EXTERNAL_CORS_ORIGINS ? process.env.EXTERNAL_CORS_ORIGINS.split(",") : null;
app.use("/api/external", cors({
  origin: externalCorsOrigins || true,
  credentials: false,
}), externalRoutes);

app.post("/api/support", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  const { subject, message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "Message is required" });
  try {
    const { rows } = await pool.query("SELECT name, email, role FROM users WHERE id = $1", [req.session.userId]);
    if (!rows.length) return res.status(401).json({ error: "User not found" });
    const user = rows[0];
    const subj = subject && subject.trim() ? `MattrMindr Support: ${subject.trim()}` : "MattrMindr Support Request";
    const text = `Support request from ${user.name} (${user.email}, ${user.role}):\n\n${message.trim()}`;
    const html = `
      <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 30px;">
        <h2 style="color: #1e3a5f; font-family: 'Playfair Display', Georgia, serif;">MattrMindr Support Request</h2>
        <table style="margin: 16px 0; font-size: 14px;">
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280; font-weight: 600;">From:</td><td>${user.name}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280; font-weight: 600;">Email:</td><td>${user.email}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; color: #6b7280; font-weight: 600;">Role:</td><td>${user.role}</td></tr>
        </table>
        <div style="background: #f0f4f8; border: 1px solid #d0d7de; border-radius: 8px; padding: 20px; margin: 20px 0; white-space: pre-wrap; font-size: 14px; line-height: 1.6;">${message.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 24px;">Sent from MattrMindr Case Management System</p>
      </div>`;
    await sendEmail({ to: "support@mattrmindr.com", subject: subj, text, html });
    res.json({ ok: true });
  } catch (err) {
    console.error("Support email error:", err.message);
    res.status(500).json({ error: "Failed to send support request. Please try again." });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    console.error("Health check DB failure:", err.message);
    res.status(503).json({ ok: false, error: "database unreachable" });
  }
});

if (isProd) {
  const buildPath = path.join(__dirname, "..", "lextrack", "build");
  const fs = require("fs");
  const indexPath = path.join(buildPath, "index.html");
  if (fs.existsSync(indexPath)) {
    app.use(express.static(buildPath));
    app.get("*", (req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    console.error("PRODUCTION BUILD MISSING — lextrack/build/index.html not found at:", indexPath);
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
      res.status(500).send("Application build not found. Please redeploy.");
    });
  }
}

async function ensureColumns() {
  const tableCreations = [
    `CREATE TABLE IF NOT EXISTS transcript_history (
      id SERIAL PRIMARY KEY,
      transcript_id INTEGER REFERENCES case_transcripts(id) ON DELETE CASCADE,
      change_type TEXT NOT NULL,
      change_description TEXT,
      previous_state JSONB,
      changed_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS custom_reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL,
      data_source TEXT NOT NULL,
      config JSONB NOT NULL DEFAULT '{}',
      visibility TEXT DEFAULT 'private',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS custom_agents (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      context_sources JSONB DEFAULT '[]',
      needs_case BOOLEAN DEFAULT true,
      interaction_mode TEXT DEFAULT 'single',
      model TEXT DEFAULT 'gpt-4o-mini',
      visibility TEXT DEFAULT 'private',
      shared_with INTEGER[] DEFAULT '{}',
      instruction_file BYTEA,
      instruction_filename TEXT,
      instruction_text TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];

  const migrations = [
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS is_video BOOLEAN DEFAULT false`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS video_data BYTEA`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS video_content_type TEXT`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS r2_audio_key TEXT`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS r2_video_key TEXT`,
    `ALTER TABLE case_correspondence ADD COLUMN IF NOT EXISTS is_voicemail BOOLEAN DEFAULT false`,
    `ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS annotations JSONB DEFAULT '[]'`,
    `ALTER TABLE case_documents ADD COLUMN IF NOT EXISTS content_html TEXT`,
    `ALTER TABLE jury_analyses ADD COLUMN IF NOT EXISTS daubert_challenge TEXT`,
    `ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_access_token TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_refresh_token TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_token_expiry TIMESTAMPTZ`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS ms_account_email TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_url TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_token TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS scribe_user_email TEXT`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS scribe_transcript_id TEXT`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS scribe_status TEXT`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS transcript_versions JSONB`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS summaries JSONB`,
    `ALTER TABLE case_transcripts ADD COLUMN IF NOT EXISTS pipeline_log JSONB`,
    `ALTER TABLE cases ADD COLUMN IF NOT EXISTS fee_is_flat BOOLEAN DEFAULT false`,
    `ALTER TABLE case_damages ADD COLUMN IF NOT EXISTS billed NUMERIC(12,2)`,
    `ALTER TABLE case_damages ADD COLUMN IF NOT EXISTS owed NUMERIC(12,2)`,
    `ALTER TABLE case_damages ADD COLUMN IF NOT EXISTS reduction_value NUMERIC(12,2)`,
    `ALTER TABLE case_damages ADD COLUMN IF NOT EXISTS reduction_is_percent BOOLEAN DEFAULT false`,
    `ALTER TABLE case_damages ADD COLUMN IF NOT EXISTS client_paid NUMERIC(12,2)`,
    `ALTER TABLE case_damages ADD COLUMN IF NOT EXISTS firm_paid NUMERIC(12,2)`,
    `ALTER TABLE case_damages ADD COLUMN IF NOT EXISTS insurance_paid NUMERIC(12,2)`,
    `ALTER TABLE case_damages ADD COLUMN IF NOT EXISTS write_off NUMERIC(12,2)`,
    `ALTER TABLE case_liens ADD COLUMN IF NOT EXISTS reduction_value NUMERIC(12,2)`,
    `ALTER TABLE case_liens ADD COLUMN IF NOT EXISTS reduction_is_percent BOOLEAN DEFAULT false`,
    `ALTER TABLE case_negotiations ADD COLUMN IF NOT EXISTS policy_id INTEGER`,
    `ALTER TABLE case_negotiations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
  ];

  for (const sql of tableCreations) {
    await pool.query(sql).catch(() => {});
  }
  for (const sql of migrations) {
    await pool.query(sql).catch(() => {});
  }

  try {
    const bcrypt = require("bcryptjs");
    const adminEmail = "admin@mattrmindr.com";
    const { rows: existing } = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [adminEmail]);
    if (existing.length === 0) {
      const hash = await bcrypt.hash("100%Warrior92", 10);
      await pool.query(
        `INSERT INTO users (id, name, role, roles, email, initials, password_hash)
         SELECT COALESCE(MAX(id), 0) + 1, $1, $2, $3, $4, $5, $6 FROM users`,
        ["Admin", "App Admin", ["App Admin"], adminEmail, "AD", hash]
      );
      console.log("Seeded admin user: " + adminEmail);
    }
  } catch (seedErr) {
    console.error("Admin seed error (non-fatal):", seedErr.message);
  }

  console.log("Runtime schema migrations applied.");
}

const listenPort = isProd ? 5000 : PORT;

(async () => {
  try {
    await ensureColumns();
  } catch (err) {
    console.error("Runtime migration error (non-fatal):", err.message);
  }

  app.listen(listenPort, "0.0.0.0", async () => {
    console.log(`MattrMindr API listening on port ${listenPort}`);
    try {
      const { rows } = await pool.query("SELECT count(*) as cnt FROM users");
      console.log(`Database connected — ${rows[0].cnt} users in database`);
    } catch (err) {
      console.error("Database connectivity check failed:", err.message);
    }

    const { processScheduledMessages } = require("./sms-scheduler");
    const smsInterval = isProd ? 60000 : 300000;
    setInterval(() => {
      processScheduledMessages().catch(err => console.error("SMS scheduler tick error:", err));
    }, smsInterval);
    console.log(`SMS scheduler started (interval: ${smsInterval / 1000}s)`);

    deletedDataRoutes.autoPurgeExpired();
    setInterval(() => {
      deletedDataRoutes.autoPurgeExpired();
    }, 24 * 60 * 60 * 1000);
  });
})();
