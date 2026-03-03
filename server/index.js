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
const negotiationsRoutes     = require("./routes/negotiations");
const smsRoutes              = require("./routes/sms");
const collaborateRoutes      = require("./routes/collaborate");
const transcriptsRoutes      = require("./routes/transcripts");
const trialCenterAiRoutes    = require("./routes/trial-center-ai");
const trialCenterRoutes      = require("./routes/trial-center");
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
app.use("/api/negotiations", negotiationsRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/collaborate", collaborateRoutes);
app.use("/api/transcripts", transcriptsRoutes);
app.use("/api/trial-center", trialCenterRoutes);
app.use("/api/trial-center/ai", trialCenterAiRoutes);

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

const listenPort = isProd ? 5000 : PORT;
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
});
