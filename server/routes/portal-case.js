const express = require("express");
const router = express.Router();
const multer = require("multer");
const pool = require("../db");
const { requireClientAuth } = require("../middleware/clientAuth");
const { extractText } = require("../utils/extract-text");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const PI_STAGES = [
  "Intake",
  "Investigation",
  "Treatment",
  "Pre-Litigation Demand",
  "Negotiation",
  "Suit Filed",
  "Discovery",
  "Mediation",
  "Trial Preparation",
  "Trial",
  "Settlement/Verdict",
  "Closed",
];

const CLIENT_FRIENDLY_STAGES = [
  { key: "Intake", label: "Case Opened" },
  { key: "Investigation", label: "Investigation" },
  { key: "Treatment", label: "Medical Treatment" },
  { key: "Pre-Litigation Demand", label: "Demand Sent" },
  { key: "Negotiation", label: "Negotiation" },
  { key: "Suit Filed", label: "Lawsuit Filed" },
  { key: "Discovery", label: "Discovery" },
  { key: "Mediation", label: "Mediation" },
  { key: "Trial Preparation", label: "Trial Preparation" },
  { key: "Trial", label: "Trial" },
  { key: "Settlement/Verdict", label: "Resolution" },
  { key: "Closed", label: "Case Closed" },
];

