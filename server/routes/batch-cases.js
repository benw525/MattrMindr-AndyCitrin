const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const ALLOWED_ROLES = [
  "Public Defender",
  "Chief Deputy Public Defender",
  "Deputy Public Defender",
  "Senior Trial Attorney",
  "IT Specialist",
  "App Admin",
];

const ROLE_FIELD_MAP = {
  assignedAttorney: "lead_attorney",
  secondAttorney: "second_attorney",
  trialCoordinator: "trial_coordinator",
  investigator: "investigator",
  socialWorker: "social_worker",
};

const ROLE_FIELD_LABELS = {
  assignedAttorney: "Assigned Attorney",
  secondAttorney: "Second Attorney",
  trialCoordinator: "Trial Coordinator",
  investigator: "Investigator",
  socialWorker: "Social Worker",
};

const VALID_STATUSES = ["Active", "Closed", "Pending", "Disposed", "Transferred"];
const VALID_STAGES = ["Arraignment", "Preliminary Hearing", "Grand Jury/Indictment", "Pre-Trial Motions", "Plea Negotiations", "Trial", "Sentencing", "Post-Conviction", "Appeal"];
const VALID_DIVISIONS = ["Circuit", "District", "Juvenile"];

function requireBatchRole(req, res, next) {
  const userRoles = req.session.roles || [];
  if (!userRoles.some(r => ALLOWED_ROLES.includes(r))) {
    return res.status(403).json({ error: "Insufficient permissions for batch operations" });
  }
  next();
}

const toFrontendCase = (row) => ({
  id: row.id,
  title: row.title,
  caseNum: row.case_num,
  defendantName: row.defendant_name,
  status: row.status,
  stage: row.stage,
  courtDivision: row.court_division,
  nextCourtDate: row.next_court_date,
  assignedAttorney: row.lead_attorney,
  secondAttorney: row.second_attorney,
  trialCoordinator: row.trial_coordinator,
  investigator: row.investigator,
  socialWorker: row.social_worker,
});

function validateStatusFilter(statusFilter) {
  if (statusFilter && statusFilter !== "All" && !VALID_STATUSES.includes(statusFilter)) {
    throw new Error("Invalid status filter");
  }
}

function buildQuery(operation, params) {
  const { fromUserId, toUserId, roleField, statusFilter, caseIds, newStatus, fromStage, toStage, newDate, newDivision } = params;

  switch (operation) {
    case "reassign-staff": {
      if (!fromUserId || !toUserId || !roleField) throw new Error("fromUserId, toUserId, and roleField are required");
      const col = ROLE_FIELD_MAP[roleField];
      if (!col) throw new Error("Invalid roleField");
      validateStatusFilter(statusFilter);
      let where = `${col} = $1 AND deleted_at IS NULL`;
      const vals = [Number(fromUserId)];
      if (statusFilter && statusFilter !== "All") {
        vals.push(statusFilter);
        where += ` AND status = $${vals.length}`;
      }
      return { where, vals, selectCols: `*, (SELECT name FROM users WHERE id = cases.${col}) AS current_staff_name` };
    }
    case "change-status": {
      if (!caseIds || !caseIds.length || !newStatus) throw new Error("caseIds and newStatus are required");
      if (!VALID_STATUSES.includes(newStatus)) throw new Error("Invalid status");
      const placeholders = caseIds.map((_, i) => `$${i + 1}`).join(", ");
      return { where: `id IN (${placeholders}) AND deleted_at IS NULL`, vals: caseIds.map(Number) };
    }
    case "advance-stage": {
      if (!fromStage || !toStage) throw new Error("fromStage and toStage are required");
      if (!VALID_STAGES.includes(fromStage) || !VALID_STAGES.includes(toStage)) throw new Error("Invalid stage");
      validateStatusFilter(statusFilter);
      let where = `stage = $1 AND deleted_at IS NULL`;
      const vals = [fromStage];
      if (statusFilter && statusFilter !== "All") {
        vals.push(statusFilter);
        where += ` AND status = $${vals.length}`;
      }
      return { where, vals };
    }
    case "update-court-date": {
      if (!caseIds || !caseIds.length || !newDate) throw new Error("caseIds and newDate are required");
      const placeholders = caseIds.map((_, i) => `$${i + 1}`).join(", ");
      return { where: `id IN (${placeholders}) AND deleted_at IS NULL`, vals: caseIds.map(Number) };
    }
    case "transfer-division": {
      if (!caseIds || !caseIds.length || !newDivision) throw new Error("caseIds and newDivision are required");
      if (!VALID_DIVISIONS.includes(newDivision)) throw new Error("Invalid division");
      const placeholders = caseIds.map((_, i) => `$${i + 1}`).join(", ");
      return { where: `id IN (${placeholders}) AND deleted_at IS NULL`, vals: caseIds.map(Number) };
    }
    default:
      throw new Error("Unknown operation: " + operation);
  }
}

