const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseNum: row.case_num,
  title: row.title,
  defendantName: row.defendant_name,
  prosecutor: row.prosecutor,
  county: row.county,
  court: row.court,
  courtDivision: row.court_division,
  chargeDescription: row.charge_description,
  chargeStatute: row.charge_statute,
  chargeClass: row.charge_class,
  caseType: row.case_type,
  type: row.type,
  status: row.status,
  stage: row.stage,
  custodyStatus: row.custody_status,
  bondAmount: row.bond_amount,
  bondConditions: row.bond_conditions,
  jailLocation: row.jail_location,
  dispositionType: row.disposition_type,
  assignedAttorney: row.lead_attorney || 0,
  secondAttorney: row.second_attorney || 0,
  trialCoordinator: row.trial_coordinator || 0,
  investigator: row.investigator || 0,
  socialWorker: row.social_worker || 0,
  offices: row.offices || [],
  arrestDate: row.arrest_date ? row.arrest_date.toISOString().split("T")[0] : "",
  arraignmentDate: row.arraignment_date ? row.arraignment_date.toISOString().split("T")[0] : "",
  nextCourtDate: row.next_court_date ? row.next_court_date.toISOString().split("T")[0] : "",
  trialDate: row.trial_date ? row.trial_date.toISOString().split("T")[0] : "",
  sentencingDate: row.sentencing_date ? row.sentencing_date.toISOString().split("T")[0] : "",
  dispositionDate: row.disposition_date ? row.disposition_date.toISOString().split("T")[0] : "",
  judge: row.judge,
  charges: Array.isArray(row.charges) ? row.charges : [],
  _customFields: Array.isArray(row.custom_fields) ? row.custom_fields : [],
  _customDates: Array.isArray(row.custom_dates) ? row.custom_dates : [],
  _hiddenFields: Array.isArray(row.hidden_fields) ? row.hidden_fields : [],
  confidential: !!row.confidential,
  deathPenalty: !!row.death_penalty,
  _customTeam: Array.isArray(row.custom_team) ? row.custom_team : [],
  deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
});

const orNull = (val) => (val && String(val).trim()) ? val : null;

const isAppAdmin = (req) => (req.session.userRoles || [req.session.userRole]).includes("App Admin");

const canAccessCase = (row, req) => {
  if (!row.confidential) return true;
  if (isAppAdmin(req)) return true;
  const uid = req.session.userId;
  if ([row.lead_attorney, row.second_attorney, row.trial_coordinator, row.investigator, row.social_worker].includes(uid)) return true;
  const customTeam = Array.isArray(row.custom_team) ? row.custom_team : [];
  return customTeam.some(m => m.userId === uid);
};

const requirePD = (req, res, next) => {
  const roles = req.session.userRoles || [req.session.userRole];
  const allowed = ["Public Defender", "Chief Deputy Public Defender", "Deputy Public Defender"];
  if (!allowed.some(r => roles.includes(r))) {
    return res.status(403).json({ error: "Public Defender leadership only" });
  }
  next();
};

