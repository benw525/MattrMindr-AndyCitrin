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

app.get("/api/health", (req, res) => res.json({ ok: true }));

if (isProd) {
  const buildPath = path.join(__dirname, "..", "lextrack", "build");
  app.use(express.static(buildPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(buildPath, "index.html"));
  });
}

const listenPort = isProd ? 5000 : PORT;
app.listen(listenPort, "0.0.0.0", () => {
  console.log(`MattrMindr API listening on port ${listenPort}`);
});
