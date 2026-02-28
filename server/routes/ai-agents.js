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

async function aiCall(systemPrompt, userPrompt, jsonMode = false, userId = null, agentId = null) {
  let finalPrompt = systemPrompt;
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

router.post("/charge-class", requireAuth, async (req, res) => {
  try {
    const { statute, description } = req.body;
    if (!statute && !description) return res.status(400).json({ error: "Statute or description required" });
    const systemPrompt = `You are an Alabama criminal law classification assistant. Given a criminal statute and/or charge description, determine the charge classification under Alabama law. Return ONLY valid JSON with one field: "chargeClass" — which must be exactly one of: "Class A Felony", "Class B Felony", "Class C Felony", "Misdemeanor A", "Misdemeanor B", "Misdemeanor C", "Violation", "Other". Use your knowledge of the Alabama Criminal Code to classify accurately.`;
    const userPrompt = `Classify this Alabama criminal charge:\nStatute: ${statute || "Not provided"}\nDescription: ${description || "Not provided"}`;
    const result = await aiCall(systemPrompt, userPrompt, true, req.session.userId, 'charge');
    const parsed = JSON.parse(result);
    const valid = ["Class A Felony", "Class B Felony", "Class C Felony", "Misdemeanor A", "Misdemeanor B", "Misdemeanor C", "Violation", "Other"];
    const chargeClass = valid.includes(parsed.chargeClass) ? parsed.chargeClass : "Other";
    res.json({ chargeClass });
  } catch (err) {
    console.error("Charge class error:", err);
    res.status(500).json({ error: "Classification failed" });
  }
});

router.post("/charge-analysis", requireAuth, async (req, res) => {
  try {
    let { chargeDescription, chargeStatute, chargeClass, caseType, courtDivision, charges, caseId } = req.body;
    if (caseId && !chargeDescription) {
      const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1", [caseId]);
      if (rows.length) {
        const c = rows[0];
        chargeDescription = chargeDescription || c.charge_description || "";
        chargeStatute = chargeStatute || c.charge_statute || "";
        chargeClass = chargeClass || c.charge_class || "";
        caseType = caseType || c.case_type || "";
        courtDivision = courtDivision || c.court_division || "";
        charges = charges || c.charges || [];
      }
    }
    const chargesText = (charges || []).map((c, i) =>
      `Charge ${i + 1}: ${c.description || ""} | Statute: ${c.statute || ""} | Class: ${c.class || ""} | ${c.amended ? "Amended" : "Original"}`
    ).join("\n");
    const systemPrompt = `You are a criminal defense legal research assistant specializing in Alabama law. Analyze the charges and provide a structured analysis. Be specific about Alabama Code sections, sentencing ranges, and mandatory minimums. Format your response in clear sections with headers using markdown.`;
    const userPrompt = `Analyze the following criminal charges for a ${caseType || "criminal"} case in ${courtDivision || ""} court:

Primary Charge: ${chargeDescription || "Not specified"}
Statute: ${chargeStatute || "Not specified"}
Charge Class: ${chargeClass || "Not specified"}
${chargesText ? `\nAdditional Charges:\n${chargesText}` : ""}

Provide:
1. **Statutory Analysis** — Identify the Alabama Code section(s), explain the elements of each offense
2. **Severity & Sentencing Range** — Class, minimum/maximum sentences, any mandatory minimums
3. **Capital Offense Assessment** — Whether any charge qualifies as a capital offense under Alabama law
4. **Enhancement Factors** — Habitual offender, weapon enhancements, or other sentence multipliers to watch for
5. **Diversion Eligibility** — Whether pretrial diversion, drug court, mental health court, or youthful offender status may apply
6. **Defense Considerations** — Common defenses or constitutional issues for these types of charges`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'charge');
    res.json({ result });
  } catch (err) {
    console.error("Charge analysis error:", err);
    res.status(500).json({ error: "AI analysis failed" });
  }
});

