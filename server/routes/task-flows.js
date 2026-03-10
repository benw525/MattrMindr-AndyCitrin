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
  conditions: row.conditions || [],
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

async function saveSteps(client, flowId, steps) {
  const savedSteps = [];
  if (!Array.isArray(steps)) return savedSteps;
  const tempIdMap = {};
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const conditions = Array.isArray(s.conditions) ? s.conditions : [];
    const { rows: stepRows } = await client.query(
      `INSERT INTO custom_task_flow_steps
       (flow_id, title, assigned_role, assigned_user_id, due_in_days, priority,
        depends_on_step_id, conditions, recurring, recurring_days, auto_escalate,
        escalate_medium_days, escalate_high_days, escalate_urgent_days, notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        flowId, s.title, s.assignedRole || null, s.assignedUserId || null,
        s.dueInDays || null, s.priority || "Medium",
        null, JSON.stringify(conditions), !!s.recurring, s.recurringDays || null,
        s.autoEscalate !== false,
        s.escalateMediumDays || 30, s.escalateHighDays || 14, s.escalateUrgentDays || 7,
        s.notes || "", i,
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
  return savedSteps;
}

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
    const savedSteps = await saveSteps(client, flow.id, steps);
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
    const savedSteps = await saveSteps(client, parseInt(req.params.id), steps);
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

function evaluateConditionValue(fieldVal, operator, condValue) {
  switch (operator) {
    case "equals": return String(fieldVal) === String(condValue);
    case "not_equals": return String(fieldVal) !== String(condValue);
    case "is_true": return fieldVal === true || fieldVal === "true";
    case "is_false": return fieldVal === false || fieldVal === "false" || !fieldVal;
    case "contains": return String(fieldVal || "").toLowerCase().includes(String(condValue || "").toLowerCase());
    case "greater_than": return Number(fieldVal) > Number(condValue);
    case "less_than": return Number(fieldVal) < Number(condValue);
    case "changed_to": return false;
    default: return String(fieldVal) === String(condValue);
  }
}

async function evaluateStepConditions(conditions, caseId, newData, stepIdToTaskId, steps) {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;

  for (const cond of conditions) {
    switch (cond.type) {
      case "prior_step": {
        const depIdx = cond.stepIndex;
        if (depIdx == null) continue;
        const depStep = steps[depIdx];
        if (!depStep || !stepIdToTaskId[depStep.id]) return false;
        break;
      }
      case "case_field": {
        const fieldVal = newData[cond.field];
        if (!evaluateConditionValue(fieldVal, cond.operator, cond.value)) return false;
        break;
      }
      case "task_status": {
        const pattern = (cond.taskTitle || "").toLowerCase();
        const requiredStatus = cond.status || "Completed";
        if (!pattern) continue;
        const { rows: matchTasks } = await pool.query(
          "SELECT id, status FROM tasks WHERE case_id = $1 AND LOWER(title) LIKE $2 ORDER BY id DESC LIMIT 1",
          [caseId, `%${pattern}%`]
        );
        if (matchTasks.length === 0 || matchTasks[0].status !== requiredStatus) return false;
        break;
      }
      case "role_assigned": {
        const roleField = {
          "Attorney": "lead_attorney",
          "Lead Attorney": "lead_attorney",
          "Second Attorney": "second_attorney",
          "Case Manager": "case_manager",
          "Investigator": "investigator",
          "Paralegal": "paralegal",
        }[cond.role];
        if (roleField) {
          const val = newData[roleField] || newData[cond.role?.toLowerCase()?.replace(/ /g, "_")];
          if (!val) return false;
        }
        break;
      }
      case "case_age": {
        const minDays = parseInt(cond.minDays) || 0;
        if (minDays <= 0) continue;
        const { rows: caseRows } = await pool.query(
          "SELECT created_at FROM cases WHERE id = $1", [caseId]
        );
        if (caseRows.length > 0) {
          const created = new Date(caseRows[0].created_at);
          const daysSince = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < minDays) return false;
        }
        break;
      }
      case "has_document": {
        const docPattern = (cond.documentName || "").toLowerCase();
        if (!docPattern) continue;
        const { rows: docs } = await pool.query(
          "SELECT id FROM case_documents WHERE case_id = $1 AND LOWER(filename) LIKE $2 LIMIT 1",
          [caseId, `%${docPattern}%`]
        );
        if (docs.length === 0) return false;
        break;
      }
      case "priority_level": {
        const { rows: highTasks } = await pool.query(
          "SELECT COUNT(*) as cnt FROM tasks WHERE case_id = $1 AND priority = $2 AND status != 'Completed'",
          [caseId, cond.priority || "Urgent"]
        );
        const op = cond.countOperator || "greater_than";
        const threshold = parseInt(cond.countValue) || 0;
        const cnt = parseInt(highTasks[0].cnt);
        if (op === "greater_than" && cnt <= threshold) return false;
        if (op === "equals" && cnt !== threshold) return false;
        if (op === "less_than" && cnt >= threshold) return false;
        break;
      }
      default:
        break;
    }
  }
  return true;
}

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

        const stepConditions = step.conditions || [];
        if (stepConditions.length > 0) {
          const condsMet = await evaluateStepConditions(stepConditions, caseId, newData, stepIdToTaskId, steps);
          if (!condsMet) continue;
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

        const hasAnyDep = !!step.depends_on_step_id || stepConditions.some(c => c.type === "prior_step");

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
            hasAnyDep, step.notes || "", flow.id,
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
