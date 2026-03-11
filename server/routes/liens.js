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
  reductionValue: r.reduction_value ? parseFloat(r.reduction_value) : null,
  reductionIsPercent: !!r.reduction_is_percent,
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
      `INSERT INTO case_liens (case_id, lien_type, lienholder_name, amount, negotiated_amount, status, notes, reduction_value, reduction_is_percent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.caseId, d.lienType || "Medical", d.lienholderName || "",
       orNull(d.amount), orNull(d.negotiatedAmount), d.status || "Pending", d.notes || "",
       orNull(d.reductionValue), !!d.reductionIsPercent]
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
    const lienFieldMap = {
      lienType: "lien_type",
      lienholderName: "lienholder_name",
      amount: "amount",
      negotiatedAmount: "negotiated_amount",
      status: "status",
      notes: "notes",
      reductionValue: "reduction_value",
      reductionIsPercent: "reduction_is_percent",
    };
    const nullableFields = new Set(["amount", "negotiatedAmount", "reductionValue"]);
    const boolFields = new Set(["reductionIsPercent"]);
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const [camel, col] of Object.entries(lienFieldMap)) {
      if (d[camel] !== undefined) {
        sets.push(`${col}=$${idx++}`);
        vals.push(boolFields.has(camel) ? !!d[camel] : (nullableFields.has(camel) ? orNull(d[camel]) : d[camel]));
      }
    }
    if (!sets.length) {
      const { rows } = await pool.query(
        "SELECT * FROM case_liens WHERE id=$1 AND case_id=$2 AND deleted_at IS NULL",
        [req.params.id, req.params.caseId]
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      return res.json(toFrontend(rows[0]));
    }
    vals.push(req.params.id, req.params.caseId);
    const { rows } = await pool.query(
      `UPDATE case_liens SET ${sets.join(", ")} WHERE id=$${idx++} AND case_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      vals
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
