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
  date: r.date,
  vendor: r.vendor,
  status: r.status,
  notes: r.notes,
  createdAt: r.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_expenses WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at",
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Expenses fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_expenses (case_id, category, description, amount, date, vendor, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.caseId, d.category || "Other", d.description || "",
       orNull(d.amount), orNull(d.date), d.vendor || "", d.status || "Pending", d.notes || ""]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Expense create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `UPDATE case_expenses SET category=$1, description=$2, amount=$3, date=$4, vendor=$5, status=$6, notes=$7
       WHERE id=$8 AND case_id=$9 RETURNING *`,
      [d.category || "Other", d.description || "", orNull(d.amount),
       orNull(d.date), d.vendor || "", d.status || "Pending", d.notes || "",
       req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Expense update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_expenses SET deleted_at = NOW() WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Expense delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
