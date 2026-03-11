const express = require("express");
const OpenAI = require("openai");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function getTrainingContext(userId, agentId = null) {
  try {
    let result;
    if (!agentId || agentId === 'advocate') {
      result = await pool.query(
        `SELECT category, title, content FROM ai_training
         WHERE active = true AND (scope = 'office' OR (scope = 'personal' AND user_id = $1))
         ORDER BY scope DESC, created_at ASC`,
        [userId]
      );
    } else {
      result = await pool.query(
        `SELECT category, title, content FROM ai_training
         WHERE active = true AND (scope = 'office' OR (scope = 'personal' AND user_id = $1))
           AND ('all' = ANY(COALESCE(target_agents, '{all}')) OR $2 = ANY(COALESCE(target_agents, '{all}')))
         ORDER BY scope DESC, created_at ASC`,
        [userId, agentId]
      );
    }
    if (result.rows.length === 0) return "";
    let block = "\n\n=== CUSTOM TRAINING & GUIDELINES ===";
    let totalLen = 0;
    const MAX_TRAINING_CHARS = 8000;
    for (const row of result.rows) {
      const entry = `\n[${row.category}] ${row.title}: ${row.content}`;
      if (totalLen + entry.length > MAX_TRAINING_CHARS) {
        block += `\n[${row.category}] ${row.title}: ${row.content.substring(0, MAX_TRAINING_CHARS - totalLen - 100)}...`;
        break;
      }
      block += entry;
      totalLen += entry.length;
    }
    return block;
  } catch (err) {
    console.error("Training context load error:", err);
    return "";
  }
}

const NO_MARKDOWN = "\n\nIMPORTANT FORMATTING RULE: Do NOT use any markdown formatting in your response. No hashtags (#, ##, ###), no asterisks (* or **), no bullet symbols. Use plain text only. Use line breaks and numbered lists (1. 2. 3.) for structure. Use ALL CAPS for section headings instead of hashtags.";

async function aiCall(systemPrompt, userPrompt, jsonMode = false, userId = null, agentId = null) {
  let finalPrompt = systemPrompt + (jsonMode ? "" : NO_MARKDOWN);
  if (userId) {
    const training = await getTrainingContext(userId, agentId);
    if (training) finalPrompt += training;
  }
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: finalPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    store: false,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });
  return resp.choices[0].message.content;
}

router.post("/liability-analysis", requireAuth, async (req, res) => {
  try {
    let { caseId, incidentDescription, incidentLocation, injuryType, liabilityAssessment, comparativeFaultPct, stateJurisdiction, caseType } = req.body;
    if (caseId && !incidentDescription) {
      const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [caseId]);
      if (rows.length) {
        const c = rows[0];
        incidentDescription = incidentDescription || c.incident_description || "";
        incidentLocation = incidentLocation || c.incident_location || "";
        injuryType = injuryType || c.injury_type || "";
        liabilityAssessment = liabilityAssessment || c.liability_assessment || "";
        comparativeFaultPct = comparativeFaultPct || c.comparative_fault_pct || "";
        stateJurisdiction = stateJurisdiction || c.state_jurisdiction || "";
        caseType = caseType || c.case_type || "";
      }
    }

    const systemPrompt = `You are a personal injury liability analysis assistant with expertise in tort law across all U.S. jurisdictions. Analyze the incident and provide a structured liability analysis. Be specific about applicable state negligence standards, comparative/contributory fault rules, and relevant statutes for the jurisdiction provided.`;
    const userPrompt = `Analyze liability for the following personal injury case:

Case Type: ${caseType || "Personal Injury"}
State/Jurisdiction: ${stateJurisdiction || "Not specified"}
Incident Description: ${incidentDescription || "Not specified"}
Incident Location: ${incidentLocation || "Not specified"}
Injury Type: ${injuryType || "Not specified"}
Current Liability Assessment: ${liabilityAssessment || "Not yet assessed"}
Estimated Comparative Fault: ${comparativeFaultPct ? comparativeFaultPct + "%" : "Not specified"}

Provide:
1. FAULT ANALYSIS — Identify all potentially liable parties and their respective duties of care
2. NEGLIGENCE ELEMENTS — Analyze duty, breach, causation (actual and proximate), and damages for each party
3. COMPARATIVE/CONTRIBUTORY FAULT — Explain the applicable fault standard in ${stateJurisdiction || "the applicable state"} (pure comparative, modified comparative 50%/51%, or contributory negligence) and how it affects recovery
4. APPLICABLE STATE LAW — Cite relevant statutes, case law principles, and any special rules (e.g., dram shop, premises liability standards, dog bite strict liability)
5. STATUTE OF LIMITATIONS — Identify the applicable SOL for this type of claim in ${stateJurisdiction || "the jurisdiction"}
6. LIABILITY STRENGTHS & WEAKNESSES — Assessment of strong points and vulnerabilities in the liability case
7. EVIDENCE TO OBTAIN — Key evidence needed to strengthen the liability case`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'liability');
    res.json({ result });
  } catch (err) {
    console.error("Liability analysis error:", err);
    res.status(500).json({ error: "AI liability analysis failed" });
  }
});

router.post("/deadline-generator", requireAuth, async (req, res) => {
  try {
    let { caseId, stage, caseType, stateJurisdiction, accidentDate, statuteOfLimitationsDate, trialDate, mediationDate, nextCourtDate, existingDeadlines } = req.body;
    if (caseId) {
      const [caseRes, dlRes] = await Promise.all([
        pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
        pool.query("SELECT title, date FROM deadlines WHERE case_id = $1", [caseId]),
      ]);
      if (caseRes.rows.length) {
        const c = caseRes.rows[0];
        stage = stage || c.stage || "";
        caseType = caseType || c.case_type || "";
        stateJurisdiction = stateJurisdiction || c.state_jurisdiction || "";
        accidentDate = accidentDate || (c.accident_date ? c.accident_date.toISOString().split("T")[0] : "");
        statuteOfLimitationsDate = statuteOfLimitationsDate || (c.statute_of_limitations_date ? c.statute_of_limitations_date.toISOString().split("T")[0] : "");
        trialDate = trialDate || (c.trial_date ? c.trial_date.toISOString().split("T")[0] : "");
        mediationDate = mediationDate || (c.mediation_date ? c.mediation_date.toISOString().split("T")[0] : "");
        nextCourtDate = nextCourtDate || (c.next_court_date ? c.next_court_date.toISOString().split("T")[0] : "");
        existingDeadlines = existingDeadlines || dlRes.rows.map(d => ({ title: d.title, date: d.date ? d.date.toISOString().split("T")[0] : "" }));
      }
    }
    const deadlinesList = (existingDeadlines || []).map(d => `- ${d.title} (${d.date})`).join("\n") || "None";
    const systemPrompt = `You are a personal injury litigation deadline expert with knowledge of civil procedure rules across all U.S. jurisdictions. Generate upcoming procedural deadlines based on the case details and the applicable state rules of civil procedure. Return ONLY valid JSON with a "deadlines" array. Each deadline object must have: "title" (string), "date" (YYYY-MM-DD string), "rule" (the applicable rule or statute reference), "type" (one of: Filing, Hearing, Court Date, Deadline, SOL, Discovery, Mediation, IME). Base dates relative to today: ${new Date().toISOString().split("T")[0]}. If exact dates cannot be determined, estimate based on typical timelines.`;
    const userPrompt = `Case details:
Stage: ${stage || "Unknown"}
Case Type: ${caseType || "Unknown"}
State/Jurisdiction: ${stateJurisdiction || "Unknown"}
Accident Date: ${accidentDate || "Unknown"}
Statute of Limitations Date: ${statuteOfLimitationsDate || "Unknown"}
Trial Date: ${trialDate || "Not set"}
Mediation Date: ${mediationDate || "Not set"}
Next Court Date: ${nextCourtDate || "Not set"}

Existing Deadlines:
${deadlinesList}

Generate 4-8 upcoming procedural deadlines that this personal injury case likely needs, considering the current stage and applicable state civil procedure rules. Include statute of limitations warnings, discovery deadlines, mediation scheduling, IME dates, expert disclosure deadlines, and any stage-specific deadlines. Do not duplicate existing deadlines.`;

    const raw = await aiCall(systemPrompt, userPrompt, true, req.session.userId, 'deadlines');
    const parsed = JSON.parse(raw);
    res.json({ deadlines: parsed.deadlines || [] });
  } catch (err) {
    console.error("Deadline generator error:", err);
    res.status(500).json({ error: "AI deadline generation failed" });
  }
});

