const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function extractPdfText(buffer) {
  const pdfParse = require("pdf-parse");
  const data = await pdfParse(buffer);
  return data.text || "";
}

function verifyCaseAccessQuery(userId, userRole) {
  if (userRole === "App Admin") return null;
  return { text: "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR trial_coordinator = $4 OR investigator = $5 OR social_worker = $6 OR confidential = false OR confidential IS NULL)", values: (caseId) => [caseId, userId, userId, userId, userId, userId] };
}

async function verifyCaseAccess(req, caseId) {
  const userRole = req.session.userRole || "";
  if (userRole === "App Admin") return true;
  const userId = req.session.userId;
  const { rows } = await pool.query(
    "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR trial_coordinator = $4 OR investigator = $5 OR social_worker = $6 OR confidential = false OR confidential IS NULL)",
    [caseId, userId, userId, userId, userId, userId]
  );
  return rows.length > 0;
}

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  filename: row.filename,
  originalFilename: row.original_filename,
  contentType: row.content_type,
  fileSize: row.file_size,
  filedBy: row.filed_by,
  filingDate: row.filing_date,
  summary: row.summary || null,
  docType: row.doc_type,
  source: row.source,
  sourceEmailFrom: row.source_email_from,
  uploadedBy: row.uploaded_by,
  uploadedByName: row.uploaded_by_name,
  createdAt: row.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, req.params.caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT id, case_id, filename, original_filename, content_type, file_size, filed_by, filing_date, summary, doc_type, source, source_email_from, uploaded_by, uploaded_by_name, created_at FROM case_filings WHERE case_id = $1 ORDER BY created_at DESC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Filings fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { caseId, filedBy, filingDate, docType } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });

    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Only PDF files are accepted for filings." });
    }

    let extractedText = "";
    try {
      extractedText = await extractPdfText(req.file.buffer);
    } catch (extractErr) {
      console.error("PDF text extraction error:", extractErr);
    }

    const userName = req.session.userName || "";
    const { rows } = await pool.query(
      `INSERT INTO case_filings (case_id, filename, original_filename, content_type, file_data, extracted_text, file_size, filed_by, filing_date, doc_type, source, uploaded_by, uploaded_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'upload', $11, $12)
       RETURNING id, case_id, filename, original_filename, content_type, file_size, filed_by, filing_date, summary, doc_type, source, source_email_from, uploaded_by, uploaded_by_name, created_at`,
      [caseId, req.file.originalname, req.file.originalname, req.file.mimetype, req.file.buffer, extractedText, req.file.size, filedBy || "", filingDate || null, docType || "", req.session.userId, userName]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Filing upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/:id/download", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT filename, content_type, file_data, case_id FROM case_filings WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    if (!(await verifyCaseAccess(req, doc.case_id))) return res.status(403).json({ error: "Access denied" });
    const disposition = req.query.inline === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `${disposition}; filename="${doc.filename}"`);
    return res.send(doc.file_data);
  } catch (err) {
    console.error("Filing download error:", err);
    return res.status(500).json({ error: "Download failed" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const attorneyRoles = ["Public Defender", "Chief Deputy Public Defender", "Deputy Public Defender", "Senior Trial Attorney", "Trial Attorney", "App Admin"];
    const userRoles = req.session.userRoles || [req.session.userRole];
    if (!userRoles.some(r => attorneyRoles.includes(r))) return res.status(403).json({ error: "Only attorneys may delete filings" });
    const { rows } = await pool.query("SELECT case_id FROM case_filings WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    await pool.query("DELETE FROM case_filings WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Filing delete error:", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { rows: check } = await pool.query("SELECT case_id FROM case_filings WHERE id = $1", [req.params.id]);
    if (check.length === 0) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, check[0].case_id))) return res.status(403).json({ error: "Access denied" });

    const { filename, filedBy, filingDate, docType } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (filename !== undefined) { sets.push(`filename = $${idx++}`); vals.push(filename); }
    if (filedBy !== undefined) { sets.push(`filed_by = $${idx++}`); vals.push(filedBy); }
    if (filingDate !== undefined) { sets.push(`filing_date = $${idx++}`); vals.push(filingDate || null); }
    if (docType !== undefined) { sets.push(`doc_type = $${idx++}`); vals.push(docType); }

    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE case_filings SET ${sets.join(", ")} WHERE id = $${idx} RETURNING id, case_id, filename, original_filename, content_type, file_size, filed_by, filing_date, summary, doc_type, source, source_email_from, uploaded_by, uploaded_by_name, created_at`,
      vals
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Filing update error:", err);
    return res.status(500).json({ error: "Update failed" });
  }
});

router.post("/:id/summarize", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT cf.*, c.title as case_title, c.defendant_name FROM case_filings cf JOIN cases c ON cf.case_id = c.id WHERE cf.id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Filing not found" });
    const filing = rows[0];
    if (!(await verifyCaseAccess(req, filing.case_id))) return res.status(403).json({ error: "Access denied" });
    if (!filing.extracted_text) return res.status(400).json({ error: "No text could be extracted from this filing" });

    const OpenAI = require("openai");
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const systemPrompt = `You are a criminal defense attorney's court filing analysis assistant. Summarize the court filing for a public defender reviewing a case. Focus on information relevant to criminal defense.

Provide a structured summary with these sections:
## Filing Type & Purpose
## Key Arguments or Rulings
## Relief Requested or Granted
## Deadlines or Requirements Created
## Defense Impact & Recommended Response

Be concise but thorough. Flag anything that requires immediate action by the defense.`;

    const textSnippet = filing.extracted_text.substring(0, 12000);
    const userPrompt = `Summarize this court filing for the case "${filing.case_title}" (Defendant: ${filing.defendant_name || "Unknown"}):\n\nFiled by: ${filing.filed_by || "Unknown"}\nDocument type: ${filing.doc_type || "Unknown"}\n\n${textSnippet}`;

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
    await pool.query("UPDATE case_filings SET summary = $1 WHERE id = $2", [summary, req.params.id]);
    return res.json({ summary });
  } catch (err) {
    console.error("Filing summarize error:", err);
    return res.status(500).json({ error: "AI summarization failed" });
  }
});

module.exports = router;
