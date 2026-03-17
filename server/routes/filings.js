const express = require("express");
const multer = require("multer");
const { randomUUID } = require("crypto");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isS3Configured, uploadToS3, downloadFromS3 } = require("../s3");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const pendingFilingChunks = new Map();

async function getFilingBuffer(row) {
  if (row.s3_key && isS3Configured()) {
    try {
      return await downloadFromS3(row.s3_key);
    } catch (err) {
      console.warn(`S3 filing download failed for key ${row.s3_key}: ${err.message}, falling back to BYTEA`);
      if (row.file_data) return row.file_data;
      return null;
    }
  }
  return row.file_data || null;
}

async function extractPdfText(buffer) {
  const pdfParse = require("pdf-parse");
  const data = await pdfParse(buffer);
  return data.text || "";
}

function verifyCaseAccessQuery(userId, userRole) {
  if (userRole === "App Admin") return null;
  return { text: "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR case_manager = $4 OR investigator = $5 OR paralegal = $6 OR confidential = false OR confidential IS NULL)", values: (caseId) => [caseId, userId, userId, userId, userId, userId] };
}

async function verifyCaseAccess(req, caseId) {
  const userRole = req.session.userRole || "";
  if (userRole === "App Admin") return true;
  const userId = req.session.userId;
  const { rows } = await pool.query(
    "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR case_manager = $4 OR investigator = $5 OR paralegal = $6 OR confidential = false OR confidential IS NULL)",
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
      "SELECT id, case_id, filename, original_filename, content_type, file_size, filed_by, filing_date, summary, doc_type, source, source_email_from, uploaded_by, uploaded_by_name, created_at FROM case_filings WHERE case_id = $1 AND deleted_at IS NULL ORDER BY filing_date DESC NULLS LAST, created_at DESC",
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
    let s3Key = null;
    if (isS3Configured()) {
      try {
        const { randomUUID } = require("crypto");
        s3Key = `filings/${randomUUID()}/${req.file.originalname}`;
        await uploadToS3(s3Key, req.file.buffer, req.file.mimetype);
      } catch (e) { throw new Error(`S3 upload failed: ${e.message}`); }
    }
    const { rows } = await pool.query(
      `INSERT INTO case_filings (case_id, filename, original_filename, content_type, file_data, extracted_text, file_size, filed_by, filing_date, doc_type, source, uploaded_by, uploaded_by_name, s3_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'upload', $11, $12, $13)
       RETURNING id, case_id, filename, original_filename, content_type, file_size, filed_by, filing_date, summary, doc_type, source, source_email_from, uploaded_by, uploaded_by_name, created_at`,
      [caseId, req.file.originalname, req.file.originalname, req.file.mimetype, s3Key ? null : req.file.buffer, extractedText, req.file.size, filedBy || "", filingDate || null, docType || "", req.session.userId, userName, s3Key]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Filing upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/:id/download", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT filename, content_type, file_data, case_id, s3_key FROM case_filings WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    if (!(await verifyCaseAccess(req, doc.case_id))) return res.status(403).json({ error: "Access denied" });
    const fileBuffer = await getFilingBuffer(doc);
    if (!fileBuffer) return res.status(404).json({ error: "File data not found" });
    const disposition = req.query.inline === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `${disposition}; filename="${doc.filename}"`);
    return res.send(fileBuffer);
  } catch (err) {
    console.error("Filing download error:", err);
    return res.status(500).json({ error: "Download failed" });
  }
});