router.post("/preview", requireAuth, requireBatchRole, async (req, res) => {
  try {
    const { operation, ...params } = req.body;
    if (!operation) return res.status(400).json({ error: "operation is required" });

    const { where, vals, selectCols } = buildQuery(operation, params);
    const q = `SELECT ${selectCols || "*"} FROM cases WHERE ${where} ORDER BY title`;
    const { rows } = await pool.query(q, vals);

    const fromUser = params.fromUserId ? (await pool.query("SELECT name FROM users WHERE id = $1", [Number(params.fromUserId)])).rows[0] : null;
    const toUser = params.toUserId ? (await pool.query("SELECT name FROM users WHERE id = $1", [Number(params.toUserId)])).rows[0] : null;

    res.json({
      count: rows.length,
      cases: rows.map(r => ({
        ...toFrontendCase(r),
        currentStaffName: r.current_staff_name || null,
      })),
      fromUserName: fromUser?.name || null,
      toUserName: toUser?.name || null,
    });
  } catch (err) {
    console.error("Batch preview error:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post("/", requireAuth, requireBatchRole, async (req, res) => {
  const client = await pool.connect();
  try {
    const { operation, ...params } = req.body;
    if (!operation) return res.status(400).json({ error: "operation is required" });

    const { where, vals } = buildQuery(operation, params);

    await client.query("BEGIN");

    const { rows: cases } = await client.query(`SELECT * FROM cases WHERE ${where} FOR UPDATE`, vals);

    if (cases.length === 0) {
      await client.query("COMMIT");
      client.release();
      return res.json({ count: 0, message: "No cases matched the criteria" });
    }

    const userId = req.session.userId;
    const userName = req.session.name || "System";
    const userRole = (req.session.roles || [])[0] || "Unknown";
    let detail = "";

    switch (operation) {
      case "reassign-staff": {
        const col = ROLE_FIELD_MAP[params.roleField];
        if (!col) throw new Error("Invalid roleField");
        const label = ROLE_FIELD_LABELS[params.roleField];
        const toUser = (await client.query("SELECT name FROM users WHERE id = $1", [Number(params.toUserId)])).rows[0];
        const fromUser = (await client.query("SELECT name FROM users WHERE id = $1", [Number(params.fromUserId)])).rows[0];
        if (!toUser) throw new Error("Target staff member not found");
        detail = `${label} reassigned from ${fromUser?.name || "Unknown"} to ${toUser.name}`;
        for (const c of cases) {
          await client.query(`UPDATE cases SET ${col} = $1, updated_at = NOW() WHERE id = $2`, [Number(params.toUserId), c.id]);
          await client.query(
            "INSERT INTO case_activity (case_id, user_id, user_name, user_role, action, detail) VALUES ($1, $2, $3, $4, $5, $6)",
            [c.id, userId, userName, userRole, "Attorney reassigned", detail]
          );
        }
        break;
      }
      case "change-status": {
        if (!VALID_STATUSES.includes(params.newStatus)) throw new Error("Invalid status");
        detail = `Status changed to ${params.newStatus}`;
        for (const c of cases) {
          await client.query("UPDATE cases SET status = $1, updated_at = NOW() WHERE id = $2", [params.newStatus, c.id]);
          await client.query(
            "INSERT INTO case_activity (case_id, user_id, user_name, user_role, action, detail) VALUES ($1, $2, $3, $4, $5, $6)",
            [c.id, userId, userName, userRole, "Status changed", `${c.status} → ${params.newStatus} (batch update)`]
          );
        }
        break;
      }
      case "advance-stage": {
        if (!VALID_STAGES.includes(params.toStage)) throw new Error("Invalid stage");
        detail = `Stage advanced from ${params.fromStage} to ${params.toStage}`;
        for (const c of cases) {
          await client.query("UPDATE cases SET stage = $1, updated_at = NOW() WHERE id = $2", [params.toStage, c.id]);
          await client.query(
            "INSERT INTO case_activity (case_id, user_id, user_name, user_role, action, detail) VALUES ($1, $2, $3, $4, $5, $6)",
            [c.id, userId, userName, userRole, "Field Updated", `Stage: ${params.fromStage} → ${params.toStage} (batch update)`]
          );
        }
        break;
      }
      case "update-court-date": {
        detail = `Next court date updated to ${params.newDate}`;
        for (const c of cases) {
          await client.query("UPDATE cases SET next_court_date = $1, updated_at = NOW() WHERE id = $2", [params.newDate, c.id]);
          await client.query(
            "INSERT INTO case_activity (case_id, user_id, user_name, user_role, action, detail) VALUES ($1, $2, $3, $4, $5, $6)",
            [c.id, userId, userName, userRole, "Court date updated", `Next court date set to ${params.newDate} (batch update)`]
          );
        }
        break;
      }
      case "transfer-division": {
        if (!VALID_DIVISIONS.includes(params.newDivision)) throw new Error("Invalid division");
        detail = `Court division changed to ${params.newDivision}`;
        for (const c of cases) {
          await client.query("UPDATE cases SET court_division = $1, updated_at = NOW() WHERE id = $2", [params.newDivision, c.id]);
          await client.query(
            "INSERT INTO case_activity (case_id, user_id, user_name, user_role, action, detail) VALUES ($1, $2, $3, $4, $5, $6)",
            [c.id, userId, userName, userRole, "Field Updated", `Division: ${c.court_division || "None"} → ${params.newDivision} (batch update)`]
          );
        }
        break;
      }
    }

    await client.query("COMMIT");
    res.json({ count: cases.length, message: `${cases.length} case${cases.length === 1 ? "" : "s"} updated: ${detail}` });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Batch apply error:", err);
    res.status(500).json({ error: err.message || "Batch operation failed" });
  } finally {
    client.release();
  }
});

module.exports = router;
