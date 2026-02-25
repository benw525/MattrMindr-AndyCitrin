const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  expertType: row.expert_type,
  data: row.data || {},
  createdAt: row.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_experts WHERE case_id = $1 ORDER BY created_at ASC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Experts fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { caseId, expertType, data } = req.body;
    if (!caseId || !expertType) {
      return res.status(400).json({ error: "caseId and expertType are required" });
    }
    const { rows } = await pool.query(
      "INSERT INTO case_experts (case_id, expert_type, data) VALUES ($1, $2, $3) RETURNING *",
      [caseId, expertType, JSON.stringify(data || {})]
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Expert create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { expertType, data } = req.body;
    const { rows } = await pool.query(
      "UPDATE case_experts SET expert_type = COALESCE($1, expert_type), data = COALESCE($2, data) WHERE id = $3 RETURNING *",
      [expertType || null, data ? JSON.stringify(data) : null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Expert record not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Expert update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM case_experts WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Expert record not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Expert delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
