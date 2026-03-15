const express = require("express");
const router = express.Router();
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

let r2Module;
try { r2Module = require("../r2"); } catch (e) { r2Module = null; }

function requireAppAdmin(req, res, next) {
  const roles = req.session.userRoles || [req.session.userRole];
  if (!roles.includes("App Admin")) return res.status(403).json({ error: "App Admin required" });
  next();
}

router.use(requireAuth);
router.use(requireAppAdmin);

const ENTITY_CONFIG = [
  { type: "cases", table: "cases", nameCol: "title", caseCol: null, label: "Cases" },
  { type: "contacts", table: "contacts", nameCol: "name", caseCol: null, label: "Contacts" },
  { type: "users", table: "users", nameCol: "name", caseCol: null, label: "Staff" },
  { type: "documents", table: "case_documents", nameCol: "filename", caseCol: "case_id", label: "Documents", r2KeyCol: "s3_key" },
  { type: "transcripts", table: "case_transcripts", nameCol: "filename", caseCol: "case_id", label: "Transcripts", r2KeyCols: ["r2_audio_key", "r2_video_key"] },
  { type: "filings", table: "case_filings", nameCol: "filename", caseCol: "case_id", label: "Filings", r2KeyCol: "s3_key" },
  { type: "correspondence", table: "case_correspondence", nameCol: "subject", caseCol: "case_id", label: "Correspondence" },
  { type: "deadlines", table: "deadlines", nameCol: "title", caseCol: "case_id", label: "Deadlines" },
  { type: "notes", table: "case_notes", nameCol: "body", caseCol: "case_id", label: "Notes" },
  { type: "time_entries", table: "time_entries", nameCol: "detail", caseCol: "case_id", label: "Time Entries" },
  { type: "insurance", table: "case_insurance_policies", nameCol: "carrier_name", caseCol: "case_id", label: "Insurance Policies" },
  { type: "medical", table: "case_medical_treatments", nameCol: "provider_name", caseCol: "case_id", label: "Medical Treatments" },
  { type: "liens", table: "case_liens", nameCol: "lienholder_name", caseCol: "case_id", label: "Liens" },
  { type: "damages", table: "case_damages", nameCol: "description", caseCol: "case_id", label: "Damages" },
  { type: "negotiations", table: "case_negotiations", nameCol: "notes", caseCol: "case_id", label: "Negotiations" },
  { type: "parties", table: "case_parties", nameCol: "party_type", caseCol: "case_id", label: "Parties", jsonName: "data->>'name'" },
  { type: "experts", table: "case_experts", nameCol: "expert_type", caseCol: "case_id", label: "Experts", jsonName: "data->>'name'" },
  { type: "misc_contacts", table: "case_misc_contacts", nameCol: "contact_type", caseCol: "case_id", label: "Misc Contacts", jsonName: "data->>'name'" },
];

async function deleteR2Objects(cfg, ids) {
  if (!r2Module || !r2Module.isR2Configured()) return;
  try {
    if (cfg.r2KeyCol) {
      const { rows } = await pool.query(
        `SELECT ${cfg.r2KeyCol} FROM ${cfg.table} WHERE id = ANY($1) AND ${cfg.r2KeyCol} IS NOT NULL`,
        [ids]
      );
      for (const row of rows) {
        if (row[cfg.r2KeyCol]) {
          try { await r2Module.deleteFromR2(row[cfg.r2KeyCol]); } catch (e) { console.error("R2 delete error:", e.message); }
        }
      }
    }
    if (cfg.r2KeyCols) {
      const selectCols = cfg.r2KeyCols.join(", ");
      const { rows } = await pool.query(
        `SELECT ${selectCols} FROM ${cfg.table} WHERE id = ANY($1)`,
        [ids]
      );
      for (const row of rows) {
        for (const col of cfg.r2KeyCols) {
          if (row[col]) {
            try { await r2Module.deleteFromR2(row[col]); } catch (e) { console.error("R2 delete error:", e.message); }
          }
        }
      }
    }
  } catch (e) {
    console.error("R2 cleanup error:", e.message);
  }
}