router.post("/batch-delete", requireAuth, async (req, res) => {
  try {
    const attorneyRoles = ["Managing Partner", "Senior Partner", "Partner", "Associate Attorney", "Of Counsel", "App Admin"];
    const userRoles = req.session.userRoles || [req.session.userRole];
    if (!userRoles.some(r => attorneyRoles.includes(r))) return res.status(403).json({ error: "Only attorneys may delete filings" });
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No ids provided" });
    const { rows: filings } = await pool.query("SELECT id, case_id FROM case_filings WHERE id = ANY($1) AND deleted_at IS NULL", [ids]);
    const caseIds = [...new Set(filings.map(f => f.case_id))];
    for (const caseId of caseIds) {
      if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied to one or more cases" });
    }
    const validIds = filings.map(f => f.id);
    if (validIds.length === 0) return res.json({ ok: true, deleted: 0 });
    const { rowCount } = await pool.query("UPDATE case_filings SET deleted_at = NOW() WHERE id = ANY($1) AND deleted_at IS NULL", [validIds]);
    return res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error("Filing batch delete error:", err);
    return res.status(500).json({ error: "Batch delete failed" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const attorneyRoles = ["Managing Partner", "Senior Partner", "Partner", "Associate Attorney", "Of Counsel", "App Admin"];
    const userRoles = req.session.userRoles || [req.session.userRole];
    if (!userRoles.some(r => attorneyRoles.includes(r))) return res.status(403).json({ error: "Only attorneys may delete filings" });
    const { rows } = await pool.query("SELECT case_id FROM case_filings WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    await pool.query("UPDATE case_filings SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
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
      "SELECT cf.*, c.title as case_title, c.client_name FROM case_filings cf JOIN cases c ON cf.case_id = c.id WHERE cf.id = $1",
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

    const systemPrompt = `You are a personal injury attorney's court filing analysis assistant. Summarize the court filing for a PI attorney reviewing a case. Focus on information relevant to the plaintiff's personal injury claim.

Provide a structured summary with these sections:
## Filing Type & Purpose
## Key Arguments or Rulings
## Relief Requested or Granted
## Deadlines or Requirements Created
## Impact on PI Claim & Recommended Response

Be concise but thorough. Flag anything that requires immediate action by the plaintiff's counsel.`;

    const textSnippet = filing.extracted_text.substring(0, 12000);
    const userPrompt = `Summarize this court filing for the case "${filing.case_title}" (Client: ${filing.client_name || "Unknown"}):\n\nFiled by: ${filing.filed_by || "Unknown"}\nDocument type: ${filing.doc_type || "Unknown"}\n\n${textSnippet}`;

    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 4000,
      store: false,
    });

    const summary = resp.choices[0].message.content;
    await pool.query("UPDATE case_filings SET summary = $1 WHERE id = $2", [summary, req.params.id]);

    let createdDeadlines = [];
    try {
      const dateResp = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          { role: "system", content: `Extract any hearing dates, court dates, or scheduled appearances from this filing summary. Return ONLY valid JSON with a single field:\n- "hearingDates" (array of objects with "date" (YYYY-MM-DD) and "description" (string — e.g., "Motion Hearing", "Status Conference", "Mediation", "Deposition", "Trial Date"). Return empty array [] if none found.)` },
          { role: "user", content: summary },
        ],
        max_completion_tokens: 500,
        store: false,
        response_format: { type: "json_object" },
      });
      const parsed = JSON.parse(dateResp.choices[0].message.content);
      if (Array.isArray(parsed.hearingDates) && parsed.hearingDates.length > 0) {
        for (const hd of parsed.hearingDates) {
          if (!hd.date || !hd.description) continue;
          const { rows: existing } = await pool.query(
            `SELECT id FROM deadlines WHERE case_id = $1 AND date = $2 AND LOWER(title) = LOWER($3)`,
            [filing.case_id, hd.date, hd.description]
          );
          if (existing.length === 0) {
            const { rows: newDl } = await pool.query(
              `INSERT INTO deadlines (case_id, title, date, type, rule, assigned) VALUES ($1, $2, $3, 'Hearing', '', NULL) RETURNING *`,
              [filing.case_id, hd.description, hd.date]
            );
            createdDeadlines.push(newDl[0]);
            console.log(`Auto-created hearing deadline: "${hd.description}" on ${hd.date} for case ${filing.case_id}`);
          }
        }
      }
    } catch (hdErr) {
      console.error("Hearing date extraction error:", hdErr.message);
    }

    return res.json({ summary, createdDeadlines });
  } catch (err) {
    console.error("Filing summarize error:", err);
    return res.status(500).json({ error: "AI summarization failed" });
  }
});

