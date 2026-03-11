const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (r) => ({
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
});

const fieldMap = {
  policyType: "policy_type",
  carrierName: "carrier_name",
  policyNumber: "policy_number",
  policyLimits: "policy_limits",
  adjusterName: "adjuster_name",
  adjusterPhone: "adjuster_phone",
  adjusterEmail: "adjuster_email",
  claimNumber: "claim_number",
  insuredName: "insured_name",
  notes: "notes",
};

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_insurance_policies WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at",
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
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
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Insurance create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const [camel, col] of Object.entries(fieldMap)) {
      if (d[camel] !== undefined) {
        sets.push(`${col}=$${idx++}`);
        vals.push(d[camel]);
      }
    }
    if (!sets.length) {
      const { rows } = await pool.query(
        "SELECT * FROM case_insurance_policies WHERE id=$1 AND case_id=$2 AND deleted_at IS NULL",
        [req.params.id, req.params.caseId]
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      return res.json(toFrontend(rows[0]));
    }
    vals.push(req.params.id, req.params.caseId);
    const { rows } = await pool.query(
      `UPDATE case_insurance_policies SET ${sets.join(", ")} WHERE id=$${idx++} AND case_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Insurance update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_insurance_policies SET deleted_at = NOW() WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    await pool.query(
      "UPDATE case_negotiations SET policy_id = NULL WHERE policy_id = $1 AND case_id = $2",
      [req.params.id, req.params.caseId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Insurance delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
