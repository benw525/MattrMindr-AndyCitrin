const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

async function verifyCaseAccess(caseId, req) {
  const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
  if (!rows.length) return null;
  const row = rows[0];
  if (!row.confidential) return row;
  const roles = req.session.userRoles || [req.session.userRole];
  if (roles.includes("App Admin")) return row;
  const uid = req.session.userId;
  if ([row.lead_attorney, row.second_attorney, row.trial_coordinator, row.investigator, row.social_worker].includes(uid)) return row;
  const customTeam = Array.isArray(row.custom_team) ? row.custom_team : [];
  if (customTeam.some(m => m.userId === uid)) return row;
  return null;
}

router.post("/sessions", requireAuth, async (req, res) => {
  try {
    const { caseId, trialDate, court, judge, status, jurySize, notes } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });
    const caseRow = await verifyCaseAccess(caseId, req);
    if (!caseRow) return res.status(404).json({ error: "Case not found or access denied" });
    const existing = await pool.query("SELECT * FROM trial_sessions WHERE case_id = $1", [caseId]);
    if (existing.rows.length) return res.json(existing.rows[0]);
    const { rows } = await pool.query(
      `INSERT INTO trial_sessions (case_id, trial_date, court, judge, status, jury_size, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [caseId, trialDate || null, court || "", judge || "", status || "pending", jurySize || 12, notes || ""]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create trial session error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/sessions/:caseId", requireAuth, async (req, res) => {
  try {
    const caseRow = await verifyCaseAccess(req.params.caseId, req);
    if (!caseRow) return res.status(404).json({ error: "Case not found or access denied" });
    const { rows } = await pool.query("SELECT * FROM trial_sessions WHERE case_id = $1", [req.params.caseId]);
    if (!rows.length) return res.json(null);
    res.json(rows[0]);
  } catch (err) {
    console.error("Get trial session error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/sessions/:id", requireAuth, async (req, res) => {
  try {
    const { trialDate, court, judge, status, jurySize, notes } = req.body;
    const sess = await pool.query("SELECT * FROM trial_sessions WHERE id = $1", [req.params.id]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      `UPDATE trial_sessions SET trial_date=$1, court=$2, judge=$3, status=$4, jury_size=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [trialDate || null, court || "", judge || "", status || "pending", jurySize || 12, notes || "", req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Update trial session error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

function buildCrud(entityName, tableName, columns, fkField = "trial_session_id") {
  router.get(`/${entityName}/:sessionId`, requireAuth, async (req, res) => {
    try {
      const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [req.params.sessionId]);
      if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
      const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
      if (!caseRow) return res.status(403).json({ error: "Access denied" });
      const orderCol = columns.includes("sort_order") ? "sort_order ASC, " : columns.includes("call_order") ? "call_order ASC, " : "";
      const { rows } = await pool.query(
        `SELECT * FROM ${tableName} WHERE ${fkField} = $1 ORDER BY ${orderCol}created_at ASC`,
        [req.params.sessionId]
      );
      res.json(rows);
    } catch (err) {
      console.error(`Get ${entityName} error:`, err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post(`/${entityName}`, requireAuth, async (req, res) => {
    try {
      const sessionId = req.body.sessionId || req.body.trial_session_id;
      if (!sessionId) return res.status(400).json({ error: "sessionId required" });
      const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [sessionId]);
      if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
      const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
      if (!caseRow) return res.status(403).json({ error: "Access denied" });

      const cols = [fkField, ...columns];
      const vals = [sessionId, ...columns.map(c => req.body[c] !== undefined ? req.body[c] : (c === "created_by" ? req.session.userId : null))];
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(
        `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        vals
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error(`Create ${entityName} error:`, err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.put(`/${entityName}/:id`, requireAuth, async (req, res) => {
    try {
      const existing = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [existing.rows[0][fkField]]);
      if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
      const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
      if (!caseRow) return res.status(403).json({ error: "Access denied" });

      const setClauses = columns.map((c, i) => `${c} = $${i + 1}`).join(", ");
      const vals = columns.map(c => req.body[c] !== undefined ? req.body[c] : existing.rows[0][c]);
      vals.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE ${tableName} SET ${setClauses} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      res.json(rows[0]);
    } catch (err) {
      console.error(`Update ${entityName} error:`, err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.delete(`/${entityName}/:id`, requireAuth, async (req, res) => {
    try {
      const existing = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [existing.rows[0][fkField]]);
      if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
      const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
      if (!caseRow) return res.status(403).json({ error: "Access denied" });
      await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(`Delete ${entityName} error:`, err);
      res.status(500).json({ error: "Server error" });
    }
  });
}

buildCrud("witnesses", "trial_witnesses", [
  "name", "type", "contact_info", "expected_testimony", "impeachment_notes", "call_order", "status"
]);

buildCrud("exhibits", "trial_exhibits", [
  "exhibit_number", "description", "type", "status", "linked_document_id", "notes"
]);

buildCrud("jurors", "trial_jurors", [
  "seat_number", "name", "notes", "strike_type", "is_selected", "demographics"
]);

buildCrud("motions", "trial_motions", [
  "title", "type", "status", "ruling_summary", "notes"
]);

buildCrud("outlines", "trial_outlines", [
  "type", "title", "content", "linked_witness_id", "sort_order"
]);

buildCrud("jury-instructions", "trial_jury_instructions", [
  "instruction_text", "status", "objection_notes", "source"
]);

buildCrud("timeline-events", "trial_timeline_events", [
  "event_date", "title", "description", "sort_order"
]);

buildCrud("pinned-docs", "trial_pinned_docs", [
  "case_document_id", "label", "sort_order"
]);

router.get("/pinned-docs-full/:sessionId", requireAuth, async (req, res) => {
  try {
    const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [req.params.sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      `SELECT p.*, d.name AS document_name, d.original_name, d.file_type
       FROM trial_pinned_docs p
       LEFT JOIN case_documents d ON d.id = p.case_document_id
       WHERE p.trial_session_id = $1
       ORDER BY p.sort_order ASC, p.created_at ASC`,
      [req.params.sessionId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get pinned-docs-full error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

buildCrud("log-entries", "trial_log_entries", [
  "trial_day", "entry_time", "category", "content", "created_by"
]);

router.put("/witnesses/reorder/:sessionId", requireAuth, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: "order array required" });
    const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [req.params.sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < order.length; i++) {
        await client.query("UPDATE trial_witnesses SET call_order = $1 WHERE id = $2 AND trial_session_id = $3", [i + 1, order[i], req.params.sessionId]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const { rows } = await pool.query("SELECT * FROM trial_witnesses WHERE trial_session_id = $1 ORDER BY call_order ASC", [req.params.sessionId]);
    res.json(rows);
  } catch (err) {
    console.error("Reorder witnesses error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
