const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  title: row.title,
  date: row.date ? row.date.toISOString().split("T")[0] : "",
  type: row.type,
  rule: row.rule,
  assigned: row.assigned || 0,
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM deadlines ORDER BY date");
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Deadlines fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO deadlines (case_id, title, date, type, rule, assigned)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.caseId, d.title, d.date, d.type || "Filing", d.rule || "", d.assigned || null]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Deadline create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
