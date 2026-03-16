const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { extractText } = require("../utils/extract-text");
const { isR2Configured, uploadToR2, downloadFromR2, deleteFromR2 } = require("../r2");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

async function getDocBuffer(doc) {
  if (doc.s3_key && isR2Configured()) {
    return downloadFromR2(doc.s3_key);
  }
  return doc.file_data || null;
}

const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];

const { randomUUID } = require("crypto");

const ATTORNEY_ROLES = ["Managing Partner", "Senior Partner", "Partner", "Associate Attorney", "Of Counsel", "App Admin"];
const pendingDocChunks = new Map();

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
  folderId: row.folder_id || null,
  sortOrder: row.sort_order || 0,
  ocrStatus: row.ocr_status || "complete",
  hasText: !!(row.extracted_text && row.extracted_text.trim().length > 0),
});

async function verifyCaseAccess(req, caseId) {
  const userId = req.session.userId;
  const userRole = req.session.userRole || "";
  if (userRole === "App Admin") return true;
  const { rows } = await pool.query(
    "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR case_manager = $4 OR investigator = $5 OR paralegal = $6 OR confidential = false OR confidential IS NULL)",
    [caseId, userId, userId, userId, userId, userId]
  );
  return rows.length > 0;
}

router.get("/:caseId/folders", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, req.params.caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT * FROM document_folders WHERE case_id = $1 ORDER BY sort_order, created_at",
      [req.params.caseId]
    );
    return res.json(rows);
  } catch (err) {
    console.error("Document folders fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/reorder-folders", requireAuth, async (req, res) => {
  try {
    const { folders } = req.body;
    if (!Array.isArray(folders)) return res.status(400).json({ error: "folders array required" });
    for (const f of folders) {
      await pool.query("UPDATE document_folders SET sort_order = $1 WHERE id = $2", [f.sortOrder, f.id]);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Reorder document folders error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, req.params.caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT id, case_id, filename, content_type, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at, folder_id, sort_order, ocr_status, CASE WHEN extracted_text IS NOT NULL AND LENGTH(TRIM(extracted_text)) > 0 THEN extracted_text ELSE NULL END as extracted_text FROM case_documents WHERE case_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at DESC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Case documents fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

function needsOcr(contentType) {
  return contentType === "application/pdf";
}

async function runOcrBackground(docId, buffer, contentType, filename) {
  try {
    console.log(`Background OCR started for doc ${docId}: "${filename}"`);
    const extractedText = await extractText(buffer, contentType, filename);
    const ocrStatus = (extractedText && extractedText.trim().length > 0) ? "complete" : "failed";
    await pool.query(
      "UPDATE case_documents SET extracted_text = $1, ocr_status = $2 WHERE id = $3",
      [extractedText || "", ocrStatus, docId]
    );
    console.log(`Background OCR ${ocrStatus} for doc ${docId}: "${filename}" (${(extractedText || "").length} chars)`);
  } catch (err) {
    console.error(`Background OCR error for doc ${docId}:`, err.message);
    await pool.query("UPDATE case_documents SET ocr_status = 'failed' WHERE id = $1", [docId]).catch(() => {});
  }
}

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { caseId, docType, folderId } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });

    const ct = req.file.mimetype;
    if (!ALLOWED_TYPES.includes(ct)) {
      return res.status(400).json({ error: "File type not supported. Upload PDF, DOCX, DOC, or TXT files." });
    }

    const userName = req.session.userName || "";
    let folderVal = null;
    if (folderId) {
      folderVal = parseInt(folderId);
      if (isNaN(folderVal)) return res.status(400).json({ error: "Invalid folderId" });
      const { rows: folderRows } = await pool.query("SELECT id FROM document_folders WHERE id = $1 AND case_id = $2", [folderVal, caseId]);
      if (!folderRows.length) return res.status(400).json({ error: "Folder not found for this case" });
    }

    let s3Key = null;
    if (isR2Configured()) {
      try {
        const { randomUUID } = require("crypto");
        s3Key = `documents/${randomUUID()}/${req.file.originalname}`;
        await uploadToR2(s3Key, req.file.buffer, ct);
      } catch (e) { console.error("S3 pre-upload failed, using BYTEA:", e.message); s3Key = null; }
    }

    if (needsOcr(ct)) {
      const { rows } = await pool.query(
        `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by, uploaded_by_name, file_size, ocr_status, folder_id, s3_key)
         VALUES ($1, $2, $3, $4, '', $5, $6, $7, $8, 'processing', $9, $10) RETURNING id, case_id, filename, content_type, extracted_text, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at, folder_id, sort_order, ocr_status`,
        [caseId, req.file.originalname, ct, s3Key ? null : req.file.buffer, docType || "Other", req.session.userId, userName, req.file.size, folderVal, s3Key]
      );
      runOcrBackground(rows[0].id, req.file.buffer, ct, req.file.originalname);
      return res.status(201).json(toFrontend(rows[0]));
    }

    let extractedText = "";
    try {
      extractedText = await extractText(req.file.buffer, ct, req.file.originalname);
    } catch (extractErr) {
      console.error("Text extraction error:", extractErr);
    }

    const ocrStatus = (extractedText && extractedText.trim().length > 0) ? "complete" : "failed";
    const { rows } = await pool.query(
      `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by, uploaded_by_name, file_size, ocr_status, folder_id, s3_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, case_id, filename, content_type, extracted_text, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at, folder_id, sort_order, ocr_status`,
      [caseId, req.file.originalname, ct, s3Key ? null : req.file.buffer, extractedText, docType || "Other", req.session.userId, userName, req.file.size, ocrStatus, folderVal, s3Key]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Document upload error:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/:id/text", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT cd.extracted_text, cd.case_id, cd.file_data, cd.content_type, cd.filename, cd.s3_key FROM case_documents cd WHERE cd.id = $1", [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Document not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const doc = rows[0];
    if (doc.extracted_text) {
      return res.json({ text: doc.extracted_text });
    }
    const fileBuffer = await getDocBuffer(doc);
    if (fileBuffer) {
      try {
        const liveText = await extractText(fileBuffer, doc.content_type, doc.filename);
        if (liveText) {
          pool.query("UPDATE case_documents SET extracted_text = $1 WHERE id = $2", [liveText, req.params.id]).catch(() => {});
          return res.json({ text: liveText });
        }
      } catch (extractErr) {
        console.error("Live text extraction error:", extractErr);
      }
    }
    return res.json({ text: "" });
  } catch (err) {
    console.error("Get document text error:", err);
    return res.status(500).json({ error: "Failed to get document text" });
  }
});

router.get("/:id/ocr-status", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT case_id, ocr_status, CASE WHEN extracted_text IS NOT NULL AND LENGTH(TRIM(extracted_text)) > 0 THEN true ELSE false END as has_text FROM case_documents WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    return res.json({ ocrStatus: rows[0].ocr_status || "complete", hasText: rows[0].has_text });
  } catch (err) {
    console.error("OCR status check error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/re-extract", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT cd.case_id, cd.file_data, cd.content_type, cd.filename, cd.s3_key FROM case_documents cd WHERE cd.id = $1", [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Document not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const doc = rows[0];
    const fileBuffer = await getDocBuffer(doc);
    if (!fileBuffer) return res.status(400).json({ error: "No file data available for re-extraction" });
    const newText = await extractText(fileBuffer, doc.content_type, doc.filename);
    const newStatus = (newText && newText.trim().length > 0) ? "complete" : "failed";
    await pool.query("UPDATE case_documents SET extracted_text = $1, ocr_status = $2 WHERE id = $3", [newText || "", newStatus, req.params.id]);
    return res.json({ text: newText || "", length: (newText || "").length, ocrStatus: newStatus, hasText: newStatus === "complete" });
  } catch (err) {
    console.error("Re-extract text error:", err);
    return res.status(500).json({ error: "Failed to re-extract text" });
  }
});

router.post("/:id/summarize", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT cd.*, c.title as case_title, c.client_name FROM case_documents cd JOIN cases c ON cd.case_id = c.id WHERE cd.id = $1",
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

    const systemPrompt = `You are a personal injury attorney's document analysis assistant. Summarize the uploaded document for a PI attorney reviewing a case. Focus on information relevant to the plaintiff's personal injury claim.

Provide a structured summary with these sections:
## Key Facts & Timeline
## People Mentioned (with roles — parties, witnesses, medical providers, insurers, experts)
## Injuries & Medical Findings
## Liability & Damages Details (fault indicators, comparative negligence, medical causation, treatment gaps)
## Bottom Line

Be concise but thorough. Flag anything that could help the plaintiff's case.`;

    const textSnippet = doc.extracted_text.substring(0, 12000);
    const userPrompt = `Summarize this ${doc.doc_type} for the case "${doc.case_title}" (Client: ${doc.client_name || "Unknown"}):\n\n${textSnippet}`;

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
    await pool.query("UPDATE case_documents SET summary = $1 WHERE id = $2", [summary, req.params.id]);
    return res.json({ summary });
  } catch (err) {
    console.error("Document summarize error:", err);
    return res.status(500).json({ error: "AI summarization failed" });
  }
});