router.post("/case-strategy", requireAuth, async (req, res) => {
  try {
    const { caseId } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });

    const [caseRes, notesRes, tasksRes, deadlinesRes, insuranceRes, medicalRes, damagesRes, liensRes, negotiationsRes] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
      pool.query("SELECT body, type FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT 10", [caseId]),
      pool.query("SELECT title, status, priority FROM tasks WHERE case_id = $1", [caseId]),
      pool.query("SELECT title, date, type FROM deadlines WHERE case_id = $1", [caseId]),
      pool.query("SELECT policy_type, carrier_name, policy_limits, claim_number FROM case_insurance_policies WHERE case_id = $1", [caseId]),
      pool.query("SELECT provider_name, provider_type, total_billed, still_treating FROM case_medical_treatments WHERE case_id = $1", [caseId]),
      pool.query("SELECT category, amount, documentation_status FROM case_damages WHERE case_id = $1", [caseId]),
      pool.query("SELECT lien_type, lienholder_name, amount, status FROM case_liens WHERE case_id = $1", [caseId]),
      pool.query("SELECT date, direction, amount, from_party FROM case_negotiations WHERE case_id = $1 ORDER BY date DESC", [caseId]),
    ]);

    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const notesText = notesRes.rows.map(n => `[${n.type}] ${(n.body || "").substring(0, 300)}`).join("\n") || "No notes";
    const tasksText = tasksRes.rows.map(t => `${t.title} (${t.status}, ${t.priority})`).join(", ") || "No tasks";

    const insuranceText = insuranceRes.rows.map(i =>
      `${i.policy_type}: ${i.carrier_name} — Limits: ${i.policy_limits || "Unknown"}, Claim#: ${i.claim_number || "N/A"}`
    ).join("\n") || "No insurance policies entered";

    const medicalText = medicalRes.rows.map(m =>
      `${m.provider_name} (${m.provider_type}) — Billed: $${m.total_billed || 0}, ${m.still_treating ? "Still Treating" : "Discharged"}`
    ).join("\n") || "No medical treatments entered";

    const totalMedicals = medicalRes.rows.reduce((sum, m) => sum + parseFloat(m.total_billed || 0), 0);

    const damagesText = damagesRes.rows.map(d =>
      `${d.category}: $${d.amount || 0} (${d.documentation_status})`
    ).join("\n") || "No damages entered";

    const totalDamages = damagesRes.rows.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);

    const liensText = liensRes.rows.map(l =>
      `${l.lien_type} — ${l.lienholder_name}: $${l.amount || 0} (${l.status})`
    ).join("\n") || "No liens";

    const totalLiens = liensRes.rows.reduce((sum, l) => sum + parseFloat(l.amount || 0), 0);

    const negotiationsText = negotiationsRes.rows.map(n =>
      `${n.date || "N/A"}: ${n.direction} — $${n.amount || 0} from ${n.from_party || "Unknown"}`
    ).join("\n") || "No negotiations";

    const systemPrompt = `You are a senior personal injury attorney providing case valuation and strategic analysis. Provide practical, specific, and action-oriented recommendations for maximizing case value and achieving the best outcome for the client. Consider the applicable state law for the jurisdiction.`;

    const userPrompt = `Case: ${c.title}
Client: ${c.client_name || "Unknown"}
Case Type: ${c.case_type || "Unknown"} | State: ${c.state_jurisdiction || "Unknown"}
Stage: ${c.stage || "Unknown"} | Status: ${c.status || "Unknown"}
Accident Date: ${c.accident_date || "Unknown"}
Statute of Limitations: ${c.statute_of_limitations_date || "Unknown"}
Liability Assessment: ${c.liability_assessment || "Not yet assessed"}
Comparative Fault: ${c.comparative_fault_pct ? c.comparative_fault_pct + "%" : "Unknown"}
Injury Type: ${c.injury_type || "Unknown"}
Injury Description: ${c.injury_description || "Not provided"}
Property Damage: ${c.property_damage_amount ? "$" + c.property_damage_amount : "Unknown"}
Contingency Fee: ${c.contingency_fee_pct ? c.contingency_fee_pct + "%" : "Unknown"}

Insurance Policies:
${insuranceText}

Medical Treatment (Total Billed: $${totalMedicals.toFixed(2)}):
${medicalText}

Damages (Total: $${totalDamages.toFixed(2)}):
${damagesText}

Liens (Total: $${totalLiens.toFixed(2)}):
${liensText}

Negotiation History:
${negotiationsText}

Recent Notes:
${notesText}

Current Tasks: ${tasksText}

Provide:
1. CASE VALUATION — Estimated settlement range and verdict range based on damages, injuries, and jurisdiction
2. LIABILITY ASSESSMENT — Strengths and weaknesses of the liability case
3. DAMAGES ANALYSIS — Review of economic and non-economic damages, multiplier analysis
4. SETTLEMENT STRATEGY — Optimal demand amount, timing, and negotiation approach
5. LITIGATION CONSIDERATIONS — Whether to file suit or continue pre-litigation negotiations, and why
6. LIEN RESOLUTION — Strategy for negotiating outstanding liens to maximize client recovery
7. INVESTIGATION PRIORITIES — Evidence, witnesses, or expert opinions needed to strengthen the case
8. RISK FACTORS — Potential issues that could reduce case value or complicate resolution`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'strategy');
    res.json({ result });
  } catch (err) {
    console.error("Case strategy error:", err);
    res.status(500).json({ error: "AI strategy analysis failed" });
  }
});

router.post("/draft-document", requireAuth, async (req, res) => {
  try {
    const { caseId, documentType, customInstructions } = req.body;
    if (!caseId || !documentType) return res.status(400).json({ error: "caseId and documentType required" });

    const [caseRes, insuranceRes, medicalRes, damagesRes] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
      pool.query("SELECT policy_type, carrier_name, policy_limits, adjuster_name, claim_number FROM case_insurance_policies WHERE case_id = $1", [caseId]),
      pool.query("SELECT provider_name, provider_type, total_billed, first_visit_date, last_visit_date, still_treating, description FROM case_medical_treatments WHERE case_id = $1", [caseId]),
      pool.query("SELECT category, description, amount FROM case_damages WHERE case_id = $1", [caseId]),
    ]);

    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const insuranceText = insuranceRes.rows.map(i =>
      `${i.policy_type}: ${i.carrier_name} — Limits: ${i.policy_limits || "Unknown"}, Adjuster: ${i.adjuster_name || "Unknown"}, Claim#: ${i.claim_number || "N/A"}`
    ).join("\n") || "Not specified";

    const medicalText = medicalRes.rows.map(m =>
      `${m.provider_name} (${m.provider_type}) — First: ${m.first_visit_date || "N/A"}, Last: ${m.last_visit_date || "N/A"}, ${m.still_treating ? "Still Treating" : "Discharged"}, Billed: $${m.total_billed || 0}${m.description ? ", " + m.description : ""}`
    ).join("\n") || "Not specified";

    const totalMedicals = medicalRes.rows.reduce((sum, m) => sum + parseFloat(m.total_billed || 0), 0);

    const damagesText = damagesRes.rows.map(d =>
      `${d.category}: $${d.amount || 0} — ${d.description || ""}`
    ).join("\n") || "Not specified";

    const totalDamages = damagesRes.rows.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);

    const isDemandLetter = documentType.toLowerCase().includes("demand");

    const systemPrompt = isDemandLetter
      ? `You are a personal injury attorney drafting a demand letter. Draft a professional, persuasive demand letter that clearly presents the facts of the incident, the client's injuries and treatment, all damages, and a specific demand amount. Follow best practices for demand letter writing in the applicable jurisdiction. Use formal legal language and a compelling narrative structure.`
      : `You are a personal injury attorney drafting legal documents. Draft professional, court-ready documents following the applicable state's court formatting conventions. Include proper case captions, legal citations, and prayer for relief. Use formal legal language appropriate for civil courts.`;

    const userPrompt = `Draft a ${documentType} for:

Case: ${c.title}
Case Number: ${c.case_num || "Pending"}
Court: ${c.court || "Not specified"}
Judge: ${c.judge || "Not assigned"}
Client: ${c.client_name || "Unknown"}
State/Jurisdiction: ${c.state_jurisdiction || "Not specified"}
Case Type: ${c.case_type || "Personal Injury"}
Stage: ${c.stage || "Unknown"}
Accident Date: ${c.accident_date || "Unknown"}
Incident Location: ${c.incident_location || "Unknown"}
Incident Description: ${c.incident_description || "Not provided"}
Injury Type: ${c.injury_type || "Not specified"}
Injury Description: ${c.injury_description || "Not provided"}
Police Report: ${c.police_report_number || "N/A"}
Liability Assessment: ${c.liability_assessment || "Not assessed"}
Comparative Fault: ${c.comparative_fault_pct ? c.comparative_fault_pct + "%" : "N/A"}
Property Damage: ${c.property_damage_amount ? "$" + c.property_damage_amount : "N/A"}
Demand Amount: ${c.demand_amount ? "$" + c.demand_amount : "Not set"}

Insurance Policies:
${insuranceText}

Medical Treatment (Total: $${totalMedicals.toFixed(2)}):
${medicalText}

Damages (Total: $${totalDamages.toFixed(2)}):
${damagesText}

${customInstructions ? `Additional Instructions: ${customInstructions}` : ""}

Draft the complete document with proper formatting, caption, body, signature block, and certificate of service.`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'draft');
    res.json({ result });
  } catch (err) {
    console.error("Document draft error:", err);
    res.status(500).json({ error: "AI document drafting failed" });
  }
});