router.post("/upload/init", requireAuth, express.json(), async (req, res) => {
  try {
    const { caseId, filename, fileSize, totalChunks, filedBy, filingDate, docType } = req.body;
    if (!caseId || !filename || !totalChunks) return res.status(400).json({ error: "Missing required fields" });
    if (fileSize > 100 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 100MB)" });
    if (totalChunks > 10) return res.status(400).json({ error: "Too many chunks" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });
    const uploadId = randomUUID();
    pendingFilingChunks.set(uploadId, {
      caseId, filename, fileSize, totalChunks,
      filedBy: filedBy || "", filingDate: filingDate || null, docType: docType || "",
      userId: req.session.userId,
      chunks: new Array(parseInt(totalChunks)).fill(null),
      received: 0, createdAt: Date.now(),
    });
    setTimeout(() => { pendingFilingChunks.delete(uploadId); }, 30 * 60 * 1000);
    res.json({ uploadId, totalChunks });
  } catch (err) {
    console.error("Filing chunk init error:", err.message);
    res.status(500).json({ error: "Failed to initialize upload" });
  }
});

router.post("/upload/chunk", requireAuth, upload.single("chunk"), async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    if (!uploadId || chunkIndex === undefined || !req.file) {
      return res.status(400).json({ error: "Missing uploadId, chunkIndex, or chunk data" });
    }
    const pending = pendingFilingChunks.get(uploadId);
    if (!pending) return res.status(404).json({ error: "Upload session not found or expired" });
    if (pending.userId !== req.session.userId) return res.status(403).json({ error: "Access denied" });
    const idx = parseInt(chunkIndex);
    if (idx < 0 || idx >= pending.totalChunks) return res.status(400).json({ error: "Invalid chunk index" });
    if (pending.chunks[idx] === null) pending.received++;
    pending.chunks[idx] = req.file.buffer;
    res.json({ received: pending.received, totalChunks: pending.totalChunks });
  } catch (err) {
    console.error("Filing chunk upload error:", err.message);
    res.status(500).json({ error: "Failed to upload chunk" });
  }
});

router.post("/upload/complete", requireAuth, express.json(), async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ error: "Missing uploadId" });
    const pending = pendingFilingChunks.get(uploadId);
    if (!pending) return res.status(404).json({ error: "Upload session not found or expired" });
    if (pending.userId !== req.session.userId) return res.status(403).json({ error: "Access denied" });
    const missing = pending.chunks.findIndex(c => c === null);
    if (missing !== -1) return res.status(400).json({ error: `Missing chunk ${missing}` });
    const fullBuffer = Buffer.concat(pending.chunks);
    pendingFilingChunks.delete(uploadId);
    let extractedText = "";
    try { extractedText = await extractPdfText(fullBuffer); } catch (e) { console.error("Filing chunk text extraction error:", e); }
    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [pending.userId]);
    const uploaderName = userRows.length ? userRows[0].name : "";
    let s3Key = null;
    if (isS3Configured()) {
      try {
        const { randomUUID } = require("crypto");
        s3Key = `filings/${randomUUID()}/${pending.filename}`;
        await uploadToS3(s3Key, fullBuffer, "application/pdf");
      } catch (e) { throw new Error(`S3 upload failed: ${e.message}`); }
    }
    const { rows } = await pool.query(
      `INSERT INTO case_filings (case_id, filename, original_filename, content_type, file_data, extracted_text, file_size, filed_by, filing_date, doc_type, source, uploaded_by, uploaded_by_name, s3_key)
       VALUES ($1, $2, $3, 'application/pdf', $4, $5, $6, $7, $8, $9, 'upload', $10, $11, $12)
       RETURNING id, case_id, filename, original_filename, content_type, file_size, filed_by, filing_date, summary, doc_type, source, source_email_from, uploaded_by, uploaded_by_name, created_at`,
      [pending.caseId, pending.filename, pending.filename, s3Key ? null : fullBuffer, extractedText, fullBuffer.length, pending.filedBy, pending.filingDate, pending.docType, pending.userId, uploaderName, s3Key]
    );
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Filing chunk complete error:", err.message);
    res.status(500).json({ error: "Failed to complete upload" });
  }
});

module.exports = router;
