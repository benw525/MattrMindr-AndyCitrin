const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  ts: row.ts instanceof Date ? row.ts.toISOString() : row.ts,
  userId: row.user_id,
  userName: row.user_name,
  userRole: row.user_role,
  action: row.action,
  detail: row.detail,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_activity WHERE case_id = $1 ORDER BY ts DESC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Activity fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_activity (case_id, ts, user_id, user_name, user_role, action, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [d.caseId, d.ts || new Date().toISOString(),
       d.userId || null, d.userName || "", d.userRole || "",
       d.action, d.detail || ""]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Activity create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
