const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  title: row.title,
  assigned: row.assigned || 0,
  assignedRole: row.assigned_role || null,
  due: row.due ? row.due.toISOString().split("T")[0] : null,
  priority: row.priority,
  autoEscalate: row.auto_escalate,
  status: row.status,
  notes: row.notes,
  recurring: row.recurring,
  recurringDays: row.recurring_days,
  isGenerated: row.is_generated,
  isChained: row.is_chained,
  completedAt: row.completed_at ? row.completed_at.toISOString().split("T")[0] : null,
  timeLogged: row.time_logged || null,
  completedBy: row.completed_by || null,
  timeLogUser: row.time_log_user || null,
});

const orNull = (val) => (val && String(val).trim() && String(val) !== "0") ? val : null;

router.get("/", requireAuth, async (req, res) => {
  try {
    const { caseId } = req.query;
    let query = "SELECT * FROM tasks";
    const params = [];
    if (caseId) {
      query += " WHERE case_id = $1";
      params.push(caseId);
    }
    query += " ORDER BY created_at";
    const { rows } = await pool.query(query, params);
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Tasks fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks
        (case_id, title, assigned, assigned_role, due, priority, auto_escalate, status,
         notes, recurring, recurring_days, is_generated, is_chained)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        d.caseId, d.title, orNull(d.assigned), d.assignedRole || null,
        d.due || null, d.priority || "Medium",
        d.autoEscalate !== false, d.status || "Not Started",
        d.notes || "", d.recurring || false,
        d.recurringDays || null, d.isGenerated || false, d.isChained || false,
      ]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Task create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/bulk", requireAuth, async (req, res) => {
  const tasks = req.body;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: "Expected an array of tasks" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = [];
    for (const d of tasks) {
      const { rows } = await client.query(
        `INSERT INTO tasks
          (case_id, title, assigned, assigned_role, due, priority, auto_escalate, status,
           notes, recurring, recurring_days, is_generated, is_chained)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [
          d.caseId, d.title, orNull(d.assigned), d.assignedRole || null,
          d.due || null, d.priority || "Medium",
          d.autoEscalate !== false, d.status || "Not Started",
          d.notes || "", d.recurring || false,
          d.recurringDays || null, d.isGenerated || false, d.isChained || false,
        ]
      );
      created.push(toFrontend(rows[0]));
    }
    await client.query("COMMIT");
    return res.status(201).json(created);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Bulk task create error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

router.put("/reassign-by-role", requireAuth, async (req, res) => {
  const { caseId, role, userId } = req.body;
  if (!caseId || !role) return res.status(400).json({ error: "Missing caseId or role" });
  const assignedVal = (userId && userId !== 0) ? userId : null;
  try {
    const { rows } = await pool.query(
      `UPDATE tasks SET assigned = $1
       WHERE case_id = $2 AND assigned_role = $3 AND status != 'Completed'
       RETURNING *`,
      [assignedVal, caseId, role]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Reassign tasks error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const fields = [];
    const params = [];
    let i = 1;
    const map = {
      title: "title", assigned: "assigned", assignedRole: "assigned_role",
      due: "due", priority: "priority",
      autoEscalate: "auto_escalate", status: "status", notes: "notes",
      recurring: "recurring", recurringDays: "recurring_days",
      completedAt: "completed_at",
    };
    for (const [jsKey, dbCol] of Object.entries(map)) {
      if (jsKey in d) {
        fields.push(`${dbCol} = $${i++}`);
        let val = d[jsKey];
        if (jsKey === "assigned" && (!val || val === 0)) val = null;
        if ((jsKey === "due" || jsKey === "completedAt") && !val) val = null;
        params.push(val);
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: "No fields to update" });
    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE tasks SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Task update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/complete", requireAuth, async (req, res) => {
  try {
    const { rows: current } = await pool.query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
    if (current.length === 0) return res.status(404).json({ error: "Not found" });
    const task = current[0];
    const completing = task.status !== "Completed";
    const today = new Date().toISOString().split("T")[0];
    const b = req.body || {};
    const timeLogged   = (completing && b.timeLogged)   ? b.timeLogged           : null;
    const completedBy  = (completing && b.completedBy)  ? Number(b.completedBy)  : null;
    const timeLogUser  = (completing && b.timeLogUser)  ? Number(b.timeLogUser)  : null;
    const { rows } = await pool.query(
      `UPDATE tasks SET status = $1, completed_at = $2, time_logged = $3, completed_by = $4, time_log_user = $5 WHERE id = $6 RETURNING *`,
      [completing ? "Completed" : "In Progress", completing ? today : null, timeLogged, completedBy, timeLogUser, req.params.id]
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Task complete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
