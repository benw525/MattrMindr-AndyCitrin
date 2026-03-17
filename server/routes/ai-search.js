const express = require("express");
const OpenAI = require("openai");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DATA_SCHEMA = {
  cases: {
    description: "Core case records with basic info, dates, financials, injury details, and team assignments",
    fields: {
      id: "Unique case ID",
      title: "Case title / caption",
      case_num: "Court case number",
      client_name: "Client's name",
      case_type: "Type of case (e.g. Auto Accident, Slip & Fall, Medical Malpractice)",
      status: "Case status (Active, Closed, Settled, etc.)",
      stage: "Case stage (Investigation, Litigation, Discovery, Trial, etc.)",
      state_jurisdiction: "State where the case is filed",
      county: "County of jurisdiction",
      court: "Court name (Circuit, District, etc.)",
      judge: "Assigned judge name",
      accident_date: "Date of the accident/incident",
      statute_of_limitations_date: "SOL deadline date",
      trial_date: "Scheduled trial date",
      mediation_date: "Scheduled mediation date",
      next_court_date: "Next court appearance date",
      injury_type: "Type of injury (Broken Bone, TBI, Soft Tissue, etc.)",
      injury_description: "Detailed description of injuries",
      incident_location: "Where the incident occurred",
      incident_description: "What happened in the incident",
      police_report_number: "Police report number",
      case_value_estimate: "Estimated case value in dollars",
      demand_amount: "Demand amount in dollars",
      settlement_amount: "Settlement amount in dollars",
      property_damage_amount: "Property damage amount in dollars",
      liability_assessment: "Liability assessment (Strong, Moderate, Weak, etc.)",
      comparative_fault_pct: "Comparative fault percentage",
      fee_structure: "Fee arrangement type",
      contingency_fee: "Contingency fee percentage",
      disposition_type: "How the case was resolved",
      lead_attorney: "Lead attorney user ID",
      second_attorney: "Second attorney user ID",
      paralegal: "Paralegal user ID",
      case_manager: "Case manager user ID",
      investigator: "Investigator user ID",
      custom_fields: "Array of custom field objects with label and value",
    },
  },
  case_parties: {
    description: "People and organizations involved in cases (plaintiffs, defendants, witnesses, insurance companies, etc.)",
    fields: {
      case_id: "Which case this party belongs to",
      party_type: "Role of the party (Plaintiff, Defendant, Witness, Insurance Company, etc.)",
      "data.firstName": "First name",
      "data.lastName": "Last name",
      "data.entityName": "Organization/company name",
      "data.email": "Email address",
      "data.phone": "Phone number",
      "data.representedBy": "Attorney representing this party",
      "data.isOurClient": "Whether this is our client",
    },
  },
  case_notes: {
    description: "Notes attached to cases (general notes, attorney notes, medical summaries, etc.)",
    fields: {
      case_id: "Which case the note belongs to",
      body: "Note text content",
      type: "Note type/category",
    },
  },
  case_documents: {
    description: "Documents uploaded to cases (pleadings, medical records, police reports, photos, etc.)",
    fields: {
      case_id: "Which case the document belongs to",
      filename: "Name of the file",
      content_type: "File MIME type",
    },
  },
  case_medical_treatments: {
    description: "Medical treatment records for case clients",
    fields: {
      case_id: "Which case",
      provider_name: "Doctor/facility name",
      treatment_type: "Type of treatment",
      diagnosis: "Diagnosis",
      start_date: "Treatment start date",
      end_date: "Treatment end date",
      total_billed: "Total amount billed",
      total_paid: "Total amount paid",
      notes: "Treatment notes",
    },
  },
  case_insurance_policies: {
    description: "Insurance policies related to cases",
    fields: {
      case_id: "Which case",
      carrier_name: "Insurance company name",
      policy_type: "Type of policy (Auto, Health, Umbrella, etc.)",
      policy_number: "Policy number",
      coverage_limit: "Coverage limit amount",
      adjuster_name: "Claims adjuster name",
      adjuster_phone: "Adjuster phone",
      adjuster_email: "Adjuster email",
      claim_number: "Claim number",
    },
  },
  case_damages: {
    description: "Itemized damages for cases (medical bills, lost wages, pain and suffering, etc.)",
    fields: {
      case_id: "Which case",
      category: "Damage category",
      description: "Description of the damage",
      amount: "Dollar amount",
    },
  },
  case_liens: {
    description: "Liens against case settlements (medical liens, attorney liens, etc.)",
    fields: {
      case_id: "Which case",
      lienholder_name: "Who holds the lien",
      lien_type: "Type of lien",
      amount: "Lien amount",
      status: "Lien status",
    },
  },
  case_expenses: {
    description: "Case expenses (filing fees, expert fees, deposition costs, etc.)",
    fields: {
      case_id: "Which case",
      description: "What the expense was for",
      amount: "Dollar amount",
      category: "Expense category",
      date: "Date of expense",
    },
  },
  case_negotiations: {
    description: "Settlement negotiation history",
    fields: {
      case_id: "Which case",
      type: "Negotiation type (Demand, Offer, Counter, etc.)",
      amount: "Dollar amount",
      date: "Date of negotiation event",
      notes: "Negotiation notes",
    },
  },
  case_experts: {
    description: "Expert witnesses and consultants retained for cases",
    fields: {
      case_id: "Which case",
      "data.name": "Expert's name",
      "data.type": "Type of expert (Medical, Accident Reconstruction, Economic, etc.)",
      "data.company": "Expert's company/organization",
      "data.specialty": "Area of expertise",
    },
  },
  tasks: {
    description: "Tasks and to-do items assigned within cases",
    fields: {
      case_id: "Which case",
      title: "Task description",
      status: "Task status (Pending, In Progress, Complete, etc.)",
      priority: "Priority level",
      due: "Due date",
      assigned_to: "User ID of assignee",
    },
  },
  deadlines: {
    description: "Important deadlines and calendar events for cases",
    fields: {
      case_id: "Which case",
      title: "Deadline description",
      date: "Deadline date",
      type: "Type of deadline (Hearing, Filing, Discovery, SOL, etc.)",
    },
  },
  case_correspondence: {
    description: "Emails and correspondence linked to cases",
    fields: {
      case_id: "Which case",
      subject: "Email subject line",
      from_email: "Sender's email",
      to_emails: "Recipient emails",
    },
  },
  case_transcripts: {
    description: "Deposition and hearing transcripts",
    fields: {
      case_id: "Which case",
      filename: "Transcript filename",
    },
  },
  case_activity: {
    description: "Activity log / audit trail for cases",
    fields: {
      case_id: "Which case",
      action: "What happened",
      detail: "Details of the activity",
    },
  },
  case_filings: {
    description: "Court filings received or filed for cases",
    fields: {
      case_id: "Which case",
      filename: "Filing document filename",
      filing_type: "Type of filing",
    },
  },
  users: {
    description: "Staff members (attorneys, paralegals, case managers, etc.)",
    fields: {
      id: "User ID",
      name: "Full name",
      role: "Role (Attorney, Paralegal, App Admin, etc.)",
    },
  },
};

