const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  type: row.type,
  body: row.body,
  authorId: row.author_id,
  authorName: row.author_name,
  authorRole: row.author_role,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  timeLogged: row.time_logged || null,
  timeLogUser: row.time_log_user || null,
});

router.get("/quick", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_notes WHERE case_id IS NULL AND author_id = $1 ORDER BY created_at DESC",
      [req.session.userId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Quick notes fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Notes fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_notes (case_id, type, body, author_id, author_name, author_role, created_at, time_logged, time_log_user)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.caseId || null, d.type || "General", d.body, d.authorId || null,
       d.authorName || "", d.authorRole || "", d.createdAt || new Date().toISOString(),
       d.timeLogged || null, d.timeLogUser || null]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Note create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const { timeLogged, body, caseId, type } = req.body;
  try {
    const sets = [];
    const vals = [];
    let idx = 1;
    if (timeLogged !== undefined) { sets.push(`time_logged = $${idx++}`); vals.push(timeLogged || null); }
    if (body !== undefined) { sets.push(`body = $${idx++}`); vals.push(body); }
    if (caseId !== undefined) { sets.push(`case_id = $${idx++}`); vals.push(caseId || null); }
    if (type !== undefined) { sets.push(`type = $${idx++}`); vals.push(type); }
    if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE case_notes SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Note update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM case_notes WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Note delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
