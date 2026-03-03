const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (r) => ({
  id: r.id,
  caseId: r.case_id,
  category: r.category,
  description: r.description,
  amount: r.amount ? parseFloat(r.amount) : null,
  documentationStatus: r.documentation_status,
  notes: r.notes,
  createdAt: r.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_damages WHERE case_id = $1 ORDER BY created_at",
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Damages fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_damages (case_id, category, description, amount, documentation_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.caseId, d.category || "Medical Bills", d.description || "",
       orNull(d.amount), d.documentationStatus || "Pending", d.notes || ""]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Damage create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `UPDATE case_damages SET category=$1, description=$2, amount=$3, documentation_status=$4, notes=$5
       WHERE id=$6 AND case_id=$7 RETURNING *`,
      [d.category || "Medical Bills", d.description || "", orNull(d.amount),
       d.documentationStatus || "Pending", d.notes || "",
       req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Damage update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM case_damages WHERE id = $1 AND case_id = $2 RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Damage delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