const PASS1_SYSTEM_PROMPT = `You are a query planner for a legal case management system. Given a user's search query, analyze what data is needed to answer it.

AVAILABLE DATA SOURCES:
${JSON.stringify(DATA_SCHEMA, null, 2)}

Your job is to output a JSON plan with:
1. "tables" — array of table names that need to be queried (always include "cases" and "users")
2. "focus_fields" — object mapping each table to an array of field names most relevant to the query
3. "search_strategy" — a clear, specific description of what to look for in the data. Be precise about keywords, patterns, conditions. Use fuzzy matching guidance (e.g. "broken leg" should match "fractured tibia", "leg fracture", etc.)
4. "reasoning" — brief explanation of why these data sources are needed

RULES:
- Only include tables that are relevant to the query
- Always include "cases" and "users" tables
- Be specific in search_strategy — mention synonyms and related terms the AI should look for
- Output ONLY valid JSON, no markdown formatting`;

const PASS2_SYSTEM_PROMPT = `You are a legal case search assistant for a personal injury law firm. You have been given specific case data that was pre-selected as potentially relevant to the user's query.

RULES:
- Return ONLY a JSON array of matching cases
- Each result must have: "id" (number), "title" (string), "reason" (string explaining WHY this case matched in 1-2 sentences), "relevance" (number 1-10, 10 = perfect match)
- Return at most 20 results, ranked by relevance (highest first)
- If no cases match, return an empty array []
- The "reason" should be specific — reference actual data that matched
- Do NOT include markdown formatting, just raw JSON
- Use fuzzy matching: related medical terms, synonyms, and similar descriptions should match
- Consider partial matches but rank them lower than exact matches`;

