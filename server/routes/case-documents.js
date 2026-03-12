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
      "SELECT id, case_id, filename, content_type, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at, folder_id, sort_order FROM case_documents WHERE case_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at DESC",
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

router.get("/:id/text", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT cd.extracted_text, cd.case_id, cd.file_data, cd.content_type, cd.filename FROM case_documents cd WHERE cd.id = $1", [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Document not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const doc = rows[0];
    if (doc.extracted_text) {
      return res.json({ text: doc.extracted_text });
    }
    if (doc.file_data) {
      try {
        const liveText = await extractText(doc.file_data, doc.content_type, doc.filename);
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

router.post("/:id/re-extract", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT cd.case_id, cd.file_data, cd.content_type, cd.filename FROM case_documents cd WHERE cd.id = $1", [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Document not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const doc = rows[0];
    if (!doc.file_data) return res.status(400).json({ error: "No file data available for re-extraction" });
    const newText = await extractText(doc.file_data, doc.content_type, doc.filename);
    await pool.query("UPDATE case_documents SET extracted_text = $1 WHERE id = $2", [newText || "", req.params.id]);
    return res.json({ text: newText || "", length: (newText || "").length });
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
    const { rows } = await pool.query("SELECT filename, content_type, file_data, case_id, source FROM case_documents WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    if (!(await verifyCaseAccess(req, doc.case_id))) return res.status(403).json({ error: "Access denied" });
    if (doc.source === "client") {
      pool.query("UPDATE case_documents SET firm_viewed_at = NOW() WHERE id = $1 AND firm_viewed_at IS NULL", [req.params.id]).catch(() => {});
    }
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename}"`);
    return res.send(doc.file_data);
  } catch (err) {
    console.error("Document download error:", err);
    return res.status(500).json({ error: "Download failed" });
  }
});

router.get("/:id/html", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT file_data, content_type, case_id, filename, content_html FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const doc = rows[0];
    if (doc.content_html) return res.json({ html: doc.content_html });
    if (!doc.file_data) return res.status(400).json({ error: "No file data" });
    const mammoth = require("mammoth");
    const result = await mammoth.convertToHtml({ buffer: doc.file_data });
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
    const { rows } = await pool.query("SELECT file_data, case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const XLSX = require("xlsx");
    const workbook = XLSX.read(rows[0].file_data, { type: "buffer" });
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
    await pool.query("UPDATE case_documents SET file_data = $1 WHERE id = $2", [buffer, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("XLSX save error:", err);
    res.status(500).json({ error: "Save failed" });
  }
});

router.get("/:id/pptx-slides", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT file_data, case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(rows[0].file_data);
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
    const { rows } = await pool.query("SELECT filename, content_type, file_data, case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    if (!(await verifyCaseAccess(req, rows[0].case_id))) return res.status(403).json({ error: "Access denied" });
    const doc = rows[0];
    res.setHeader("Content-Type", doc.content_type);
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename}"`);
    res.send(doc.file_data);
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
    const { caseId, name } = req.body;
    if (!caseId || !name) return res.status(400).json({ error: "caseId and name are required" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM document_folders WHERE case_id = $1", [caseId]);
    const { rows } = await pool.query(
      "INSERT INTO document_folders (case_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *",
      [caseId, name, maxRows[0].next]
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
    const { caseId, filename, contentType, fileSize, totalChunks, docType } = req.body;
    if (!caseId || !filename || !totalChunks) return res.status(400).json({ error: "Missing required fields" });
    if (fileSize > 100 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 100MB)" });
    if (totalChunks > 10) return res.status(400).json({ error: "Too many chunks" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });
    const uploadId = randomUUID();
    pendingDocChunks.set(uploadId, {
      caseId, filename, contentType, fileSize, totalChunks, docType: docType || "Other",
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
    let extractedText = "";
    try { extractedText = await extractText(fullBuffer, pending.contentType, pending.filename); } catch (e) { console.error("Chunk text extraction error:", e); }
    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [pending.userId]);
    const uploaderName = userRows.length ? userRows[0].name : "";
    const { rows } = await pool.query(
      `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by, uploaded_by_name, file_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, case_id, filename, content_type, extracted_text, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at, folder_id, sort_order`,
      [pending.caseId, pending.filename, pending.contentType, fullBuffer, extractedText, pending.docType, pending.userId, uploaderName, fullBuffer.length]
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
    const { rows } = await pool.query("SELECT id, filename, content_type, file_data, case_id FROM case_documents WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    if (!(await verifyCaseAccess(req, doc.case_id))) return res.status(403).json({ error: "Access denied" });
    const ext = (doc.filename || "").split(".").pop().toLowerCase();
    const officeExts = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"];
    if (!officeExts.includes(ext)) return res.json({ url: null });
    if (!doc.file_data) return res.json({ url: null });

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

    const { rows } = await pool.query("SELECT filename, content_type, file_data FROM case_documents WHERE id = $1", [entry.docId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const doc = rows[0];
    res.setHeader("Content-Type", doc.content_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename}"`);
    res.send(doc.file_data);
  } catch (err) {
    console.error("Office download error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
