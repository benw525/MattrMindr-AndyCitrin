const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { extractText } = require("../utils/extract-text");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  filename: row.filename,
  contentType: row.content_type,
  summary: row.summary || null,
  docType: row.doc_type,
  uploadedBy: row.uploaded_by,
  uploadedByName: row.uploaded_by_name,
  fileSize: row.file_size,
  createdAt: row.created_at,
});

async function verifyCaseAccess(req, caseId) {
  const userId = req.session.userId;
  const userRole = req.session.userRole || "";
  if (userRole === "App Admin") return true;
  const { rows } = await pool.query(
    "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR trial_coordinator = $4 OR investigator = $5 OR social_worker = $6 OR confidential = false OR confidential IS NULL)",
    [caseId, userId, userId, userId, userId, userId]
  );
  return rows.length > 0;
}

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, req.params.caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT id, case_id, filename, content_type, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at FROM case_documents WHERE case_id = $1 ORDER BY created_at DESC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Case documents fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { caseId, docType } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });

    const ct = req.file.mimetype;
    if (!ALLOWED_TYPES.includes(ct)) {
      return res.status(400).json({ error: "File type not supported. Upload PDF, DOCX, DOC, or TXT files." });
    }

    let extractedText = "";
    try {
      extractedText = await extractText(req.file.buffer, ct, req.file.originalname);
    } catch (extractErr) {
      console.error("Text extraction error:", extractErr);
    }

    const userName = req.session.userName || "";
    const { rows } = await pool.query(
      `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by, uploaded_by_name, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, case_id, filename, content_type, extracted_text, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at`,
      [caseId, req.file.originalname, ct, req.file.buffer, extractedText, docType || "Other", req.session.userId, userName, req.file.size]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Document upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

router.post("/:id/summarize", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT cd.*, c.title as case_title, c.defendant_name FROM case_documents cd JOIN cases c ON cd.case_id = c.id WHERE cd.id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Document not found" });
    const doc = rows[0];
    if (!(await verifyCaseAccess(req, doc.case_id))) return res.status(403).json({ error: "Access denied" });
    if (!doc.extracted_text) return res.status(400).json({ error: "No text could be extracted from this document" });

    const OpenAI = require("openai");
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const systemPrompt = `You are a criminal defense attorney's document analysis assistant. Summarize the uploaded document for a public defender reviewing a case. Focus on information relevant to criminal defense.

Provide a structured summary with these sections:
## Key Facts & Timeline
## People Mentioned (with roles — officers, witnesses, victims, co-defendants)
## Inconsistencies or Contradictions
## Defense-Relevant Details (Miranda issues, search/seizure concerns, chain of custody, witness credibility)
## Bottom Line

Be concise but thorough. Flag anything that could help the defense.`;

    const textSnippet = doc.extracted_text.substring(0, 12000);
    const userPrompt = `Summarize this ${doc.doc_type} for the case "${doc.case_title}" (Defendant: ${doc.defendant_name || "Unknown"}):\n\n${textSnippet}`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      store: false,
    });

    const summary = resp.choices[0].message.content;
    await pool.query("UPDATE case_documents SET summary = $1 WHERE id = $2", [summary, req.params.id]);
    return res.json({ summary });
  } catch (err) {
    console.error("Document summarize error:", err);
    return res.status(500).json({ error: "AI summarization failed" });
  }
});

router.get("/:id/download", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT filename, content_type, file_data, case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    if (!(await verifyCaseAccess(req, doc.case_id))) return res.status(403).json({ error: "Access denied" });
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    return res.send(doc.file_data);
  } catch (err) {
    console.error("Document download error:", err);
    return res.status(500).json({ error: "Download failed" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { rows: check } = await pool.query("SELECT case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (check.length === 0) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, check[0].case_id))) return res.status(403).json({ error: "Access denied" });

    const { filename, docType } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (filename !== undefined) { sets.push(`filename = $${idx++}`); vals.push(filename); }
    if (docType !== undefined) { sets.push(`doc_type = $${idx++}`); vals.push(docType); }

    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE case_documents SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id, case_id, filename, content_type, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at`,
      vals
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Document update error:", err);
    return res.status(500).json({ error: "Update failed" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    await pool.query("DELETE FROM case_documents WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Document delete error:", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

module.exports = router;