async function pass1QueryPlan(query) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: PASS1_SYSTEM_PROMPT },
      { role: "user", content: `Search query: "${query}"` },
    ],
    max_completion_tokens: 1024,
    temperature: 0,
    store: false,
  });

  const raw = (completion.choices[0]?.message?.content || "{}").trim();
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    return JSON.parse(cleaned);
  } catch {
    return { tables: ["cases", "users"], focus_fields: {}, search_strategy: query, reasoning: "Fallback: query all case data" };
  }
}

const TABLE_QUERIES = {
  cases: {
    query: "SELECT * FROM cases WHERE deleted_at IS NULL AND confidential = FALSE ORDER BY title",
    buildSummary: (rows, usersMap, focusFields) => {
      return rows.map(c => {
        const parts = [`ID:${c.id}`, `"${c.title}"`];
        if (c.case_num) parts.push(`Case#:${c.case_num}`);
        if (c.client_name) parts.push(`Client:${c.client_name}`);
        if (c.county) parts.push(`County:${c.county}`);
        if (c.court) parts.push(`Court:${c.court}`);
        parts.push(`Type:${c.case_type || c.type || "Auto Accident"}`);
        parts.push(`Status:${c.status}`);
        if (c.stage) parts.push(`Stage:${c.stage}`);
        if (c.state_jurisdiction) parts.push(`State:${c.state_jurisdiction}`);
        if (c.injury_type) parts.push(`Injury:${c.injury_type}`);
        if (c.injury_description) parts.push(`InjuryDesc:${c.injury_description}`);
        if (c.incident_location) parts.push(`Location:${c.incident_location}`);
        if (c.incident_description) parts.push(`IncidentDesc:${c.incident_description}`);
        if (c.police_report_number) parts.push(`PoliceReport#:${c.police_report_number}`);
        if (c.case_value_estimate) parts.push(`Value:$${c.case_value_estimate}`);
        if (c.settlement_amount) parts.push(`Settlement:$${c.settlement_amount}`);
        if (c.demand_amount) parts.push(`Demand:$${c.demand_amount}`);
        if (c.property_damage_amount) parts.push(`PropDmg:$${c.property_damage_amount}`);
        if (c.liability_assessment) parts.push(`Liability:${c.liability_assessment}`);
        if (c.comparative_fault_pct) parts.push(`CompFault:${c.comparative_fault_pct}%`);
        if (c.fee_structure) parts.push(`FeeStructure:${c.fee_structure}`);
        if (c.lead_attorney && usersMap[c.lead_attorney]) parts.push(`LeadAtty:${usersMap[c.lead_attorney]}`);
        if (c.second_attorney && usersMap[c.second_attorney]) parts.push(`2ndAtty:${usersMap[c.second_attorney]}`);
        if (c.paralegal && usersMap[c.paralegal]) parts.push(`Paralegal:${usersMap[c.paralegal]}`);
        if (c.case_manager && usersMap[c.case_manager]) parts.push(`CaseMgr:${usersMap[c.case_manager]}`);
        if (c.investigator && usersMap[c.investigator]) parts.push(`Investigator:${usersMap[c.investigator]}`);
        if (c.judge) parts.push(`Judge:${c.judge}`);
        if (c.trial_date) parts.push(`Trial:${fmtD(c.trial_date)}`);
        if (c.accident_date) parts.push(`AccidentDate:${fmtD(c.accident_date)}`);
        if (c.statute_of_limitations_date) parts.push(`SOL:${fmtD(c.statute_of_limitations_date)}`);
        if (c.mediation_date) parts.push(`Mediation:${fmtD(c.mediation_date)}`);
        if (c.next_court_date) parts.push(`NextCourt:${fmtD(c.next_court_date)}`);
        if (c.disposition_type) parts.push(`Disposition:${c.disposition_type}`);
        const customFields = Array.isArray(c.custom_fields) ? c.custom_fields : [];
        for (const cf of customFields) {
          if (cf.value) parts.push(`${cf.label}:${cf.value}`);
        }
        return { id: c.id, title: c.title, summary: parts.join(" | ") };
      });
    },
  },
  users: {
    query: "SELECT id, name, role FROM users",
    buildMap: (rows) => {
      const map = {};
      for (const u of rows) map[u.id] = u.name;
      return map;
    },
  },
  case_parties: {
    query: "SELECT case_id, party_type, data FROM case_parties",
    buildByCase: (rows) => groupByCase(rows, (p) => {
      const d = parseJSON(p.data);
      const name = d.entityName || [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ") || "";
      if (!name) return null;
      const info = [name];
      if (p.party_type) info.push(`(${p.party_type})`);
      if (d.representedBy) info.push(`rep:${d.representedBy}`);
      if (d.email) info.push(d.email);
      if (d.phone) info.push(d.phone);
      if (d.isOurClient) info.push("OurClient");
      return info.join(" ");
    }),
  },
  case_notes: {
    query: "SELECT case_id, body, type FROM case_notes ORDER BY created_at DESC",
    buildByCase: (rows) => groupByCase(rows, (n) => `${n.type}:"${(n.body || "").substring(0, 200)}"`, 8),
  },
  case_documents: {
    query: "SELECT case_id, filename FROM case_documents WHERE deleted_at IS NULL ORDER BY created_at DESC",
    buildByCase: (rows) => groupByCase(rows, (d) => d.filename, 15),
  },
  case_medical_treatments: {
    query: "SELECT case_id, provider_name, treatment_type, diagnosis, start_date, end_date, total_billed, total_paid, notes FROM case_medical_treatments",
    buildByCase: (rows) => groupByCase(rows, (t) => {
      const parts = [];
      if (t.provider_name) parts.push(t.provider_name);
      if (t.treatment_type) parts.push(`(${t.treatment_type})`);
      if (t.diagnosis) parts.push(`Dx:${t.diagnosis}`);
      if (t.start_date) parts.push(`from:${fmtD(t.start_date)}`);
      if (t.end_date) parts.push(`to:${fmtD(t.end_date)}`);
      if (t.total_billed) parts.push(`billed:$${t.total_billed}`);
      if (t.notes) parts.push(`"${(t.notes || "").substring(0, 100)}"`);
      return parts.join(" ");
    }),
  },
  case_insurance_policies: {
    query: "SELECT case_id, carrier_name, policy_type, policy_number, coverage_limit, adjuster_name, adjuster_phone, adjuster_email, claim_number FROM case_insurance_policies",
    buildByCase: (rows) => groupByCase(rows, (p) => {
      const parts = [];
      if (p.carrier_name) parts.push(p.carrier_name);
      if (p.policy_type) parts.push(`(${p.policy_type})`);
      if (p.policy_number) parts.push(`Policy#:${p.policy_number}`);
      if (p.coverage_limit) parts.push(`Limit:$${p.coverage_limit}`);
      if (p.adjuster_name) parts.push(`Adjuster:${p.adjuster_name}`);
      if (p.claim_number) parts.push(`Claim#:${p.claim_number}`);
      return parts.join(" ");
    }),
  },
  case_damages: {
    query: "SELECT case_id, category, description, amount FROM case_damages",
    buildByCase: (rows) => groupByCase(rows, (d) => {
      const parts = [];
      if (d.category) parts.push(d.category);
      if (d.description) parts.push(`"${(d.description || "").substring(0, 100)}"`);
      if (d.amount) parts.push(`$${d.amount}`);
      return parts.join(" ");
    }),
  },
  case_liens: {
    query: "SELECT case_id, lienholder_name, lien_type, amount, status FROM case_liens",
    buildByCase: (rows) => groupByCase(rows, (l) => {
      const parts = [];
      if (l.lienholder_name) parts.push(l.lienholder_name);
      if (l.lien_type) parts.push(`(${l.lien_type})`);
      if (l.amount) parts.push(`$${l.amount}`);
      if (l.status) parts.push(l.status);
      return parts.join(" ");
    }),
  },
  case_expenses: {
    query: "SELECT case_id, description, amount, category, date FROM case_expenses",
    buildByCase: (rows) => groupByCase(rows, (e) => {
      const parts = [];
      if (e.category) parts.push(e.category);
      if (e.description) parts.push(`"${(e.description || "").substring(0, 80)}"`);
      if (e.amount) parts.push(`$${e.amount}`);
      if (e.date) parts.push(fmtD(e.date));
      return parts.join(" ");
    }),
  },
  case_negotiations: {
    query: "SELECT case_id, type, amount, date, notes FROM case_negotiations ORDER BY date DESC",
    buildByCase: (rows) => groupByCase(rows, (n) => {
      const parts = [];
      if (n.type) parts.push(n.type);
      if (n.amount) parts.push(`$${n.amount}`);
      if (n.date) parts.push(fmtD(n.date));
      if (n.notes) parts.push(`"${(n.notes || "").substring(0, 80)}"`);
      return parts.join(" ");
    }),
  },
  case_experts: {
    query: "SELECT case_id, data FROM case_experts",
    buildByCase: (rows) => groupByCase(rows, (ex) => {
      const d = parseJSON(ex.data);
      const parts = [];
      if (d.name) parts.push(d.name);
      if (d.type) parts.push(`(${d.type})`);
      if (d.company) parts.push(d.company);
      if (d.specialty) parts.push(d.specialty);
      return parts.join(" ");
    }),
  },
  tasks: {
    query: "SELECT case_id, title, status, priority, due, assigned_to FROM tasks",
    buildByCase: (rows) => groupByCase(rows, (t) =>
      `${t.title}(${t.status},${t.priority}${t.due ? ",due:" + fmtD(t.due) : ""})`, 10),
  },
  deadlines: {
    query: "SELECT case_id, title, date, type FROM deadlines",
    buildByCase: (rows) => groupByCase(rows, (d) =>
      `${d.title}(${d.type},${d.date ? fmtD(d.date) : ""})`),
  },
  case_correspondence: {
    query: "SELECT case_id, subject, from_email, to_emails FROM case_correspondence ORDER BY received_at DESC",
    buildByCase: (rows) => groupByCase(rows, (cr) => {
      const parts = [];
      if (cr.subject) parts.push(`"${cr.subject}"`);
      if (cr.from_email) parts.push(`from:${cr.from_email}`);
      return parts.join(" ");
    }, 8),
  },
  case_transcripts: {
    query: "SELECT case_id, filename FROM case_transcripts WHERE deleted_at IS NULL ORDER BY created_at DESC",
    buildByCase: (rows) => groupByCase(rows, (t) => t.filename, 15),
  },
  case_activity: {
    query: "SELECT case_id, action, detail FROM case_activity ORDER BY ts DESC",
    buildByCase: (rows) => groupByCase(rows, (a) =>
      `${a.action}:"${(a.detail || "").substring(0, 100)}"`, 5),
  },
  case_filings: {
    query: "SELECT case_id, filename, filing_type FROM case_filings WHERE deleted_at IS NULL ORDER BY created_at DESC",
    buildByCase: (rows) => groupByCase(rows, (f) => {
      const parts = [f.filename];
      if (f.filing_type) parts.push(`(${f.filing_type})`);
      return parts.join(" ");
    }, 15),
  },
};

function fmtD(v) {
  if (!v) return "";
  return v instanceof Date ? v.toISOString().split("T")[0] : String(v).split("T")[0];
}

function parseJSON(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return {}; }
}

