const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const requireShareholder = (req, res, next) => {
  if (req.session.userRole !== "Shareholder") {
    return res.status(403).json({ error: "Shareholders only" });
  }
  next();
};

const toFrontend = (row) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  phone: row.phone || "",
  email: row.email || "",
  fax: row.fax || "",
  address: row.address || "",
  firm: row.firm || "",
  company: row.company || "",
  county: row.county || "",
  deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
});

router.get("/", requireAuth, async (req, res) => {
  try {
    if (req.query.deleted === "true") {
      const { rows } = await pool.query(
        "SELECT * FROM contacts WHERE deleted_at IS NOT NULL AND deleted_at > NOW() - INTERVAL '30 days' ORDER BY category, name"
      );
      return res.json(rows.map(toFrontend));
    }
    let sql = "SELECT * FROM contacts WHERE deleted_at IS NULL";
    const params = [];
    if (req.query.category) {
      params.push(req.query.category);
      sql += ` AND category = $${params.length}`;
    }
    sql += " ORDER BY name";
    const { rows } = await pool.query(sql, params);
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Contacts fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM contacts WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Contact fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (name, category, phone, email, fax, address, firm, company, county)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [d.name, d.category, d.phone || "", d.email || "", d.fax || "", d.address || "", d.firm || "", d.company || "", d.county || ""]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Contact create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const d = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET name=$1, category=$2, phone=$3, email=$4, fax=$5, address=$6, firm=$7, company=$8, county=$9
       WHERE id=$10 AND deleted_at IS NULL RETURNING *`,
      [d.name, d.category, d.phone || "", d.email || "", d.fax || "", d.address || "", d.firm || "", d.company || "", d.county || "", req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Contact update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE contacts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found or already deleted" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Contact delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/restore", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE contacts SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING *",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found or not deleted" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Contact restore error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/case-counts/batch", requireAuth, async (req, res) => {
  try {
    const expertCounts = await pool.query(
      `SELECT c.id AS contact_id, COUNT(DISTINCT ce.case_id) AS cnt
       FROM contacts c
       JOIN case_experts ce ON (ce.data->>'fullName' ILIKE c.name OR ce.data->>'contactId' = c.id::text)
       JOIN cases cs ON cs.id = ce.case_id AND cs.deleted_at IS NULL
       WHERE c.category = 'Expert' AND c.deleted_at IS NULL
       GROUP BY c.id`
    );
    const adjusterCounts = await pool.query(
      `SELECT c.id AS contact_id, COUNT(DISTINCT ci.case_id) AS cnt
       FROM contacts c
       JOIN case_insurance ci ON ci.data->>'adjusterName' ILIKE c.name
       JOIN cases cs ON cs.id = ci.case_id AND cs.deleted_at IS NULL
       WHERE c.category = 'Adjuster' AND c.deleted_at IS NULL
       GROUP BY c.id`
    );
    const miscCounts = await pool.query(
      `SELECT c.id AS contact_id, COUNT(DISTINCT mc.case_id) AS cnt
       FROM contacts c
       JOIN case_misc_contacts mc ON (mc.data->>'name' ILIKE c.name OR mc.data->>'contactId' = c.id::text)
       JOIN cases cs ON cs.id = mc.case_id AND cs.deleted_at IS NULL
       WHERE c.category = 'Miscellaneous' AND c.deleted_at IS NULL
       GROUP BY c.id`
    );
    const counts = {};
    [...expertCounts.rows, ...adjusterCounts.rows, ...miscCounts.rows].forEach(r => {
      counts[r.contact_id] = Number(r.cnt);
    });
    return res.json(counts);
  } catch (err) {
    console.error("Case counts error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id/associated-cases", requireAuth, async (req, res) => {
  try {
    const { rows: contactRows } = await pool.query("SELECT * FROM contacts WHERE id = $1", [req.params.id]);
    if (!contactRows.length) return res.status(404).json({ error: "Not found" });
    const contact = contactRows[0];
    let caseIds = [];
    if (contact.category === "Expert") {
      const { rows } = await pool.query(
        `SELECT DISTINCT ce.case_id FROM case_experts ce
         JOIN cases c ON c.id = ce.case_id AND c.deleted_at IS NULL
         WHERE ce.data->>'fullName' ILIKE $1 OR ce.data->>'contactId' = $2`,
        [contact.name, String(contact.id)]
      );
      caseIds = rows.map(r => r.case_id);
    } else if (contact.category === "Adjuster") {
      const { rows } = await pool.query(
        `SELECT DISTINCT ci.case_id FROM case_insurance ci
         JOIN cases c ON c.id = ci.case_id AND c.deleted_at IS NULL
         WHERE ci.data->>'adjusterName' ILIKE $1`,
        [contact.name]
      );
      caseIds = rows.map(r => r.case_id);
    } else if (contact.category === "Miscellaneous") {
      const { rows } = await pool.query(
        `SELECT DISTINCT mc.case_id FROM case_misc_contacts mc
         JOIN cases c ON c.id = mc.case_id AND c.deleted_at IS NULL
         WHERE mc.data->>'name' ILIKE $1 OR mc.data->>'contactId' = $2`,
        [contact.name, String(contact.id)]
      );
      caseIds = rows.map(r => r.case_id);
    } else {
      return res.json([]);
    }
    if (caseIds.length === 0) return res.json([]);
    const { rows: cases } = await pool.query(
      `SELECT id, case_num, title, status FROM cases WHERE id = ANY($1::int[]) AND deleted_at IS NULL ORDER BY case_num`,
      [caseIds]
    );
    return res.json(cases.map(c => ({ id: c.id, caseNum: c.case_num, title: c.title, status: c.status })));
  } catch (err) {
    console.error("Associated cases error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/merge", requireAuth, requireShareholder, async (req, res) => {
  const { primaryId, mergeIds, fields } = req.body;
  if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
    return res.status(400).json({ error: "primaryId and mergeIds[] required" });
  }
  if (!fields || !fields.name || !fields.category) {
    return res.status(400).json({ error: "fields.name and fields.category required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE contacts SET name=$1, category=$2, phone=$3, email=$4, fax=$5, address=$6, firm=$7, company=$8, county=$9
       WHERE id=$10 AND deleted_at IS NULL`,
      [fields.name, fields.category, fields.phone || "", fields.email || "",
       fields.fax || "", fields.address || "", fields.firm || "", fields.company || "", fields.county || "", primaryId]
    );

    // Move all notes from merged contacts to the primary
    if (mergeIds.length > 0) {
      await client.query(
        `UPDATE contact_notes SET contact_id = $1 WHERE contact_id = ANY($2::int[])`,
        [primaryId, mergeIds]
      );
      // Hard-delete the merged contacts
      await client.query(
        `DELETE FROM contacts WHERE id = ANY($1::int[])`,
        [mergeIds]
      );
    }

    const { rows } = await client.query("SELECT * FROM contacts WHERE id=$1", [primaryId]);
    await client.query("COMMIT");
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Contact merge error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

module.exports = router;
