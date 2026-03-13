const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const multer = require("multer");
const OpenAI = require("openai");
const { extractTextWithPages } = require("../utils/extract-text");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const router = express.Router();

let openai = null;
const getOpenAI = () => {
  if (!openai) openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
  return openai;
};

const parseBillingText = async (text) => {
  const ai = getOpenAI();
  const resp = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: `You are a legal billing analysis AI for personal injury cases. Given document text, extract ALL billing line items you can find. These are typically medical bills but may include other charges. Look for: total billed amounts, reductions/adjustments, insurance payments, patient responsibility, outstanding balances, write-offs, contractual adjustments, co-pays, deductibles, and any other financial figures.

Return a JSON array of objects. Each object represents one billing entry with these fields:
- name (string): provider name or description of the charge (e.g. "ER Visit - Memorial Hospital", "MRI - Radiology Associates")
- category (string): one of "Medical Bill", "Lost Wages", "Future Medical", "Property Damage", "Other"
- description (string): brief description of what the charge covers
- billed (number or null): total amount billed
- reductionValue (number or null): any reduction/adjustment amount (contractual adjustments, discounts)
- insurancePaid (number or null): amount paid by insurance
- writeOff (number or null): amount written off
- clientPaid (number or null): amount patient/client paid (co-pay, deductible, out-of-pocket)
- documentationStatus (string): "Documented"

Be thorough - extract every billing item you can identify. If a single document has multiple line items or providers, create separate entries for each. If you can only find a total without breakdown, create one entry with whatever fields you can populate.

Return ONLY the JSON array, no other text.` },
      { role: "user", content: text.substring(0, 15000) }
    ],
  });

  const content = resp.choices[0].message.content.trim();
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  return JSON.parse(jsonMatch[0]);
};

