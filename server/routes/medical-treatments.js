const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (r) => ({
  id: r.id,
  caseId: r.case_id,
  providerName: r.provider_name,
  providerType: r.provider_type,
  firstVisitDate: r.first_visit_date ? r.first_visit_date.toISOString().split("T")[0] : "",
  lastVisitDate: r.last_visit_date ? r.last_visit_date.toISOString().split("T")[0] : "",
  stillTreating: !!r.still_treating,
  totalBilled: r.total_billed ? parseFloat(r.total_billed) : null,
  totalPaid: r.total_paid ? parseFloat(r.total_paid) : null,
  description: r.description,
  notes: r.notes,
  createdAt: r.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_medical_treatments WHERE case_id = $1 AND deleted_at IS NULL ORDER BY first_visit_date ASC NULLS LAST, created_at",
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Medical treatments fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_medical_treatments
        (case_id, provider_name, provider_type, first_visit_date, last_visit_date,
         still_treating, total_billed, total_paid, description, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.caseId, d.providerName || "", d.providerType || "Other",
       orNull(d.firstVisitDate), orNull(d.lastVisitDate),
       !!d.stillTreating, orNull(d.totalBilled), orNull(d.totalPaid),
       d.description || "", d.notes || ""]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Medical treatment create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `UPDATE case_medical_treatments SET
        provider_name=$1, provider_type=$2, first_visit_date=$3, last_visit_date=$4,
        still_treating=$5, total_billed=$6, total_paid=$7, description=$8, notes=$9
       WHERE id=$10 AND case_id=$11 RETURNING *`,
      [d.providerName || "", d.providerType || "Other",
       orNull(d.firstVisitDate), orNull(d.lastVisitDate),
       !!d.stillTreating, orNull(d.totalBilled), orNull(d.totalPaid),
       d.description || "", d.notes || "", req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Medical treatment update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_medical_treatments SET deleted_at = NOW() WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Medical treatment delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
