const express = require("express");
const OpenAI = require("openai");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

router.post("/", requireAuth, async (req, res) => {
  const { query } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    const [casesResult, notesResult, activityResult, tasksResult, deadlinesResult, linksResult, usersResult, partiesResult, expertsResult, corrResult] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE deleted_at IS NULL AND confidential = FALSE ORDER BY title"),
      pool.query("SELECT case_id, body, type FROM case_notes ORDER BY created_at DESC"),
      pool.query("SELECT case_id, action, detail FROM case_activity ORDER BY ts DESC"),
      pool.query("SELECT case_id, title, status, priority, due FROM tasks"),
      pool.query("SELECT case_id, title, date, type FROM deadlines"),
      pool.query("SELECT case_id, label, category FROM case_links"),
      pool.query("SELECT id, name, role FROM users"),
      pool.query("SELECT case_id, party_type, data FROM case_parties"),
      pool.query("SELECT case_id, data FROM case_experts"),
      pool.query("SELECT case_id, subject, from_email, to_emails FROM case_correspondence ORDER BY received_at DESC"),
    ]);

    const cases = casesResult.rows;

    const notesByCase = {};
    for (const n of notesResult.rows) {
      if (!notesByCase[n.case_id]) notesByCase[n.case_id] = [];
      if (notesByCase[n.case_id].length < 5) {
        notesByCase[n.case_id].push({ type: n.type, body: (n.body || "").substring(0, 120) });
      }
    }

    const activityByCase = {};
    for (const a of activityResult.rows) {
      if (!activityByCase[a.case_id]) activityByCase[a.case_id] = [];
      if (activityByCase[a.case_id].length < 3) {
        activityByCase[a.case_id].push({ action: a.action, detail: (a.detail || "").substring(0, 100) });
      }
    }

    const tasksByCase = {};
    for (const t of tasksResult.rows) {
      if (!tasksByCase[t.case_id]) tasksByCase[t.case_id] = [];
      if (tasksByCase[t.case_id].length < 8) {
        tasksByCase[t.case_id].push(`${t.title}(${t.status},${t.priority}${t.due ? ",due:" + (t.due instanceof Date ? t.due.toISOString().split("T")[0] : t.due) : ""})`);
      }
    }

    const deadlinesByCase = {};
    for (const d of deadlinesResult.rows) {
      if (!deadlinesByCase[d.case_id]) deadlinesByCase[d.case_id] = [];
      deadlinesByCase[d.case_id].push(`${d.title}(${d.type},${d.date instanceof Date ? d.date.toISOString().split("T")[0] : d.date || ""})`);
    }

    const linksByCase = {};
    for (const l of linksResult.rows) {
      if (!linksByCase[l.case_id]) linksByCase[l.case_id] = [];
      if (linksByCase[l.case_id].length < 5) {
        linksByCase[l.case_id].push(`${l.label || ""}(${l.category || ""})`);
      }
    }

    const partiesByCase = {};
    for (const p of partiesResult.rows) {
      if (!partiesByCase[p.case_id]) partiesByCase[p.case_id] = [];
      const d = typeof p.data === "string" ? JSON.parse(p.data) : (p.data || {});
      const name = d.entityName || [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ") || "";
      if (name) {
        const info = [name];
        if (p.party_type) info.push(`(${p.party_type})`);
        if (d.representedBy) info.push(`rep:${d.representedBy}`);
        if (d.email) info.push(d.email);
        if (d.phone) info.push(d.phone);
        if (d.isOurClient) info.push("OurClient");
        partiesByCase[p.case_id].push(info.join(" "));
      }
    }


    const expertsByCase = {};
    for (const ex of expertsResult.rows) {
      if (!expertsByCase[ex.case_id]) expertsByCase[ex.case_id] = [];
      const d = typeof ex.data === "string" ? JSON.parse(ex.data) : (ex.data || {});
      const info = [];
      if (d.name) info.push(d.name);
      if (d.type) info.push(`(${d.type})`);
      if (d.company) info.push(d.company);
      if (d.specialty) info.push(d.specialty);
      if (info.length) expertsByCase[ex.case_id].push(info.join(" "));
    }

    const corrByCase = {};
    for (const cr of corrResult.rows) {
      if (!corrByCase[cr.case_id]) corrByCase[cr.case_id] = [];
      if (corrByCase[cr.case_id].length < 5) {
        const info = [];
        if (cr.subject) info.push(`"${cr.subject}"`);
        if (cr.from_email) info.push(`from:${cr.from_email}`);
        if (info.length) corrByCase[cr.case_id].push(info.join(" "));
      }
    }

    const usersMap = {};
    for (const u of usersResult.rows) usersMap[u.id] = u.name;

    const caseSummaries = cases.map(c => {
      const parts = [];
      parts.push(`ID:${c.id}`);
      parts.push(`"${c.title}"`);
      if (c.case_num) parts.push(`Case#:${c.case_num}`);
      if (c.defendant_name) parts.push(`Defendant:${c.defendant_name}`);
      if (c.prosecutor) parts.push(`Prosecutor:${c.prosecutor}`);
      if (c.county) parts.push(`County:${c.county}`);
      if (c.court) parts.push(`Court:${c.court}`);
      parts.push(`Type:${c.type || "Felony"}`);
      parts.push(`Status:${c.status}`);
      if (c.stage) parts.push(`Stage:${c.stage}`);
      if (c.court_division) parts.push(`Division:${c.court_division}`);
      if (c.custody_status) parts.push(`Custody:${c.custody_status}`);
      if (c.bond_amount) parts.push(`Bond:${c.bond_amount}`);
      if (c.jail_location) parts.push(`Jail:${c.jail_location}`);
      if (c.charge_description) parts.push(`Charge:${c.charge_description}`);
      if (c.charge_statute) parts.push(`Statute:${c.charge_statute}`);
      if (c.charge_class) parts.push(`Class:${c.charge_class}`);
      if (c.lead_attorney && usersMap[c.lead_attorney]) parts.push(`LeadAtty:${usersMap[c.lead_attorney]}`);
      if (c.second_attorney && usersMap[c.second_attorney]) parts.push(`2ndAtty:${usersMap[c.second_attorney]}`);
      if (c.trial_coordinator && usersMap[c.trial_coordinator]) parts.push(`TrialCoordinator:${usersMap[c.trial_coordinator]}`);
      if (c.judge) parts.push(`Judge:${c.judge}`);
      if (c.trial_date) parts.push(`Trial:${c.trial_date.toISOString().split("T")[0]}`);
      if (c.arrest_date) parts.push(`Arrest:${c.arrest_date.toISOString().split("T")[0]}`);
      if (c.next_court_date) parts.push(`NextCourt:${c.next_court_date.toISOString().split("T")[0]}`);
      if (c.disposition_type) parts.push(`Disposition:${c.disposition_type}`);
      if (c.death_penalty) parts.push(`DeathPenalty:YES`);
      if (c.probation) parts.push(`Probation:YES`);

      const charges = Array.isArray(c.charges) ? c.charges : [];
      if (charges.length) {
        const chargeStr = charges.slice(0, 5).map(ch => `${ch.description || ""}${ch.statute ? " (" + ch.statute + ")" : ""}${ch.class ? " [" + ch.class + "]" : ""}`).filter(Boolean).join("; ");
        if (chargeStr) parts.push(`Charges:[${chargeStr}]`);
      }

      const customFields = Array.isArray(c.custom_fields) ? c.custom_fields : [];
      for (const cf of customFields.slice(0, 3)) {
        if (cf.value) parts.push(`${cf.label}:${cf.value}`);
      }

      const notes = notesByCase[c.id] || [];
      if (notes.length) {
        parts.push("Notes:[" + notes.map(n => `${n.type}:"${n.body}"`).join("; ") + "]");
      }

      const acts = activityByCase[c.id] || [];
      if (acts.length) {
        parts.push("Activity:[" + acts.map(a => `${a.action}:"${a.detail}"`).join("; ") + "]");
      }

      const tasks = tasksByCase[c.id] || [];
      if (tasks.length) {
        parts.push("Tasks:[" + tasks.join("; ") + "]");
      }

      const dls = deadlinesByCase[c.id] || [];
      if (dls.length) {
        parts.push("Deadlines:[" + dls.join("; ") + "]");
      }

      const lnks = linksByCase[c.id] || [];
      if (lnks.length) {
        parts.push("Links:[" + lnks.join("; ") + "]");
      }

      const parties = partiesByCase[c.id] || [];
      if (parties.length) {
        parts.push("Parties:[" + parties.join("; ") + "]");
      }

      const exps = expertsByCase[c.id] || [];
      if (exps.length) {
        parts.push("Experts:[" + exps.join("; ") + "]");
      }

      const corr = corrByCase[c.id] || [];
      if (corr.length) {
        parts.push("Emails:[" + corr.join("; ") + "]");
      }

      return parts.join(" | ");
    });

    const systemPrompt = `You are a legal case search assistant for a criminal defense case management system. The user will ask a question and you must find matching cases from the data provided.

RULES:
- Return ONLY a JSON array of matching cases
- Each result must have: "id" (number), "title" (string), "reason" (string explaining WHY this case matched in 1-2 sentences)
- Return at most 20 results, ranked by relevance
- If no cases match, return an empty array []
- The "reason" should be specific about what data matched the query
- Do NOT include markdown formatting, just raw JSON
- Search across ALL fields: title, defendant, charges, custody status, notes, activity, tasks, deadlines, parties, staff, dates, etc.`;

    let caseDataText = caseSummaries.join("\n");
    const MAX_CHARS = 700000;
    if (caseDataText.length > MAX_CHARS) {
      caseDataText = caseDataText.substring(0, MAX_CHARS);
      const lastNewline = caseDataText.lastIndexOf("\n");
      if (lastNewline > MAX_CHARS * 0.9) caseDataText = caseDataText.substring(0, lastNewline);
    }

    const userPrompt = `Search query: "${query}"

Case data (${caseSummaries.length} cases):
${caseDataText}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 4096,
      store: false,
    });

    const raw = (completion.choices[0]?.message?.content || "[]").trim();
    let results;
    try {
      const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
      results = JSON.parse(jsonStr);
    } catch {
      results = [];
    }

    if (!Array.isArray(results)) results = [];
    const validIds = new Set(cases.map(c => c.id));
    results = results
      .filter(r => r && typeof r.id === "number" && validIds.has(r.id))
      .map(r => ({
        id: r.id,
        title: r.title || cases.find(c => c.id === r.id)?.title || "Unknown",
        reason: r.reason || "Matched based on case data",
      }));

    return res.json({ results });
  } catch (err) {
    console.error("AI search error:", err);
    return res.status(500).json({ error: "AI search failed. Please try again." });
  }
});

module.exports = router;