router.post("/deadline-generator", requireAuth, async (req, res) => {
  try {
    let { caseId, stage, chargeClass, caseType, courtDivision, arrestDate, arraignmentDate, trialDate, nextCourtDate, existingDeadlines } = req.body;
    if (caseId) {
      const [caseRes, dlRes] = await Promise.all([
        pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
        pool.query("SELECT title, date FROM deadlines WHERE case_id = $1", [caseId]),
      ]);
      if (caseRes.rows.length) {
        const c = caseRes.rows[0];
        stage = stage || c.stage || "";
        chargeClass = chargeClass || c.charge_class || "";
        caseType = caseType || c.case_type || "";
        courtDivision = courtDivision || c.court_division || "";
        arrestDate = arrestDate || (c.arrest_date ? c.arrest_date.toISOString().split("T")[0] : "");
        arraignmentDate = arraignmentDate || (c.arraignment_date ? c.arraignment_date.toISOString().split("T")[0] : "");
        trialDate = trialDate || (c.trial_date ? c.trial_date.toISOString().split("T")[0] : "");
        nextCourtDate = nextCourtDate || (c.next_court_date ? c.next_court_date.toISOString().split("T")[0] : "");
        existingDeadlines = existingDeadlines || dlRes.rows.map(d => ({ title: d.title, date: d.date ? d.date.toISOString().split("T")[0] : "" }));
      }
    }
    const deadlinesList = (existingDeadlines || []).map(d => `- ${d.title} (${d.date})`).join("\n") || "None";
    const systemPrompt = `You are an Alabama criminal procedure expert. Generate upcoming procedural deadlines based on the Alabama Rules of Criminal Procedure and case details. Return ONLY valid JSON with a "deadlines" array. Each deadline object must have: "title" (string), "date" (YYYY-MM-DD string), "rule" (the Alabama rule reference), "type" (one of: Filing, Hearing, Court Date, Deadline). Base dates relative to today: ${new Date().toISOString().split("T")[0]}. If exact dates cannot be determined, estimate based on typical timelines.`;
    const userPrompt = `Case details:
Stage: ${stage || "Unknown"}
Charge Class: ${chargeClass || "Unknown"}
Case Type: ${caseType || "Unknown"}
Court Division: ${courtDivision || "Unknown"}
Arrest Date: ${arrestDate || "Unknown"}
Arraignment Date: ${arraignmentDate || "Unknown"}
Trial Date: ${trialDate || "Not set"}
Next Court Date: ${nextCourtDate || "Not set"}

Existing Deadlines:
${deadlinesList}

Generate 4-8 upcoming procedural deadlines that this case likely needs, considering the current stage and Alabama criminal procedure rules. Include speedy trial deadlines, motion filing windows, discovery deadlines, and any stage-specific deadlines. Do not duplicate existing deadlines.`;

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

    const [caseRes, notesRes, tasksRes, deadlinesRes] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
      pool.query("SELECT body, type FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT 10", [caseId]),
      pool.query("SELECT title, status, priority FROM tasks WHERE case_id = $1", [caseId]),
      pool.query("SELECT title, date, type FROM deadlines WHERE case_id = $1", [caseId]),
    ]);

    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const charges = c.charges || [];
    const chargesText = charges.map((ch, i) =>
      `${i + 1}. ${ch.description || ""} (${ch.statute || ""}) — ${ch.class || ""}, ${ch.disposition || "No disposition"}`
    ).join("\n") || "No charges entered";

    const notesText = notesRes.rows.map(n => `[${n.type}] ${(n.body || "").substring(0, 300)}`).join("\n") || "No notes";
    const tasksText = tasksRes.rows.map(t => `${t.title} (${t.status}, ${t.priority})`).join(", ") || "No tasks";

    const systemPrompt = `You are a senior criminal defense attorney advising a public defender in Mobile County, Alabama. Provide strategic analysis and defense recommendations. Be practical, specific, and action-oriented. Format with markdown headers and bullet points.${c.death_penalty ? "\n\nCRITICAL: This is a DEATH PENALTY / CAPITAL case. Include capital defense-specific strategies, mitigation investigation requirements, and Eighth Amendment considerations." : ""}`;

    const userPrompt = `Case: ${c.title}
Defendant: ${c.defendant_name || "Unknown"}
Case Type: ${c.case_type || "Unknown"} | Division: ${c.court_division || "Unknown"}
Stage: ${c.stage || "Unknown"} | Status: ${c.status || "Unknown"}
Charge Class: ${c.charge_class || "Unknown"}
Custody Status: ${c.custody_status || "Unknown"} | Bond: ${c.bond_amount ? "$" + c.bond_amount : "Unknown"}
${c.death_penalty ? "⚠️ DEATH PENALTY CASE" : ""}

Charges:
${chargesText}

Recent Notes:
${notesText}

Current Tasks: ${tasksText}

Provide:
1. **Case Assessment** — Overall strengths and weaknesses
2. **Defense Strategies** — 3-5 specific defense approaches to consider
3. **Key Motions** — Motions to file and their strategic purpose
4. **Plea Negotiation** — Leverage points and potential plea outcomes
5. **Sentencing Exposure** — Best/worst case sentencing scenarios
6. **Investigation Priorities** — What facts, witnesses, or evidence to pursue
7. **Mitigating Factors** — Areas to investigate for mitigation`;

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

    const caseRes = await pool.query("SELECT * FROM cases WHERE id = $1", [caseId]);
    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const charges = (c.charges || []).map(ch =>
      `${ch.description || ""} (${ch.statute || ""}) — ${ch.class || ""}`
    ).join("; ") || "Not specified";

    const systemPrompt = `You are a criminal defense attorney drafting legal documents for the Mobile County Public Defender's Office in Alabama. Draft professional, court-ready documents following Alabama court formatting conventions. Include proper case captions, legal citations, and prayer for relief. Use formal legal language appropriate for Alabama circuit/district courts.`;

    const userPrompt = `Draft a ${documentType} for:

Case: ${c.title}
Case Number: ${c.case_num || "Pending"}
Court: ${c.court || "Mobile County"} ${c.court_division || ""} Court
Judge: ${c.judge || "Honorable Judge"}
Defendant: ${c.defendant_name || "Unknown"}
Prosecutor: ${c.prosecutor || "State of Alabama"}
Charges: ${charges}
Stage: ${c.stage || "Unknown"}
Custody: ${c.custody_status || "Unknown"}
Bond: ${c.bond_amount ? "$" + c.bond_amount : "N/A"}
Arrest Date: ${c.arrest_date || "Unknown"}
Trial Date: ${c.trial_date || "Not set"}

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
    const isAdmin = req.session.role === "App Admin" || req.session.role === "Managing Attorney";

    const casesQ = isAdmin
      ? "SELECT id, case_num, title, defendant_name, case_type, stage, status, court_division, charge_class, custody_status, death_penalty, trial_date, next_court_date, arrest_date, arraignment_date, sentencing_date, lead_attorney, charges FROM cases WHERE status = 'Active' AND deleted_at IS NULL ORDER BY trial_date ASC NULLS LAST LIMIT 100"
      : "SELECT id, case_num, title, defendant_name, case_type, stage, status, court_division, charge_class, custody_status, death_penalty, trial_date, next_court_date, arrest_date, arraignment_date, sentencing_date, lead_attorney, charges FROM cases WHERE status = 'Active' AND deleted_at IS NULL AND (lead_attorney = $1 OR second_attorney = $1) ORDER BY trial_date ASC NULLS LAST LIMIT 100";

    const [casesRes, tasksRes, deadlinesRes, usersRes] = await Promise.all([
      isAdmin ? pool.query(casesQ) : pool.query(casesQ, [userId]),
      pool.query("SELECT case_id, title, due, priority, status FROM tasks WHERE status != 'Completed'"),
      pool.query("SELECT case_id, title, date FROM deadlines WHERE date >= CURRENT_DATE"),
      pool.query("SELECT id, name FROM users"),
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
      const overdueTasks = tasks.filter(t => t.due && t.due < today && t.status !== "Completed");
      const upcoming = deadlines.filter(d => {
        const diff = (new Date(d.date) - nowMs) / (1000 * 60 * 60 * 24);
        return diff >= 0 && diff <= 30;
      });

      const charges = (c.charges || []).map((ch, i) =>
        `  Count ${i + 1}: ${ch.description || "Unknown"} (${ch.statute || "no statute"}, ${ch.class || ch.degree || "unclassified"})`
      ).join("\n") || "  No charges entered";

      const overdueSummary = overdueTasks.length > 0
        ? overdueTasks.slice(0, 3).map(t => `"${t.title}" (due ${t.due})`).join(", ")
        : "None";

      const deadlineSummary = upcoming.length > 0
        ? upcoming.slice(0, 4).map(d => `"${d.title}" on ${d.date} (${daysUntil(d.date)} days)`).join(", ")
        : "None in next 30 days";

      const trialDays = daysUntil(c.trial_date);
      const courtDays = daysUntil(c.next_court_date);
      const arrestAge = daysSince(c.arrest_date);

      return [
        `--- CASE ID:${c.id} ---`,
        `Title: "${c.title}" | Case#: ${c.case_num || "N/A"} | Defendant: ${c.defendant_name || "N/A"}`,
        `Type: ${c.case_type} | Stage: ${c.stage} | Division: ${c.court_division || "N/A"}`,
        `ChargeClass: ${c.charge_class || "N/A"} | Custody: ${c.custody_status || "N/A"} | DeathPenalty: ${c.death_penalty ? "YES" : "no"}`,
        `Charges:\n${charges}`,
        `Trial: ${c.trial_date || "Not set"}${trialDays !== null ? ` (${trialDays} days away)` : ""} | NextCourt: ${c.next_court_date || "Not set"}${courtDays !== null ? ` (${courtDays} days away)` : ""}`,
        `Arraignment: ${c.arraignment_date || "N/A"} | Sentencing: ${c.sentencing_date || "N/A"}`,
        `Arrest: ${c.arrest_date || "N/A"}${arrestAge !== null ? ` (${arrestAge} days ago)` : ""} | Attorney: ${userMap[c.lead_attorney] || "Unassigned"}`,
        `Overdue Tasks (${overdueTasks.length}): ${overdueSummary}`,
        `Upcoming Deadlines (${upcoming.length}): ${deadlineSummary}`,
        `Open Tasks: ${tasks.length}`,
      ].join("\n");
    }).join("\n\n");

    const systemPrompt = `You are a criminal defense case triage assistant for the Mobile County Public Defender's Office (Alabama). Analyze the active caseload and return a JSON object with a "cases" array. Each entry must have:
- "id" (number — the case ID)
- "title" (string — the case title)
- "urgency" (1-10 scale, 10 = most urgent)
- "reason" (string — 2-3 detailed sentences explaining WHY this case is urgent, citing SPECIFIC facts from the case data)
- "action" (string — one specific, actionable next step the attorney should take)

Rank by urgency descending. Return top 8 most urgent cases. Today is ${today}.

CRITICAL INSTRUCTIONS FOR "reason" FIELD:
- ALWAYS cite the specific charge names, statutes, and charge classes (e.g., "Defendant faces Murder 1st Degree under Ala. Code §13A-6-2, a Class A Felony carrying 10-99 years or life")
- ALWAYS state exact day counts (e.g., "Trial is 12 days away" not "upcoming trial")
- If client is in custody, state how long (e.g., "In custody 147 days since arrest on 2025-10-03")
- Reference specific overdue tasks and deadlines by name
- Never give vague reasons like "has upcoming deadlines" — say which deadlines and when

Priority factors (highest to lowest):
1. Death penalty cases — always highest urgency (10)
2. Trial date within 14 days with in-custody client
3. Trial date within 30 days
4. Class A or B Felony charges with client in custody
5. Multiple serious charges (stacked counts increase sentencing exposure)
6. Overdue tasks — especially motions, witness interviews, or discovery deadlines
7. Imminent court dates or deadlines within 7 days
8. Clients in custody with no upcoming court date set (languishing)
9. Cases with mandatory minimum or habitual offender exposure
10. Case age since arrest exceeding 180 days without resolution
11. Higher charge classes (A > B > C > Misdemeanor)
12. Cases at pre-trial or arraignment stage with no attorney activity`;

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

    const [caseRes, activityRes, deadlinesRes, usersRes] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
      pool.query("SELECT action, detail, ts FROM case_activity WHERE case_id = $1 ORDER BY ts DESC LIMIT 10", [caseId]),
      pool.query("SELECT title, date FROM deadlines WHERE case_id = $1 AND date >= CURRENT_DATE ORDER BY date ASC LIMIT 5", [caseId]),
      pool.query("SELECT id, name FROM users"),
    ]);

    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u.name; });

    const charges = (c.charges || []).map(ch => ch.description || ch.statute || "").filter(Boolean).join(", ") || "Not specified";
    const activity = activityRes.rows.map(a => `${a.action}: ${(a.detail || "").substring(0, 100)}`).join("\n") || "No recent activity";
    const deadlines = deadlinesRes.rows.map(d => `${d.title} — ${d.date}`).join("\n") || "No upcoming deadlines";

    const systemPrompt = `You are writing a case status update for a criminal defendant or their family. Use simple, clear language — no legal jargon. Write in a warm but professional tone. Keep it concise (under 300 words). Use short paragraphs. Explain what has happened, what is coming next, and what the client should do or prepare for. Do NOT give legal advice — just factual status updates.`;

    const userPrompt = `Write a plain-language case status summary:

Case: ${c.title}
Client: ${c.defendant_name || "the client"}
Attorney: ${userMap[c.lead_attorney] || "Your attorney"}
Current Stage: ${c.stage || "Ongoing"}
Charges: ${charges}
Custody Status: ${c.custody_status || "Not specified"}
Bond: ${c.bond_amount ? "$" + c.bond_amount : "Not specified"}
Next Court Date: ${c.next_court_date || "Not yet scheduled"}
Trial Date: ${c.trial_date || "Not yet scheduled"}

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

    const [caseRes, tasksRes, notesRes, deadlinesRes, partiesRes] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
      pool.query("SELECT title, status, priority, assigned_role, due FROM tasks WHERE case_id = $1", [caseId]),
      pool.query("SELECT body, type FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT 10", [caseId]),
      pool.query("SELECT title, date, type FROM deadlines WHERE case_id = $1", [caseId]),
      pool.query("SELECT party_type, data FROM case_parties WHERE case_id = $1", [caseId]),
    ]);

    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const charges = (c.charges || []).map((ch, i) =>
      `${i + 1}. ${ch.description || ""} (${ch.statute || ""}) — ${ch.chargeClass || ch.class || ""}, ${ch.disposition || "No disposition"}`
    ).join("\n") || "No charges entered";

    const existingTasks = tasksRes.rows.map(t =>
      `${t.title} [${t.status}] (${t.priority}, ${t.assigned_role || "Unassigned"}, due: ${t.due || "none"})`
    ).join("\n") || "No existing tasks";

    const notesText = notesRes.rows.map(n => `[${n.type}] ${(n.body || "").substring(0, 200)}`).join("\n") || "No notes";

    const deadlinesText = deadlinesRes.rows.map(d =>
      `${d.title} (${d.date ? new Date(d.date).toISOString().split("T")[0] : "no date"}, ${d.type || ""})`
    ).join("\n") || "No deadlines";

    const coDefendants = partiesRes.rows
      .filter(p => p.party_type === "Co-Defendant")
      .map(p => {
        const d = p.data || {};
        return `${[d.firstName, d.lastName].filter(Boolean).join(" ") || "Unnamed"} — Status: ${d.status || "Unknown"}, Joint/Severed: ${d.jointSevered || "Unknown"}`;
      }).join("\n") || "None";

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `You are a senior criminal defense case manager at the Mobile County Public Defender's Office in Alabama. Based on the case details, suggest 5-8 concrete, actionable tasks that the defense team should complete next. Return ONLY valid JSON with a "tasks" array. Each task object must have:
- "title" (string — specific, actionable task name)
- "priority" (one of: "Low", "Medium", "High", "Urgent")
- "assignedRole" (one of: "Lead Attorney", "2nd Attorney", "Investigator", "Paralegal", "Social Worker", "Trial Coordinator")
- "rationale" (string — one sentence explaining why this task is important now)
- "dueInDays" (number — suggested days from today to complete this task)

