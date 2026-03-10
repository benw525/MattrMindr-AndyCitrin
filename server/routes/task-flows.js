const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const ADMIN_ROLES = ["App Admin"];

function requireAdmin(req, res, next) {
  const roles = req.session.userRoles || [req.session.userRole];
  if (!roles.some(r => ADMIN_ROLES.includes(r))) {
    return res.status(403).json({ error: "App Admin access required" });
  }
  next();
}

const flowToFrontend = (row, steps = []) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  triggerCondition: row.trigger_condition,
  triggerOn: row.trigger_on,
  isActive: row.is_active,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  steps: steps.map(stepToFrontend),
});

const stepToFrontend = (row) => ({
  id: row.id,
  flowId: row.flow_id,
  title: row.title,
  assignedRole: row.assigned_role,
  assignedUserId: row.assigned_user_id,
  dueInDays: row.due_in_days,
  priority: row.priority,
  dependsOnStepId: row.depends_on_step_id,
  recurring: row.recurring,
  recurringDays: row.recurring_days,
  autoEscalate: row.auto_escalate,
  escalateMediumDays: row.escalate_medium_days,
  escalateHighDays: row.escalate_high_days,
  escalateUrgentDays: row.escalate_urgent_days,
  notes: row.notes,
  sortOrder: row.sort_order,
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows: flows } = await pool.query(
      "SELECT * FROM custom_task_flows ORDER BY created_at DESC"
    );
    const { rows: allSteps } = await pool.query(
      "SELECT * FROM custom_task_flow_steps ORDER BY sort_order, id"
    );
    const stepsByFlow = {};
    for (const s of allSteps) {
      if (!stepsByFlow[s.flow_id]) stepsByFlow[s.flow_id] = [];
      stepsByFlow[s.flow_id].push(s);
    }
    return res.json(flows.map(f => flowToFrontend(f, stepsByFlow[f.id] || [])));
  } catch (err) {
    console.error("Get task flows error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM custom_task_flows WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const { rows: steps } = await pool.query(
      "SELECT * FROM custom_task_flow_steps WHERE flow_id = $1 ORDER BY sort_order, id",
      [req.params.id]
    );
    return res.json(flowToFrontend(rows[0], steps));
  } catch (err) {
    console.error("Get task flow error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { name, description, triggerCondition, triggerOn, isActive, steps } = req.body;
    if (!name || !triggerCondition) {
      return res.status(400).json({ error: "Name and trigger condition required" });
    }
    const { rows } = await client.query(
      `INSERT INTO custom_task_flows (name, description, trigger_condition, trigger_on, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, description || "", JSON.stringify(triggerCondition), triggerOn || "update", isActive !== false, req.session.userId]
    );
    const flow = rows[0];
    const savedSteps = [];
    if (Array.isArray(steps)) {
      const tempIdMap = {};
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const { rows: stepRows } = await client.query(
          `INSERT INTO custom_task_flow_steps
           (flow_id, title, assigned_role, assigned_user_id, due_in_days, priority,
            depends_on_step_id, recurring, recurring_days, auto_escalate,
            escalate_medium_days, escalate_high_days, escalate_urgent_days, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            flow.id, s.title, s.assignedRole || null, s.assignedUserId || null,
            s.dueInDays || null, s.priority || "Medium",
            null, !!s.recurring, s.recurringDays || null,
            s.autoEscalate !== false,
            s.escalateMediumDays || 30, s.escalateHighDays || 14, s.escalateUrgentDays || 7,
            s.notes || null, i,
          ]
        );
        tempIdMap[s.tempId || i] = stepRows[0].id;
        savedSteps.push(stepRows[0]);
      }
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        let realDepId = null;
        if (s.dependsOnTempId !== undefined && s.dependsOnTempId !== null) {
          realDepId = tempIdMap[s.dependsOnTempId];
        } else if (s.dependsOnStepIndex !== undefined && s.dependsOnStepIndex !== null && savedSteps[s.dependsOnStepIndex]) {
          realDepId = savedSteps[s.dependsOnStepIndex].id;
        }
        if (realDepId) {
          await client.query(
            "UPDATE custom_task_flow_steps SET depends_on_step_id = $1 WHERE id = $2",
            [realDepId, savedSteps[i].id]
          );
          savedSteps[i].depends_on_step_id = realDepId;
        }
      }
    }
    await client.query("COMMIT");
    return res.json(flowToFrontend(flow, savedSteps));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Create task flow error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { name, description, triggerCondition, triggerOn, isActive, steps } = req.body;
    const { rows } = await client.query(
      `UPDATE custom_task_flows SET name=$1, description=$2, trigger_condition=$3,
       trigger_on=$4, is_active=$5, updated_at=NOW() WHERE id=$6 RETURNING *`,
      [name, description || "", JSON.stringify(triggerCondition), triggerOn || "update", isActive !== false, req.params.id]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Not found" });
    }
    await client.query("DELETE FROM custom_task_flow_steps WHERE flow_id = $1", [req.params.id]);
    const savedSteps = [];
    if (Array.isArray(steps)) {
      const tempIdMap = {};
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const { rows: stepRows } = await client.query(
          `INSERT INTO custom_task_flow_steps
           (flow_id, title, assigned_role, assigned_user_id, due_in_days, priority,
            depends_on_step_id, recurring, recurring_days, auto_escalate,
            escalate_medium_days, escalate_high_days, escalate_urgent_days, notes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [
            req.params.id, s.title, s.assignedRole || null, s.assignedUserId || null,
            s.dueInDays || null, s.priority || "Medium",
            null, !!s.recurring, s.recurringDays || null,
            s.autoEscalate !== false,
            s.escalateMediumDays || 30, s.escalateHighDays || 14, s.escalateUrgentDays || 7,
            s.notes || null, i,
          ]
        );
        tempIdMap[s.tempId !== undefined ? s.tempId : i] = stepRows[0].id;
        savedSteps.push(stepRows[0]);
      }
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        let realDepId = null;
        if (s.dependsOnTempId !== undefined && s.dependsOnTempId !== null) {
          realDepId = tempIdMap[s.dependsOnTempId];
        } else if (s.dependsOnStepIndex !== undefined && s.dependsOnStepIndex !== null && savedSteps[s.dependsOnStepIndex]) {
          realDepId = savedSteps[s.dependsOnStepIndex].id;
        }
        if (realDepId) {
          await client.query(
            "UPDATE custom_task_flow_steps SET depends_on_step_id = $1 WHERE id = $2",
            [realDepId, savedSteps[i].id]
          );
          savedSteps[i].depends_on_step_id = realDepId;
        }
      }
    }
    await client.query("COMMIT");
    return res.json(flowToFrontend(rows[0], savedSteps));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Update task flow error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM custom_task_flows WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete task flow error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

async function evaluateFlowsForCase(caseId, oldData, newData, triggerType) {
  const eventType = triggerType || (oldData ? "update" : "create");
  try {
    const { rows: flows } = await pool.query(
      "SELECT * FROM custom_task_flows WHERE is_active = true"
    );
    if (flows.length === 0) return;

    for (const flow of flows) {
      const flowTriggerOn = flow.trigger_on || "update";
      if (flowTriggerOn !== "both" && flowTriggerOn !== eventType) continue;

      const cond = flow.trigger_condition;
      if (!cond || !cond.field) continue;

      const newVal = newData[cond.field];
      const oldVal = oldData ? oldData[cond.field] : undefined;

      let conditionMet = false;
      switch (cond.operator) {
        case "equals": conditionMet = String(newVal) === String(cond.value); break;
        case "not_equals": conditionMet = String(newVal) !== String(cond.value); break;
        case "is_true": conditionMet = newVal === true || newVal === "true"; break;
        case "is_false": conditionMet = newVal === false || newVal === "false" || !newVal; break;
        case "contains": conditionMet = String(newVal || "").toLowerCase().includes(String(cond.value || "").toLowerCase()); break;
        case "greater_than": conditionMet = Number(newVal) > Number(cond.value); break;
        case "less_than": conditionMet = Number(newVal) < Number(cond.value); break;
        case "changed_to":
          conditionMet = String(newVal) === String(cond.value) && (oldData ? String(oldVal) !== String(cond.value) : true);
          break;
        default: conditionMet = String(newVal) === String(cond.value);
      }

      if (!conditionMet) continue;

      if (oldData && cond.operator !== "changed_to") {
        let wasAlreadyMet = false;
        const ov = oldVal;
        switch (cond.operator) {
          case "equals": wasAlreadyMet = String(ov) === String(cond.value); break;
          case "not_equals": wasAlreadyMet = String(ov) !== String(cond.value); break;
          case "is_true": wasAlreadyMet = ov === true || ov === "true"; break;
          case "is_false": wasAlreadyMet = ov === false || ov === "false" || !ov; break;
          case "contains": wasAlreadyMet = String(ov || "").toLowerCase().includes(String(cond.value || "").toLowerCase()); break;
          case "greater_than": wasAlreadyMet = Number(ov) > Number(cond.value); break;
          case "less_than": wasAlreadyMet = Number(ov) < Number(cond.value); break;
          default: wasAlreadyMet = String(ov) === String(cond.value);
        }
        if (wasAlreadyMet) continue;
      }

      const { rows: existing } = await pool.query(
        "SELECT id FROM task_flow_executions WHERE flow_id = $1 AND case_id = $2",
        [flow.id, caseId]
      );
      if (existing.length > 0) continue;

      await pool.query(
        "INSERT INTO task_flow_executions (flow_id, case_id, triggered_by) VALUES ($1, $2, $3)",
        [flow.id, caseId, newData._triggeredBy || null]
      );

      const { rows: steps } = await pool.query(
        "SELECT * FROM custom_task_flow_steps WHERE flow_id = $1 ORDER BY sort_order, id",
        [flow.id]
      );

      const today = new Date().toISOString().slice(0, 10);
      const stepIdToTaskId = {};

      for (const step of steps) {
        if (step.depends_on_step_id && !stepIdToTaskId[step.depends_on_step_id]) {
          continue;
        }

        let dueDate = null;
        if (step.due_in_days) {
          const d = new Date();
          d.setDate(d.getDate() + step.due_in_days);
          dueDate = d.toISOString().slice(0, 10);
        }

        let assignedUserId = step.assigned_user_id || null;
        if (!assignedUserId && step.assigned_role) {
          const { rows: roleUsers } = await pool.query(
            "SELECT id FROM users WHERE $1 = ANY(roles) LIMIT 1",
            [step.assigned_role]
          );
          if (roleUsers.length > 0) assignedUserId = roleUsers[0].id;
        }

        const { rows: taskRows } = await pool.query(
          `INSERT INTO tasks (case_id, title, assigned, assigned_role, due, priority, status,
            recurring, recurring_days, auto_escalate, escalate_medium_days, escalate_high_days,
            escalate_urgent_days, is_generated, is_chained, notes, source_flow_id)
           VALUES ($1,$2,$3,$4,$5,$6,'Not Started',$7,$8,$9,$10,$11,$12,true,$13,$14,$15) RETURNING id`,
          [
            caseId, step.title, assignedUserId, step.assigned_role,
            dueDate, step.priority,
            step.recurring, step.recurring_days, step.auto_escalate,
            step.escalate_medium_days, step.escalate_high_days, step.escalate_urgent_days,
            !!step.depends_on_step_id, step.notes, flow.id,
          ]
        );
        stepIdToTaskId[step.id] = taskRows[0].id;
      }

      console.log(`Task flow "${flow.name}" triggered for case ${caseId}: created ${Object.keys(stepIdToTaskId).length} tasks`);
    }
  } catch (err) {
    console.error("Evaluate task flows error:", err);
  }
}

router.post("/evaluate/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows: caseRows } = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.caseId]);
    if (caseRows.length === 0) return res.status(404).json({ error: "Case not found" });
    await evaluateFlowsForCase(req.params.caseId, null, { ...caseRows[0], _triggeredBy: req.session.userId });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Evaluate flows error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
module.exports.evaluateFlowsForCase = evaluateFlowsForCase;
