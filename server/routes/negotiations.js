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
  createdAt: r.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_negotiations WHERE case_id = $1 ORDER BY date ASC NULLS LAST, created_at",
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
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_negotiations (case_id, date, direction, amount, from_party, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.caseId, orNull(d.date), d.direction || "Demand",
       orNull(d.amount), d.fromParty || "", d.notes || ""]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Negotiation create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `UPDATE case_negotiations SET date=$1, direction=$2, amount=$3, from_party=$4, notes=$5
       WHERE id=$6 AND case_id=$7 RETURNING *`,
      [orNull(d.date), d.direction || "Demand", orNull(d.amount),
       d.fromParty || "", d.notes || "", req.params.id, req.params.caseId]
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
      "DELETE FROM case_negotiations WHERE id = $1 AND case_id = $2 RETURNING id",
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
