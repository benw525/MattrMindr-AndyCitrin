const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const OpenAI = require("openai");

const router = express.Router();

let openai;
try {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "placeholder" });
} catch (e) { openai = null; }

const SCHEMA_MAP = {
  cases: {
    table: "cases",
    columns: {
      case_number: { sql: "c.case_number", label: "Case Number" },
      title: { sql: "c.title", label: "Title" },
      client_name: { sql: "c.client_name", label: "Client Name" },
      status: { sql: "c.status", label: "Status" },
      stage: { sql: "c.stage", label: "Stage" },
      case_type: { sql: "c.case_type", label: "Case Type" },
      lead_attorney: { sql: "la.name", label: "Lead Attorney", join: "LEFT JOIN users la ON la.id = c.lead_attorney" },
      case_manager: { sql: "cm.name", label: "Case Manager", join: "LEFT JOIN users cm ON cm.id = c.case_manager" },
      created_at: { sql: "c.created_at", label: "Created", type: "date" },
      incident_date: { sql: "c.incident_date", label: "Incident Date", type: "date" },
      statute_of_limitations: { sql: "c.statute_of_limitations", label: "SOL Date", type: "date" },
      demand_date: { sql: "c.demand_date", label: "Demand Date", type: "date" },
      trial_date: { sql: "c.trial_date", label: "Trial Date", type: "date" },
      next_court_date: { sql: "c.next_court_date", label: "Next Court Date", type: "date" },
      in_litigation: { sql: "c.in_litigation", label: "In Litigation", type: "boolean" },
    },
    baseFrom: "cases c",
    baseWhere: "c.deleted_at IS NULL",
  },
  tasks: {
    table: "case_tasks",
    columns: {
      title: { sql: "t.title", label: "Title" },
      status: { sql: "t.status", label: "Status" },
      priority: { sql: "t.priority", label: "Priority" },
      assigned_to: { sql: "u.name", label: "Assigned To", join: "LEFT JOIN users u ON u.id = t.assigned_to" },
      case_number: { sql: "c.case_number", label: "Case Number", join: "LEFT JOIN cases c ON c.id = t.case_id" },
      due_date: { sql: "t.due_date", label: "Due Date", type: "date" },
      created_at: { sql: "t.created_at", label: "Created", type: "date" },
    },
    baseFrom: "case_tasks t",
    baseWhere: "t.deleted_at IS NULL",
  },
  contacts: {
    table: "contacts",
    columns: {
      name: { sql: "co.name", label: "Name" },
      email: { sql: "co.email", label: "Email" },
      phone: { sql: "co.phone", label: "Phone" },
      company: { sql: "co.company", label: "Company" },
      contact_type: { sql: "co.contact_type", label: "Type" },
      created_at: { sql: "co.created_at", label: "Created", type: "date" },
    },
    baseFrom: "contacts co",
    baseWhere: "co.deleted_at IS NULL",
  },
  deadlines: {
    table: "case_deadlines",
    columns: {
      title: { sql: "d.title", label: "Title" },
      due_date: { sql: "d.due_date", label: "Due Date", type: "date" },
      status: { sql: "d.status", label: "Status" },
      priority: { sql: "d.priority", label: "Priority" },
      case_number: { sql: "c.case_number", label: "Case Number", join: "LEFT JOIN cases c ON c.id = d.case_id" },
    },
    baseFrom: "case_deadlines d",
    baseWhere: "d.deleted_at IS NULL",
  },
};

