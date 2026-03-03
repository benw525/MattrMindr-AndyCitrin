const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_insurance_policies WHERE case_id = $1 ORDER BY created_at",
      [req.params.caseId]
    );
    res.json(rows.map(r => ({
      id: r.id,
      caseId: r.case_id,
      policyType: r.policy_type,
      carrierName: r.carrier_name,
      policyNumber: r.policy_number,
      policyLimits: r.policy_limits,
      adjusterName: r.adjuster_name,
      adjusterPhone: r.adjuster_phone,
      adjusterEmail: r.adjuster_email,
      claimNumber: r.claim_number,
      insuredName: r.insured_name,
      notes: r.notes,
      createdAt: r.created_at,
    })));
  } catch (err) {
    console.error("Insurance fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_insurance_policies
        (case_id, policy_type, carrier_name, policy_number, policy_limits,
         adjuster_name, adjuster_phone, adjuster_email, claim_number, insured_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.caseId, d.policyType || "Liability", d.carrierName || "", d.policyNumber || "",
       d.policyLimits || "", d.adjusterName || "", d.adjusterPhone || "", d.adjusterEmail || "",
       d.claimNumber || "", d.insuredName || "", d.notes || ""]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Insurance create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE case_insurance_policies SET
        policy_type=$1, carrier_name=$2, policy_number=$3, policy_limits=$4,
        adjuster_name=$5, adjuster_phone=$6, adjuster_email=$7, claim_number=$8, insured_name=$9, notes=$10
       WHERE id=$11 AND case_id=$12 RETURNING *`,
      [d.policyType || "Liability", d.carrierName || "", d.policyNumber || "", d.policyLimits || "",
       d.adjusterName || "", d.adjusterPhone || "", d.adjusterEmail || "", d.claimNumber || "",
       d.insuredName || "", d.notes || "", req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Insurance update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM case_insurance_policies WHERE id = $1 AND case_id = $2 RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Insurance delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
