const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  userId: row.user_id,
  caseId: row.case_id,
  caseTitle: row.case_title || "",
  fileNum: row.file_num || "",
  date: row.date instanceof Date ? row.date.toISOString() : row.date,
  detail: row.detail,
  time: row.time || "",
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

router.get("/", requireAuth, async (req, res) => {
  const { userId, from, to } = req.query;
  try {
    const conditions = [];
    const vals = [];
    let idx = 1;
    if (userId) { conditions.push(`user_id = $${idx++}`); vals.push(Number(userId)); }
    if (from) { conditions.push(`date >= $${idx++}`); vals.push(from); }
    if (to) { conditions.push(`date <= $${idx++}::date + interval '1 day'`); vals.push(to); }
    conditions.push("deleted_at IS NULL");
    const where = "WHERE " + conditions.join(" AND ");
    const { rows } = await pool.query(
      `SELECT * FROM time_entries ${where} ORDER BY date DESC`, vals
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Time entries fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const { caseId, date, detail, time } = req.body;
  if (!caseId) return res.status(400).json({ error: "Case is required" });
  try {
    const { rows: caseRows } = await pool.query(
      "SELECT title, file_num FROM cases WHERE id = $1", [caseId]
    );
    const caseTitle = caseRows.length > 0 ? caseRows[0].title : "";
    const fileNum = caseRows.length > 0 ? caseRows[0].file_num : "";
    const { rows } = await pool.query(
      `INSERT INTO time_entries (user_id, case_id, case_title, file_num, date, detail, time)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.session.userId, caseId, caseTitle, fileNum, date || new Date().toISOString(), detail || "", time || null]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Time entry create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const { detail, time, caseId, date } = req.body;
  try {
    const { rows: existing } = await pool.query("SELECT * FROM time_entries WHERE id = $1", [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: "Not found" });
    if (existing[0].user_id !== req.session.userId) return res.status(403).json({ error: "Permission denied" });
    const sets = ["updated_at = NOW()"];
    const vals = [];
    let idx = 1;
    if (detail !== undefined) { sets.push(`detail = $${idx++}`); vals.push(detail); }
    if (time !== undefined) { sets.push(`time = $${idx++}`); vals.push(time || null); }
    if (date !== undefined) { sets.push(`date = $${idx++}`); vals.push(date); }
    if (caseId !== undefined) {
      sets.push(`case_id = $${idx++}`); vals.push(caseId);
      const { rows: caseRows } = await pool.query("SELECT title, file_num FROM cases WHERE id = $1", [caseId]);
      if (caseRows.length > 0) {
        sets.push(`case_title = $${idx++}`); vals.push(caseRows[0].title);
        sets.push(`file_num = $${idx++}`); vals.push(caseRows[0].file_num);
      }
    }
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE time_entries SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Time entry update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM time_entries WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (rows[0].user_id !== req.session.userId) return res.status(403).json({ error: "Permission denied" });
    await pool.query("UPDATE time_entries SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Time entry delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
