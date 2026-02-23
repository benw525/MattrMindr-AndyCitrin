const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  path: row.path,
  label: row.label,
  category: row.category,
  addedBy: row.added_by,
  addedAt: row.added_at instanceof Date ? row.added_at.toISOString() : row.added_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_links WHERE case_id = $1 ORDER BY added_at",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Links fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_links (case_id, path, label, category, added_by, added_at)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.caseId, d.path, d.label, d.category || "General",
       d.addedBy || "", d.addedAt || new Date().toISOString()]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Link create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM case_links WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Link delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
