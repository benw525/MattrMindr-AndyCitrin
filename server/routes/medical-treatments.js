const express = require("express");
const pool = require("../db");
const multer = require("multer");
const OpenAI = require("openai");
const { requireAuth } = require("../middleware/auth");
const { extractText } = require("../utils/extract-text");

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

router.post("/:caseId/records/:treatmentId/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { caseId, treatmentId } = req.params;
    const buffer = req.file.buffer;
    const filename = req.file.originalname;
    const mimeType = req.file.mimetype;

    const text = await extractText(buffer, mimeType, filename);

    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Could not extract text from document" });
    }

    let visits = [];
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are a medical record parser. Given extracted text from a medical document, parse it into individual visit entries. Return a JSON array of objects, each with:
- provider_name: the healthcare provider or facility name
- date_of_service: date in YYYY-MM-DD format (or null if unknown)
- description: brief description of the visit/treatment
- source_pages: which pages this visit appears on (e.g., "1-2" or "3")
- summary: a concise clinical summary of the visit

Return ONLY valid JSON array, no other text.`
          },
          {
            role: "user",
            content: `Parse this medical document into individual visit records:\n\n${text.substring(0, 15000)}`
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
      });

      const content = completion.choices[0].message.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        visits = JSON.parse(jsonMatch[0]);
      }
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

    const inserted = [];
    for (const visit of visits) {
      const dateVal = visit.date_of_service && /^\d{4}-\d{2}-\d{2}$/.test(visit.date_of_service) ? visit.date_of_service : null;
      const { rows } = await pool.query(
        `INSERT INTO medical_records
          (treatment_id, case_id, provider_name, date_of_service, description, source_pages, summary, file_data, file_size, filename, mime_type, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          treatmentId, caseId,
          visit.provider_name || "",
          dateVal,
          visit.description || "",
          visit.source_pages || "",
          visit.summary || "",
          buffer,
          buffer.length,
          filename,
          mimeType,
          req.user?.id || null
        ]
      );
      inserted.push(recordToFrontend(rows[0]));
    }

    res.status(201).json(inserted);
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
      "SELECT file_data, content_type, filename FROM case_documents WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL",
      [documentId, caseId]
    );
    if (!docRows.length) return res.status(404).json({ error: "Document not found" });

    const doc = docRows[0];
    const buffer = doc.file_data;
    const filename = doc.filename;
    const mimeType = doc.content_type;

    const text = await extractText(buffer, mimeType, filename);
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Could not extract text from document" });
    }

    let visits = [];
    try {
      if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "placeholder" });
      const completion = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are a medical record parser. Given extracted text from a medical document, parse it into individual visit entries. Return a JSON array of objects, each with:
- provider_name: the healthcare provider or facility name
- date_of_service: date in YYYY-MM-DD format (or null if unknown)
- description: brief description of the visit/treatment
- source_pages: which pages this visit appears on (e.g., "1-2" or "3")
- summary: a concise clinical summary of the visit

Return ONLY valid JSON array, no other text.`
          },
          {
            role: "user",
            content: `Parse this medical document into individual visit records:\n\n${text.substring(0, 15000)}`
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
      });

      const content = completion.choices[0].message.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) visits = JSON.parse(jsonMatch[0]);
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

    const inserted = [];
    for (const visit of visits) {
      const dateVal = visit.date_of_service && /^\d{4}-\d{2}-\d{2}$/.test(visit.date_of_service) ? visit.date_of_service : null;
      const { rows } = await pool.query(
        `INSERT INTO medical_records
          (treatment_id, case_id, provider_name, date_of_service, description, source_pages, summary, file_size, filename, mime_type, uploaded_by, source_document_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          treatmentId, caseId,
          visit.provider_name || "",
          dateVal,
          visit.description || "",
          visit.source_pages || "",
          visit.summary || "",
          buffer.length,
          filename,
          mimeType,
          req.user?.id || null,
          documentId
        ]
      );
      inserted.push(recordToFrontend(rows[0]));
    }

    res.status(201).json(inserted);
  } catch (err) {
    console.error("Medical record from-document error:", err);
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
