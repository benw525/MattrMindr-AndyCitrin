const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (r) => ({
  id: r.id,
  caseId: r.case_id,
  isPdCase: r.is_pd_case,
  linkedCaseId: r.linked_case_id,
  externalCaseNumber: r.external_case_number,
  externalCaseStyle: r.external_case_style,
  externalCourt: r.external_court,
  externalCounty: r.external_county,
  externalCharges: r.external_charges,
  externalAttorney: r.external_attorney,
  externalStatus: r.external_status,
  externalNotes: r.external_notes,
  relationship: r.relationship,
  addedBy: r.added_by,
  addedAt: r.added_at,
  linkedCaseNum: r.linked_case_num || null,
  linkedCaseTitle: r.linked_case_title || null,
  linkedDefendant: r.linked_defendant || null,
  linkedCharges: r.linked_charges || null,
  linkedStatus: r.linked_status || null,
  linkedStage: r.linked_stage || null,
  linkedCourt: r.linked_court || null,
  linkedCounty: r.linked_county || null,
  linkedAttorney: r.linked_attorney || null,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT lc.*,
              c.case_num AS linked_case_num,
              c.title AS linked_case_title,
              c.defendant_name AS linked_defendant,
              c.charges AS linked_charges,
              c.status AS linked_status,
              c.stage AS linked_stage,
              c.court AS linked_court,
              c.county AS linked_county,
              c.lead_attorney AS linked_attorney
       FROM linked_cases lc
       LEFT JOIN cases c ON lc.linked_case_id = c.id
       WHERE lc.case_id = $1
       ORDER BY lc.added_at DESC`,
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Get linked cases error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { caseId, isPdCase, linkedCaseId, externalCaseNumber, externalCaseStyle, externalCourt, externalCounty, externalCharges, externalAttorney, externalStatus, externalNotes, relationship } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    const { rows } = await pool.query(
      `INSERT INTO linked_cases (case_id, is_pd_case, linked_case_id, external_case_number, external_case_style, external_court, external_county, external_charges, external_attorney, external_status, external_notes, relationship, added_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [caseId, isPdCase || false, linkedCaseId || null, externalCaseNumber || '', externalCaseStyle || '', externalCourt || '', externalCounty || 'Mobile', externalCharges || '', externalAttorney || '', externalStatus || '', externalNotes || '', relationship || '', req.session.userName || '']
    );

    if (rows[0].linked_case_id) {
      const { rows: caseRows } = await pool.query(
        "SELECT case_num, title, defendant_name, charges, status, stage, court, county, assigned_attorney FROM cases WHERE id = $1",
        [rows[0].linked_case_id]
      );
      if (caseRows.length) {
        const c = caseRows[0];
        rows[0].linked_case_num = c.case_num;
        rows[0].linked_case_title = c.title;
        rows[0].linked_defendant = c.defendant_name;
        rows[0].linked_charges = c.charges;
        rows[0].linked_status = c.status;
        rows[0].linked_stage = c.stage;
        rows[0].linked_court = c.court;
        rows[0].linked_county = c.county;
        rows[0].linked_attorney = c.assigned_attorney;
      }
    }

    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Create linked case error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM linked_cases WHERE id = $1",
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Linked case not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete linked case error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