router.get("/", requireAuth, async (req, res) => {
  try {
    if (req.query.deleted === "true") {
      const { rows } = await pool.query(
        "SELECT * FROM cases WHERE deleted_at IS NOT NULL AND deleted_at > NOW() - INTERVAL '30 days' ORDER BY deleted_at DESC"
      );
      return res.json(rows.filter(r => canAccessCase(r, req)).map(toFrontend));
    }
    if (req.query.includeDeleted === "true") {
      const { rows } = await pool.query("SELECT * FROM cases ORDER BY title");
      return res.json(rows.filter(r => canAccessCase(r, req)).map(toFrontend));
    }
    const { rows } = await pool.query(
      "SELECT * FROM cases WHERE deleted_at IS NULL ORDER BY title"
    );
    return res.json(rows.filter(r => canAccessCase(r, req)).map(toFrontend));
  } catch (err) {
    console.error("Cases fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/conflict-check", requireAuth, async (req, res) => {
  try {
    const name = (req.query.name || "").trim();
    if (!name || name.length < 2) return res.json({ cases: [], contacts: [] });
    const pattern = `%${name}%`;
    const caseResults = await pool.query(
      "SELECT id, case_num, title, defendant_name, status FROM cases WHERE deleted_at IS NULL AND (defendant_name ILIKE $1 OR title ILIKE $1) LIMIT 20",
      [pattern]
    );
    const contactResults = await pool.query(
      "SELECT id, name, category FROM contacts WHERE deleted_at IS NULL AND name ILIKE $1 LIMIT 20",
      [pattern]
    );
    return res.json({
      cases: caseResults.rows.map(r => ({ id: r.id, caseNum: r.case_num, title: r.title, defendantName: r.defendant_name, status: r.status })),
      contacts: contactResults.rows.map(r => ({ id: r.id, name: r.name, category: r.category })),
    });
  } catch (err) {
    console.error("Conflict check error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (!canAccessCase(rows[0], req)) return res.status(403).json({ error: "Access denied — this case is confidential" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Case fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO cases
        (case_num, title, defendant_name, prosecutor, county, court, court_division,
         charge_description, charge_statute, charge_class, case_type, type, status, stage,
         custody_status, bond_amount, bond_conditions, jail_location, disposition_type,
         lead_attorney, second_attorney, trial_coordinator, investigator, social_worker,
         arrest_date, arraignment_date, next_court_date, trial_date, sentencing_date, disposition_date,
         judge, charges, custom_fields, custom_dates, hidden_fields, offices, confidential, custom_team, death_penalty)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39)
       RETURNING *`,
      [
        d.caseNum || "", d.title, d.defendantName || "", d.prosecutor || "",
        d.county || "", d.court || "", d.courtDivision || "",
        d.chargeDescription || "", d.chargeStatute || "", d.chargeClass || "",
        d.caseType || "Felony", d.type || "Felony", d.status || "Active", d.stage || "Arraignment",
        d.custodyStatus || "", d.bondAmount || "", d.bondConditions || "", d.jailLocation || "", d.dispositionType || "",
        orNull(d.assignedAttorney), orNull(d.secondAttorney), orNull(d.trialCoordinator), orNull(d.investigator), orNull(d.socialWorker),
        orNull(d.arrestDate), orNull(d.arraignmentDate), orNull(d.nextCourtDate),
        orNull(d.trialDate), orNull(d.sentencingDate), orNull(d.dispositionDate),
        d.judge || "", JSON.stringify(d.charges || []),
        JSON.stringify(d._customFields || []), JSON.stringify(d._customDates || []),
        JSON.stringify(d._hiddenFields || []), d.offices || [],
        !!d.confidential, JSON.stringify(d._customTeam || []),
        !!d.deathPenalty,
      ]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Case create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const existing = await pool.query("SELECT * FROM cases WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (!canAccessCase(existing.rows[0], req)) return res.status(403).json({ error: "Access denied — this case is confidential" });
    const { rows } = await pool.query(
      `UPDATE cases SET
        case_num=$1, title=$2, defendant_name=$3, prosecutor=$4, county=$5, court=$6, court_division=$7,
        charge_description=$8, charge_statute=$9, charge_class=$10, case_type=$11, type=$12, status=$13, stage=$14,
        custody_status=$15, bond_amount=$16, bond_conditions=$17, jail_location=$18, disposition_type=$19,
        lead_attorney=$20, second_attorney=$21, trial_coordinator=$22, investigator=$23, social_worker=$24,
        arrest_date=$25, arraignment_date=$26, next_court_date=$27, trial_date=$28, sentencing_date=$29, disposition_date=$30,
        judge=$31, charges=$32, custom_fields=$33, custom_dates=$34, hidden_fields=$35, offices=$36, confidential=$37, custom_team=$38, death_penalty=$39
       WHERE id=$40 AND deleted_at IS NULL RETURNING *`,
      [
        d.caseNum || "", d.title, d.defendantName || "", d.prosecutor || "",
        d.county || "", d.court || "", d.courtDivision || "",
        d.chargeDescription || "", d.chargeStatute || "", d.chargeClass || "",
        d.caseType || "Felony", d.type || "Felony", d.status || "Active", d.stage || "Arraignment",
        d.custodyStatus || "", d.bondAmount || "", d.bondConditions || "", d.jailLocation || "", d.dispositionType || "",
        orNull(d.assignedAttorney), orNull(d.secondAttorney), orNull(d.trialCoordinator), orNull(d.investigator), orNull(d.socialWorker),
        orNull(d.arrestDate), orNull(d.arraignmentDate), orNull(d.nextCourtDate),
        orNull(d.trialDate), orNull(d.sentencingDate), orNull(d.dispositionDate),
        d.judge || "", JSON.stringify(d.charges || []),
        JSON.stringify(d._customFields || []), JSON.stringify(d._customDates || []),
        JSON.stringify(d._hiddenFields || []), d.offices || [],
        !!d.confidential, JSON.stringify(d._customTeam || []),
        !!d.deathPenalty,
        req.params.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Case update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, requirePD, async (req, res) => {
  try {
    const existing = await pool.query("SELECT * FROM cases WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "Not found or already deleted" });
    if (!canAccessCase(existing.rows[0], req)) return res.status(403).json({ error: "Access denied — this case is confidential" });
    const { rows } = await pool.query(
      "UPDATE cases SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found or already deleted" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Case delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/restore", requireAuth, requirePD, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE cases SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found or not deleted" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Case restore error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
