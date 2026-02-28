const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const orNull = (val) => (val && String(val).trim()) ? val : null;

const ADMIN_ROLES = ["IT Specialist", "App Admin"];
const isAppAdmin = (req) => (req.session.userRoles || [req.session.userRole]).some(r => ADMIN_ROLES.includes(r));

const verifyCaseAccess = async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.caseId]);
  if (rows.length === 0) { res.status(404).json({ error: "Case not found" }); return false; }
  const c = rows[0];
  if (c.confidential) {
    if (!isAppAdmin(req)) {
      const uid = req.session.userId;
      const team = [c.lead_attorney, c.second_attorney, c.trial_coordinator, c.investigator, c.social_worker];
      const customTeam = Array.isArray(c.custom_team) ? c.custom_team : [];
      if (!team.includes(uid) && !customTeam.some(m => m.userId === uid)) {
        res.status(403).json({ error: "Access denied" });
        return false;
      }
    }
  }
  return true;
};

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  violationDate: row.violation_date ? row.violation_date.toISOString().split("T")[0] : "",
  violationType: row.violation_type || "Technical",
  description: row.description || "",
  source: row.source || "",
  relatedCharges: row.related_charges || "",
  preliminaryHearingDate: row.preliminary_hearing_date ? row.preliminary_hearing_date.toISOString().split("T")[0] : "",
  reconveningDate: row.reconvening_date ? row.reconvening_date.toISOString().split("T")[0] : "",
  customDates: Array.isArray(row.custom_dates) ? row.custom_dates : [],
  hearingType: row.hearing_type || "",
  attorney: row.attorney || "",
  judge: row.judge || "",
  outcome: row.outcome || "Pending",
  jailTimeImposed: row.jail_time_imposed || "",
  jailCredit: row.jail_credit || "",
  remainingProbation: row.remaining_probation || "",
  sentenceImposed: row.sentence_imposed || "",
  notes: row.notes || "",
  createdAt: row.created_at ? row.created_at.toISOString() : "",
});

router.get("/:caseId/violations", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, res))) return;
    const { rows } = await pool.query(
      "SELECT * FROM case_probation_violations WHERE case_id = $1 ORDER BY violation_date DESC NULLS LAST, created_at DESC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Get probation violations error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId/violations", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    if (!(await verifyCaseAccess(req, res))) return;
    const { rows } = await pool.query(
      `INSERT INTO case_probation_violations
        (case_id, violation_date, violation_type, description, source, related_charges,
         preliminary_hearing_date, reconvening_date, custom_dates, hearing_type,
         attorney, judge, outcome, jail_time_imposed, jail_credit, remaining_probation,
         sentence_imposed, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        req.params.caseId,
        orNull(d.violationDate),
        d.violationType || "Technical",
        d.description || "",
        d.source || "",
        d.relatedCharges || "",
        orNull(d.preliminaryHearingDate),
        orNull(d.reconveningDate),
        JSON.stringify(d.customDates || []),
        d.hearingType || "",
        d.attorney || "",
        d.judge || "",
        d.outcome || "Pending",
        d.jailTimeImposed || "",
        d.jailCredit || "",
        d.remainingProbation || "",
        d.sentenceImposed || "",
        d.notes || "",
      ]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Create probation violation error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/violations/:id", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    if (!(await verifyCaseAccess(req, res))) return;
    const { rows } = await pool.query(
      `UPDATE case_probation_violations SET
        violation_date=$1, violation_type=$2, description=$3, source=$4, related_charges=$5,
        preliminary_hearing_date=$6, reconvening_date=$7, custom_dates=$8, hearing_type=$9,
        attorney=$10, judge=$11, outcome=$12, jail_time_imposed=$13, jail_credit=$14,
        remaining_probation=$15, sentence_imposed=$16, notes=$17
       WHERE id=$18 AND case_id=$19 RETURNING *`,
      [
        orNull(d.violationDate),
        d.violationType || "Technical",
        d.description || "",
        d.source || "",
        d.relatedCharges || "",
        orNull(d.preliminaryHearingDate),
        orNull(d.reconveningDate),
        JSON.stringify(d.customDates || []),
        d.hearingType || "",
        d.attorney || "",
        d.judge || "",
        d.outcome || "Pending",
        d.jailTimeImposed || "",
        d.jailCredit || "",
        d.remainingProbation || "",
        d.sentenceImposed || "",
        d.notes || "",
        req.params.id,
        req.params.caseId,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Update probation violation error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/violations/:id", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, res))) return;
    const { rows } = await pool.query(
      "DELETE FROM case_probation_violations WHERE id = $1 AND case_id = $2 RETURNING *",
      [req.params.id, req.params.caseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete probation violation error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
