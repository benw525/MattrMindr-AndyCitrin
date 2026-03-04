const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { extractText } = require("../utils/extract-text");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned_cases JSONB NOT NULL DEFAULT '[]'`).catch(() => {});

const toFrontend = (row) => ({
  id: row.id,
  caseNum: row.case_num,
  title: row.title,
  clientName: row.client_name,
  county: row.county,
  court: row.court,
  caseType: row.case_type,
  type: row.type,
  status: row.status,
  stage: row.stage,
  stateJurisdiction: row.state_jurisdiction,
  accidentDate: row.accident_date ? row.accident_date.toISOString().split("T")[0] : "",
  incidentDescription: row.incident_description,
  incidentLocation: row.incident_location,
  injuryType: row.injury_type,
  injuryDescription: row.injury_description,
  statuteOfLimitationsDate: row.statute_of_limitations_date ? row.statute_of_limitations_date.toISOString().split("T")[0] : "",
  caseValueEstimate: row.case_value_estimate ? parseFloat(row.case_value_estimate) : null,
  settlementAmount: row.settlement_amount ? parseFloat(row.settlement_amount) : null,
  settlementDate: row.settlement_date ? row.settlement_date.toISOString().split("T")[0] : "",
  demandAmount: row.demand_amount ? parseFloat(row.demand_amount) : null,
  demandDate: row.demand_date ? row.demand_date.toISOString().split("T")[0] : "",
  contingencyFeePct: row.contingency_fee_pct ? parseFloat(row.contingency_fee_pct) : null,
  caseExpenses: row.case_expenses ? parseFloat(row.case_expenses) : null,
  liabilityAssessment: row.liability_assessment,
  comparativeFaultPct: row.comparative_fault_pct ? parseFloat(row.comparative_fault_pct) : null,
  policeReportNumber: row.police_report_number,
  weatherConditions: row.weather_conditions,
  propertyDamageAmount: row.property_damage_amount ? parseFloat(row.property_damage_amount) : null,
  dispositionType: row.disposition_type,
  assignedAttorney: row.lead_attorney || 0,
  secondAttorney: row.second_attorney || 0,
  caseManager: row.case_manager || 0,
  investigator: row.investigator || 0,
  paralegal: row.paralegal || 0,
  offices: row.offices || [],
  nextCourtDate: row.next_court_date ? row.next_court_date.toISOString().split("T")[0] : "",
  trialDate: row.trial_date ? row.trial_date.toISOString().split("T")[0] : "",
  mediationDate: row.mediation_date ? row.mediation_date.toISOString().split("T")[0] : "",
  dispositionDate: row.disposition_date ? row.disposition_date.toISOString().split("T")[0] : "",
  judge: row.judge,
  referringAttorney: row.referring_attorney,
  referralSource: row.referral_source,
  _customFields: Array.isArray(row.custom_fields) ? row.custom_fields : [],
  _customDates: Array.isArray(row.custom_dates) ? row.custom_dates : [],
  _hiddenFields: Array.isArray(row.hidden_fields) ? row.hidden_fields : [],
  confidential: !!row.confidential,
  inLitigation: !!row.in_litigation,
  demandResponseDue: row.demand_response_due ? row.demand_response_due.toISOString().split("T")[0] : "",
  clientDob: row.client_dob ? row.client_dob.toISOString().split("T")[0] : "",
  clientSsn: row.client_ssn || "",
  clientAddress: row.client_address || "",
  clientPhones: Array.isArray(row.client_phones) ? row.client_phones : [],
  clientEmergencyContact: row.client_emergency_contact || "",
  clientEmail: row.client_email || "",
  clientBankruptcy: !!row.client_bankruptcy,
  _customTeam: Array.isArray(row.custom_team) ? row.custom_team : [],
  deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
});

const orNull = (val) => (val && String(val).trim()) ? val : null;

const isAppAdmin = (req) => (req.session.userRoles || [req.session.userRole]).includes("App Admin");

const canAccessCase = (row, req) => {
  if (!row.confidential) return true;
  if (isAppAdmin(req)) return true;
  const uid = req.session.userId;
  if ([row.lead_attorney, row.second_attorney, row.case_manager, row.investigator, row.paralegal].includes(uid)) return true;
  const customTeam = Array.isArray(row.custom_team) ? row.custom_team : [];
  return customTeam.some(m => m.userId === uid);
};

const requireManagement = (req, res, next) => {
  const roles = req.session.userRoles || [req.session.userRole];
  const allowed = ["Managing Partner", "Senior Partner", "Partner", "App Admin"];
  if (!allowed.some(r => roles.includes(r))) {
    return res.status(403).json({ error: "Management access required" });
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
      "SELECT id, case_num, title, client_name, status FROM cases WHERE deleted_at IS NULL AND (client_name ILIKE $1 OR title ILIKE $1) LIMIT 20",
      [pattern]
    );
    const contactResults = await pool.query(
      "SELECT id, name, category FROM contacts WHERE deleted_at IS NULL AND name ILIKE $1 LIMIT 20",
      [pattern]
    );
    return res.json({
      cases: caseResults.rows.map(r => ({ id: r.id, caseNum: r.case_num, title: r.title, clientName: r.client_name, status: r.status })),
      contacts: contactResults.rows.map(r => ({ id: r.id, name: r.name, category: r.category })),
    });
  } catch (err) {
    console.error("Conflict check error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/pinned", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT pinned_cases FROM users WHERE id = $1", [req.session.userId]);
    return res.json(rows[0]?.pinned_cases || []);
  } catch (err) {
    console.error("Get pinned cases error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/pinned", requireAuth, async (req, res) => {
  try {
    const { pinnedIds } = req.body;
    if (!Array.isArray(pinnedIds)) return res.status(400).json({ error: "pinnedIds must be an array" });
    const cleaned = pinnedIds.filter(id => typeof id === "number" && Number.isFinite(id));
    await pool.query("UPDATE users SET pinned_cases = $1 WHERE id = $2", [JSON.stringify(cleaned), req.session.userId]);
    return res.json(cleaned);
  } catch (err) {
    console.error("Update pinned cases error:", err);
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
        (case_num, title, client_name, county, court,
         case_type, type, status, stage, state_jurisdiction,
         accident_date, incident_description, incident_location,
         injury_type, injury_description, statute_of_limitations_date,
         case_value_estimate, settlement_amount, settlement_date,
         demand_amount, demand_date, contingency_fee_pct, case_expenses,
         liability_assessment, comparative_fault_pct,
         police_report_number, weather_conditions, property_damage_amount,
         disposition_type,
         lead_attorney, second_attorney, case_manager, investigator, paralegal,
         next_court_date, trial_date, mediation_date, disposition_date,
         judge, referring_attorney, referral_source,
         custom_fields, custom_dates, hidden_fields, offices, confidential, custom_team,
         in_litigation, demand_response_due,
         client_dob, client_ssn, client_address, client_phones, client_emergency_contact, client_email, client_bankruptcy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,$53,$54,$55,$56)
       RETURNING *`,
      [
        d.caseNum || "", d.title, d.clientName || "", d.county || "", d.court || "",
        d.caseType || "Auto Accident", d.type || "Auto Accident", d.status || "Active", d.stage || "Intake", d.stateJurisdiction || "",
        orNull(d.accidentDate), d.incidentDescription || "", d.incidentLocation || "",
        d.injuryType || "", d.injuryDescription || "", orNull(d.statuteOfLimitationsDate),
        orNull(d.caseValueEstimate), orNull(d.settlementAmount), orNull(d.settlementDate),
        orNull(d.demandAmount), orNull(d.demandDate), orNull(d.contingencyFeePct), orNull(d.caseExpenses),
        d.liabilityAssessment || "", orNull(d.comparativeFaultPct),
        d.policeReportNumber || "", d.weatherConditions || "", orNull(d.propertyDamageAmount),
        d.dispositionType || "",
        orNull(d.assignedAttorney), orNull(d.secondAttorney), orNull(d.caseManager), orNull(d.investigator), orNull(d.paralegal),
        orNull(d.nextCourtDate), orNull(d.trialDate), orNull(d.mediationDate), orNull(d.dispositionDate),
        d.judge || "", d.referringAttorney || "", d.referralSource || "",
        JSON.stringify(d._customFields || []), JSON.stringify(d._customDates || []),
        JSON.stringify(d._hiddenFields || []), d.offices || [],
        !!d.confidential, JSON.stringify(d._customTeam || []),
        !!d.inLitigation, orNull(d.demandResponseDue),
        orNull(d.clientDob), d.clientSsn || "", d.clientAddress || "",
        JSON.stringify(d.clientPhones || []), d.clientEmergencyContact || "", d.clientEmail || "",
        !!d.clientBankruptcy,
      ]
    );
    const newCase = rows[0];
    const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const callTasks = [
      { case_id: newCase.id, title: "Call Client - Attorney Check-in", assigned: newCase.lead_attorney || null, assigned_role: "Attorney", due: thirtyDaysOut, priority: "Medium", status: "Not Started", recurring: true, recurring_days: 30, is_generated: true, notes: "Recurring 30-day attorney check-in call with client" },
      { case_id: newCase.id, title: "Call Client - Case Manager Check-in", assigned: newCase.case_manager || null, assigned_role: "Case Manager", due: thirtyDaysOut, priority: "Medium", status: "Not Started", recurring: true, recurring_days: 30, is_generated: true, notes: "Recurring 30-day case manager check-in call with client" },
    ];
    for (const t of callTasks) {
      try {
        await pool.query(
          `INSERT INTO tasks (case_id, title, assigned, assigned_role, due, priority, status, recurring, recurring_days, is_generated, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [t.case_id, t.title, t.assigned, t.assigned_role, t.due, t.priority, t.status, t.recurring, t.recurring_days, t.is_generated, t.notes]
        );
      } catch (e) { console.error("Auto-task creation error:", e.message); }
    }
    return res.status(201).json(toFrontend(newCase));
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
        case_num=$1, title=$2, client_name=$3, county=$4, court=$5,
        case_type=$6, type=$7, status=$8, stage=$9, state_jurisdiction=$10,
        accident_date=$11, incident_description=$12, incident_location=$13,
        injury_type=$14, injury_description=$15, statute_of_limitations_date=$16,
        case_value_estimate=$17, settlement_amount=$18, settlement_date=$19,
        demand_amount=$20, demand_date=$21, contingency_fee_pct=$22, case_expenses=$23,
        liability_assessment=$24, comparative_fault_pct=$25,
        police_report_number=$26, weather_conditions=$27, property_damage_amount=$28,
        disposition_type=$29,
        lead_attorney=$30, second_attorney=$31, case_manager=$32, investigator=$33, paralegal=$34,
        next_court_date=$35, trial_date=$36, mediation_date=$37, disposition_date=$38,
        judge=$39, referring_attorney=$40, referral_source=$41,
        custom_fields=$42, custom_dates=$43, hidden_fields=$44, offices=$45, confidential=$46, custom_team=$47,
        in_litigation=$48, demand_response_due=$49,
        client_dob=$50, client_ssn=$51, client_address=$52, client_phones=$53,
        client_emergency_contact=$54, client_email=$55, client_bankruptcy=$56
       WHERE id=$57 AND deleted_at IS NULL RETURNING *`,
      [
        d.caseNum || "", d.title, d.clientName || "", d.county || "", d.court || "",
        d.caseType || "Auto Accident", d.type || "Auto Accident", d.status || "Active", d.stage || "Intake", d.stateJurisdiction || "",
        orNull(d.accidentDate), d.incidentDescription || "", d.incidentLocation || "",
        d.injuryType || "", d.injuryDescription || "", orNull(d.statuteOfLimitationsDate),
        orNull(d.caseValueEstimate), orNull(d.settlementAmount), orNull(d.settlementDate),
        orNull(d.demandAmount), orNull(d.demandDate), orNull(d.contingencyFeePct), orNull(d.caseExpenses),
        d.liabilityAssessment || "", orNull(d.comparativeFaultPct),
        d.policeReportNumber || "", d.weatherConditions || "", orNull(d.propertyDamageAmount),
        d.dispositionType || "",
        orNull(d.assignedAttorney), orNull(d.secondAttorney), orNull(d.caseManager), orNull(d.investigator), orNull(d.paralegal),
        orNull(d.nextCourtDate), orNull(d.trialDate), orNull(d.mediationDate), orNull(d.dispositionDate),
        d.judge || "", d.referringAttorney || "", d.referralSource || "",
        JSON.stringify(d._customFields || []), JSON.stringify(d._customDates || []),
        JSON.stringify(d._hiddenFields || []), d.offices || [],
        !!d.confidential, JSON.stringify(d._customTeam || []),
        !!d.inLitigation, orNull(d.demandResponseDue),
        orNull(d.clientDob), d.clientSsn || "", d.clientAddress || "",
        JSON.stringify(d.clientPhones || []), d.clientEmergencyContact || "", d.clientEmail || "",
        !!d.clientBankruptcy,
        req.params.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const oldLit = !!existing.rows[0].in_litigation;
    const newLit = !!rows[0].in_litigation;
    if (oldLit !== newLit) {
      try {
        if (newLit) {
          await pool.query(
            `UPDATE tasks SET assigned_role = 'Paralegal', assigned = (SELECT paralegal FROM cases WHERE id = $1)
             WHERE case_id = $1 AND title = 'Call Client - Case Manager Check-in' AND status != 'Complete' AND deleted_at IS NULL`,
            [req.params.id]
          );
        } else {
          await pool.query(
            `UPDATE tasks SET assigned_role = 'Case Manager', assigned = (SELECT case_manager FROM cases WHERE id = $1)
             WHERE case_id = $1 AND title = 'Call Client - Case Manager Check-in' AND status != 'Complete' AND deleted_at IS NULL`,
            [req.params.id]
          );
        }
      } catch (e) { console.error("Litigation task reassign error:", e.message); }
    }
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Case update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, requireManagement, async (req, res) => {
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

router.post("/:id/restore", requireAuth, requireManagement, async (req, res) => {
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

router.post("/parse-intake", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const text = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!text || text.trim().length === 0) {
      return res.status(422).json({ error: "Could not extract text from the uploaded file" });
    }

    const OpenAI = require("openai");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const resp = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a legal intake form parser for a personal injury law firm. Extract structured case information from the provided text. Return a JSON object with the following fields (use empty string if not found):
- clientName: full name of the client/injured party
- accidentDate: date of accident/incident (YYYY-MM-DD format)
- injuryType: type of injury (e.g., "Soft Tissue", "Fracture", "TBI")
- injuryDescription: description of injuries
- stateJurisdiction: state where the case is filed or incident occurred
- address: client's address
- phone: client's phone number
- dob: client's date of birth (YYYY-MM-DD format)
- ssn: client's SSN if present
- incidentLocation: location of the incident
- incidentDescription: description of the incident
- county: county of incident or filing
- policeReportNumber: police report number if available
- caseType: type of case (e.g., "Auto Accident", "Slip and Fall", "Medical Malpractice")
- referralSource: how the client was referred
- email: client's email address
Return ONLY valid JSON, no markdown or extra text.`
        },
        {
          role: "user",
          content: text.substring(0, 15000)
        }
      ],
    });

    let parsed = {};
    try {
      let content = resp.choices[0].message.content.trim();
      content = content.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error("Failed to parse OpenAI response:", parseErr.message);
      return res.status(422).json({ error: "Failed to parse intake form fields" });
    }

    return res.json(parsed);
  } catch (err) {
    console.error("Parse intake error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
