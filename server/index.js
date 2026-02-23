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

const app  = express();
const PORT = process.env.API_PORT || 3001;

app.use(cors({
  origin: ["http://localhost:5000", "http://0.0.0.0:5000"],
  credentials: true,
}));

app.use(express.json({ limit: "2mb" }));

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

app.use("/api/auth",      authRoutes);
app.use("/api/users",     usersRoutes);
app.use("/api/cases",     casesRoutes);
app.use("/api/tasks",     tasksRoutes);
app.use("/api/deadlines", deadlinesRoutes);
app.use("/api/notes",     notesRoutes);
app.use("/api/links",     linksRoutes);
app.use("/api/activity",  activityRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`LexTrack API listening on port ${PORT}`);
});