const toFrontend = (r) => ({
  id: r.id,
  caseId: r.case_id,
  name: r.name || "",
  category: r.category,
  description: r.description,
  amount: r.amount ? parseFloat(r.amount) : null,
  documentationStatus: r.documentation_status,
  notes: r.notes,
  billed: r.billed ? parseFloat(r.billed) : null,
  owed: r.owed ? parseFloat(r.owed) : null,
  reductionValue: r.reduction_value ? parseFloat(r.reduction_value) : null,
  reductionIsPercent: !!r.reduction_is_percent,
  clientPaid: r.client_paid ? parseFloat(r.client_paid) : null,
  firmPaid: r.firm_paid ? parseFloat(r.firm_paid) : null,
  insurancePaid: r.insurance_paid ? parseFloat(r.insurance_paid) : null,
  writeOff: r.write_off ? parseFloat(r.write_off) : null,
  createdAt: r.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM case_damages WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at",
      [req.params.caseId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Damages fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO case_damages (case_id, name, category, description, amount, documentation_status, notes, billed, owed, reduction_value, reduction_is_percent, client_paid, firm_paid, insurance_paid, write_off)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.params.caseId, d.name || "", d.category || "Medical Bill", d.description || "",
       orNull(d.amount), d.documentationStatus || "Pending", d.notes || "",
       orNull(d.billed), orNull(d.owed), orNull(d.reductionValue),
       !!d.reductionIsPercent, orNull(d.clientPaid), orNull(d.firmPaid),
       orNull(d.insurancePaid), orNull(d.writeOff)]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Damage create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/:id", requireAuth, async (req, res) => {
  const d = req.body;
  const orNull = (v) => (v && String(v).trim()) ? v : null;
  try {
    const dmgFieldMap = {
      name: "name",
      category: "category",
      description: "description",
      amount: "amount",
      documentationStatus: "documentation_status",
      notes: "notes",
      billed: "billed",
      owed: "owed",
      reductionValue: "reduction_value",
      reductionIsPercent: "reduction_is_percent",
      clientPaid: "client_paid",
      firmPaid: "firm_paid",
      insurancePaid: "insurance_paid",
      writeOff: "write_off",
    };
    const nullableFields = new Set(["amount", "billed", "owed", "reductionValue", "clientPaid", "firmPaid", "insurancePaid", "writeOff"]);
    const boolFields = new Set(["reductionIsPercent"]);
    const sets = [];
    const vals = [];
    let idx = 1;
    for (const [camel, col] of Object.entries(dmgFieldMap)) {
      if (d[camel] !== undefined) {
        sets.push(`${col}=$${idx++}`);
        vals.push(boolFields.has(camel) ? !!d[camel] : (nullableFields.has(camel) ? orNull(d[camel]) : d[camel]));
      }
    }
    if (!sets.length) {
      const { rows } = await pool.query(
        "SELECT * FROM case_damages WHERE id=$1 AND case_id=$2 AND deleted_at IS NULL",
        [req.params.id, req.params.caseId]
      );
      if (!rows.length) return res.status(404).json({ error: "Not found" });
      return res.json(toFrontend(rows[0]));
    }
    vals.push(req.params.id, req.params.caseId);
    const { rows } = await pool.query(
      `UPDATE case_damages SET ${sets.join(", ")} WHERE id=$${idx++} AND case_id=$${idx} AND deleted_at IS NULL RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Damage update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_damages SET deleted_at = NOW() WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL RETURNING id",
      [req.params.id, req.params.caseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Damage delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId/from-document", requireAuth, async (req, res) => {
  try {
    const { caseId } = req.params;
    const { documentId } = req.body;
    if (!documentId) return res.status(400).json({ error: "documentId is required" });

    const { rows: docRows } = await pool.query(
      "SELECT file_data, content_type, filename, extracted_text FROM case_documents WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL",
      [documentId, caseId]
    );
    if (!docRows.length) return res.status(404).json({ error: "Document not found" });

    const doc = docRows[0];
    let text = null;
    if (doc.extracted_text && doc.extracted_text.trim().length > 10) {
      text = doc.extracted_text;
    }
    if (!text) {
      const result = await extractTextWithPages(doc.file_data, doc.content_type, doc.filename);
      text = result.text;
    }
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Could not extract text from document. Try again in a moment." });
    }

    let entries = [];
    try {
      entries = await parseBillingText(text);
    } catch (aiErr) {
      console.error("Billing AI parse error:", aiErr.message);
      return res.status(500).json({ error: "AI analysis failed. Please try again." });
    }

    if (!entries.length) {
      return res.json({ entries: [], message: "No billing items found in this document." });
    }

    const saved = [];
    for (const e of entries) {
      const orNull = (v) => (v !== undefined && v !== null && String(v).trim()) ? v : null;
      const { rows } = await pool.query(
        `INSERT INTO case_damages (case_id, name, category, description, amount, documentation_status, billed, reduction_value, insurance_paid, write_off, client_paid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [caseId, e.name || "", e.category || "Medical Bill", e.description || "",
         orNull(e.billed), e.documentationStatus || "Documented",
         orNull(e.billed), orNull(e.reductionValue), orNull(e.insurancePaid),
         orNull(e.writeOff), orNull(e.clientPaid)]
      );
      saved.push(toFrontend(rows[0]));
    }

    res.json({ entries: saved });
  } catch (err) {
    console.error("Damage from-document error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId/upload-bill", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { caseId } = req.params;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const buffer = req.file.buffer;
    const mimeType = req.file.mimetype;
    const filename = req.file.originalname;

    let text = null;
    try {
      const result = await extractTextWithPages(buffer, mimeType, filename);
      text = result.text;
    } catch (e) {
      console.error("Text extraction error:", e.message);
    }
    if (!text || text.trim().length < 10) {
      return res.status(400).json({ error: "Could not extract text from the uploaded file." });
    }

    let entries = [];
    try {
      entries = await parseBillingText(text);
    } catch (aiErr) {
      console.error("Billing AI parse error:", aiErr.message);
      return res.status(500).json({ error: "AI analysis failed. Please try again." });
    }

    if (!entries.length) {
      return res.json({ entries: [], message: "No billing items found in the uploaded file." });
    }

    const saved = [];
    for (const e of entries) {
      const orNull = (v) => (v !== undefined && v !== null && String(v).trim()) ? v : null;
      const { rows } = await pool.query(
        `INSERT INTO case_damages (case_id, name, category, description, amount, documentation_status, billed, reduction_value, insurance_paid, write_off, client_paid)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [caseId, e.name || "", e.category || "Medical Bill", e.description || "",
         orNull(e.billed), e.documentationStatus || "Documented",
         orNull(e.billed), orNull(e.reductionValue), orNull(e.insurancePaid),
         orNull(e.writeOff), orNull(e.clientPaid)]
      );
      saved.push(toFrontend(rows[0]));
    }

    res.json({ entries: saved, filename });
  } catch (err) {
    console.error("Damage upload-bill error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
