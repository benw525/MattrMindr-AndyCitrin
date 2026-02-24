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
    const [casesResult, notesResult, activityResult, tasksResult, deadlinesResult, linksResult, usersResult] = await Promise.all([
      pool.query("SELECT * FROM cases WHERE deleted_at IS NULL AND confidential = FALSE ORDER BY title"),
      pool.query("SELECT case_id, body, type FROM case_notes ORDER BY created_at DESC"),
      pool.query("SELECT case_id, action, detail FROM case_activity ORDER BY ts DESC"),
      pool.query("SELECT case_id, title, status, priority, due FROM tasks"),
      pool.query("SELECT case_id, title, date, type FROM deadlines"),
      pool.query("SELECT case_id, label, category FROM case_links"),
      pool.query("SELECT id, name, role FROM users"),
    ]);

    const cases = casesResult.rows;

    const notesByCase = {};
    for (const n of notesResult.rows) {
      if (!notesByCase[n.case_id]) notesByCase[n.case_id] = [];
      if (notesByCase[n.case_id].length < 10) {
        notesByCase[n.case_id].push({ type: n.type, body: (n.body || "").substring(0, 200) });
      }
    }

    const activityByCase = {};
    for (const a of activityResult.rows) {
      if (!activityByCase[a.case_id]) activityByCase[a.case_id] = [];
      if (activityByCase[a.case_id].length < 5) {
        activityByCase[a.case_id].push({ action: a.action, detail: (a.detail || "").substring(0, 150) });
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

    const usersMap = {};
    for (const u of usersResult.rows) usersMap[u.id] = u.name;

    const caseSummaries = cases.map(c => {
      const parts = [];
      parts.push(`ID:${c.id}`);
      parts.push(`"${c.title}"`);
      if (c.case_num) parts.push(`Case#:${c.case_num}`);
      if (c.claim_num) parts.push(`Claim#:${c.claim_num}`);
      if (c.file_num) parts.push(`File#:${c.file_num}`);
      if (c.client) parts.push(`Client:${c.client}`);
      if (c.insured) parts.push(`Insured:${c.insured}`);
      if (c.plaintiff) parts.push(`Plaintiff:${c.plaintiff}`);
      if (c.defendant) parts.push(`Defendant:${c.defendant}`);
      if (c.opposing_counsel) parts.push(`OpposingCounsel:${c.opposing_counsel}`);
      if (c.short_case_num) parts.push(`ShortCaseNum:${c.short_case_num}`);
      if (c.county) parts.push(`County:${c.county}`);
      if (c.court) parts.push(`Court:${c.court}`);
      if (c.claim_spec) parts.push(`ClaimSpec:${c.claim_spec}`);
      parts.push(`Type:${c.type || "Civil Litigation"}`);
      parts.push(`Status:${c.status}`);
      if (c.stage) parts.push(`Stage:${c.stage}`);
      if (c.offices && c.offices.length) parts.push(`Offices:${c.offices.join(",")}`);
      if (c.lead_attorney && usersMap[c.lead_attorney]) parts.push(`LeadAtty:${usersMap[c.lead_attorney]}`);
      if (c.second_attorney && usersMap[c.second_attorney]) parts.push(`2ndAtty:${usersMap[c.second_attorney]}`);
      if (c.paralegal && usersMap[c.paralegal]) parts.push(`Paralegal:${usersMap[c.paralegal]}`);
      if (c.judge) parts.push(`Judge:${c.judge}`);
      if (c.mediator) parts.push(`Mediator:${c.mediator}`);
      if (c.expert) parts.push(`Expert:${c.expert}`);
      if (c.trial_date) parts.push(`Trial:${c.trial_date.toISOString().split("T")[0]}`);
      if (c.mediation) parts.push(`Mediation:${c.mediation.toISOString().split("T")[0]}`);
      if (c.dol) parts.push(`DOL:${c.dol.toISOString().split("T")[0]}`);

      const customFields = Array.isArray(c.custom_fields) ? c.custom_fields : [];
      for (const cf of customFields) {
        if (cf.value) parts.push(`${cf.label}:${cf.value}`);
      }
      const customDates = Array.isArray(c.custom_dates) ? c.custom_dates : [];
      for (const cd of customDates) {
        if (cd.value) parts.push(`${cd.label}:${cd.value}`);
      }

      const billingParties = Array.isArray(c.billing_parties) ? c.billing_parties : [];
      for (const bp of billingParties) {
        if (bp.name) parts.push(`BillingParty:${bp.name}`);
        if (bp.medicals) parts.push(`Medicals:$${bp.medicals}`);
        if (bp.settlement) parts.push(`Settlement:$${bp.settlement}`);
      }

      const caseExpenses = Array.isArray(c.case_expenses) ? c.case_expenses : [];
      for (const ce of caseExpenses) {
        if (ce.description) parts.push(`Expense:${ce.description}${ce.amount ? " $" + ce.amount : ""}`);
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

      return parts.join(" | ");
    });

    const systemPrompt = `You are a legal case search assistant for a law firm's case management system. The user will ask a question and you must find matching cases from the data provided.

RULES:
- Return ONLY a JSON array of matching cases
- Each result must have: "id" (number), "title" (string), "reason" (string explaining WHY this case matched in 1-2 sentences)
- Return at most 20 results, ranked by relevance
- If no cases match, return an empty array []
- The "reason" should be specific about what data matched the query
- Do NOT include markdown formatting, just raw JSON
- Search across ALL fields: title, parties, notes, activity, tasks, deadlines, links, custom fields, billing, expenses, staff, dates, etc.`;

    const userPrompt = `Search query: "${query}"

Case data (${caseSummaries.length} cases):
${caseSummaries.join("\n")}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 4096,
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
