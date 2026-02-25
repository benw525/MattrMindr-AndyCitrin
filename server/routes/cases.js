const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseNum: row.case_num,
  title: row.title,
  client: row.client,
  insured: row.insured,
  plaintiff: row.plaintiff,
  defendant: row.defendant,
  opposingCounsel: row.opposing_counsel,
  shortCaseNum: row.short_case_num,
  county: row.county,
  court: row.court,
  claimNum: row.claim_num,
  fileNum: row.file_num,
  adjuster: row.adjuster,
  type: row.type,
  status: row.status,
  stage: row.stage,
  leadAttorney: row.lead_attorney || 0,
  secondAttorney: row.second_attorney || 0,
  paralegal: row.paralegal || 0,
  paralegal2: row.paralegal2 || 0,
  legalAssistant: row.legal_assistant || 0,
  offices: row.offices || [],
  trialDate: row.trial_date ? row.trial_date.toISOString().split("T")[0] : "",
  answerFiled: row.answer_filed ? row.answer_filed.toISOString().split("T")[0] : "",
  writtenDisc: row.written_disc ? row.written_disc.toISOString().split("T")[0] : "",
  partyDepo: row.party_depo ? row.party_depo.toISOString().split("T")[0] : "",
  expertDepo: row.expert_depo ? row.expert_depo.toISOString().split("T")[0] : "",
  witnessDepo: row.witness_depo ? row.witness_depo.toISOString().split("T")[0] : "",
  mediation: row.mediation ? row.mediation.toISOString().split("T")[0] : "",
  mediator: row.mediator,
  judge: row.judge,
  dol: row.dol ? row.dol.toISOString().split("T")[0] : "",
  expert: row.expert || "",
  _customFields: Array.isArray(row.custom_fields) ? row.custom_fields : [],
  _customDates: Array.isArray(row.custom_dates) ? row.custom_dates : [],
  _hiddenFields: Array.isArray(row.hidden_fields) ? row.hidden_fields : [],
  billingParties: Array.isArray(row.billing_parties) ? row.billing_parties : [],
  caseExpenses: Array.isArray(row.case_expenses) ? row.case_expenses : [],
  confidential: !!row.confidential,
  _customTeam: Array.isArray(row.custom_team) ? row.custom_team : [],
  medicalSummary: Array.isArray(row.medical_summary) ? row.medical_summary : [],
  deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
});

const orNull = (val) => (val && String(val).trim()) ? val : null;

const isAppAdmin = (req) => (req.session.userRoles || [req.session.userRole]).includes("App Admin");

const canAccessCase = (row, req) => {
  if (!row.confidential) return true;
  if (isAppAdmin(req)) return true;
  const uid = req.session.userId;
  if ([row.lead_attorney, row.second_attorney, row.paralegal, row.paralegal2, row.legal_assistant].includes(uid)) return true;
  const customTeam = Array.isArray(row.custom_team) ? row.custom_team : [];
  return customTeam.some(m => m.userId === uid);
};

const requireShareholder = (req, res, next) => {
  if (req.session.userRole !== "Shareholder") {
    return res.status(403).json({ error: "Shareholders only" });
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
        (case_num, title, client, insured, plaintiff, defendant, opposing_counsel, short_case_num, county, court,
         claim_num, file_num, adjuster,
         type, status, stage, lead_attorney, second_attorney, paralegal, paralegal2, legal_assistant,
         trial_date, answer_filed, written_disc, party_depo, expert_depo,
         witness_depo, mediation, mediator, judge, dol, custom_fields, offices, expert, custom_dates, billing_parties, case_expenses, hidden_fields, confidential, custom_team, medical_summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41)
       RETURNING *`,
      [
        d.caseNum || "", d.title, d.client || "", d.insured || "",
        d.plaintiff || "", d.defendant || "", d.opposingCounsel || "", d.shortCaseNum || "", d.county || "", d.court || "",
        d.claimNum || "", d.fileNum || "", d.adjuster || "",
        d.type || "Civil Litigation", d.status || "Active", d.stage || "Pleadings",
        orNull(d.leadAttorney), orNull(d.secondAttorney), orNull(d.paralegal), orNull(d.paralegal2), orNull(d.legalAssistant),
        orNull(d.trialDate), orNull(d.answerFiled), orNull(d.writtenDisc),
        orNull(d.partyDepo), orNull(d.expertDepo), orNull(d.witnessDepo),
        orNull(d.mediation), d.mediator || "", d.judge || "",
        orNull(d.dol), JSON.stringify(d._customFields || []), d.offices || [],
        d.expert || "", JSON.stringify(d._customDates || []),
        JSON.stringify(d.billingParties || []), JSON.stringify(d.caseExpenses || []),
        JSON.stringify(d._hiddenFields || []),
        !!d.confidential,
        JSON.stringify(d._customTeam || []),
        JSON.stringify(d.medicalSummary || []),
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
        case_num=$1, title=$2, client=$3, insured=$4, plaintiff=$5,
        defendant=$6, opposing_counsel=$7, short_case_num=$8, county=$9, court=$10,
        claim_num=$11, file_num=$12, adjuster=$13, type=$14, status=$15,
        stage=$16, lead_attorney=$17, second_attorney=$18, paralegal=$19, paralegal2=$20, legal_assistant=$21,
        trial_date=$22, answer_filed=$23, written_disc=$24, party_depo=$25,
        expert_depo=$26, witness_depo=$27, mediation=$28, mediator=$29,
        judge=$30, dol=$31, custom_fields=$32, offices=$33, expert=$34, custom_dates=$35,
        billing_parties=$36, case_expenses=$37, hidden_fields=$38, confidential=$39, custom_team=$40, medical_summary=$41
       WHERE id=$42 AND deleted_at IS NULL RETURNING *`,
      [
        d.caseNum || "", d.title, d.client || "", d.insured || "",
        d.plaintiff || "", d.defendant || "", d.opposingCounsel || "", d.shortCaseNum || "", d.county || "", d.court || "",
        d.claimNum || "", d.fileNum || "", d.adjuster || "",
        d.type || "Civil Litigation", d.status || "Active", d.stage || "Pleadings",
        orNull(d.leadAttorney), orNull(d.secondAttorney), orNull(d.paralegal), orNull(d.paralegal2), orNull(d.legalAssistant),
        orNull(d.trialDate), orNull(d.answerFiled), orNull(d.writtenDisc),
        orNull(d.partyDepo), orNull(d.expertDepo), orNull(d.witnessDepo),
        orNull(d.mediation), d.mediator || "", d.judge || "",
        orNull(d.dol), JSON.stringify(d._customFields || []), d.offices || [],
        d.expert || "", JSON.stringify(d._customDates || []),
        JSON.stringify(d.billingParties || []), JSON.stringify(d.caseExpenses || []),
        JSON.stringify(d._hiddenFields || []),
        !!d.confidential,
        JSON.stringify(d._customTeam || []),
        JSON.stringify(d.medicalSummary || []),
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

router.delete("/:id", requireAuth, requireShareholder, async (req, res) => {
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

router.post("/:id/restore", requireAuth, requireShareholder, async (req, res) => {
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
