const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  widgetType: row.widget_type,
  dataSource: row.data_source,
  config: row.config,
  size: row.size,
  visibility: row.visibility,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM custom_dashboard_widgets
       WHERE user_id = $1 OR visibility IN ('shared', 'public')
       ORDER BY created_at DESC`,
      [req.session.userId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Get custom widgets error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, widgetType, dataSource, config, size, visibility } = req.body;
    if (!name || !widgetType || !dataSource) {
      return res.status(400).json({ error: "Name, widget type, and data source required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO custom_dashboard_widgets (user_id, name, widget_type, data_source, config, size, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.session.userId, name, widgetType, dataSource, JSON.stringify(config || {}), size || "half", visibility || "private"]
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Create custom widget error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { name, widgetType, dataSource, config, size, visibility } = req.body;
    const { rows } = await pool.query(
      `UPDATE custom_dashboard_widgets SET name=$1, widget_type=$2, data_source=$3,
       config=$4, size=$5, visibility=$6, updated_at=NOW()
       WHERE id=$7 AND user_id=$8 RETURNING *`,
      [name, widgetType, dataSource, JSON.stringify(config || {}), size || "half", visibility || "private", req.params.id, req.session.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Update custom widget error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM custom_dashboard_widgets WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete custom widget error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

const WIDGET_SCHEMA_MAP = {
  cases: {
    table: "cases",
    allowed: ["id", "title", "status", "stage", "case_type", "state_jurisdiction", "created_at", "settlement_amount", "case_value_estimate", "client_name", "county", "lead_attorney", "case_manager", "in_litigation", "client_bankruptcy", "accident_date", "disposition_type", "injury_type"],
    defaultSort: "id",
    deleteFilter: "deleted_at IS NULL",
  },
  tasks: {
    table: "tasks",
    allowed: ["id", "title", "status", "priority", "due", "assigned_role", "case_id", "created_at", "assigned"],
    defaultSort: "id",
    deleteFilter: "deleted_at IS NULL",
  },
  deadlines: {
    table: "deadlines",
    allowed: ["id", "title", "date", "type", "case_id", "created_at"],
    defaultSort: "id",
    deleteFilter: null,
  },
  contacts: {
    table: "contacts",
    allowed: ["id", "name", "company", "type", "email", "phone", "created_at"],
    defaultSort: "id",
    deleteFilter: "deleted_at IS NULL",
  },
  correspondence: {
    table: "case_correspondence",
    allowed: ["id", "from_email", "to_email", "subject", "received_at", "case_id"],
    defaultSort: "id",
    deleteFilter: "deleted_at IS NULL",
  },
  expenses: {
    table: "case_expenses",
    allowed: ["id", "category", "amount", "status", "case_id", "vendor", "date", "created_at"],
    defaultSort: "id",
    deleteFilter: "deleted_at IS NULL",
  },
};

function validateColumn(col, allowed) {
  const clean = col.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  return allowed.includes(clean) ? clean : null;
}

router.post("/run", requireAuth, async (req, res) => {
  try {
    const { widgetType, dataSource, config } = req.body;
    const schema = WIDGET_SCHEMA_MAP[dataSource];
    if (!schema) return res.status(400).json({ error: "Invalid data source" });

    const filters = config.filters || [];
    const whereClauses = ["1=1"];
    const params = [];

    if (schema.deleteFilter) {
      whereClauses.push(schema.deleteFilter);
    }

    for (const f of filters) {
      if (!f.field || !f.operator) continue;
      const safeField = validateColumn(f.field, schema.allowed);
      if (!safeField) continue;
      const pi = params.length + 1;
      switch (f.operator) {
        case "equals": whereClauses.push(`${safeField} = $${pi}`); params.push(f.value); break;
        case "not_equals": whereClauses.push(`${safeField} != $${pi}`); params.push(f.value); break;
        case "contains": whereClauses.push(`CAST(${safeField} AS TEXT) ILIKE $${pi}`); params.push(`%${f.value}%`); break;
        case "greater_than": whereClauses.push(`${safeField} > $${pi}`); params.push(f.value); break;
        case "less_than": whereClauses.push(`${safeField} < $${pi}`); params.push(f.value); break;
        case "is_true": whereClauses.push(`${safeField} = true`); break;
        case "is_false": whereClauses.push(`(${safeField} = false OR ${safeField} IS NULL)`); break;
      }
    }

    const where = whereClauses.join(" AND ");

    if (widgetType === "metric") {
      const agg = config.aggregation || "count";
      const targetField = validateColumn(config.target_field || config.targetField || "id", schema.allowed) || "id";
      let aggSql;
      switch (agg) {
        case "sum": aggSql = `COALESCE(SUM(CAST(${targetField} AS NUMERIC)), 0)`; break;
        case "average": aggSql = `COALESCE(AVG(CAST(${targetField} AS NUMERIC)), 0)`; break;
        default: aggSql = "COUNT(*)";
      }
      const { rows } = await pool.query(`SELECT ${aggSql} AS value FROM ${schema.table} WHERE ${where}`, params);
      return res.json({ value: Number(rows[0].value) });
    }

    if (widgetType === "list") {
      const rawCols = config.columns || config.column_list || "";
      const colList = (typeof rawCols === "string" ? rawCols.split(",") : rawCols)
        .map(c => validateColumn(c, schema.allowed))
        .filter(Boolean);
      const cols = colList.length > 0 ? colList.join(", ") : schema.allowed.slice(0, 5).join(", ");
      const sortBy = validateColumn(config.sort_by || config.sortBy || schema.defaultSort, schema.allowed) || schema.defaultSort;
      const sortDir = (config.sort_dir || config.sortDirection || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
      const limit = Math.min(parseInt(config.row_limit || config.rowLimit) || 10, 50);
      const { rows } = await pool.query(
        `SELECT ${cols} FROM ${schema.table} WHERE ${where} ORDER BY ${sortBy} ${sortDir} LIMIT ${limit}`,
        params
      );
      const resultColumns = colList.length > 0 ? colList : schema.allowed.slice(0, 5);
      return res.json({ rows, columns: resultColumns });
    }

    if (widgetType === "chart") {
      const groupBy = validateColumn(config.chart_field || config.groupBy || "status", schema.allowed) || "status";
      const agg = config.aggregation || "count";
      const targetField = validateColumn(config.target_field || config.targetField || "id", schema.allowed) || "id";
      let aggSql;
      switch (agg) {
        case "sum": aggSql = `COALESCE(SUM(CAST(${targetField} AS NUMERIC)), 0)`; break;
        case "average": aggSql = `COALESCE(AVG(CAST(${targetField} AS NUMERIC)), 0)`; break;
        default: aggSql = "COUNT(*)";
      }
      const { rows } = await pool.query(
        `SELECT ${groupBy} AS label, ${aggSql} AS value FROM ${schema.table} WHERE ${where} GROUP BY ${groupBy} ORDER BY value DESC LIMIT 20`,
        params
      );
      return res.json({ data: rows.map(r => ({ label: r.label || "Unknown", value: Number(r.value) })) });
    }

    return res.status(400).json({ error: "Invalid widget type" });
  } catch (err) {
    console.error("Run custom widget error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
