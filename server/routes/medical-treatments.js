const express = require("express");
const pool = require("../db");
const multer = require("multer");
const OpenAI = require("openai");
const { requireAuth } = require("../middleware/auth");
const { extractText, extractTextWithPages } = require("../utils/extract-text");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

let openai;
try {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "placeholder" });
} catch (e) {
  openai = null;
}

const toFrontend = (r) => ({
  id: r.id,
  caseId: r.case_id,
  providerName: r.provider_name,
  providerType: r.provider_type,
  firstVisitDate: r.first_visit_date ? r.first_visit_date.toISOString().split("T")[0] : "",
  lastVisitDate: r.last_visit_date ? r.last_visit_date.toISOString().split("T")[0] : "",
  stillTreating: !!r.still_treating,
  totalBilled: r.total_billed ? parseFloat(r.total_billed) : null,
  totalPaid: r.total_paid ? parseFloat(r.total_paid) : null,
  description: r.description,
  notes: r.notes,
  createdAt: r.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_medical_treatments WHERE case_id = $1 AND deleted_at IS NULL ORDER BY first_visit_date ASC NULLS LAST, created_at",
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Medical treatments fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_medical_treatments
        (case_id, provider_name, provider_type, first_visit_date, last_visit_date,
         still_treating, total_billed, total_paid, description, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.caseId, d.providerName || "", d.providerType || "Other",
       orNull(d.firstVisitDate), orNull(d.lastVisitDate),
       !!d.stillTreating, orNull(d.totalBilled), orNull(d.totalPaid),
       d.description || "", d.notes || ""]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Medical treatment create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const treatmentFieldMap = {
      providerName: "provider_name",
      providerType: "provider_type",
      firstVisitDate: "first_visit_date",
      lastVisitDate: "last_visit_date",
      stillTreating: "still_treating",
      totalBilled: "total_billed",
      totalPaid: "total_paid",
      description: "description",
      notes: "notes",
    };
    const nullableFields = new Set(["firstVisitDate", "lastVisitDate", "totalBilled", "totalPaid"]);
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const [camel, col] of Object.entries(treatmentFieldMap)) {
      if (d[camel] !== undefined) {
        sets.push(`${col}=$${idx++}`);
        vals.push(nullableFields.has(camel) ? orNull(d[camel]) : (camel === "stillTreating" ? !!d[camel] : d[camel]));
      }
    }
    if (!sets.length) {
      const { rows } = await pool.query(
        "SELECT * FROM case_medical_treatments WHERE id=$1 AND case_id=$2 AND deleted_at IS NULL",
        [req.params.id, req.params.caseId]
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      return res.json(toFrontend(rows[0]));
    }
    vals.push(req.params.id, req.params.caseId);
    const { rows } = await pool.query(
      `UPDATE case_medical_treatments SET ${sets.join(", ")} WHERE id=$${idx++} AND case_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Medical treatment update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_medical_treatments SET deleted_at = NOW() WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Medical treatment delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const recordToFrontend = (r) => ({
  id: r.id,
  treatmentId: r.treatment_id,
  caseId: r.case_id,
  providerName: r.provider_name,
  dateOfService: r.date_of_service ? r.date_of_service.toISOString().split("T")[0] : "",
  description: r.description,
  sourcePages: r.source_pages,
  summary: r.summary,
  fileSize: r.file_size,
  filename: r.filename,
  mimeType: r.mime_type,
  uploadedBy: r.uploaded_by,
  uploadedAt: r.uploaded_at,
});

router.get("/:caseId/records/:treatmentId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM medical_records WHERE treatment_id = $1 AND case_id = $2 AND deleted_at IS NULL ORDER BY date_of_service ASC NULLS LAST, uploaded_at",
      [req.params.treatmentId, req.params.caseId]
    );
    res.json(rows.map(recordToFrontend));
  } catch (err) {
    console.error("Medical records fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

const parseMedicalText = async (text) => {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "placeholder" });
  const completion = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content: `You extract structured medical treatment data from medical records. The text may be labeled with [PAGE N] markers indicating which page each section comes from. Return JSON:
{
  "entries": [
    {
      "provider": "Provider/Facility Name (include doctor name and credentials if mentioned)",
      "dateOfService": "YYYY-MM-DD",
      "summary": "Brief summary of treatment, diagnosis, findings",
      "pageNumbers": [1]
    }
  ]
}
For each entry, include a "pageNumbers" array listing every page number where data for that entry was found (a single entry may span multiple pages). Extract every distinct visit/treatment entry you can identify. Each date of service should be a separate entry. Use ISO date format. If a date is ambiguous, use your best interpretation. Return ONLY valid JSON.`
      },
      {
        role: "user",
        content: `Parse this medical document into individual visit records:\n\n${text.substring(0, 16000)}`
      }
    ],
    temperature: 0.1,
    max_completion_tokens: 4000,
    store: false,
  });

  const content = completion.choices[0].message.content.trim();
  let parsed = null;

  const objMatch = content.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      parsed = JSON.parse(objMatch[0]);
      if (parsed.entries && Array.isArray(parsed.entries)) {
        return parsed.entries.map(e => ({
          provider_name: e.provider || "",
          date_of_service: e.dateOfService || null,
          description: e.summary || "",
          source_pages: Array.isArray(e.pageNumbers) ? e.pageNumbers.join(", ") : (e.pageNumbers || ""),
          summary: e.summary || "",
        }));
      }
    } catch (e) {}
  }

  const arrMatch = content.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      return arr.map(e => ({
        provider_name: e.provider || e.provider_name || "",
        date_of_service: e.dateOfService || e.date_of_service || null,
        description: e.summary || e.description || "",
        source_pages: Array.isArray(e.pageNumbers) ? e.pageNumbers.join(", ") : (e.source_pages || e.pageNumbers || ""),
        summary: e.summary || "",
      }));
    } catch (e) {}
  }

  return [];
};

router.post("/:caseId/records/:treatmentId/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { caseId, treatmentId } = req.params;
    const buffer = req.file.buffer;
    const filename = req.file.originalname;
    const mimeType = req.file.mimetype;

    const { text } = await extractTextWithPages(buffer, mimeType, filename);

    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Could not extract text from document" });
    }

    let visits = [];
    try {
      visits = await parseMedicalText(text);
    } catch (aiErr) {
      console.error("OpenAI medical record parse error:", aiErr.message);
      visits = [{
        provider_name: "",
        date_of_service: null,
        description: "Uploaded medical record",
        source_pages: "",
        summary: text.substring(0, 500),
      }];
    }

    if (!visits.length) {
      visits = [{
        provider_name: "",
        date_of_service: null,
        description: "Uploaded medical record",
        source_pages: "",
        summary: text.substring(0, 500),
      }];
    }

    const staged = visits.map((v, i) => ({
      _stagingId: `upload-${Date.now()}-${i}`,
      provider_name: v.provider_name || "",
      date_of_service: v.date_of_service && /^\d{4}-\d{2}-\d{2}$/.test(v.date_of_service) ? v.date_of_service : null,
      description: v.description || "",
      source_pages: v.source_pages || "",
      summary: v.summary || "",
    }));

    res.status(200).json({ staged, filename, fileSize: buffer.length, mimeType });
  } catch (err) {
    console.error("Medical record upload error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId/records/:treatmentId/from-document", requireAuth, async (req, res) => {
  try {
    const { caseId, treatmentId } = req.params;
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: "documentId is required" });

    const { rows: treatmentRows } = await pool.query(
      "SELECT id FROM case_medical_treatments WHERE id = $1 AND case_id = $2",
      [treatmentId, caseId]
    );
    if (!treatmentRows.length) return res.status(404).json({ error: "Treatment not found for this case" });

    const { rows: docRows } = await pool.query(
      "SELECT file_data, content_type, filename, extracted_text FROM case_documents WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL",
      [documentId, caseId]
    );
    if (!docRows.length) return res.status(404).json({ error: "Document not found" });

    const doc = docRows[0];
    const buffer = doc.file_data;
    const filename = doc.filename;
    const mimeType = doc.content_type;

    let text = null;
    if (doc.extracted_text && doc.extracted_text.trim().length > 10 && /\[PAGE \d+\]/.test(doc.extracted_text)) {
      text = doc.extracted_text;
    }
    if (!text) {
      const result = await extractTextWithPages(buffer, mimeType, filename);
      text = result.text;
    }
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Could not extract text from document. The document may still be processing — try again in a moment." });
    }

    let visits = [];
    try {
      visits = await parseMedicalText(text);
    } catch (aiErr) {
      console.error("OpenAI medical record parse error:", aiErr.message);
      visits = [{
        provider_name: "",
        date_of_service: null,
        description: "Linked from: " + filename,
        source_pages: "",
        summary: text.substring(0, 500),
      }];
    }

    if (!visits.length) {
      visits = [{
        provider_name: "",
        date_of_service: null,
        description: "Linked from: " + filename,
        source_pages: "",
        summary: text.substring(0, 500),
      }];
    }

    const staged = visits.map((v, i) => ({
      _stagingId: `doc-${Date.now()}-${i}`,
      provider_name: v.provider_name || "",
      date_of_service: v.date_of_service && /^\d{4}-\d{2}-\d{2}$/.test(v.date_of_service) ? v.date_of_service : null,
      description: v.description || "",
      source_pages: v.source_pages || "",
      summary: v.summary || "",
    }));

    res.status(200).json({ staged, filename, documentId, mimeType });
  } catch (err) {
    console.error("Medical record from-document error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId/records/:treatmentId/commit", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { caseId, treatmentId } = req.params;

    const { rows: treatmentCheck } = await pool.query(
      "SELECT id FROM case_medical_treatments WHERE id = $1 AND case_id = $2",
      [treatmentId, caseId]
    );
    if (!treatmentCheck.length) return res.status(404).json({ error: "Treatment not found for this case" });

    let entries, documentId, filename, mimeType;
    try {
      entries = JSON.parse(req.body.entries || "[]");
      documentId = req.body.documentId || null;
      filename = req.body.filename || "unknown";
      mimeType = req.body.mimeType || "application/octet-stream";
    } catch (parseErr) {
      return res.status(400).json({ error: "Invalid entries data" });
    }

    if (!entries.length) return res.status(400).json({ error: "No entries to commit" });

    if (documentId) {
      const { rows: docCheck } = await pool.query(
        "SELECT id FROM case_documents WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL",
        [documentId, caseId]
      );
      if (!docCheck.length) return res.status(404).json({ error: "Document not found for this case" });
    }

    const buffer = req.file ? req.file.buffer : null;

    const inserted = [];
    for (const visit of entries) {
      const dateVal = visit.date_of_service && /^\d{4}-\d{2}-\d{2}$/.test(visit.date_of_service) ? visit.date_of_service : null;
      const params = [
        treatmentId, caseId,
        visit.provider_name || "",
        dateVal,
        visit.description || "",
        visit.source_pages || "",
        visit.summary || "",
        buffer ? buffer.length : 0,
        filename,
        mimeType,
        req.user?.id || null,
      ];

      let sql;
      if (documentId) {
        sql = `INSERT INTO medical_records
          (treatment_id, case_id, provider_name, date_of_service, description, source_pages, summary, file_size, filename, mime_type, uploaded_by, source_document_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`;
        params.push(documentId);
      } else if (buffer) {
        sql = `INSERT INTO medical_records
          (treatment_id, case_id, provider_name, date_of_service, description, source_pages, summary, file_data, file_size, filename, mime_type, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`;
        params.splice(7, 0, buffer);
      } else {
        sql = `INSERT INTO medical_records
          (treatment_id, case_id, provider_name, date_of_service, description, source_pages, summary, file_size, filename, mime_type, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`;
      }

      const { rows } = await pool.query(sql, params);
      inserted.push(recordToFrontend(rows[0]));
    }

    const providerName = entries[0]?.provider_name || "";
    const dates = entries.filter(v => v.date_of_service).map(v => v.date_of_service).sort();
    let treatmentUpdates = {};
    const { rows: tRows } = await pool.query("SELECT provider_name, first_visit_date, last_visit_date FROM case_medical_treatments WHERE id=$1 AND case_id=$2", [treatmentId, caseId]);
    if (tRows.length) {
      const t = tRows[0];
      if (providerName && (!t.provider_name || t.provider_name.trim() === "")) treatmentUpdates.provider_name = providerName;
      if (!t.first_visit_date && dates.length) treatmentUpdates.first_visit_date = dates[0];
      if (!t.last_visit_date && dates.length) treatmentUpdates.last_visit_date = dates[dates.length - 1];
    }
    if (Object.keys(treatmentUpdates).length) {
      const sets = [];
      const vals = [];
      let idx = 1;
      for (const [col, val] of Object.entries(treatmentUpdates)) {
        sets.push(`${col}=$${idx++}`);
        vals.push(val);
      }
      vals.push(treatmentId, caseId);
      await pool.query(`UPDATE case_medical_treatments SET ${sets.join(", ")} WHERE id=$${idx++} AND case_id=$${idx}`, vals);
    }

    res.status(201).json({ records: inserted, treatmentUpdates: Object.keys(treatmentUpdates).length ? treatmentUpdates : null });
  } catch (err) {
    console.error("Medical record commit error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/records/:treatmentId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const recFieldMap = {
      providerName: "provider_name",
      dateOfService: "date_of_service",
      description: "description",
      sourcePages: "source_pages",
      summary: "summary",
    };
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const [camel, col] of Object.entries(recFieldMap)) {
      if (d[camel] !== undefined) {
        sets.push(`${col}=$${idx++}`);
        vals.push(camel === "dateOfService" ? orNull(d[camel]) : d[camel]);
      }
    }
    if (!sets.length) {
      const { rows } = await pool.query(
        "SELECT * FROM medical_records WHERE id=$1 AND treatment_id=$2 AND case_id=$3 AND deleted_at IS NULL",
        [req.params.id, req.params.treatmentId, req.params.caseId]
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      return res.json(recordToFrontend(rows[0]));
    }
    vals.push(req.params.id, req.params.treatmentId, req.params.caseId);
    const { rows } = await pool.query(
      `UPDATE medical_records SET ${sets.join(", ")} WHERE id=$${idx++} AND treatment_id=$${idx++} AND case_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(recordToFrontend(rows[0]));
  } catch (err) {
    console.error("Medical record update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/records/:treatmentId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE medical_records SET deleted_at = NOW() WHERE id = $1 AND treatment_id = $2 AND case_id = $3 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.params.treatmentId, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Medical record delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