router.post("/case-triage", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const isAdmin = req.session.role === "App Admin" || req.session.role === "Managing Partner";

    const casesQ = isAdmin
      ? "SELECT id, case_num, title, client_name, case_type, stage, status, state_jurisdiction, injury_type, accident_date, statute_of_limitations_date, case_value_estimate, settlement_amount, trial_date, mediation_date, next_court_date, lead_attorney FROM cases WHERE status = 'Active' AND deleted_at IS NULL ORDER BY statute_of_limitations_date ASC NULLS LAST LIMIT 100"
      : "SELECT id, case_num, title, client_name, case_type, stage, status, state_jurisdiction, injury_type, accident_date, statute_of_limitations_date, case_value_estimate, settlement_amount, trial_date, mediation_date, next_court_date, lead_attorney FROM cases WHERE status = 'Active' AND deleted_at IS NULL AND (lead_attorney = $1 OR second_attorney = $1) ORDER BY statute_of_limitations_date ASC NULLS LAST LIMIT 100";

    const [casesRes, tasksRes, deadlinesRes, usersRes, medicalRes] = await Promise.all([
      isAdmin ? pool.query(casesQ) : pool.query(casesQ, [userId]),
      pool.query("SELECT case_id, title, due, priority, status FROM tasks WHERE status != 'Completed'"),
      pool.query("SELECT case_id, title, date FROM deadlines WHERE date >= CURRENT_DATE"),
      pool.query("SELECT id, name FROM users"),
      pool.query("SELECT case_id, still_treating, total_billed FROM case_medical_treatments"),
    ]);

    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u.name; });

    const tasksByCase = {};
    tasksRes.rows.forEach(t => {
      if (!tasksByCase[t.case_id]) tasksByCase[t.case_id] = [];
      tasksByCase[t.case_id].push(t);
    });

    const deadlinesByCase = {};
    deadlinesRes.rows.forEach(d => {
      if (!deadlinesByCase[d.case_id]) deadlinesByCase[d.case_id] = [];
      deadlinesByCase[d.case_id].push(d);
    });

    const medicalByCase = {};
    medicalRes.rows.forEach(m => {
      if (!medicalByCase[m.case_id]) medicalByCase[m.case_id] = { stillTreating: false, totalBilled: 0 };
      if (m.still_treating) medicalByCase[m.case_id].stillTreating = true;
      medicalByCase[m.case_id].totalBilled += parseFloat(m.total_billed || 0);
    });

    const today = new Date().toISOString().split("T")[0];
    const nowMs = Date.now();
    const daysUntil = (dateStr) => {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      return Math.ceil((d - nowMs) / (1000 * 60 * 60 * 24));
    };
    const daysSince = (dateStr) => {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      return Math.floor((nowMs - d) / (1000 * 60 * 60 * 24));
    };

    const caseSummaries = casesRes.rows.map(c => {
      const tasks = tasksByCase[c.id] || [];
      const deadlines = deadlinesByCase[c.id] || [];
      const medical = medicalByCase[c.id] || { stillTreating: false, totalBilled: 0 };
      const overdueTasks = tasks.filter(t => t.due && t.due < today && t.status !== "Completed");
      const upcoming = deadlines.filter(d => {
        const diff = (new Date(d.date) - nowMs) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 30;
      });

      const overdueSummary = overdueTasks.length > 0
        ? overdueTasks.slice(0, 3).map(t => `"${t.title}" (due ${t.due})`).join(", ")
        : "None";

      const deadlineSummary = upcoming.length > 0
        ? upcoming.slice(0, 4).map(d => `"${d.title}" on ${d.date} (${daysUntil(d.date)} days)`).join(", ")
        : "None in next 30 days";

      const solDays = daysUntil(c.statute_of_limitations_date);
      const trialDays = daysUntil(c.trial_date);
      const accidentAge = daysSince(c.accident_date);

      return [
        `--- CASE ID:${c.id} ---`,
        `Title: "${c.title}" | Case#: ${c.case_num || "N/A"} | Client: ${c.client_name || "N/A"}`,
        `Type: ${c.case_type} | Stage: ${c.stage} | State: ${c.state_jurisdiction || "N/A"}`,
        `Injury: ${c.injury_type || "N/A"} | Case Value: ${c.case_value_estimate ? "$" + c.case_value_estimate : "Not estimated"}`,
        `SOL Date: ${c.statute_of_limitations_date || "Not set"}${solDays !== null ? ` (${solDays} days remaining)` : ""}`,
        `Trial: ${c.trial_date || "Not set"}${trialDays !== null ? ` (${trialDays} days away)` : ""} | Mediation: ${c.mediation_date || "Not set"}`,
        `Accident: ${c.accident_date || "N/A"}${accidentAge !== null ? ` (${accidentAge} days ago)` : ""} | Attorney: ${userMap[c.lead_attorney] || "Unassigned"}`,
        `Treatment: ${medical.stillTreating ? "Still Treating" : "Discharged/None"} | Medical Specials: $${medical.totalBilled.toFixed(2)}`,
        `Overdue Tasks (${overdueTasks.length}): ${overdueSummary}`,
        `Upcoming Deadlines (${upcoming.length}): ${deadlineSummary}`,
        `Open Tasks: ${tasks.length}`,
      ].join("\n");
    }).join("\n\n");

    const systemPrompt = `You are a personal injury case triage assistant for a PI law firm. Analyze the active caseload and return a JSON object with a "cases" array. Each entry must have:
- "id" (number — the case ID)
- "title" (string — the case title)
- "urgency" (1-10 scale, 10 = most urgent)
- "reason" (string — 2-3 detailed sentences explaining WHY this case is urgent, citing SPECIFIC facts from the case data)
- "action" (string — one specific, actionable next step the attorney should take)

Rank by urgency descending. Return top 8 most urgent cases. Today is ${today}.

CRITICAL INSTRUCTIONS FOR "reason" FIELD:
- ALWAYS cite specific SOL dates and days remaining (e.g., "Statute of limitations expires in 45 days on 2025-08-15")
- ALWAYS state exact day counts for deadlines and dates
- Reference specific overdue tasks and deadlines by name
- Mention treatment status and medical specials totals
- Never give vague reasons — cite specific facts

Priority factors (highest to lowest):
1. Statute of limitations expiring within 60 days — always highest urgency (9-10)
2. SOL expiring within 180 days with no suit filed
3. Trial date within 30 days
4. High-value cases with incomplete treatment or missing documentation
5. Cases with overdue tasks — especially medical records requests, demand letters, or discovery
6. Imminent court dates, mediations, or deadlines within 7 days
7. Cases where client is still treating but approaching maximum medical improvement
8. Cases with pending settlement negotiations requiring response
9. Cases stalled without activity for extended periods
10. Cases with unresolved liens that may affect settlement distribution
11. Higher case values requiring more attention
12. Cases at intake or investigation stage needing advancement`;

    const raw = await aiCall(systemPrompt, `Active caseload:\n${caseSummaries}`, true, req.session.userId, 'triage');
    const parsed = JSON.parse(raw);
    res.json({ cases: parsed.cases || [] });
  } catch (err) {
    console.error("Case triage error:", err);
    res.status(500).json({ error: "AI triage failed" });
  }
});

