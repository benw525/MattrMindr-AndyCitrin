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
  claimNum: row.claim_num,
  fileNum: row.file_num,
  claimSpec: row.claim_spec,
  type: row.type,
  status: row.status,
  stage: row.stage,
  leadAttorney: row.lead_attorney || 0,
  secondAttorney: row.second_attorney || 0,
  paralegal: row.paralegal || 0,
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
  _customFields: Array.isArray(row.custom_fields) ? row.custom_fields : [],
});

const orNull = (val) => (val && String(val).trim()) ? val : null;

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM cases ORDER BY title");
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Cases fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
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
        (case_num, title, client, insured, plaintiff, claim_num, file_num, claim_spec,
         type, status, stage, lead_attorney, second_attorney, paralegal,
         trial_date, answer_filed, written_disc, party_depo, expert_depo,
         witness_depo, mediation, mediator, judge, dol, custom_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       RETURNING *`,
      [
        d.caseNum || "", d.title, d.client || "", d.insured || "",
        d.plaintiff || "", d.claimNum || "", d.fileNum || "", d.claimSpec || "",
        d.type || "Civil Litigation", d.status || "Active", d.stage || "Pleadings",
        orNull(d.leadAttorney), orNull(d.secondAttorney), orNull(d.paralegal),
        orNull(d.trialDate), orNull(d.answerFiled), orNull(d.writtenDisc),
        orNull(d.partyDepo), orNull(d.expertDepo), orNull(d.witnessDepo),
        orNull(d.mediation), d.mediator || "", d.judge || "",
        orNull(d.dol), JSON.stringify(d._customFields || []),
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
    const { rows } = await pool.query(
      `UPDATE cases SET
        case_num=$1, title=$2, client=$3, insured=$4, plaintiff=$5,
        claim_num=$6, file_num=$7, claim_spec=$8, type=$9, status=$10,
        stage=$11, lead_attorney=$12, second_attorney=$13, paralegal=$14,
        trial_date=$15, answer_filed=$16, written_disc=$17, party_depo=$18,
        expert_depo=$19, witness_depo=$20, mediation=$21, mediator=$22,
        judge=$23, dol=$24, custom_fields=$25
       WHERE id=$26 RETURNING *`,
      [
        d.caseNum || "", d.title, d.client || "", d.insured || "",
        d.plaintiff || "", d.claimNum || "", d.fileNum || "", d.claimSpec || "",
        d.type || "Civil Litigation", d.status || "Active", d.stage || "Pleadings",
        orNull(d.leadAttorney), orNull(d.secondAttorney), orNull(d.paralegal),
        orNull(d.trialDate), orNull(d.answerFiled), orNull(d.writtenDisc),
        orNull(d.partyDepo), orNull(d.expertDepo), orNull(d.witnessDepo),
        orNull(d.mediation), d.mediator || "", d.judge || "",
        orNull(d.dol), JSON.stringify(d._customFields || []),
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

module.exports = router;