router.get("/:id/download", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT filename, content_type, file_data, case_id, source, s3_key FROM case_documents WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    if (!(await verifyCaseAccess(req, doc.case_id))) return res.status(403).json({ error: "Access denied" });
    if (doc.source === "client") {
      pool.query("UPDATE case_documents SET firm_viewed_at = NOW() WHERE id = $1 AND firm_viewed_at IS NULL", [req.params.id]).catch(() => {});
    }
    const fileBuffer = await getDocBuffer(doc);
    if (!fileBuffer) return res.status(404).json({ error: "File content is unavailable — the document record exists but no file was stored. Try re-uploading the document." });
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    return res.send(fileBuffer);
  } catch (err) {
    console.error("Document download error:", err);
    return res.status(500).json({ error: "Download failed" });
  }
});

router.get("/:id/html", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT file_data, content_type, case_id, filename, content_html, s3_key FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const doc = rows[0];
    if (doc.content_html) return res.json({ html: doc.content_html });
    const fileBuffer = await getDocBuffer(doc);
    if (!fileBuffer) return res.status(400).json({ error: "No file data" });
    const mammoth = require("mammoth");
    const result = await mammoth.convertToHtml({ buffer: fileBuffer });
    pool.query("UPDATE case_documents SET content_html = $1 WHERE id = $2", [result.value, req.params.id]).catch(() => {});
    res.json({ html: result.value });
  } catch (err) {
    console.error("DOCX to HTML error:", err);
    res.status(500).json({ error: "Conversion failed" });
  }
});