router.post("/client-summary", requireAuth, async (req, res) => {
  try {
    const { caseId } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });

    const [caseRes, activityRes, deadlinesRes, usersRes, medicalRes, negotiationsRes] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
      pool.query("SELECT action, detail, ts FROM case_activity WHERE case_id = $1 ORDER BY ts DESC LIMIT 10", [caseId]),
      pool.query("SELECT title, date FROM deadlines WHERE case_id = $1 AND date >= CURRENT_DATE ORDER BY date ASC LIMIT 5", [caseId]),
      pool.query("SELECT id, name FROM users"),
      pool.query("SELECT provider_name, provider_type, still_treating FROM case_medical_treatments WHERE case_id = $1", [caseId]),
      pool.query("SELECT date, direction, amount FROM case_negotiations WHERE case_id = $1 ORDER BY date DESC LIMIT 3", [caseId]),
    ]);

    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u.name; });

    const activity = activityRes.rows.map(a => `${a.action}: ${(a.detail || "").substring(0, 100)}`).join("\n") || "No recent activity";
    const deadlines = deadlinesRes.rows.map(d => `${d.title} — ${d.date}`).join("\n") || "No upcoming deadlines";

    const treatmentStatus = medicalRes.rows.length > 0
      ? medicalRes.rows.map(m => `${m.provider_name} (${m.provider_type}): ${m.still_treating ? "Still treating" : "Completed"}`).join("\n")
      : "No treatment records";

    const recentNegotiations = negotiationsRes.rows.length > 0
      ? negotiationsRes.rows.map(n => `${n.date || "N/A"}: ${n.direction} — $${n.amount || 0}`).join("\n")
      : "No negotiations yet";

    const systemPrompt = `You are writing a case status update for a personal injury client or their family. Use simple, clear language — no legal jargon. Write in a warm but professional tone. Keep it concise (under 300 words). Use short paragraphs. Explain what has happened with their case, where they are in the treatment and claims process, what is coming next, and what the client should do or prepare for. Do NOT give legal advice — just factual status updates.`;

    const userPrompt = `Write a plain-language case status summary:

Case: ${c.title}
Client: ${c.client_name || "the client"}
Attorney: ${userMap[c.lead_attorney] || "Your attorney"}
Current Stage: ${c.stage || "Ongoing"}
Case Type: ${c.case_type || "Personal Injury"}
Accident Date: ${c.accident_date || "Not specified"}
Statute of Limitations: ${c.statute_of_limitations_date || "Not specified"}
Next Court Date: ${c.next_court_date || "Not yet scheduled"}
Trial Date: ${c.trial_date || "Not yet scheduled"}
Mediation Date: ${c.mediation_date || "Not yet scheduled"}

Treatment Status:
${treatmentStatus}

Recent Negotiations:
${recentNegotiations}

Recent Activity:
${activity}

Upcoming Dates:
${deadlines}`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'summary');
    res.json({ result });
  } catch (err) {
    console.error("Client summary error:", err);
    res.status(500).json({ error: "AI summary generation failed" });
  }
});

router.post("/task-suggestions", requireAuth, async (req, res) => {
  try {
    const { caseId } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });

    const [caseRes, tasksRes, notesRes, deadlinesRes, partiesRes, medicalRes, insuranceRes] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
      pool.query("SELECT title, status, priority, assigned_role, due FROM tasks WHERE case_id = $1", [caseId]),
      pool.query("SELECT body, type FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT 10", [caseId]),
      pool.query("SELECT title, date, type FROM deadlines WHERE case_id = $1", [caseId]),
      pool.query("SELECT party_type, data FROM case_parties WHERE case_id = $1", [caseId]),
      pool.query("SELECT provider_name, provider_type, still_treating, total_billed FROM case_medical_treatments WHERE case_id = $1", [caseId]),
      pool.query("SELECT policy_type, carrier_name, claim_number FROM case_insurance_policies WHERE case_id = $1", [caseId]),
    ]);

    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const existingTasks = tasksRes.rows.map(t =>
      `${t.title} [${t.status}] (${t.priority}, ${t.assigned_role || "Unassigned"}, due: ${t.due || "none"})`
    ).join("\n") || "No existing tasks";

    const notesText = notesRes.rows.map(n => `[${n.type}] ${(n.body || "").substring(0, 200)}`).join("\n") || "No notes";

    const deadlinesText = deadlinesRes.rows.map(d =>
      `${d.title} (${d.date ? new Date(d.date).toISOString().split("T")[0] : "no date"}, ${d.type || ""})`
    ).join("\n") || "No deadlines";

    const partiesText = partiesRes.rows.map(p => {
      const d = p.data || {};
      return `${[d.firstName, d.lastName].filter(Boolean).join(" ") || "Unnamed"} (${p.party_type})`;
    }).join("\n") || "None";

    const medicalText = medicalRes.rows.map(m =>
      `${m.provider_name} (${m.provider_type}) — $${m.total_billed || 0}, ${m.still_treating ? "Still Treating" : "Discharged"}`
    ).join("\n") || "No medical treatments";

    const insuranceText = insuranceRes.rows.map(i =>
      `${i.policy_type}: ${i.carrier_name}, Claim#: ${i.claim_number || "N/A"}`
    ).join("\n") || "No insurance policies";

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `You are a senior personal injury case manager. Based on the case details, suggest 5-8 concrete, actionable tasks that the legal team should complete next. Return ONLY valid JSON with a "tasks" array. Each task object must have:
- "title" (string — specific, actionable task name)
- "priority" (one of: "Low", "Medium", "High", "Urgent")
- "assignedRole" (one of: "Lead Attorney", "2nd Attorney", "Investigator", "Paralegal", "Case Manager", "Medical Records Coordinator")
- "rationale" (string — one sentence explaining why this task is important now)
- "dueInDays" (number — suggested days from today to complete this task)

Guidelines:
- DO NOT suggest tasks that duplicate existing tasks listed below
- Consider the current case stage, injury type, treatment status, and upcoming deadlines
- Prioritize time-sensitive items (SOL deadlines, discovery deadlines, IME scheduling)
- Include tasks like: order medical records, send preservation letter, schedule IME, file suit, draft demand letter, request police report, obtain witness statements, schedule client deposition prep, file discovery responses, coordinate lien negotiations
- Consider whether medical treatment is complete before suggesting demand-related tasks
Today's date is ${today}.`;

    const userPrompt = `Case: ${c.title}
Client: ${c.client_name || "Unknown"}
Case Type: ${c.case_type || "Unknown"} | State: ${c.state_jurisdiction || "Unknown"}
Stage: ${c.stage || "Unknown"} | Status: ${c.status || "Unknown"}
Accident Date: ${c.accident_date ? new Date(c.accident_date).toISOString().split("T")[0] : "Unknown"}
SOL Date: ${c.statute_of_limitations_date ? new Date(c.statute_of_limitations_date).toISOString().split("T")[0] : "Unknown"}
Injury Type: ${c.injury_type || "Unknown"}
Liability Assessment: ${c.liability_assessment || "Not assessed"}
Next Court Date: ${c.next_court_date ? new Date(c.next_court_date).toISOString().split("T")[0] : "Not set"}
Trial Date: ${c.trial_date ? new Date(c.trial_date).toISOString().split("T")[0] : "Not set"}
Mediation Date: ${c.mediation_date ? new Date(c.mediation_date).toISOString().split("T")[0] : "Not set"}
Demand Amount: ${c.demand_amount ? "$" + c.demand_amount : "Not set"}

Insurance Policies:
${insuranceText}

Medical Treatment:
${medicalText}

Parties:
${partiesText}

Existing Tasks (DO NOT DUPLICATE):
${existingTasks}

Recent Notes:
${notesText}

Upcoming Deadlines:
${deadlinesText}

Suggest 5-8 specific, actionable tasks the legal team should prioritize next.`;

    const raw = await aiCall(systemPrompt, userPrompt, true, req.session.userId, 'tasksuggestions');
    const parsed = JSON.parse(raw);
    res.json({ tasks: parsed.tasks || [] });
  } catch (err) {
    console.error("Task suggestions error:", err);
    res.status(500).json({ error: "AI task suggestion failed" });
  }
});

