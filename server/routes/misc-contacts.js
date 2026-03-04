const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  contactType: row.contact_type,
  data: row.data || {},
  createdAt: row.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_misc_contacts WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Misc contacts fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { caseId, contactType, data } = req.body;
    if (!caseId || !contactType) {
      return res.status(400).json({ error: "caseId and contactType are required" });
    }
    const { rows } = await pool.query(
      "INSERT INTO case_misc_contacts (case_id, contact_type, data) VALUES ($1, $2, $3) RETURNING *",
      [caseId, contactType, JSON.stringify(data || {})]
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Misc contact create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { contactType, data } = req.body;
    const { rows } = await pool.query(
      "UPDATE case_misc_contacts SET contact_type = COALESCE($1, contact_type), data = COALESCE($2, data) WHERE id = $3 RETURNING *",
      [contactType || null, data ? JSON.stringify(data) : null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Misc contact not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Misc contact update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_misc_contacts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Misc contact not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Misc contact delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