const toFrontend = (r) => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  dataSource: r.data_source,
  config: r.config,
  visibility: r.visibility,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM custom_reports WHERE user_id = $1 OR visibility = 'shared' ORDER BY updated_at DESC",
      [req.session.userId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Custom reports list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, dataSource, config, visibility } = req.body;
    if (!name || !dataSource) return res.status(400).json({ error: "Name and data source required" });
    const { rows } = await pool.query(
      "INSERT INTO custom_reports (user_id, name, data_source, config, visibility) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [req.session.userId, name, dataSource, config || {}, visibility || "private"]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Custom report create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { name, dataSource, config, visibility } = req.body;
    const { rows } = await pool.query(
      "UPDATE custom_reports SET name=COALESCE($1,name), data_source=COALESCE($2,data_source), config=COALESCE($3,config), visibility=COALESCE($4,visibility), updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *",
      [name, dataSource, config, visibility, req.params.id, req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Custom report update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM custom_reports WHERE id=$1 AND user_id=$2 RETURNING id",
      [req.params.id, req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Custom report delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

function buildOperatorClause(colSql, operator, value, params) {
  const idx = params.length + 1;
  switch (operator) {
    case "equals": params.push(value); return `${colSql} = $${idx}`;
    case "not_equals": params.push(value); return `${colSql} != $${idx}`;
    case "contains": params.push(`%${value}%`); return `${colSql} ILIKE $${idx}`;
    case "starts_with": params.push(`${value}%`); return `${colSql} ILIKE $${idx}`;
    case "greater_than": params.push(value); return `${colSql} > $${idx}`;
    case "less_than": params.push(value); return `${colSql} < $${idx}`;
    case "is_empty": return `(${colSql} IS NULL OR ${colSql} = '')`;
    case "is_not_empty": return `(${colSql} IS NOT NULL AND ${colSql} != '')`;
    case "date_before": params.push(value); return `${colSql} < $${idx}`;
    case "date_after": params.push(value); return `${colSql} > $${idx}`;
    case "date_between": {
      const [from, to] = Array.isArray(value) ? value : value.split(",");
      params.push(from, to);
      return `${colSql} BETWEEN $${idx} AND $${idx + 1}`;
    }
    default: params.push(value); return `${colSql} = $${idx}`;
  }
}

router.post("/run", requireAuth, async (req, res) => {
  try {
    const { dataSource, config } = req.body;
    const schema = SCHEMA_MAP[dataSource];
    if (!schema) return res.status(400).json({ error: "Invalid data source" });

    const columns = (config.columns || []).filter(c => schema.columns[c]);
    if (!columns.length) return res.status(400).json({ error: "No valid columns selected" });

    const selectParts = columns.map(c => `${schema.columns[c].sql} AS "${c}"`);
    const joins = new Set();
    columns.forEach(c => {
      if (schema.columns[c].join) joins.add(schema.columns[c].join);
    });

    const params = [];
    const whereParts = [schema.baseWhere];

    if (config.filters && Array.isArray(config.filters)) {
      for (const f of config.filters) {
        if (!schema.columns[f.field]) continue;
        const col = schema.columns[f.field];
        if (col.join) joins.add(col.join);
        const clause = buildOperatorClause(col.sql, f.operator, f.value, params);
        whereParts.push(clause);
      }
    }

    let sql = `SELECT ${selectParts.join(", ")} FROM ${schema.baseFrom}`;
    for (const j of joins) sql += ` ${j}`;
    sql += ` WHERE ${whereParts.join(" AND ")}`;

    if (config.sortBy && schema.columns[config.sortBy]) {
      sql += ` ORDER BY ${schema.columns[config.sortBy].sql} ${config.sortDir === "asc" ? "ASC" : "DESC"}`;
    }

    sql += " LIMIT 1000";

    const { rows } = await pool.query(sql, params);

    let groupedResults = null;
    if (config.groupBy && schema.columns[config.groupBy]) {
      groupedResults = {};
      for (const row of rows) {
        const key = row[config.groupBy] || "(Empty)";
        if (!groupedResults[key]) groupedResults[key] = [];
        groupedResults[key].push(row);
      }
    }

    res.json({ rows, groupedResults, totalRows: rows.length });
  } catch (err) {
    console.error("Custom report run error:", err);
    res.status(500).json({ error: "Failed to run report: " + err.message });
  }
});

router.post("/ai-assist", requireAuth, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "placeholder" });

    const schemaDescription = Object.entries(SCHEMA_MAP).map(([source, schema]) => {
      const cols = Object.entries(schema.columns).map(([k, v]) => `  - ${k} (${v.label}${v.type ? ', type: ' + v.type : ''})`).join("\n");
      return `Data Source: "${source}"\nColumns:\n${cols}`;
    }).join("\n\n");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a report configuration assistant for a plaintiff law firm case management system. Given a natural language description, create a report configuration JSON. Available schema:\n\n${schemaDescription}\n\nReturn ONLY valid JSON with this structure:\n{\n  "dataSource": "cases|tasks|contacts|deadlines",\n  "columns": ["col1", "col2"],\n  "filters": [{"field": "col", "operator": "equals|not_equals|contains|starts_with|greater_than|less_than|is_empty|is_not_empty|date_before|date_after|date_between", "value": "..."}],\n  "sortBy": "col",\n  "sortDir": "asc|desc",\n  "groupBy": "col" (optional)\n}`
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1000,
    });

    const content = completion.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(400).json({ error: "Could not parse AI response" });

    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error("Custom report AI assist error:", err);
    res.status(500).json({ error: "AI assist failed" });
  }
});

module.exports = router;
