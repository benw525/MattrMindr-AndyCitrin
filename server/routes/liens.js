const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (r) => ({
  id: r.id,
  caseId: r.case_id,
  lienType: r.lien_type,
  lienholderName: r.lienholder_name,
  amount: r.amount ? parseFloat(r.amount) : null,
  negotiatedAmount: r.negotiated_amount ? parseFloat(r.negotiated_amount) : null,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_liens WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at",
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Liens fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_liens (case_id, lien_type, lienholder_name, amount, negotiated_amount, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.caseId, d.lienType || "Medical", d.lienholderName || "",
       orNull(d.amount), orNull(d.negotiatedAmount), d.status || "Pending", d.notes || ""]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Lien create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `UPDATE case_liens SET lien_type=$1, lienholder_name=$2, amount=$3, negotiated_amount=$4, status=$5, notes=$6
       WHERE id=$7 AND case_id=$8 RETURNING *`,
      [d.lienType || "Medical", d.lienholderName || "", orNull(d.amount),
       orNull(d.negotiatedAmount), d.status || "Pending", d.notes || "",
       req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Lien update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_liens SET deleted_at = NOW() WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Lien delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
