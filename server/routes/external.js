const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { generateToken, requireExternalAuth } = require("../middleware/external-auth");

const router = express.Router();

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
      [email.trim()]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid credentials" });
    const user = rows[0];
    let authenticated = false;
    if (user.password_hash) authenticated = await bcrypt.compare(password, user.password_hash);
    if (!authenticated && user.temp_password && user.temp_password === password) authenticated = true;
    if (!authenticated) return res.status(401).json({ error: "Invalid credentials" });
    const token = generateToken(user.id);
    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, roles: user.roles || [user.role] },
    });
  } catch (err) {
    console.error("External login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/auth/verify", requireExternalAuth, (req, res) => {
  return res.json({ valid: true, user: req.extUser });
});

router.get("/cases", requireExternalAuth, async (req, res) => {
  try {
    const user = req.extUser;
    const roles = user.roles || [user.role];
    let query, params;
    if (roles.includes("App Admin")) {
      query = "SELECT id, case_num, title, client_name, case_type, type, status, stage, county, court, created_at FROM cases WHERE deleted_at IS NULL AND status != 'Closed' ORDER BY created_at DESC";
      params = [];
    } else {
      query = `SELECT id, case_num, title, client_name, case_type, type, status, stage, county, court, created_at FROM cases
        WHERE deleted_at IS NULL AND status != 'Closed'
        AND (lead_attorney = $1 OR second_attorney = $1 OR case_manager = $1 OR investigator = $1 OR paralegal = $1 OR confidential = false OR confidential IS NULL)
        ORDER BY created_at DESC`;
      params = [user.id];
    }
    const { rows } = await pool.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error("External cases error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/cases/:id", requireExternalAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Case not found" });
    const c = rows[0];
    const user = req.extUser;
    const roles = user.roles || [user.role];
    if (!roles.includes("App Admin")) {
      if (c.confidential && ![c.lead_attorney, c.second_attorney, c.case_manager, c.investigator, c.paralegal].includes(user.id)) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    const { rows: parties } = await pool.query("SELECT * FROM case_parties WHERE case_id = $1", [req.params.id]);
    const { rows: notes } = await pool.query("SELECT id, case_id, type, body, author_name, author_role, created_at FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT 50", [req.params.id]);
    return res.json({ ...c, parties, recentNotes: notes });
  } catch (err) {
    console.error("External case detail error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/cases/:id/jury-analysis", requireExternalAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.id);
    const { rows: caseRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
    if (!caseRows.length) return res.status(404).json({ error: "Case not found" });
    const { jurors, strikeStrategy, causeChallenges, causeStrategy, daubertChallenge, source } = req.body;
    if (!jurors || !Array.isArray(jurors)) return res.status(400).json({ error: "jurors array is required" });
    const sanitizedDaubert = daubertChallenge ? String(daubertChallenge).slice(0, 10000) : null;
    const { rows } = await pool.query(
      `INSERT INTO jury_analyses (case_id, jurors, strike_strategy, cause_challenges, cause_strategy, daubert_challenge, imported_by, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (case_id) DO UPDATE SET jurors = $2, strike_strategy = $3, cause_challenges = $4, cause_strategy = $5, daubert_challenge = $6, imported_at = NOW(), imported_by = $7, source = $8
       RETURNING *`,
      [caseId, JSON.stringify(jurors), strikeStrategy || "", JSON.stringify(causeChallenges || []), causeStrategy || "", sanitizedDaubert, req.extUser.id, source || "external"]
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error("External jury analysis import error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