function groupByCase(rows, mapper, limit = 20) {
  const byCase = {};
  for (const row of rows) {
    if (!byCase[row.case_id]) byCase[row.case_id] = [];
    if (byCase[row.case_id].length >= limit) continue;
    const val = mapper(row);
    if (val) byCase[row.case_id].push(val);
  }
  return byCase;
}

async function pass2Search(query, plan, caseSummaries, supplementalData) {
  let caseDataLines = caseSummaries.map(cs => {
    const extras = [];
    for (const [tableName, byCase] of Object.entries(supplementalData)) {
      const items = byCase[cs.id];
      if (items && items.length) {
        const label = tableName.replace("case_", "").replace(/_/g, " ");
        extras.push(`${label}:[${items.join("; ")}]`);
      }
    }
    return cs.summary + (extras.length ? " | " + extras.join(" | ") : "");
  });

  let caseDataText = caseDataLines.join("\n");
  const MAX_CHARS = 700000;
  if (caseDataText.length > MAX_CHARS) {
    caseDataText = caseDataText.substring(0, MAX_CHARS);
    const lastNewline = caseDataText.lastIndexOf("\n");
    if (lastNewline > MAX_CHARS * 0.9) caseDataText = caseDataText.substring(0, lastNewline);
  }

  const userPrompt = `Search query: "${query}"

SEARCH STRATEGY (from query analysis):
${plan.search_strategy || "Find cases matching the query"}

Case data (${caseSummaries.length} cases):
${caseDataText}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: PASS2_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    max_completion_tokens: 4096,
    store: false,
  });

  const raw = (completion.choices[0]?.message?.content || "[]").trim();
  try {
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    return JSON.parse(jsonStr);
  } catch {
    return [];
  }
}

router.post("/", requireAuth, async (req, res) => {
  const { query } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "Search query is required" });
  }

  try {
    const startTime = Date.now();

    const plan = await pass1QueryPlan(query);
    console.log(`AI Search Pass 1 (${Date.now() - startTime}ms): tables=[${(plan.tables || []).join(",")}] strategy="${(plan.search_strategy || "").substring(0, 100)}"`);

    const allowedTables = Object.keys(TABLE_QUERIES);
    let tablesToQuery = Array.isArray(plan.tables) ? plan.tables.filter(t => typeof t === "string" && allowedTables.includes(t)) : [];
    if (tablesToQuery.length === 0) tablesToQuery = ["cases", "users"];
    if (!tablesToQuery.includes("cases")) tablesToQuery.unshift("cases");
    if (!tablesToQuery.includes("users")) tablesToQuery.push("users");

    const validTables = tablesToQuery;

    const queryPromises = validTables.map(async (tableName) => {
      const tq = TABLE_QUERIES[tableName];
      try {
        const result = await pool.query(tq.query);
        return { tableName, rows: result.rows };
      } catch (err) {
        console.error(`AI Search: query failed for ${tableName}:`, err.message);
        return { tableName, rows: [] };
      }
    });

    const queryResults = await Promise.all(queryPromises);

    let usersMap = {};
    let caseSummaries = [];
    const supplementalData = {};

    for (const { tableName, rows } of queryResults) {
      const tq = TABLE_QUERIES[tableName];
      if (tableName === "users" && tq.buildMap) {
        usersMap = tq.buildMap(rows);
      }
    }

    for (const { tableName, rows } of queryResults) {
      const tq = TABLE_QUERIES[tableName];
      if (tableName === "cases" && tq.buildSummary) {
        caseSummaries = tq.buildSummary(rows, usersMap, plan.focus_fields?.cases);
      } else if (tableName !== "users" && tq.buildByCase) {
        supplementalData[tableName] = tq.buildByCase(rows);
      }
    }

    if (caseSummaries.length === 0) {
      return res.json({ results: [], plan: { tables: validTables, strategy: plan.search_strategy } });
    }

    const pass2Start = Date.now();
    let results = await pass2Search(query, plan, caseSummaries, supplementalData);
    console.log(`AI Search Pass 2 (${Date.now() - pass2Start}ms): ${Array.isArray(results) ? results.length : 0} results`);

    if (!Array.isArray(results)) results = [];
    const validIds = new Set(caseSummaries.map(c => c.id));
    const titleMap = {};
    for (const cs of caseSummaries) titleMap[cs.id] = cs.title;
    results = results
      .filter(r => r && typeof r.id === "number" && validIds.has(r.id))
      .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
      .map(r => ({
        id: r.id,
        title: r.title || titleMap[r.id] || "Unknown",
        reason: r.reason || "Matched based on case data",
        relevance: r.relevance || 5,
      }));

    const totalTime = Date.now() - startTime;
    console.log(`AI Search complete (${totalTime}ms): ${results.length} results for "${query.substring(0, 60)}"`);

    return res.json({
      results,
      plan: { tables: validTables, strategy: plan.search_strategy },
    });
  } catch (err) {
    console.error("AI search error:", err);
    return res.status(500).json({ error: "AI search failed. Please try again." });
  }
});

module.exports = router;
