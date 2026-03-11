const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (r) => ({
  id: r.id,
  caseId: r.case_id,
  date: r.date ? r.date.toISOString().split("T")[0] : "",
  direction: r.direction,
  amount: r.amount ? parseFloat(r.amount) : null,
  fromParty: r.from_party,
  notes: r.notes,
  policyId: r.policy_id || null,
  createdAt: r.created_at,
});

const fieldMap = {
  date: "date",
  direction: "direction",
  amount: "amount",
  fromParty: "from_party",
  notes: "notes",
  policyId: "policy_id",
};

const orNull = (v) => (v && String(v).trim()) ? v : null;

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_negotiations WHERE case_id = $1 AND deleted_at IS NULL ORDER BY date ASC NULLS LAST, created_at",
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Negotiations fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_negotiations (case_id, date, direction, amount, from_party, notes, policy_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.caseId, orNull(d.date), d.direction || "Demand",
       orNull(d.amount), d.fromParty || "", d.notes || "", orNull(d.policyId)]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Negotiation create error:", err);
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
        const val = (camel === "date" || camel === "amount" || camel === "policyId") ? orNull(d[camel]) : d[camel];
        sets.push(`${col}=$${idx++}`);
        vals.push(val);
      }
    }
    if (!sets.length) {
      const { rows } = await pool.query(
        "SELECT * FROM case_negotiations WHERE id=$1 AND case_id=$2 AND deleted_at IS NULL",
        [req.params.id, req.params.caseId]
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      return res.json(toFrontend(rows[0]));
    }
    vals.push(req.params.id, req.params.caseId);
    const { rows } = await pool.query(
      `UPDATE case_negotiations SET ${sets.join(", ")} WHERE id=$${idx++} AND case_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Negotiation update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_negotiations SET deleted_at = NOW() WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Negotiation delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
