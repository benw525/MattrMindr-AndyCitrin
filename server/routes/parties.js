const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  partyType: row.party_type,
  entityKind: row.entity_kind,
  data: row.data || {},
  createdAt: row.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_parties WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Parties fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { caseId, partyType, entityKind, data } = req.body;
    if (!caseId || !partyType || !entityKind) {
      return res.status(400).json({ error: "caseId, partyType, and entityKind are required" });
    }
    const { rows } = await pool.query(
      "INSERT INTO case_parties (case_id, party_type, entity_kind, data) VALUES ($1, $2, $3, $4) RETURNING *",
      [caseId, partyType, entityKind, JSON.stringify(data || {})]
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Party create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { partyType, entityKind, data } = req.body;
    const { rows } = await pool.query(
      "UPDATE case_parties SET party_type = COALESCE($1, party_type), entity_kind = COALESCE($2, entity_kind), data = COALESCE($3, data) WHERE id = $4 RETURNING *",
      [partyType || null, entityKind || null, data ? JSON.stringify(data) : null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Party not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Party update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_parties SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Party not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Party delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
