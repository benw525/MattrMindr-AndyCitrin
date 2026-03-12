const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (r) => ({
  id: r.id,
  caseId: r.case_id,
  name: r.name || "",
  category: r.category,
  description: r.description,
  amount: r.amount ? parseFloat(r.amount) : null,
  documentationStatus: r.documentation_status,
  notes: r.notes,
  billed: r.billed ? parseFloat(r.billed) : null,
  owed: r.owed ? parseFloat(r.owed) : null,
  reductionValue: r.reduction_value ? parseFloat(r.reduction_value) : null,
  reductionIsPercent: !!r.reduction_is_percent,
  clientPaid: r.client_paid ? parseFloat(r.client_paid) : null,
  firmPaid: r.firm_paid ? parseFloat(r.firm_paid) : null,
  insurancePaid: r.insurance_paid ? parseFloat(r.insurance_paid) : null,
  writeOff: r.write_off ? parseFloat(r.write_off) : null,
  createdAt: r.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_damages WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at",
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
      `INSERT INTO case_damages (case_id, name, category, description, amount, documentation_status, notes, billed, owed, reduction_value, reduction_is_percent, client_paid, firm_paid, insurance_paid, write_off)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.params.caseId, d.name || "", d.category || "Medical Bills", d.description || "",
       orNull(d.amount), d.documentationStatus || "Pending", d.notes || "",
       orNull(d.billed), orNull(d.owed), orNull(d.reductionValue),
       !!d.reductionIsPercent, orNull(d.clientPaid), orNull(d.firmPaid),
       orNull(d.insurancePaid), orNull(d.writeOff)]
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
    const dmgFieldMap = {
      name: "name",
      category: "category",
      description: "description",
      amount: "amount",
      documentationStatus: "documentation_status",
      notes: "notes",
      billed: "billed",
      owed: "owed",
      reductionValue: "reduction_value",
      reductionIsPercent: "reduction_is_percent",
      clientPaid: "client_paid",
      firmPaid: "firm_paid",
      insurancePaid: "insurance_paid",
      writeOff: "write_off",
    };
    const nullableFields = new Set(["amount", "billed", "owed", "reductionValue", "clientPaid", "firmPaid", "insurancePaid", "writeOff"]);
    const boolFields = new Set(["reductionIsPercent"]);
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const [camel, col] of Object.entries(dmgFieldMap)) {
      if (d[camel] !== undefined) {
        sets.push(`${col}=$${idx++}`);
        vals.push(boolFields.has(camel) ? !!d[camel] : (nullableFields.has(camel) ? orNull(d[camel]) : d[camel]));
      }
    }
    if (!sets.length) {
      const { rows } = await pool.query(
        "SELECT * FROM case_damages WHERE id=$1 AND case_id=$2 AND deleted_at IS NULL",
        [req.params.id, req.params.caseId]
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      return res.json(toFrontend(rows[0]));
    }
    vals.push(req.params.id, req.params.caseId);
    const { rows } = await pool.query(
      `UPDATE case_damages SET ${sets.join(", ")} WHERE id=$${idx++} AND case_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      vals
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
      "UPDATE case_damages SET deleted_at = NOW() WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL RETURNING id",
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