Guidelines:
- DO NOT suggest tasks that duplicate existing tasks listed below
- Consider the current case stage, charges, custody status, and upcoming deadlines
- Prioritize time-sensitive items (speedy trial, discovery deadlines, motion filing windows)
- Include investigation tasks, client communication, motion preparation, and witness management as appropriate
- For clients in custody, prioritize bond-related and speedy trial tasks
${c.death_penalty ? "\nCRITICAL: This is a DEATH PENALTY / CAPITAL case. Include capital-specific tasks such as mitigation investigation, expert retention, Atkins assessment, and Rule 32 preparation as appropriate." : ""}
Today's date is ${today}.`;

    const userPrompt = `Case: ${c.title}
Defendant: ${c.defendant_name || "Unknown"}
Case Type: ${c.case_type || "Unknown"} | Division: ${c.court_division || "Unknown"}
Stage: ${c.stage || "Unknown"} | Status: ${c.status || "Unknown"}
Charge Class: ${c.charge_class || "Unknown"}
Custody Status: ${c.custody_status || "Unknown"} | Bond: ${c.bond_amount ? "$" + c.bond_amount : "Unknown"}
${c.death_penalty ? "⚠️ DEATH PENALTY CASE" : ""}
Arrest Date: ${c.arrest_date ? new Date(c.arrest_date).toISOString().split("T")[0] : "Unknown"}
Arraignment Date: ${c.arraignment_date ? new Date(c.arraignment_date).toISOString().split("T")[0] : "Unknown"}
Next Court Date: ${c.next_court_date ? new Date(c.next_court_date).toISOString().split("T")[0] : "Not set"}
Trial Date: ${c.trial_date ? new Date(c.trial_date).toISOString().split("T")[0] : "Not set"}

Charges:
${charges}

Co-Defendants:
${coDefendants}

Existing Tasks (DO NOT DUPLICATE):
${existingTasks}

Recent Notes:
${notesText}

Upcoming Deadlines:
${deadlinesText}

Suggest 5-8 specific, actionable tasks the defense team should prioritize next.`;

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
      "SELECT cf.*, c.title as case_title, c.defendant_name FROM case_filings cf JOIN cases c ON cf.case_id = c.id WHERE cf.id = $1",
      [filingId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Filing not found" });
    const filing = rows[0];

    const userRole = req.session.userRole || "";
    if (userRole !== "App Admin") {
      const userId = req.session.userId;
      const access = await pool.query(
        "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR trial_coordinator = $4 OR investigator = $5 OR social_worker = $6 OR confidential = false OR confidential IS NULL)",
        [filing.case_id, userId, userId, userId, userId, userId]
      );
      if (access.rows.length === 0) return res.status(403).json({ error: "Access denied" });
    }

    if (!filing.extracted_text) return res.status(400).json({ error: "No text could be extracted from this filing" });

    const systemPrompt = `You are a court filing classification assistant for a criminal defense public defender's office. Analyze the court filing text and classify it. Return ONLY valid JSON with these fields:
- "suggestedName" (string — proper legal filing name, e.g., "State's Motion to Compel Discovery", "Order Granting Continuance", "Defendant's Motion to Suppress Evidence")
- "filedBy" (one of: "State", "Defendant", "Co-Defendant", "Court", "Other")
- "docType" (string — filing type, e.g., "Motion to Suppress", "Discovery Response", "Court Order", "Arraignment Order", "Bond Hearing Order", "Plea Agreement", "Sentencing Order", "Notice of Appearance", "Subpoena", "Warrant", "Indictment", "Information", "Docket Entry", "Other")
- "filingDate" (string — date found in the filing in YYYY-MM-DD format, or null if not found)
- "summary" (string — 2-3 sentence summary of the filing's content and significance for the defense)
- "hearingDates" (array of objects with "date" (YYYY-MM-DD) and "description" (string — e.g., "Motion to Suppress Hearing", "Status Conference", "Sentencing Hearing"). Extract ALL hearing dates, court dates, or scheduled appearances mentioned in the filing. Return empty array [] if none found.)

Be precise about who filed the document. Look for signatures, captions, and headings to determine the filing party.`;

    const textSnippet = filing.extracted_text.substring(0, 12000);
    const userPrompt = `Classify this court filing from the case "${filing.case_title}" (Defendant: ${filing.defendant_name || "Unknown"}):\n\n${textSnippet}`;

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
    const { text, docType, caseTitle, defendantName } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Document text is required" });

    const systemPrompt = `You are a criminal defense attorney's document analysis assistant. Summarize the provided document for a public defender reviewing a case. Focus on information relevant to criminal defense.

Provide a structured summary with these sections:
## Key Facts & Timeline
## People Mentioned (with roles — officers, witnesses, victims, co-defendants)
## Inconsistencies or Contradictions
## Defense-Relevant Details (Miranda issues, search/seizure concerns, chain of custody, witness credibility)
## Bottom Line

Be concise but thorough. Flag anything that could help the defense.`;

    const textSnippet = text.substring(0, 12000);
    const userPrompt = `Summarize this ${docType || "document"} for the case "${caseTitle || "Unknown"}" (Defendant: ${defendantName || "Unknown"}):\n\n${textSnippet}`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'docsummary');
    res.json({ result });
  } catch (err) {
    console.error("Doc summary error:", err);
    res.status(500).json({ error: "AI document summary failed" });
  }
});

