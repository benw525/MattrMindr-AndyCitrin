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
      `INSERT INTO case_notes (case_id, type, body, author_id, author_name, author_role, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.caseId, d.type || "General", d.body, d.authorId || null,
       d.authorName || "", d.authorRole || "", d.createdAt || new Date().toISOString()]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Note create error:", err);
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
