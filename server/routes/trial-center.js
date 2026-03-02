const express = require("express");
const pool = require("../db");
const multer = require("multer");
const mammoth = require("mammoth");
const { requireAuth } = require("../middleware/auth");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const router = express.Router();

async function verifyCaseAccess(caseId, req) {
  const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
  if (!rows.length) return null;
  const row = rows[0];
  if (!row.confidential) return row;
  const roles = req.session.userRoles || [req.session.userRole];
  if (roles.includes("App Admin")) return row;
  const uid = req.session.userId;
  if ([row.lead_attorney, row.second_attorney, row.trial_coordinator, row.investigator, row.social_worker].includes(uid)) return row;
  const customTeam = Array.isArray(row.custom_team) ? row.custom_team : [];
  if (customTeam.some(m => m.userId === uid)) return row;
  return null;
}

router.post("/sessions", requireAuth, async (req, res) => {
  try {
    const { caseId, trialDate, court, judge, status, jurySize, notes } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });
    const caseRow = await verifyCaseAccess(caseId, req);
    if (!caseRow) return res.status(404).json({ error: "Case not found or access denied" });
    const existing = await pool.query("SELECT * FROM trial_sessions WHERE case_id = $1", [caseId]);
    if (existing.rows.length) return res.json(existing.rows[0]);
    const { rows } = await pool.query(
      `INSERT INTO trial_sessions (case_id, trial_date, court, judge, status, jury_size, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [caseId, trialDate || null, court || "", judge || "", status || "pending", jurySize || 12, notes || ""]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create trial session error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/sessions/:caseId", requireAuth, async (req, res) => {
  try {
    const caseRow = await verifyCaseAccess(req.params.caseId, req);
    if (!caseRow) return res.status(404).json({ error: "Case not found or access denied" });
    const { rows } = await pool.query("SELECT * FROM trial_sessions WHERE case_id = $1", [req.params.caseId]);
    if (!rows.length) return res.json(null);
    res.json(rows[0]);
  } catch (err) {
    console.error("Get trial session error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/sessions/:id", requireAuth, async (req, res) => {
  try {
    const { trialDate, court, judge, status, jurySize, notes } = req.body;
    const sess = await pool.query("SELECT * FROM trial_sessions WHERE id = $1", [req.params.id]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      `UPDATE trial_sessions SET trial_date=$1, court=$2, judge=$3, status=$4, jury_size=$5, notes=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [trialDate || null, court || "", judge || "", status || "pending", jurySize || 12, notes || "", req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Update trial session error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

function buildCrud(entityName, tableName, columns, fkField = "trial_session_id") {
  router.get(`/${entityName}/:sessionId`, requireAuth, async (req, res) => {
    try {
      const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [req.params.sessionId]);
      if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
      const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
      if (!caseRow) return res.status(403).json({ error: "Access denied" });
      const orderCol = columns.includes("sort_order") ? "sort_order ASC, " : columns.includes("call_order") ? "call_order ASC, " : "";
      const { rows } = await pool.query(
        `SELECT * FROM ${tableName} WHERE ${fkField} = $1 ORDER BY ${orderCol}created_at ASC`,
        [req.params.sessionId]
      );
      res.json(rows);
    } catch (err) {
      console.error(`Get ${entityName} error:`, err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post(`/${entityName}`, requireAuth, async (req, res) => {
    try {
      const sessionId = req.body.sessionId || req.body.trial_session_id;
      if (!sessionId) return res.status(400).json({ error: "sessionId required" });
      const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [sessionId]);
      if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
      const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
      if (!caseRow) return res.status(403).json({ error: "Access denied" });

      const cols = [fkField, ...columns];
      const vals = [sessionId, ...columns.map(c => req.body[c] !== undefined ? req.body[c] : (c === "created_by" ? req.session.userId : null))];
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(
        `INSERT INTO ${tableName} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
        vals
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      console.error(`Create ${entityName} error:`, err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.put(`/${entityName}/:id`, requireAuth, async (req, res) => {
    try {
      const existing = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [existing.rows[0][fkField]]);
      if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
      const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
      if (!caseRow) return res.status(403).json({ error: "Access denied" });

      const setClauses = columns.map((c, i) => `${c} = $${i + 1}`).join(", ");
      const vals = columns.map(c => req.body[c] !== undefined ? req.body[c] : existing.rows[0][c]);
      vals.push(req.params.id);
      const { rows } = await pool.query(
        `UPDATE ${tableName} SET ${setClauses} WHERE id = $${vals.length} RETURNING *`,
        vals
      );
      res.json(rows[0]);
    } catch (err) {
      console.error(`Update ${entityName} error:`, err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.delete(`/${entityName}/:id`, requireAuth, async (req, res) => {
    try {
      const existing = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: "Not found" });
      const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [existing.rows[0][fkField]]);
      if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
      const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
      if (!caseRow) return res.status(403).json({ error: "Access denied" });
      await pool.query(`DELETE FROM ${tableName} WHERE id = $1`, [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error(`Delete ${entityName} error:`, err);
      res.status(500).json({ error: "Server error" });
    }
  });
}

buildCrud("witnesses", "trial_witnesses", [
  "name", "type", "contact_info", "expected_testimony", "impeachment_notes", "call_order", "status"
]);

buildCrud("exhibits", "trial_exhibits", [
  "exhibit_number", "description", "type", "status", "linked_document_id", "notes"
]);

router.get("/exhibits-full/:sessionId", requireAuth, async (req, res) => {
  try {
    const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [req.params.sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      `SELECT e.*, d.filename AS document_name, d.content_type AS file_content_type
       FROM trial_exhibits e
       LEFT JOIN case_documents d ON d.id = e.linked_document_id
       WHERE e.trial_session_id = $1
       ORDER BY e.created_at ASC`,
      [req.params.sessionId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get exhibits-full error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

buildCrud("jurors", "trial_jurors", [
  "seat_number", "name", "notes", "strike_type", "is_selected", "demographics"
]);

buildCrud("motions", "trial_motions", [
  "title", "type", "status", "ruling_summary", "notes"
]);

buildCrud("outlines", "trial_outlines", [
  "type", "title", "content", "linked_witness_id", "sort_order"
]);

buildCrud("jury-instructions", "trial_jury_instructions", [
  "instruction_text", "status", "objection_notes", "source"
]);

buildCrud("timeline-events", "trial_timeline_events", [
  "event_date", "title", "description", "sort_order", "association"
]);

router.post("/demonstratives/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { sessionId, title, description, association } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    const file = req.file;
    const { rows } = await pool.query(
      `INSERT INTO trial_timeline_events (trial_session_id, title, description, association, file_data, file_name, file_type, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, trial_session_id, title, description, association, file_name, file_type, file_size, event_date, sort_order, created_at`,
      [sessionId, title || "", description || "", association || "general",
       file ? file.buffer : null, file ? file.originalname : "", file ? file.mimetype : "", file ? file.size : 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Demonstrative upload error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/demonstratives/:id/download", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM trial_timeline_events WHERE id = $1", [req.params.id]);
    if (!rows.length || !rows[0].file_data) return res.status(404).json({ error: "File not found" });
    const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [rows[0].trial_session_id]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    res.setHeader("Content-Type", rows[0].file_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(rows[0].file_name)}"`);
    res.send(rows[0].file_data);
  } catch (err) {
    console.error("Demonstrative download error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/exhibits/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { sessionId, exhibit_number, description, type, status, notes } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    let linkedDocId = null;
    let docName = "";
    if (req.file) {
      const docResult = await pool.query(
        `INSERT INTO case_documents (case_id, filename, content_type, file_size, file_data, uploaded_by, uploaded_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, filename`,
        [sess.rows[0].case_id, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.session.userId, req.session.userName || ""]
      );
      linkedDocId = docResult.rows[0].id;
      docName = docResult.rows[0].filename;
    }
    const { rows } = await pool.query(
      `INSERT INTO trial_exhibits (trial_session_id, exhibit_number, description, type, status, notes, linked_document_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [sessionId, exhibit_number || "", description || "", type || "physical", status || "pending", notes || "", linkedDocId]
    );
    rows[0].document_name = docName;
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Exhibit upload error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

buildCrud("pinned-docs", "trial_pinned_docs", [
  "case_document_id", "transcript_id", "label", "sort_order"
]);

router.get("/pinned-docs-full/:sessionId", requireAuth, async (req, res) => {
  try {
    const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [req.params.sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      `SELECT p.*,
              d.filename AS document_name, d.content_type AS file_type, d.summary AS document_summary, d.file_size AS document_size,
              t.filename AS transcript_name, t.content_type AS transcript_content_type, t.file_size AS transcript_size,
              t.status AS transcript_status, t.duration_seconds AS transcript_duration
       FROM trial_pinned_docs p
       LEFT JOIN case_documents d ON d.id = p.case_document_id
       LEFT JOIN case_transcripts t ON t.id = p.transcript_id
       WHERE p.trial_session_id = $1
       ORDER BY p.sort_order ASC, p.created_at ASC`,
      [req.params.sessionId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get pinned-docs-full error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

buildCrud("log-entries", "trial_log_entries", [
  "trial_day", "entry_time", "category", "content", "created_by"
]);

router.put("/witnesses/reorder/:sessionId", requireAuth, async (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: "order array required" });
    const sess = await pool.query("SELECT case_id FROM trial_sessions WHERE id = $1", [req.params.sessionId]);
    if (!sess.rows.length) return res.status(404).json({ error: "Session not found" });
    const caseRow = await verifyCaseAccess(sess.rows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < order.length; i++) {
        await client.query("UPDATE trial_witnesses SET call_order = $1 WHERE id = $2 AND trial_session_id = $3", [i + 1, order[i], req.params.sessionId]);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    const { rows } = await pool.query("SELECT * FROM trial_witnesses WHERE trial_session_id = $1 ORDER BY call_order ASC", [req.params.sessionId]);
    res.json(rows);
  } catch (err) {
    console.error("Reorder witnesses error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/witnesses/:witnessId/documents", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT wd.*,
              d.filename AS document_name, d.content_type AS document_content_type, d.file_size AS document_size,
              t.filename AS transcript_name, t.content_type AS transcript_content_type, t.file_size AS transcript_size, t.status AS transcript_status
       FROM trial_witness_documents wd
       LEFT JOIN case_documents d ON d.id = wd.case_document_id
       LEFT JOIN case_transcripts t ON t.id = wd.transcript_id
       WHERE wd.trial_witness_id = $1
       ORDER BY wd.created_at ASC`,
      [req.params.witnessId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get witness documents error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/witnesses/:witnessId/documents", requireAuth, async (req, res) => {
  try {
    const { case_document_id, transcript_id, label } = req.body;
    if (!case_document_id && !transcript_id) return res.status(400).json({ error: "case_document_id or transcript_id required" });
    const { rows } = await pool.query(
      `INSERT INTO trial_witness_documents (trial_witness_id, case_document_id, transcript_id, label)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.witnessId, case_document_id || null, transcript_id || null, label || ""]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Link witness document error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/witness-documents/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM trial_witness_documents WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Unlink witness document error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/witness-prep/export", requireAuth, async (req, res) => {
  try {
    const { witnessName, caseName, caseNumber, content } = req.body;
    if (!content) return res.status(400).json({ error: "content required" });

    const PizZip = require("pizzip");
    const Docxtemplater = require("docxtemplater");
    const fs = require("fs");
    const path = require("path");

    const templatePath = path.join(__dirname, "../system-templates/case-header.docx");
    let docBuffer;

    if (fs.existsSync(templatePath)) {
      const templateBuf = fs.readFileSync(templatePath);
      const zip = new PizZip(templateBuf);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
      doc.render({
        case_title: caseName || "",
        case_number: caseNumber || "",
        defendant_name: "",
        court: "",
        judge: "",
      });
      docBuffer = doc.getZip().generate({ type: "nodebuffer" });
    }

    const minimalDocx = () => {
      const zip = new PizZip();
      const lines = (content || "").split("\n");
      let bodyXml = "";
      const title = `Witness Preparation — ${witnessName || "Unknown"}`;
      const subtitle = caseName ? `${caseName}${caseNumber ? ` (${caseNumber})` : ""}` : "";

      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${escapeXml(title)}</w:t></w:r></w:p>`;
      if (subtitle) {
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>${escapeXml(subtitle)}</w:t></w:r></w:p>`;
      }
      bodyXml += `<w:p><w:r><w:t></w:t></w:r></w:p>`;

      for (const line of lines) {
        const trimmed = line.trim();
        const isMarkdownHeading = trimmed.startsWith("# ") || trimmed.startsWith("## ") || trimmed.startsWith("### ");
        const isAllCapsHeading = trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 80 && /[A-Z]/.test(trimmed);
        if (isMarkdownHeading || isAllCapsHeading) {
          const level = isMarkdownHeading ? (trimmed.startsWith("### ") ? "Heading3" : trimmed.startsWith("## ") ? "Heading2" : "Heading1") : "Heading2";
          const text = isMarkdownHeading ? trimmed.replace(/^#{1,3}\s*/, "").replace(/\*\*/g, "") : trimmed;
          bodyXml += `<w:p><w:pPr><w:pStyle w:val="${level}"/></w:pPr><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
        } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const text = trimmed.replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
          bodyXml += `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
        } else if (trimmed.match(/^\d+\.\s/)) {
          const text = trimmed.replace(/^\d+\.\s*/, "").replace(/\*\*/g, "");
          bodyXml += `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
        } else if (trimmed === "") {
          bodyXml += `<w:p><w:r><w:t></w:t></w:r></w:p>`;
        } else {
          const text = trimmed.replace(/\*\*/g, "");
          bodyXml += `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
        }
      }

      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml">
  <w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;

      zip.file("word/document.xml", documentXml);
      zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
      zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
      zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`);
      return zip.generate({ type: "nodebuffer" });
    };

    const buf = minimalDocx();
    const filename = `Witness_Prep_${(witnessName || "Unknown").replace(/[^a-zA-Z0-9]/g, "_")}.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (err) {
    console.error("Witness prep export error:", err);
    res.status(500).json({ error: "Export failed" });
  }
});

function escapeXml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

router.post("/outlines/ai-assist", requireAuth, upload.single("file"), async (req, res) => {
  try {
    let extractedText = "";
    if (req.file) {
      if (req.file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        extractedText = result.value || "";
      } else if (req.file.mimetype === "text/plain") {
        extractedText = req.file.buffer.toString("utf-8");
      }
    }
    res.json({ extractedText });
  } catch (err) {
    console.error("Outline AI assist file extract error:", err);
    res.status(500).json({ error: "File extraction failed" });
  }
});

module.exports = router;