router.get("/", requireClientAuth, async (req, res) => {
  try {
    const caseId = req.session.clientCaseId;
    const { rows: settingsRows } = await pool.query(
      "SELECT * FROM client_portal_settings WHERE case_id = $1",
      [caseId]
    );
    const settings = settingsRows[0] || {};

    const { rows: caseRows } = await pool.query(
      `SELECT id, title, client_name, case_type, stage, status,
              accident_date, next_court_date, trial_date, mediation_date,
              case_value_estimate, lead_attorney, case_manager, paralegal, state_jurisdiction
       FROM cases WHERE id = $1`,
      [caseId]
    );
    if (caseRows.length === 0) return res.status(404).json({ error: "Case not found" });
    const c = caseRows[0];

    let attorneyName = null;
    if (settings.show_attorney_name !== false && c.lead_attorney) {
      const { rows: attRows } = await pool.query("SELECT name FROM users WHERE id = $1", [c.lead_attorney]);
      if (attRows.length) attorneyName = attRows[0].name;
    }

    const litigationStages = ["Suit Filed", "Discovery", "Mediation", "Trial Preparation", "Trial"];
    const isLitigation = litigationStages.includes(c.stage);

    let caseManagerName = null;
    if (!isLitigation && c.case_manager) {
      const { rows: cmRows } = await pool.query("SELECT name FROM users WHERE id = $1", [c.case_manager]);
      if (cmRows.length) caseManagerName = cmRows[0].name;
    }

    let paralegalName = null;
    if (isLitigation && c.paralegal) {
      const { rows: plRows } = await pool.query("SELECT name FROM users WHERE id = $1", [c.paralegal]);
      if (plRows.length) paralegalName = plRows[0].name;
    }

    const stageIndex = PI_STAGES.indexOf(c.stage);
    const timeline = CLIENT_FRIENDLY_STAGES.map((s, i) => ({
      label: s.label,
      status: i < stageIndex ? "completed" : i === stageIndex ? "current" : "upcoming",
    }));

    const result = {
      id: c.id,
      title: c.title,
      clientName: c.client_name,
      statusMessage: settings.status_message || "",
      timeline,
      currentStage: CLIENT_FRIENDLY_STAGES[stageIndex]?.label || c.stage,
    };

    if (settings.show_stage !== false) result.stage = c.stage;
    if (settings.show_case_type !== false) result.caseType = c.case_type;
    if (settings.show_accident_date) result.accidentDate = c.accident_date;
    if (settings.show_next_court_date) {
      result.nextCourtDate = c.next_court_date;
      result.trialDate = c.trial_date;
      result.mediationDate = c.mediation_date;
    }
    if (settings.show_case_value) result.caseValueEstimate = c.case_value_estimate;
    if (settings.show_attorney_name !== false) {
      result.attorneyName = attorneyName;
      result.caseManagerName = caseManagerName;
      result.paralegalName = paralegalName;
    }

    result.showDocuments = settings.show_documents !== false;
    result.showMessaging = settings.show_messaging !== false;
    result.showMedicalTreatments = !!settings.show_medical_treatments;
    result.showNegotiations = !!settings.show_negotiations;

    res.json(result);
  } catch (err) {
    console.error("Portal case error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/messages", requireClientAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, sender_type, sender_name, body, read_at, created_at FROM client_messages WHERE case_id = $1 ORDER BY created_at ASC",
      [req.session.clientCaseId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Portal messages error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/messages", requireClientAuth, async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
  try {
    const { rows: clientRows } = await pool.query("SELECT name FROM client_users WHERE id = $1", [req.session.clientId]);
    const senderName = clientRows[0]?.name || "Client";
    const { rows } = await pool.query(
      `INSERT INTO client_messages (case_id, sender_type, sender_id, sender_name, body)
       VALUES ($1, 'client', $2, $3, $4) RETURNING *`,
      [req.session.clientCaseId, req.session.clientId, senderName, body.trim()]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Portal send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/documents", requireClientAuth, async (req, res) => {
  try {
    const caseId = req.session.clientCaseId;
    const { rows: settingsRows } = await pool.query(
      "SELECT show_documents FROM client_portal_settings WHERE case_id = $1",
      [caseId]
    );
    const showFirmDocs = settingsRows[0]?.show_documents !== false;

    let query, params;
    if (showFirmDocs) {
      query = `SELECT id, filename, content_type, doc_type, file_size, source, uploaded_by_name, created_at
               FROM case_documents WHERE case_id = $1 ORDER BY source DESC, created_at DESC`;
      params = [caseId];
    } else {
      query = `SELECT id, filename, content_type, doc_type, file_size, source, uploaded_by_name, created_at
               FROM case_documents WHERE case_id = $1 AND source = 'client' ORDER BY created_at DESC`;
      params = [caseId];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Portal documents error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const ALLOWED_CLIENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];

router.post("/documents/upload", requireClientAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (!ALLOWED_CLIENT_TYPES.includes(req.file.mimetype)) {
    return res.status(400).json({ error: "File type not allowed. Accepted: PDF, DOCX, DOC, TXT, JPG, PNG" });
  }
  try {
    const caseId = req.session.clientCaseId;
    const { rows: clientRows } = await pool.query("SELECT name FROM client_users WHERE id = $1", [req.session.clientId]);
    const uploaderName = clientRows[0]?.name || "Client";

    let extractedText = "";
    try {
      extractedText = await extractText(req.file.buffer, req.file.mimetype, req.file.originalname) || "";
    } catch (_) {}

    const { rows } = await pool.query(
      `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by, uploaded_by_name, file_size, source)
       VALUES ($1, $2, $3, $4, $5, 'Client Upload', $6, $7, $8, 'client') RETURNING id, filename, doc_type, file_size, source, created_at`,
      [caseId, req.file.originalname, req.file.mimetype, req.file.buffer, extractedText, req.session.clientId, uploaderName, req.file.size]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Portal upload error:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

router.get("/documents/:id/download", requireClientAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT file_data, content_type, filename FROM case_documents WHERE id = $1 AND case_id = $2",
      [req.params.id, req.session.clientCaseId]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Document not found" });
    res.set("Content-Type", rows[0].content_type);
    res.set("Content-Disposition", `attachment; filename="${rows[0].filename}"`);
    res.send(rows[0].file_data);
  } catch (err) {
    console.error("Portal download error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/treatments", requireClientAuth, async (req, res) => {
  try {
    const caseId = req.session.clientCaseId;
    const { rows: settingsRows } = await pool.query(
      "SELECT show_medical_treatments FROM client_portal_settings WHERE case_id = $1",
      [caseId]
    );
    if (!settingsRows[0]?.show_medical_treatments) {
      return res.json([]);
    }
    const { rows } = await pool.query(
      `SELECT id, provider_name, provider_type, first_visit_date, last_visit_date, still_treating, description
       FROM case_medical_treatments WHERE case_id = $1 AND deleted_at IS NULL ORDER BY first_visit_date DESC NULLS LAST, created_at DESC`,
      [caseId]
    );
    res.json(rows.map(r => ({
      id: r.id,
      providerName: r.provider_name,
      providerType: r.provider_type,
      firstVisitDate: r.first_visit_date,
      lastVisitDate: r.last_visit_date,
      stillTreating: r.still_treating,
      description: r.description,
    })));
  } catch (err) {
    console.error("Portal treatments error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