router.put("/:id/content", requireAuth, async (req, res) => {
  try {
    const { rows: check } = await pool.query("SELECT case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!check.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, check[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const { html } = req.body;
    await pool.query("UPDATE case_documents SET content_html = $1 WHERE id = $2", [html, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Save content error:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

router.get("/:id/xlsx-data", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT file_data, case_id, s3_key FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const fileBuffer = await getDocBuffer(rows[0]);
    if (!fileBuffer) return res.status(400).json({ error: "No file data" });
    const XLSX = require("xlsx");
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheets = workbook.SheetNames.map(name => {
      const sheet = workbook.Sheets[name];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
      return { name, rows: jsonData };
    });
    res.json({ sheets });
  } catch (err) {
    console.error("XLSX parse error:", err);
    res.status(500).json({ error: "Parse failed" });
  }
});

router.put("/:id/xlsx-data", requireAuth, async (req, res) => {
  try {
    const { rows: check } = await pool.query("SELECT case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!check.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, check[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const XLSX = require("xlsx");
    const { sheets } = req.body;
    const workbook = XLSX.utils.book_new();
    for (const sheet of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
      XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
    }
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const { rows: docInfo } = await pool.query("SELECT filename, content_type FROM case_documents WHERE id = $1", [req.params.id]);
    let xlsxS3Key = null;
    if (isR2Configured() && docInfo.length) {
      try {
        const { randomUUID } = require("crypto");
        xlsxS3Key = `documents/${randomUUID()}/${docInfo[0].filename}`;
        await uploadToR2(xlsxS3Key, buffer, docInfo[0].content_type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      } catch (e) { console.error("S3 xlsx pre-upload failed, using BYTEA:", e.message); xlsxS3Key = null; }
    }
    await pool.query("UPDATE case_documents SET file_data = $1, s3_key = COALESCE($2, s3_key) WHERE id = $3", [xlsxS3Key ? null : buffer, xlsxS3Key, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("XLSX save error:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

router.get("/:id/pptx-slides", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT file_data, case_id, s3_key FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const fileBuffer = await getDocBuffer(rows[0]);
    if (!fileBuffer) return res.status(400).json({ error: "No file data" });
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(fileBuffer);
    const slides = [];
    const slideFiles = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort();
    for (const slideFile of slideFiles) {
      const xml = await zip.file(slideFile).async("string");
      const texts = [];
      const textMatches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
      for (const match of textMatches) {
        const text = match.replace(/<\/?a:t>/g, "");
        if (text.trim()) texts.push({ text: text, x: 0, y: texts.length * 40, width: 800, height: 30, bold: false, italic: false, color: "#000", fontSize: 14 });
      }
      slides.push({ texts });
    }
    res.json({ slides });
  } catch (err) {
    console.error("PPTX parse error:", err);
    res.status(500).json({ error: "Parse failed" });
  }
});

router.put("/:id/pptx-slides", requireAuth, async (req, res) => {
  try {
    const { rows: check } = await pool.query("SELECT case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!check.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, check[0].case_id))) return res.status(403).json({ error: "Access denied" });
    res.json({ ok: true });
  } catch (err) {
    console.error("PPTX save error:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

router.put("/:id/annotations", requireAuth, async (req, res) => {
  try {
    const { rows: check } = await pool.query("SELECT case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!check.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, check[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const { annotations } = req.body;
    await pool.query("UPDATE case_documents SET annotations = $1 WHERE id = $2", [JSON.stringify(annotations || []), req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Annotations save error:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

router.get("/:id/annotations", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT annotations, case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    res.json({ annotations: rows[0].annotations || [] });
  } catch (err) {
    console.error("Get annotations error:", err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/:id/view", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT filename, content_type, file_data, case_id, s3_key FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const doc = rows[0];
    const fileBuffer = await getDocBuffer(doc);
    if (!fileBuffer) return res.status(404).json({ error: "File data not found" });
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename}"`);
    res.send(fileBuffer);
  } catch (err) {
    console.error("Document view error:", err);
    res.status(500).json({ error: "View failed" });
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
    await pool.query("UPDATE case_documents SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Document delete error:", err);
    return res.status(500).json({ error: "Delete failed" });
  }
});


router.post("/folders", requireAuth, async (req, res) => {
  try {
    const { caseId, name, parentId } = req.body;
    if (!caseId || !name) return res.status(400).json({ error: "caseId and name are required" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });
    if (parentId) {
      const { rows: parentRows } = await pool.query("SELECT id FROM document_folders WHERE id = $1 AND case_id = $2", [parentId, caseId]);
      if (!parentRows.length) return res.status(400).json({ error: "Parent folder not found" });
    }
    const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM document_folders WHERE case_id = $1", [caseId]);
    const { rows } = await pool.query(
      "INSERT INTO document_folders (case_id, name, sort_order, parent_id) VALUES ($1, $2, $3, $4) RETURNING *",
      [caseId, name, maxRows[0].next, parentId || null]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create document folder error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/folders/:id", requireAuth, async (req, res) => {
  try {
    const { name, collapsed } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (collapsed !== undefined) { sets.push(`collapsed = $${idx++}`); vals.push(!!collapsed); }
    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE document_folders SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Update document folder error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/folders/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("UPDATE case_documents SET folder_id = NULL WHERE folder_id = $1", [req.params.id]);
    const { rowCount } = await pool.query("DELETE FROM document_folders WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete document folder error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


router.put("/:docId/move", requireAuth, async (req, res) => {
  try {
    const { folderId } = req.body;
    const { rows } = await pool.query(
      "UPDATE case_documents SET folder_id = $1 WHERE id = $2 RETURNING id, folder_id",
      [folderId || null, req.params.docId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Move document error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/batch-move", requireAuth, async (req, res) => {
  try {
    const { ids, folderId } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    const { rows: docRows } = await pool.query(
      "SELECT DISTINCT case_id FROM case_documents WHERE id = ANY($1) AND deleted_at IS NULL", [ids]
    );
    if (docRows.length === 0) return res.status(404).json({ error: "No documents found" });
    if (docRows.length > 1) return res.status(400).json({ error: "All documents must belong to the same case" });
    const caseId = docRows[0].case_id;
    if (folderId) {
      const { rows: folderRows } = await pool.query(
        "SELECT id FROM document_folders WHERE id = $1 AND case_id = $2", [folderId, caseId]
      );
      if (folderRows.length === 0) return res.status(400).json({ error: "Folder not found for this case" });
    }
    const { rowCount } = await pool.query(
      "UPDATE case_documents SET folder_id = $1 WHERE id = ANY($2) AND deleted_at IS NULL",
      [folderId || null, ids]
    );
    return res.json({ ok: true, moved: rowCount });
  } catch (err) {
    console.error("Batch move documents error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/batch-delete", requireAuth, async (req, res) => {
  try {
    const userRoles = req.session.userRoles || [req.session.userRole];
    if (!userRoles.some(r => ATTORNEY_ROLES.includes(r))) {
      return res.status(403).json({ error: "Only attorneys may batch delete documents" });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    const { rowCount } = await pool.query("UPDATE case_documents SET deleted_at = NOW() WHERE id = ANY($1) AND deleted_at IS NULL", [ids]);
    return res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error("Batch delete documents error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/upload/init", requireAuth, express.json(), async (req, res) => {
  try {
    const { caseId, filename, contentType, fileSize, totalChunks, docType, folderId } = req.body;
    if (!caseId || !filename || !totalChunks) return res.status(400).json({ error: "Missing required fields" });
    if (fileSize > 100 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 100MB)" });
    if (totalChunks > 10) return res.status(400).json({ error: "Too many chunks" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });
    let folderVal = null;
    if (folderId) {
      folderVal = parseInt(folderId);
      if (isNaN(folderVal)) return res.status(400).json({ error: "Invalid folderId" });
      const { rows: folderRows } = await pool.query("SELECT id FROM document_folders WHERE id = $1 AND case_id = $2", [folderVal, caseId]);
      if (!folderRows.length) return res.status(400).json({ error: "Folder not found for this case" });
    }
    const uploadId = randomUUID();
    pendingDocChunks.set(uploadId, {
      caseId, filename, contentType, fileSize, totalChunks, docType: docType || "Other",
      folderId: folderVal,
      userId: req.session.userId,
      chunks: new Array(parseInt(totalChunks)).fill(null),
      received: 0, createdAt: Date.now(),
    });
    setTimeout(() => { pendingDocChunks.delete(uploadId); }, 30 * 60 * 1000);
    res.json({ uploadId, totalChunks });
  } catch (err) {
    console.error("Doc chunk init error:", err.message);
    res.status(500).json({ error: "Failed to initialize upload" });
  }
});

router.post("/upload/chunk", requireAuth, upload.single("chunk"), async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    if (!uploadId || chunkIndex === undefined || !req.file) {
      return res.status(400).json({ error: "Missing uploadId, chunkIndex, or chunk data" });
    }
    const pending = pendingDocChunks.get(uploadId);
    if (!pending) return res.status(404).json({ error: "Upload session not found or expired" });
    if (pending.userId !== req.session.userId) return res.status(403).json({ error: "Access denied" });
    const idx = parseInt(chunkIndex);
    if (idx < 0 || idx >= pending.totalChunks) return res.status(400).json({ error: "Invalid chunk index" });
    if (pending.chunks[idx] === null) pending.received++;
    pending.chunks[idx] = req.file.buffer;
    res.json({ received: pending.received, totalChunks: pending.totalChunks });
  } catch (err) {
    console.error("Doc chunk upload error:", err.message);
    res.status(500).json({ error: "Failed to upload chunk" });
  }
});

router.post("/upload/complete", requireAuth, express.json(), async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ error: "Missing uploadId" });
    const pending = pendingDocChunks.get(uploadId);
    if (!pending) return res.status(404).json({ error: "Upload session not found or expired" });
    if (pending.userId !== req.session.userId) return res.status(403).json({ error: "Access denied" });
    const missing = pending.chunks.findIndex(c => c === null);
    if (missing !== -1) return res.status(400).json({ error: `Missing chunk ${missing}` });
    const fullBuffer = Buffer.concat(pending.chunks);
    pendingDocChunks.delete(uploadId);
    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [pending.userId]);
    const uploaderName = userRows.length ? userRows[0].name : "";

    let s3Key = null;
    if (isR2Configured()) {
      try {
        const { randomUUID } = require("crypto");
        s3Key = `documents/${randomUUID()}/${pending.filename}`;
        await uploadToR2(s3Key, fullBuffer, pending.contentType);
      } catch (e) { console.error("S3 chunk pre-upload failed, using BYTEA:", e.message); s3Key = null; }
    }

    if (needsOcr(pending.contentType)) {
      const { rows } = await pool.query(
        `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by, uploaded_by_name, file_size, ocr_status, folder_id, s3_key)
         VALUES ($1, $2, $3, $4, '', $5, $6, $7, $8, 'processing', $9, $10) RETURNING id, case_id, filename, content_type, extracted_text, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at, folder_id, sort_order, ocr_status`,
        [pending.caseId, pending.filename, pending.contentType, s3Key ? null : fullBuffer, pending.docType, pending.userId, uploaderName, fullBuffer.length, pending.folderId || null, s3Key]
      );
      runOcrBackground(rows[0].id, fullBuffer, pending.contentType, pending.filename);
      return res.json(toFrontend(rows[0]));
    }

    let extractedText = "";
    try { extractedText = await extractText(fullBuffer, pending.contentType, pending.filename); } catch (e) { console.error("Chunk text extraction error:", e); }
    const ocrStatus = (extractedText && extractedText.trim().length > 0) ? "complete" : "failed";
    const { rows } = await pool.query(
      `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by, uploaded_by_name, file_size, ocr_status, folder_id, s3_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, case_id, filename, content_type, extracted_text, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at, folder_id, sort_order, ocr_status`,
      [pending.caseId, pending.filename, pending.contentType, s3Key ? null : fullBuffer, extractedText, pending.docType, pending.userId, uploaderName, fullBuffer.length, ocrStatus, pending.folderId || null, s3Key]
    );
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Doc chunk complete error:", err.message);
    res.status(500).json({ error: "Failed to complete upload" });
  }
});

const officeViewTokens = new Map();

router.get("/:id/office-view-url", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, filename, content_type, file_data, case_id, s3_key FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    if (!(await verifyCaseAccess(req, doc.case_id))) return res.status(403).json({ error: "Access denied" });
    const ext = (doc.filename || "").split(".").pop().toLowerCase();
    const officeExts = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"];
    if (!officeExts.includes(ext)) return res.json({ url: null });
    if (!doc.file_data && !doc.s3_key) return res.json({ url: null });

    const token = randomUUID();
    officeViewTokens.set(token, { docId: doc.id, expiresAt: Date.now() + 10 * 60 * 1000 });
    setTimeout(() => officeViewTokens.delete(token), 10 * 60 * 1000);

    const host = req.get("host");
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const downloadUrl = `${protocol}://${host}/api/case-documents/office-download/${token}`;
    const officeUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(downloadUrl)}`;
    res.json({ url: officeUrl, fallback: true });
  } catch (err) {
    console.error("Office view URL error:", err.message);
    res.json({ url: null });
  }
});

router.get("/office-download/:token", async (req, res) => {
  try {
    const entry = officeViewTokens.get(req.params.token);
    if (!entry || Date.now() > entry.expiresAt) return res.status(403).json({ error: "Token expired or invalid" });

    const { rows } = await pool.query("SELECT filename, content_type, file_data, s3_key FROM case_documents WHERE id = $1", [entry.docId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    const fileBuffer = await getDocBuffer(doc);
    if (!fileBuffer) return res.status(404).json({ error: "File data not found" });
    res.setHeader("Content-Type", doc.content_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename}"`);
    res.send(fileBuffer);
  } catch (err) {
    console.error("Office download error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