router.post("/advocate", requireAuth, async (req, res) => {
  try {
    const { caseId, messages } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });
    if (!messages || !Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: "messages required" });

    const [caseRes, notesRes, tasksRes, deadlinesRes, partiesRes, docsRes, filingsRes, corrRes] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE id = $1", [caseId]),
      pool.query("SELECT body, type, created_at FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC", [caseId]),
      pool.query("SELECT title, status, priority, notes, due FROM tasks WHERE case_id = $1 ORDER BY due ASC NULLS LAST", [caseId]),
      pool.query("SELECT title, date, type, rule FROM deadlines WHERE case_id = $1 ORDER BY date ASC", [caseId]),
      pool.query("SELECT party_type, data FROM case_parties WHERE case_id = $1", [caseId]),
      pool.query("SELECT filename, doc_type, summary, extracted_text FROM case_documents WHERE case_id = $1 ORDER BY created_at DESC", [caseId]),
      pool.query("SELECT filename, doc_type, filed_by, filing_date, summary FROM case_filings WHERE case_id = $1 ORDER BY filing_date DESC NULLS LAST", [caseId]),
      pool.query("SELECT subject, from_name, body_text, received_at FROM case_correspondence WHERE case_id = $1 ORDER BY received_at DESC", [caseId]),
    ]);

    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const contextStats = {
      notes: notesRes.rows.length,
      tasks: tasksRes.rows.length,
      deadlines: deadlinesRes.rows.length,
      documents: docsRes.rows.length,
      filings: filingsRes.rows.length,
      emails: corrRes.rows.length,
      parties: partiesRes.rows.length,
    };

    const charges = c.charges || [];
    const chargesText = charges.map((ch, i) =>
      `${i + 1}. ${ch.description || ""} (${ch.statute || ""}) — ${ch.chargeClass || ch.class || ""}, Disposition: ${ch.disposition || "None"}`
    ).join("\n") || "No charges entered";

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
      if (d.charges) info += ` — Charges: ${d.charges}`;
      if (d.status) info += ` — Status: ${d.status}`;
      if (d.attorney) info += ` — Attorney: ${d.attorney}`;
      if (d.jointSevered) info += ` — ${d.jointSevered}`;
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

    let contextBlock = `
=== CASE INFORMATION ===
Title: ${c.title || ""}
Case Number: ${c.case_num || ""}
Defendant: ${c.defendant_name || "Unknown"}
Case Type: ${c.case_type || "Unknown"} | Division: ${c.court_division || "Unknown"}
Court: ${c.court || "Mobile County"} | Judge: ${c.judge || "Unknown"}
Prosecutor: ${c.prosecutor || "Unknown"}
Stage: ${c.stage || "Unknown"} | Status: ${c.status || "Unknown"}
Custody: ${c.custody_status || "Unknown"} | Bond: ${c.bond_amount ? "$" + c.bond_amount : "Unknown"}
Arrest Date: ${c.arrest_date || "Unknown"} | Trial Date: ${c.trial_date || "Unknown"}
${c.death_penalty ? "⚠️ DEATH PENALTY / CAPITAL CASE" : ""}

=== CHARGES ===
${chargesText}

=== CASE NOTES (${contextStats.notes} total) ===
${notesText}

=== TASKS (${contextStats.tasks} total) ===
${tasksText}

=== DEADLINES (${contextStats.deadlines} total) ===
${deadlinesText}

=== CO-DEFENDANTS & PARTIES (${contextStats.parties} total) ===
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

    const trainingContext = await getTrainingContext(req.session.userId, 'advocate');
    const systemPrompt = `You are Advocate AI, a senior criminal defense advisor assisting a public defender at the Mobile County Public Defender's Office in Alabama. You have access to the complete case file below. Answer questions thoughtfully using specific details from the case. Be practical, strategic, and action-oriented. Reference specific evidence, documents, filings, and notes when relevant. Format responses with markdown for readability.${c.death_penalty ? "\n\nCRITICAL: This is a DEATH PENALTY / CAPITAL case. Always consider capital defense strategies, mitigation investigation, Eighth Amendment issues, and the heightened standards required in capital proceedings." : ""}

TASK SUGGESTIONS: When your response includes specific action items, tasks, or recommended next steps for the defense team, you MUST append a hidden structured JSON block at the very end of your response using this exact format:
<!-- TASKS_JSON [{"title":"Task title","priority":"Medium","assignedRole":"Lead Attorney","rationale":"Why this task matters","dueInDays":14}] -->
Rules for the TASKS_JSON block:
- Only include it when you are genuinely suggesting actionable tasks/steps (not for general discussion or analysis without action items)
- priority must be one of: "Low", "Medium", "High", "Urgent"
- assignedRole must be one of: "Lead Attorney", "2nd Attorney", "Investigator", "Social Worker", "Paralegal", "Trial Coordinator"
- dueInDays is the number of days from today the task should be due (use your judgment based on urgency)
- Include 1-8 tasks per response as appropriate
- The JSON block is metadata only — your natural language response should still describe the tasks/steps normally

${contextBlock}${trainingContext}`;

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