router.post("/classify-filing", requireAuth, async (req, res) => {
  try {
    const { filingId } = req.body;
    if (!filingId) return res.status(400).json({ error: "filingId required" });

    const { rows } = await pool.query(
      "SELECT cf.*, c.title as case_title, c.client_name FROM case_filings cf JOIN cases c ON cf.case_id = c.id WHERE cf.id = $1",
      [filingId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Filing not found" });
    const filing = rows[0];

    const userRole = req.session.userRole || "";
    if (userRole !== "App Admin") {
      const userId = req.session.userId;
      const access = await pool.query(
        "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR case_manager = $4 OR investigator = $5 OR paralegal = $6 OR confidential = false OR confidential IS NULL)",
        [filing.case_id, userId, userId, userId, userId, userId]
      );
      if (access.rows.length === 0) return res.status(403).json({ error: "Access denied" });
    }

    if (!filing.extracted_text) return res.status(400).json({ error: "No text could be extracted from this filing" });

    const systemPrompt = `You are a court filing classification assistant for a personal injury law firm. Analyze the court filing text and classify it. Return ONLY valid JSON with these fields:
- "suggestedName" (string — proper legal filing name, e.g., "Complaint for Personal Injury", "Defendant's Answer", "Motion for Summary Judgment", "Discovery Responses", "Medical Records Subpoena")
- "filedBy" (one of: "Plaintiff", "Defendant", "Court", "Third Party", "Other")
- "docType" (string — filing type, e.g., "Complaint", "Answer", "Motion for Summary Judgment", "Motion to Compel", "Discovery Request", "Discovery Response", "Interrogatories", "Request for Production", "Deposition Notice", "Court Order", "Subpoena", "Expert Report", "Medical Records", "Settlement Agreement", "Mediation Report", "Daubert Motion", "Other")
- "filingDate" (string — date found in the filing in YYYY-MM-DD format, or null if not found)
- "summary" (string — 2-3 sentence summary of the filing's content and significance for the plaintiff's case)
- "hearingDates" (array of objects with "date" (YYYY-MM-DD) and "description" (string — e.g., "Motion Hearing", "Mediation", "Deposition", "Trial Setting Conference"). Extract ALL hearing dates, court dates, or scheduled appearances mentioned in the filing. Return empty array [] if none found.)

Be precise about who filed the document. Look for signatures, captions, and headings to determine the filing party.`;

    const textSnippet = filing.extracted_text.substring(0, 12000);
    const userPrompt = `Classify this court filing from the case "${filing.case_title}" (Client: ${filing.client_name || "Unknown"}):\n\n${textSnippet}`;

    const raw = await aiCall(systemPrompt, userPrompt, true, req.session.userId, 'filingclassifier');
    const parsed = JSON.parse(raw);

    const updates = [];
    const vals = [];
    let idx = 1;
    if (parsed.suggestedName) { updates.push(`filename = $${idx++}`); vals.push(parsed.suggestedName); }
    if (parsed.filedBy) { updates.push(`filed_by = $${idx++}`); vals.push(parsed.filedBy); }
    if (parsed.docType) { updates.push(`doc_type = $${idx++}`); vals.push(parsed.docType); }
    if (parsed.filingDate) { updates.push(`filing_date = $${idx++}`); vals.push(parsed.filingDate); }
    if (parsed.summary) { updates.push(`summary = $${idx++}`); vals.push(parsed.summary); }

    if (updates.length > 0) {
      vals.push(filingId);
      await pool.query(`UPDATE case_filings SET ${updates.join(", ")} WHERE id = $${idx}`, vals);
    }

    if (Array.isArray(parsed.hearingDates) && parsed.hearingDates.length > 0) {
      const createdDeadlines = [];
      for (const hd of parsed.hearingDates) {
        if (!hd.date || !hd.description) continue;
        try {
          const { rows: existing } = await pool.query(
            `SELECT id FROM deadlines WHERE case_id = $1 AND date = $2 AND LOWER(title) = LOWER($3)`,
            [filing.case_id, hd.date, hd.description]
          );
          if (existing.length === 0) {
            const { rows: newDl } = await pool.query(
              `INSERT INTO deadlines (case_id, title, date, type, rule, assigned) VALUES ($1, $2, $3, 'Hearing', '', NULL) RETURNING *`,
              [filing.case_id, hd.description, hd.date]
            );
            createdDeadlines.push(newDl[0]);
            console.log(`Auto-created hearing deadline: "${hd.description}" on ${hd.date} for case ${filing.case_id}`);
          }
        } catch (dlErr) {
          console.error("Auto-create hearing deadline error:", dlErr.message);
        }
      }
      parsed.createdDeadlines = createdDeadlines;
    }

    res.json({ classification: parsed });
  } catch (err) {
    console.error("Filing classification error:", err);
    res.status(500).json({ error: "AI filing classification failed" });
  }
});

router.post("/doc-summary", requireAuth, async (req, res) => {
  try {
    const { text, docType, caseTitle, clientName } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Document text is required" });

    const isMedicalRecord = (docType || "").toLowerCase().includes("medical") || (docType || "").toLowerCase().includes("record");

    const systemPrompt = isMedicalRecord
      ? `You are a personal injury attorney's medical record analysis assistant. Summarize the provided medical records for an attorney reviewing a personal injury case. Focus on information relevant to the injury claim.

Provide a structured summary with these sections:
PATIENT INFORMATION & DATES OF SERVICE
CHIEF COMPLAINTS & DIAGNOSES (with ICD codes if available)
TREATMENT PROVIDED (procedures, medications, referrals)
OBJECTIVE FINDINGS (imaging, lab results, physical exam findings)
FUNCTIONAL LIMITATIONS & RESTRICTIONS
CAUSATION STATEMENTS (any provider statements linking injuries to the accident)
PRE-EXISTING CONDITIONS (any mention of prior injuries or conditions)
PROGNOSIS & FUTURE TREATMENT RECOMMENDATIONS
BILLING SUMMARY (charges if mentioned)

Be thorough but concise. Flag anything that strengthens or weakens the injury claim.`
      : `You are a personal injury attorney's document analysis assistant. Summarize the provided document for an attorney reviewing a personal injury case. Focus on information relevant to the claim.

Provide a structured summary with these sections:
KEY FACTS & TIMELINE
PEOPLE MENTIONED (with roles — witnesses, parties, adjusters, officers)
LIABILITY-RELEVANT DETAILS (fault indicators, admissions, scene conditions)
DAMAGES-RELEVANT DETAILS (injuries, property damage, financial losses)
INCONSISTENCIES OR CONCERNS
BOTTOM LINE

Be concise but thorough. Flag anything that could help or hurt the case.`;

    const textSnippet = text.substring(0, 12000);
    const userPrompt = `Summarize this ${docType || "document"} for the case "${caseTitle || "Unknown"}" (Client: ${clientName || "Unknown"}):\n\n${textSnippet}`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'docsummary');
    res.json({ result });
  } catch (err) {
    console.error("Doc summary error:", err);
    res.status(500).json({ error: "AI document summary failed" });
  }
});

const APP_KNOWLEDGE_BASE = `
=== MATTRMINDR APPLICATION GUIDE ===
You are also the built-in help assistant for MattrMindr, a personal injury case management system for PI law firms. When users ask "how do I..." questions about the software, give specific step-by-step instructions based on this guide.

NAVIGATION: The app has a left sidebar with these sections: Dashboard, Cases, Calendar, Tasks, Templates, Time Log, Reports, AI Center, Contacts, Staff. Click any item to navigate.

DASHBOARD:
- Shows widgets: My Tasks, My Upcoming Deadlines, Recent Activity, Pinned Cases, My Time, AI Triage
- Click "Customize" (top-right) to add/remove/reorder widgets via drag-and-drop
- Quick Notes widget: type notes without assigning to a case; assign later from the note itself
- Quick Notes support speech-to-text: click the microphone icon to dictate

CASES:
- "New Case" button (top-right) opens the creation form. Fill in case number, title, client name, case type, state jurisdiction, and accident date
- Conflict Check: automatically runs when you enter a client name — shows matching cases/contacts
- Filter cases by status tabs: All, Active, Pre-Litigation, In Litigation, Settled, Closed
- Search bar filters by case number, title, or client name
- Click any case row to open the Case Detail Overlay
- Pin important cases: click the pin icon on any case row; pinned cases appear at the top and in dropdown selectors
- Case Detail Overlay has tabs: Overview, Details, Medical Treatment, Insurance, Damages, Liens, Negotiations, Documents, Filings, Correspondence, Tasks, Deadlines, Notes, Activity, Linked Cases
- Edit mode: click "Edit" button in case header to enable field editing; click "Done" to save
- Mark cases Confidential via toggle button in the case header
- SOL Warning: cases approaching statute of limitations display a warning indicator (red when < 60 days, amber when < 180 days)
- Delete a case: click "Delete" in edit mode; case moves to Deleted tab (30-day retention, then permanent deletion; can restore within window)

CASE DETAILS:
- Overview shows: client name, case type, accident date, SOL date with countdown, injury type, case value estimate
- Details tab has: incident description, location, police report, weather conditions, liability assessment, comparative fault %, property damage
- State jurisdiction selector for all 50 US states — controls jurisdiction-aware AI analysis

MEDICAL TREATMENT TAB:
- Track all medical providers and treatment history
- Add providers: click "+ Add Provider", fill in provider name, type (ER, Hospital, Orthopedic, Chiropractor, PT, etc.), visit dates, billing
- Running total of medical specials displayed at the top
- Track whether client is still treating at each provider

INSURANCE TAB:
- Track multiple insurance policies per case (Liability, UM/UIM, MedPay, PIP, etc.)
- Add policies: click "+ Add Policy", fill in carrier, policy number, limits, adjuster info, claim number

DAMAGES TAB:
- Track all damage categories: Medical Bills, Lost Wages, Future Medical, Property Damage, Pain & Suffering, etc.
- Running totals and demand vs settlement comparison

LIENS TAB:
- Track liens: Medical, Medicare, Medicaid, Health Insurance, ERISA, etc.
- Track negotiated amounts and status (Pending, Confirmed, Negotiated, Satisfied, Disputed)

NEGOTIATIONS TAB:
- Timeline of all demands, offers, counter-demands, and counter-offers
- Track amounts, dates, and parties for each negotiation entry

DOCUMENTS:
- Documents tab in Case Detail: upload PDF, DOCX, DOC, XLS/XLSX, PPT/PPTX, images, and other file types
- Document types include: Medical Records, Police Report, Insurance Correspondence, Demand Letter, Settlement Agreement, Expert Report, Client Correspondence, Court Filing, Discovery, Witness Statement, Photo/Video Evidence, Bills/Invoices, Employment Records, Property Damage, and more
- Each document can be AI-summarized (click "Summarize" button) — medical records get specialized analysis
- Edit document name and type inline by clicking on them
- Download or delete documents via action buttons
- Documents can be organized into folders — drag and drop to move documents between folders
- Click a document filename or "View" button to open it in the floating Document Viewer window
- Document Viewer: floating, draggable, resizable window with title bar buttons for download, print, present (opens in new window), and reload
- Document Viewer supports: PDF, Word (DOCX/DOC), Excel (XLSX/XLS), PowerPoint (PPTX/PPT), images, video, audio, and text files
- Document Viewer: Office documents can be viewed via Microsoft 365 Online or built-in viewer (toggle between them)
- Document Viewer: Office documents can be edited in-place using Microsoft 365 or ONLYOFFICE DocSpace (if connected)
- Document Viewer: Case Info Panel — click the briefcase icon in the title bar to open a side panel showing all case information (client, dates, financials, liability, team) for quick reference while reviewing documents
- Multiple document viewers can be open simultaneously; minimize to chips at bottom of screen

FILINGS:
- Filings tab in Case Detail: upload court filings (PDF only)
- AI auto-classifies uploaded filings (name, filing party, type, date, hearing dates)
- Filter filings by filing party (Plaintiff, Defendant, Court, etc.)
- Click "Classify" to re-run AI classification; "Summarize" for a detailed summary

TRANSCRIPTS:
- Transcripts tab in Case Detail: upload audio/video files for transcription or create text-based transcripts
- Transcripts can be organized into folders — drag and drop to move between folders
- Click a transcript to open it in the floating Transcript Viewer window (similar to Document Viewer — draggable, resizable)
- Transcript Viewer: shows full transcript text with speaker labels, timestamps, and playback controls for audio/video
- Scribe Integration: if connected, transcripts can be sent to Scribe for professional AI transcription
- Scribe Summaries: click "Summaries" button in the Transcript Viewer to fetch AI-generated summaries from Scribe (requires Scribe connection)
- Multiple transcript viewers can be open simultaneously; minimize to chips at bottom of screen

CASE FEE STRUCTURE:
- Cases support fee structure tracking: Contingency, Hourly, Flat Fee, or Hybrid
- Contingency fee percentage can be set per case (shown in case header and overview)
- Fee information appears in reports and case valuation analysis

CALENDAR:
- Monthly grid showing deadlines, task due dates, court dates, and imported calendar events
- Toggle event types on/off using the visibility toggles
- Click any day to see all events for that day with clickable case links
- "Add Deadline" tab: create new deadlines linked to cases
- List view: toggle between calendar grid and sortable deadline list

TASKS:
- View all tasks across all cases
- Filter by assignee, priority, status, or search
- Create tasks: click "+ New Task", select a case, fill in title, priority, due date, assignee
- Complete tasks: click the checkbox; you'll be prompted to log time
- Edit tasks inline by clicking on fields
- Tasks can be auto-suggested by the AI Task Suggestions agent

TEMPLATES:
- Upload .docx template files with placeholders like {{client_name}}, {{case_number}}, etc.
- Create a template: click "+ New Template", upload your .docx file, set category and name
- The system auto-detects placeholders in the document
- Generate documents: from a case's detail view, click "Generate" and choose a template; placeholders auto-fill with case data
- Categories: Demand Letters, Motions, Discovery, Complaints, Client Letters, Medical Records Requests, General
- AI Draft mode: alternatively, use "AI Draft" tab to generate documents from scratch using AI (including demand letters)

TIME LOG:
- Shows all time entries: auto-derived from completed tasks, notes with time logged, and correspondence
- Also supports manual time entries: click "+ Add Entry" to log time manually
- Filter by date range (This Week, This Month, Last Month, Custom)
- Export time data for billing purposes

REPORTS:
- Click any report card to generate that report type
- Available reports: Settlement Report, Case Value Pipeline, Cases by Type, SOL Tracker, Medical Specials Summary, Contingency Fee Report, Attorney Caseload, Time-to-Settlement Analysis
- Reports support attorney/staff filtering and date range parameters
- Export to CSV or Print directly from the report view

AI CENTER:
- Access all AI agents from one place
- Agent cards in a grid; click one to open it
- Most agents require selecting a case first (except Case Triage and Batch Case Manager)
- Available agents: Liability Analysis, Deadline Generator, Case Valuation & Strategy, Demand Letter & Document Drafting, Case Triage, Client Summary, Task Suggestions, Filing Classifier, Medical Record Summarizer
- "Advocate AI Trainer" tab: create training entries to customize how AI agents behave
- Training entries can target specific agents or all agents
- Two scopes: Personal (only affects your AI) and Office (affects everyone's AI, admin-only)

CONTACTS:
- Directory of all contacts: Clients, Insurance Adjusters, Insurance Companies, Medical Providers, Defense Attorneys, Judges, Courts, Witnesses, Experts, etc.
- Add new contact: click "+ New Contact", fill in details
- Click a contact to open their detail overlay with notes and linked cases
- Pin frequently used contacts for quick access
- Merge duplicate contacts: select two contacts and use the merge function
- Deleted contacts have 30-day retention

STAFF:
- View all staff members with their roles, contact info, and active case counts
- Admins can: change roles, toggle offices, send temporary passwords, deactivate staff
- Pin staff members for quick access at the top of the list

CASE DETAILS — INJURY & INCIDENT FIELDS:
- Injury Type: categorize the type of injury (Soft Tissue, Fracture, TBI, Spinal, Burns, Amputation, Internal Injuries, Wrongful Death, etc.)
- Injury Description: free-text description of the client's injuries
- Incident Location: where the accident/incident occurred
- Incident Description: free-text description of what happened
- Liability Assessment: Favorable, Neutral, Contested, or Unfavorable
- Comparative Fault %: estimated client comparative fault percentage

FLOATING VIEWER SYSTEM:
- Documents and transcripts open in floating viewer windows that hover over the main application
- Multiple viewers can be open at the same time — each is independently draggable and resizable
- Viewers can be minimized to chips at the bottom of the screen (click chip to restore)
- On mobile devices: viewers open full-screen instead of floating (no drag/resize/minimize)
- Document Viewer has a Case Info Panel (briefcase icon) to quickly reference case details while reviewing a document

KEYBOARD & TIPS:
- Press Enter in search fields to filter immediately
- Speech-to-text available in notes (click microphone icon)
- Dark/Light mode toggle in sidebar footer
- All modals and pop-up windows require clicking the X close button or Cancel to dismiss — clicking outside does not close them
- Advocate AI can be opened from any case (click the AI button in the case header) or globally from the sidebar
- Advocate AI when opened from a case has full access to all case data for context-aware assistance
- Multiple document/transcript viewers can be open simultaneously — minimize them to manage screen space
`;

router.post("/advocate", requireAuth, async (req, res) => {
  try {
    const { caseId, messages, screenContext } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "messages required" });

    let contextBlock = "";
    let contextStats = null;

    if (caseId) {
      const [caseRes, notesRes, tasksRes, deadlinesRes, partiesRes, docsRes, filingsRes, corrRes, insuranceRes, medicalRes, damagesRes, liensRes, negotiationsRes] = await Promise.all([
        pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
        pool.query("SELECT body, type, created_at FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC", [caseId]),
        pool.query("SELECT title, status, priority, notes, due FROM tasks WHERE case_id = $1 ORDER BY due ASC NULLS LAST", [caseId]),
        pool.query("SELECT title, date, type, rule FROM deadlines WHERE case_id = $1 ORDER BY date ASC", [caseId]),
        pool.query("SELECT party_type, data FROM case_parties WHERE case_id = $1", [caseId]),
        pool.query("SELECT filename, doc_type, summary, extracted_text FROM case_documents WHERE case_id = $1 ORDER BY created_at DESC", [caseId]),
        pool.query("SELECT filename, doc_type, filed_by, filing_date, summary FROM case_filings WHERE case_id = $1 ORDER BY filing_date DESC NULLS LAST", [caseId]),
        pool.query("SELECT subject, from_name, body_text, received_at FROM case_correspondence WHERE case_id = $1 ORDER BY received_at DESC", [caseId]),
        pool.query("SELECT policy_type, carrier_name, policy_limits, adjuster_name, adjuster_email, claim_number, insured_name FROM case_insurance_policies WHERE case_id = $1", [caseId]),
        pool.query("SELECT provider_name, provider_type, first_visit_date, last_visit_date, still_treating, total_billed, total_paid, description FROM case_medical_treatments WHERE case_id = $1", [caseId]),
        pool.query("SELECT category, description, amount, documentation_status FROM case_damages WHERE case_id = $1", [caseId]),
        pool.query("SELECT lien_type, lienholder_name, amount, negotiated_amount, status FROM case_liens WHERE case_id = $1", [caseId]),
        pool.query("SELECT date, direction, amount, from_party, notes FROM case_negotiations WHERE case_id = $1 ORDER BY date DESC", [caseId]),
      ]);

      const c = caseRes.rows[0];
      if (!c) return res.status(404).json({ error: "Case not found" });

      contextStats = {
        notes: notesRes.rows.length,
        tasks: tasksRes.rows.length,
        deadlines: deadlinesRes.rows.length,
        documents: docsRes.rows.length,
        filings: filingsRes.rows.length,
        emails: corrRes.rows.length,
        parties: partiesRes.rows.length,
        insurance: insuranceRes.rows.length,
        medical: medicalRes.rows.length,
        damages: damagesRes.rows.length,
        liens: liensRes.rows.length,
        negotiations: negotiationsRes.rows.length,
      };

      const notesText = notesRes.rows.map(n => `[${n.type || "Note"}] ${(n.body || "").substring(0, 800)}`).join("\n\n") || "No notes";
      const tasksText = tasksRes.rows.map(t =>
        `- ${t.title} (${t.status}, ${t.priority}${t.due ? ", due " + t.due : ""}${t.notes ? ": " + t.notes.substring(0, 200) : ""})`
      ).join("\n") || "No tasks";
      const deadlinesText = deadlinesRes.rows.map(d =>
        `- ${d.title} — ${d.date || "No date"} (${d.type || ""}${d.rule ? ", Rule: " + d.rule : ""})`
      ).join("\n") || "No deadlines";
      const partiesText = partiesRes.rows.map(p => {
        const d = p.data || {};
        const name = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ") || "Unknown";
        let info = `${name} (${p.party_type || "Party"})`;
        if (d.attorney) info += ` — Attorney: ${d.attorney}`;
        if (d.insurance) info += ` — Insurance: ${d.insurance}`;
        return `- ${info}`;
      }).join("\n") || "No parties";
      const docsText = docsRes.rows.map(d => {
        const summary = d.summary || (d.extracted_text ? d.extracted_text.substring(0, 400) + "..." : "No summary available");
        return `- [${d.doc_type || "Other"}] ${d.filename}: ${summary}`;
      }).join("\n\n") || "No documents";
      const filingsText = filingsRes.rows.map(f =>
        `- [${f.doc_type || "Filing"}] ${f.filename} — Filed by: ${f.filed_by || "Unknown"}, Date: ${f.filing_date || "Unknown"}${f.summary ? "\n  Summary: " + f.summary : ""}`
      ).join("\n\n") || "No filings";
      const emailsText = corrRes.rows.map(e =>
        `- From: ${e.from_name || "Unknown"} — Subject: ${e.subject || "(no subject)"}\n  ${(e.body_text || "").substring(0, 500)}`
      ).join("\n\n") || "No correspondence";

      const insuranceText = insuranceRes.rows.map(i =>
        `- ${i.policy_type}: ${i.carrier_name} — Limits: ${i.policy_limits || "Unknown"}, Adjuster: ${i.adjuster_name || "N/A"}, Claim#: ${i.claim_number || "N/A"}`
      ).join("\n") || "No insurance policies";

      const totalMedicals = medicalRes.rows.reduce((sum, m) => sum + parseFloat(m.total_billed || 0), 0);
      const medicalText = medicalRes.rows.map(m =>
        `- ${m.provider_name} (${m.provider_type}) — Billed: $${m.total_billed || 0}, ${m.still_treating ? "Still Treating" : "Discharged"}, ${m.first_visit_date || "N/A"} to ${m.last_visit_date || "N/A"}${m.description ? ": " + m.description : ""}`
      ).join("\n") || "No medical treatments";

      const totalDamages = damagesRes.rows.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0);
      const damagesText = damagesRes.rows.map(d =>
        `- ${d.category}: $${d.amount || 0} (${d.documentation_status}) ${d.description || ""}`
      ).join("\n") || "No damages";

      const totalLiens = liensRes.rows.reduce((sum, l) => sum + parseFloat(l.amount || 0), 0);
      const liensText = liensRes.rows.map(l =>
        `- ${l.lien_type}: ${l.lienholder_name} — $${l.amount || 0} (${l.status})${l.negotiated_amount ? ", Negotiated: $" + l.negotiated_amount : ""}`
      ).join("\n") || "No liens";

      const negotiationsText = negotiationsRes.rows.map(n =>
        `- ${n.date || "N/A"}: ${n.direction} — $${n.amount || 0} from ${n.from_party || "Unknown"}${n.notes ? ": " + n.notes.substring(0, 200) : ""}`
      ).join("\n") || "No negotiations";

      contextBlock = `
=== CASE INFORMATION ===
Title: ${c.title || ""}
Case Number: ${c.case_num || ""}
Client: ${c.client_name || "Unknown"}
Case Type: ${c.case_type || "Unknown"} | State: ${c.state_jurisdiction || "Unknown"}
Court: ${c.court || "Not specified"} | Judge: ${c.judge || "Not assigned"}
Stage: ${c.stage || "Unknown"} | Status: ${c.status || "Unknown"}
Accident Date: ${c.accident_date || "Unknown"} | SOL Date: ${c.statute_of_limitations_date || "Unknown"}
Injury Type: ${c.injury_type || "Unknown"} | Injury Description: ${c.injury_description || "Not provided"}
Incident Location: ${c.incident_location || "Unknown"}
Incident Description: ${c.incident_description || "Not provided"}
Liability Assessment: ${c.liability_assessment || "Not assessed"}
Comparative Fault: ${c.comparative_fault_pct ? c.comparative_fault_pct + "%" : "Unknown"}
Case Value Estimate: ${c.case_value_estimate ? "$" + c.case_value_estimate : "Not estimated"}
Demand Amount: ${c.demand_amount ? "$" + c.demand_amount : "Not set"}
Settlement Amount: ${c.settlement_amount ? "$" + c.settlement_amount : "Not settled"}
Property Damage: ${c.property_damage_amount ? "$" + c.property_damage_amount : "Unknown"}
Police Report: ${c.police_report_number || "N/A"}
Trial Date: ${c.trial_date || "Not set"} | Mediation: ${c.mediation_date || "Not set"}

=== INSURANCE POLICIES (${contextStats.insurance} total) ===
${insuranceText}

=== MEDICAL TREATMENT (${contextStats.medical} total, Total Billed: $${totalMedicals.toFixed(2)}) ===
${medicalText}

=== DAMAGES (${contextStats.damages} total, Total: $${totalDamages.toFixed(2)}) ===
${damagesText}

=== LIENS (${contextStats.liens} total, Total: $${totalLiens.toFixed(2)}) ===
${liensText}

=== NEGOTIATIONS (${contextStats.negotiations} total) ===
${negotiationsText}

=== CASE NOTES (${contextStats.notes} total) ===
${notesText}

=== TASKS (${contextStats.tasks} total) ===
${tasksText}

=== DEADLINES (${contextStats.deadlines} total) ===
${deadlinesText}

=== PARTIES (${contextStats.parties} total) ===
${partiesText}

=== DOCUMENTS (${contextStats.documents} total) ===
${docsText}

=== COURT FILINGS (${contextStats.filings} total) ===
${filingsText}

=== EMAIL CORRESPONDENCE (${contextStats.emails} total) ===
${emailsText}`;

      const MAX_CONTEXT_CHARS = 60000;
      if (contextBlock.length > MAX_CONTEXT_CHARS) {
        const emailsTrunc = corrRes.rows.slice(0, 10).map(e =>
          `- From: ${e.from_name || "Unknown"} — Subject: ${e.subject || "(no subject)"}\n  ${(e.body_text || "").substring(0, 200)}`
        ).join("\n") || "No correspondence";
        contextBlock = contextBlock.replace(/=== EMAIL CORRESPONDENCE[\s\S]*$/, `=== EMAIL CORRESPONDENCE (${contextStats.emails} total, showing recent 10) ===\n${emailsTrunc}`);
      }
      if (contextBlock.length > MAX_CONTEXT_CHARS) {
        const notesTrunc = notesRes.rows.slice(0, 20).map(n => `[${n.type || "Note"}] ${(n.body || "").substring(0, 400)}`).join("\n\n");
        contextBlock = contextBlock.replace(/=== CASE NOTES[\s\S]*?=== TASKS/, `=== CASE NOTES (${contextStats.notes} total, showing recent 20) ===\n${notesTrunc}\n\n=== TASKS`);
      }
      if (contextBlock.length > MAX_CONTEXT_CHARS) {
        const docsTrunc = docsRes.rows.map(d => `- [${d.doc_type || "Other"}] ${d.filename}: ${(d.summary || "No summary").substring(0, 200)}`).join("\n");
        contextBlock = contextBlock.replace(/=== DOCUMENTS[\s\S]*?=== COURT FILINGS/, `=== DOCUMENTS (${contextStats.documents} total, truncated) ===\n${docsTrunc}\n\n=== COURT FILINGS`);
      }
      if (contextBlock.length > MAX_CONTEXT_CHARS) {
        const filTrunc = filingsRes.rows.slice(0, 15).map(f => `- [${f.doc_type || "Filing"}] ${f.filename} — Filed by: ${f.filed_by || "Unknown"}`).join("\n");
        contextBlock = contextBlock.replace(/=== COURT FILINGS[\s\S]*?=== EMAIL/, `=== COURT FILINGS (${contextStats.filings} total, truncated) ===\n${filTrunc}\n\n=== EMAIL`);
      }
      if (contextBlock.length > MAX_CONTEXT_CHARS) {
        contextBlock = contextBlock.substring(0, MAX_CONTEXT_CHARS) + "\n[Context truncated due to case size]";
      }
    }

    if (screenContext) {
      contextBlock += `\n\n=== CURRENT SCREEN CONTEXT ===\nThe user is currently viewing the following screen/data in the application:\n${screenContext.substring(0, 6000)}`;
    }

    const trainingContext = await getTrainingContext(req.session.userId, 'advocate');

    let basePrompt;
    if (caseId) {
      basePrompt = `You are Advocate AI, a senior personal injury attorney advisor assisting attorneys at a personal injury law firm. You have access to the complete case file below. Answer questions thoughtfully using specific details from the case. Be practical, strategic, and action-oriented. Reference specific evidence, documents, filings, medical records, insurance policies, and notes when relevant. Consider the applicable state law based on the case's jurisdiction.

TASK SUGGESTIONS: When your response includes specific action items, tasks, or recommended next steps for the legal team, you MUST append a hidden structured JSON block at the very end of your response using this exact format:
<!-- TASKS_JSON [{"title":"Task title","priority":"Medium","assignedRole":"Lead Attorney","rationale":"Why this task matters","dueInDays":14}] -->
Rules for the TASKS_JSON block:
- Only include it when you are genuinely suggesting actionable tasks/steps (not for general discussion or analysis without action items)
- priority must be one of: "Low", "Medium", "High", "Urgent"
- assignedRole must be one of: "Lead Attorney", "2nd Attorney", "Investigator", "Paralegal", "Case Manager", "Medical Records Coordinator"
- dueInDays is the number of days from today the task should be due (use your judgment based on urgency)
- Include 1-8 tasks per response as appropriate
- The JSON block is metadata only — your natural language response should still describe the tasks/steps normally`;
    } else {
      basePrompt = `You are Advocate AI, a senior personal injury attorney advisor and application assistant for a personal injury law firm. You help attorneys with:
1. General personal injury law questions about tort law, negligence, damages, insurance, and litigation strategy across all U.S. jurisdictions
2. Office policies and procedures
3. Navigating and using the MattrMindr case management system — always give specific, step-by-step instructions for this application when users ask how to do something
4. Answering questions about data currently visible on their screen

You have access to the user's current screen context below (if any). When answering questions about their data, reference specific items from the screen context. When answering "how do I..." questions, give step-by-step instructions specific to the MattrMindr application.

Do NOT suggest task actions (TASKS_JSON) when no case is selected.`;
    }

    const systemPrompt = `${basePrompt}\n\n${APP_KNOWLEDGE_BASE}${contextBlock}${trainingContext}${NO_MARKDOWN}`;

    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...messages.slice(-20).map(m => ({ role: m.role, content: m.content })),
    ];

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: apiMessages,
      temperature: 0.4,
      max_tokens: 2000,
      store: false,
    });

    let reply = resp.choices[0].message.content;
    let suggestedTasks = null;

    const taskPatterns = [
      /<!--\s*TASKS_JSON\s*(\[[\s\S]*?\])\s*-->/,
      /```(?:json)?\s*<!--\s*TASKS_JSON\s*(\[[\s\S]*?\])\s*-->\s*```/,
      /TASKS_JSON\s*(\[[\s\S]*?\])\s*(?:-->)?/,
    ];
    for (const pat of taskPatterns) {
      const m = reply.match(pat);
      if (m) {
        try {
          const parsed = JSON.parse(m[1]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            suggestedTasks = parsed;
            reply = reply.replace(m[0], "").replace(/```\s*$/, "").trim();
            break;
          }
        } catch (e) {}
      }
    }

    res.json({ reply, contextStats, suggestedTasks });
  } catch (err) {
    console.error("Advocate AI error:", err);
    res.status(500).json({ error: "Advocate AI failed" });
  }
});

module.exports = router;