router.get("/", async (req, res) => {
  try {
    const search = (req.query.search || "").trim().toLowerCase();
    const results = [];
    for (const cfg of ENTITY_CONFIG) {
      try {
        const caseJoin = cfg.caseCol
          ? `LEFT JOIN cases c ON c.id = t.${cfg.caseCol}`
          : "";
        const caseSelect = cfg.caseCol
          ? `, t.${cfg.caseCol} AS case_id, c.title AS case_title`
          : "";
        const nameExpr = cfg.jsonName ? `COALESCE(t.${cfg.jsonName}, t.${cfg.nameCol})` : `t.${cfg.nameCol}`;

        let searchClause = "";
        const params = [];
        if (search) {
          params.push(`%${search}%`);
          const searchConditions = [`LOWER(${nameExpr}) LIKE $1`];
          if (cfg.caseCol) {
            searchConditions.push(`LOWER(c.title) LIKE $1`);
          }
          searchClause = `AND (${searchConditions.join(" OR ")})`;
        }

        const { rows } = await pool.query(
          `SELECT t.id, ${nameExpr} AS name, t.deleted_at${caseSelect}
           FROM ${cfg.table} t ${caseJoin}
           WHERE t.deleted_at IS NOT NULL AND t.deleted_at > NOW() - INTERVAL '30 days'
           ${searchClause}
           ORDER BY t.deleted_at DESC`,
          params
        );
        if (rows.length > 0) {
          results.push({
            type: cfg.type,
            label: cfg.label,
            items: rows.map(r => ({
              id: r.id,
              name: (r.name || "").substring(0, 200) || "(untitled)",
              deletedAt: r.deleted_at,
              caseId: r.case_id || null,
              caseTitle: r.case_title || null,
              daysRemaining: Math.max(0, 30 - Math.floor((Date.now() - new Date(r.deleted_at).getTime()) / 86400000)),
            })),
          });
        }
      } catch (tableErr) {
        console.error(`Deleted data query error for ${cfg.table}:`, tableErr.message);
      }
    }
    res.json(results);
  } catch (err) {
    console.error("Deleted data list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/restore", async (req, res) => {
  try {
    const { type, id } = req.body;
    const cfg = ENTITY_CONFIG.find(c => c.type === type);
    if (!cfg) return res.status(400).json({ error: "Invalid type" });
    const { rowCount } = await pool.query(
      `UPDATE ${cfg.table} SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
      [id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Not found or not deleted" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Restore error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/batch-restore", async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "No items provided" });
    let totalRestored = 0;
    const grouped = {};
    for (const item of items) {
      if (!grouped[item.type]) grouped[item.type] = [];
      grouped[item.type].push(item.id);
    }
    for (const [type, ids] of Object.entries(grouped)) {
      const cfg = ENTITY_CONFIG.find(c => c.type === type);
      if (!cfg) continue;
      const { rowCount } = await pool.query(
        `UPDATE ${cfg.table} SET deleted_at = NULL WHERE id = ANY($1) AND deleted_at IS NOT NULL`,
        [ids]
      );
      totalRestored += rowCount;
    }
    res.json({ ok: true, restored: totalRestored });
  } catch (err) {
    console.error("Batch restore error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/batch-purge", async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "No items provided" });
    let totalPurged = 0;
    const grouped = {};
    for (const item of items) {
      if (!grouped[item.type]) grouped[item.type] = [];
      grouped[item.type].push(item.id);
    }
    for (const [type, ids] of Object.entries(grouped)) {
      const cfg = ENTITY_CONFIG.find(c => c.type === type);
      if (!cfg) continue;
      await deleteR2Objects(cfg, ids);
      const { rowCount } = await pool.query(
        `DELETE FROM ${cfg.table} WHERE id = ANY($1) AND deleted_at IS NOT NULL`,
        [ids]
      );
      totalPurged += rowCount;
    }
    res.json({ ok: true, purged: totalPurged });
  } catch (err) {
    console.error("Batch purge error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/purge", async (req, res) => {
  try {
    let totalPurged = 0;
    for (const cfg of ENTITY_CONFIG) {
      const idsResult = await pool.query(
        `SELECT id FROM ${cfg.table} WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'`
      );
      const ids = idsResult.rows.map(r => r.id);
      if (ids.length > 0) {
        await deleteR2Objects(cfg, ids);
        const { rowCount } = await pool.query(
          `DELETE FROM ${cfg.table} WHERE id = ANY($1)`,
          [ids]
        );
        totalPurged += rowCount;
      }
    }
    res.json({ ok: true, purged: totalPurged });
  } catch (err) {
    console.error("Purge error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

async function autoPurgeExpired() {
  try {
    let total = 0;
    for (const cfg of ENTITY_CONFIG) {
      if (cfg.r2KeyCol || cfg.r2KeyCols) {
        const { rows: expiredRows } = await pool.query(
          `SELECT id FROM ${cfg.table} WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'`
        );
        if (expiredRows.length > 0) {
          const ids = expiredRows.map(r => r.id);
          await deleteR2Objects(cfg, ids);
        }
      }
      const { rowCount } = await pool.query(
        `DELETE FROM ${cfg.table} WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '30 days'`
      );
      total += rowCount;
    }
    if (total > 0) console.log(`Auto-purge: permanently removed ${total} expired records`);
  } catch (err) {
    console.error("Auto-purge error:", err);
  }
}

router.autoPurgeExpired = autoPurgeExpired;

module.exports = router;
