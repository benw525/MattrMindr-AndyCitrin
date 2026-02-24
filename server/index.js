const express = require("express");
const session = require("express-session");
const cors = require("cors");

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
const aiSearchRoutes         = require("./routes/ai-search");
const correspondenceRoutes   = require("./routes/correspondence");
const inboundEmailRoutes     = require("./routes/inbound-email");
const templatesRoutes        = require("./routes/templates");

const app  = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors({
  origin: ["http://localhost:5000", "http://0.0.0.0:5000"],
  credentials: true,
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

app.use(session({
  name: "lextrack.sid",
  secret: process.env.SESSION_SECRET || "lextrack-dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
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
app.use("/api/ai-search",     aiSearchRoutes);
app.use("/api/correspondence", correspondenceRoutes);
app.use("/api/templates",      templatesRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MattrMindr API listening on port ${PORT}`);
});
