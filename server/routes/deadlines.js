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
    const roles = req.session.userRoles || [req.session.userRole];
    const isAdmin = roles.includes("App Admin");
    if (isAdmin) {
      const { rows } = await pool.query("SELECT * FROM deadlines WHERE deleted_at IS NULL ORDER BY date");
      return res.json(rows.map(toFrontend));
    }
    const uid = req.session.userId;
    const { rows } = await pool.query(
      `SELECT d.* FROM deadlines d
       JOIN cases c ON d.case_id = c.id
       WHERE d.deleted_at IS NULL AND (c.lead_attorney = $1 OR c.second_attorney = $1
          OR c.case_manager = $1 OR c.investigator = $1
          OR c.paralegal = $1)
       ORDER BY d.date`,
      [uid]
    );
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
    const created = rows[0];
    const type = (created.type || "").toLowerCase();
    let eventType = "deadline";
    if (type === "hearing" || type === "court appearance") eventType = "hearing";
    if (type === "court date") eventType = "court_date";
    if (type === "appointment" || type === "treatment") eventType = "appointment";
    if (type === "sol" || type === "statute of limitations") eventType = "deadline";
    const { scheduleForNewEvent } = require("../sms-scheduler");
    scheduleForNewEvent(created.case_id, eventType, created.title, created.date).catch(err => console.error("SMS auto-schedule error:", err));

    return res.status(201).json(toFrontend(created));
  } catch (err) {
    console.error("Deadline create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const { date, title, type, rule, assigned } = req.body;
  try {
    const oldRes = await pool.query("SELECT * FROM deadlines WHERE id = $1", [req.params.id]);
    const oldRow = oldRes.rows[0];

    const sets = [];
    const vals = [];
    let idx = 1;
    if (date !== undefined) { sets.push(`date = $${idx++}`); vals.push(date); }
    if (title !== undefined) { sets.push(`title = $${idx++}`); vals.push(title); }
    if (type !== undefined) { sets.push(`type = $${idx++}`); vals.push(type); }
    if (rule !== undefined) { sets.push(`rule = $${idx++}`); vals.push(rule); }
    if (assigned !== undefined) { sets.push(`assigned = $${idx++}`); vals.push(assigned); }
    if (sets.length === 0) return res.json({ ok: true });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE deadlines SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    const updated = rows[0];
    if (oldRow && (date !== undefined || title !== undefined || type !== undefined)) {
      const { cancelForEvent, scheduleForNewEvent } = require("../sms-scheduler");
      cancelForEvent(oldRow.case_id, oldRow.title, oldRow.date).catch(err => console.error("SMS cancel error:", err));
      const t = (updated.type || "").toLowerCase();
      let eventType = "deadline";
      if (t === "hearing" || t === "court appearance") eventType = "hearing";
      if (t === "court date") eventType = "court_date";
      if (t === "appointment" || t === "treatment") eventType = "appointment";
      if (t === "sol" || t === "statute of limitations") eventType = "deadline";
      scheduleForNewEvent(updated.case_id, eventType, updated.title, updated.date).catch(err => console.error("SMS reschedule error:", err));
    }

    return res.json(toFrontend(updated));
  } catch (err) {
    console.error("Deadline update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("UPDATE deadlines SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const { cancelForEvent } = require("../sms-scheduler");
    cancelForEvent(rows[0].case_id, rows[0].title, rows[0].date).catch(err => console.error("SMS cancel error:", err));
    return res.json({ ok: true });
  } catch (err) {
    console.error("Deadline delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
