const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const TEMPLATE_FIELDS = "id, name, tags, created_by, created_by_name, placeholders, visibility, created_at, updated_at";

const toFrontend = (row) => ({
  id: row.id,
  name: row.name,
  tags: row.tags || [],
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  placeholders: row.placeholders || [],
  visibility: row.visibility || "global",
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

const isShareholder = (req) => (req.session.userRoles || [req.session.userRole]).includes("Shareholder");
const canEditTemplate = (req, template) => {
  return template.created_by === req.session.userId || isShareholder(req);
};

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${TEMPLATE_FIELDS} FROM doc_templates WHERE visibility = 'global' OR created_by = $1 ORDER BY name`,
      [req.session.userId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Templates fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const fname = req.file.originalname.toLowerCase();
  if (!fname.endsWith(".docx") && !fname.endsWith(".doc")) {
    return res.status(400).json({ error: "Only .doc and .docx files are supported" });
  }

  const isDoc = fname.endsWith(".doc") && !fname.endsWith(".docx");

  try {
    let text = "";
    if (isDoc) {
      try {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = result.value || "";
      } catch (docErr) {
        console.error("mammoth .doc parse failed, trying convertToHtml:", docErr.message);
        try {
          const htmlResult = await mammoth.convertToHtml({ buffer: req.file.buffer });
          text = (htmlResult.value || "").replace(/<[^>]+>/g, "");
        } catch (htmlErr) {
          console.error("mammoth .doc convertToHtml also failed:", htmlErr.message);
          return res.status(400).json({
            error: "This .doc file could not be parsed. Older .doc files (Word 97-2003) may use formatting that isn't supported. Please open it in Word or Google Docs and re-save as .docx, then upload the .docx version."
          });
        }
      }
    } else {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value || "";
    }

    if (!text.trim()) {
      return res.status(400).json({ error: "The document appears to be empty or its content could not be extracted. If this is a scanned document or image-based PDF saved as .doc, please convert it to a text-based .docx file first." });
    }

    const paragraphs = text.split("\n").filter(p => p.trim());
    return res.json({ text, paragraphs, isDoc });
  } catch (err) {
    console.error("Template upload/parse error:", err);
    return res.status(500).json({ error: "Failed to parse document. Please ensure the file is a valid Word document (.doc or .docx)." });
  }
});

router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const fname = req.file.originalname.toLowerCase();
  if (!fname.endsWith(".docx") && !fname.endsWith(".doc")) {
    return res.status(400).json({ error: "Only .doc and .docx files are supported" });
  }

  const { name, tags, placeholders } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Template name is required" });

  let parsedTags = [];
  let parsedPlaceholders = [];
  try {
    parsedTags = JSON.parse(tags || "[]");
    parsedPlaceholders = JSON.parse(placeholders || "[]");
  } catch { }

  const isDoc = fname.endsWith(".doc") && !fname.endsWith(".docx");

  try {
    let docxBuffer = req.file.buffer;

    if (isDoc) {
      const result = await mammoth.convertToHtml({ buffer: req.file.buffer });
      const htmlContent = result.value || "";
      const newZip = new PizZip();
      newZip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      newZip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      newZip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>');

      const plainText = htmlContent.replace(/<[^>]+>/g, "").trim();
      const paragraphs = plainText.split(/\n+/).filter(p => p.trim());
      const bodyXml = paragraphs.map(p =>
        `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</w:t></w:r></w:p>`
      ).join("");

      newZip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14"><w:body>${bodyXml}</w:body></w:document>`);

      docxBuffer = newZip.generate({ type: "nodebuffer" });
    }

    const zip = new PizZip(docxBuffer);

    const blankFields = parsedPlaceholders.filter(ph => ph.original && /^\[.+\]$/.test(ph.original) && ph.mapping === "_manual");
    const replacements = parsedPlaceholders.filter(ph => !blankFields.includes(ph));
    const sortedReplacements = [...replacements].sort((a, b) => (b.original || "").length - (a.original || "").length);

    const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
    for (const xmlPath of xmlFiles) {
      const file = zip.file(xmlPath);
      if (!file) continue;
      let xml = file.asText();
      for (const ph of sortedReplacements) {
        if (!ph.original) continue;
        const escaped = ph.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const simplePattern = new RegExp(escaped, "g");
        xml = xml.replace(simplePattern, `{{${ph.token}}}`);
      }
      if (blankFields.length > 0 && xmlPath === "word/document.xml") {
        const blankRuns = blankFields.map(ph =>
          `<w:p><w:r><w:t>{{${ph.token}}}</w:t></w:r></w:p>`
        ).join("");
        xml = xml.replace(/<\/w:body>/, blankRuns + "</w:body>");
      }
      zip.file(xmlPath, xml);
    }

    const modifiedBuffer = zip.generate({ type: "nodebuffer" });

    const { rows } = await pool.query(
      `INSERT INTO doc_templates (name, tags, created_by, created_by_name, placeholders, docx_data, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${TEMPLATE_FIELDS}`,
      [
        name.trim(),
        parsedTags,
        req.session.userId,
        req.session.userName,
        JSON.stringify(parsedPlaceholders),
        modifiedBuffer,
        req.body.visibility === "personal" ? "personal" : "global",
      ]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Template save error:", err);
    return res.status(500).json({ error: "Failed to save template" });
  }
});

router.get("/:id/source", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT docx_data, placeholders, created_by FROM doc_templates WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (!canEditTemplate(req, rows[0])) return res.status(403).json({ error: "Permission denied" });

    const oldPlaceholders = rows[0].placeholders || [];
    const zip = new PizZip(rows[0].docx_data);
    let xml = "";
    const xmlFile = zip.file("word/document.xml");
    if (xmlFile) xml = xmlFile.asText();

    let cleanXml = xml;
    for (const ph of oldPlaceholders) {
      const tokenPattern = new RegExp(`\\{\\{${ph.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}`, "g");
      cleanXml = cleanXml.replace(tokenPattern, (ph.original || ph.token));
    }

    const cleanZip = new PizZip(rows[0].docx_data);
    cleanZip.file("word/document.xml", cleanXml);
    const cleanBuffer = cleanZip.generate({ type: "nodebuffer" });

    const result = await mammoth.extractRawText({ buffer: cleanBuffer });
    const text = result.value || "";

    const positioned = [];
    const usedRanges = [];
    for (const ph of oldPlaceholders) {
      const orig = ph.original || "";
      let searchFrom = 0;
      let idx = -1;
      while (true) {
        idx = text.indexOf(orig, searchFrom);
        if (idx === -1) break;
        const overlaps = usedRanges.some(r => !(idx + orig.length <= r.start || idx >= r.end));
        if (!overlaps) break;
        searchFrom = idx + 1;
      }
      if (idx !== -1) {
        usedRanges.push({ start: idx, end: idx + orig.length });
        positioned.push({
          id: Date.now() + Math.random(),
          label: ph.label,
          token: ph.token,
          original: orig,
          start: idx,
          end: idx + orig.length,
          mapping: ph.mapping || "_manual",
        });
      }
    }

    return res.json({ text, placeholders: positioned });
  } catch (err) {
    console.error("Template source error:", err);
    return res.status(500).json({ error: "Failed to load template source" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const { name, tags, placeholders, visibility, reprocessDocx } = req.body;
  try {
    const { rows: existing } = await pool.query("SELECT created_by, docx_data, placeholders AS old_placeholders FROM doc_templates WHERE id = $1", [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: "Not found" });
    if (!canEditTemplate(req, existing[0])) return res.status(403).json({ error: "Only the creator or a Shareholder can edit this template" });

    const sets = ["updated_at = NOW()"];
    const vals = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (tags !== undefined) { sets.push(`tags = $${idx++}`); vals.push(Array.isArray(tags) ? tags : JSON.parse(tags || "[]")); }
    if (visibility !== undefined) { sets.push(`visibility = $${idx++}`); vals.push(visibility === "personal" ? "personal" : "global"); }

    let parsedNewPhs = [];
    if (placeholders !== undefined) {
      parsedNewPhs = Array.isArray(placeholders) ? placeholders : JSON.parse(placeholders || "[]");
      sets.push(`placeholders = $${idx++}`);
      vals.push(JSON.stringify(parsedNewPhs));
    }

    if (reprocessDocx && placeholders !== undefined) {
      const oldPhs = existing[0].old_placeholders || [];
      const zip = new PizZip(existing[0].docx_data);
      const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];

      for (const xmlPath of xmlFiles) {
        const file = zip.file(xmlPath);
        if (!file) continue;
        let xml = file.asText();

        const oldBlankTokens = oldPhs.filter(ph => ph.original && /^\[.+\]$/.test(ph.original) && ph.mapping === "_manual").map(ph => ph.token);
        for (const ph of oldPhs) {
          const tokenPattern = new RegExp(`\\{\\{${ph.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}`, "g");
          if (oldBlankTokens.includes(ph.token)) {
            xml = xml.replace(new RegExp(`<w:p><w:r><w:t>\\{\\{${ph.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}</w:t></w:r></w:p>`, "g"), "");
            xml = xml.replace(tokenPattern, "");
          } else {
            xml = xml.replace(tokenPattern, (ph.original || ph.token));
          }
        }

        const newBlankFields = parsedNewPhs.filter(ph => ph.original && /^\[.+\]$/.test(ph.original) && ph.mapping === "_manual");
        const newReplacements = parsedNewPhs.filter(ph => !newBlankFields.includes(ph));
        const sorted = [...newReplacements].sort((a, b) => (b.original || "").length - (a.original || "").length);
        for (const ph of sorted) {
          if (!ph.original) continue;
          const escaped = ph.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const simplePattern = new RegExp(escaped, "g");
          xml = xml.replace(simplePattern, `{{${ph.token}}}`);
        }

        if (newBlankFields.length > 0 && xmlPath === "word/document.xml") {
          const blankRuns = newBlankFields.map(ph =>
            `<w:p><w:r><w:t>{{${ph.token}}}</w:t></w:r></w:p>`
          ).join("");
          xml = xml.replace(/<\/w:body>/, blankRuns + "</w:body>");
        }

        zip.file(xmlPath, xml);
      }

      const newDocxData = zip.generate({ type: "nodebuffer" });
      sets.push(`docx_data = $${idx++}`);
      vals.push(newDocxData);
    }

    vals.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE doc_templates SET ${sets.join(", ")} WHERE id = $${idx} RETURNING ${TEMPLATE_FIELDS}`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Template update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows: existing } = await pool.query("SELECT created_by FROM doc_templates WHERE id = $1", [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: "Not found" });
    if (!canEditTemplate(req, existing[0])) return res.status(403).json({ error: "Only the creator or a Shareholder can delete this template" });
    await pool.query("DELETE FROM doc_templates WHERE id=$1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Template delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/generate", requireAuth, async (req, res) => {
  const { values } = req.body;
  if (!values || typeof values !== "object") return res.status(400).json({ error: "Values required" });

  try {
    const { rows } = await pool.query("SELECT * FROM doc_templates WHERE id=$1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Template not found" });

    const template = rows[0];
    const zip = new PizZip(template.docx_data);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "{{", end: "}}" },
    });

    doc.render(values);

    const output = doc.getZip().generate({
      type: "nodebuffer",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${template.name.replace(/[^a-zA-Z0-9 ._-]/g, "")}.docx"`);
    res.setHeader("Content-Length", output.length);
    return res.send(output);
  } catch (err) {
    console.error("Document generation error:", err);
    return res.status(500).json({ error: "Failed to generate document" });
  }
});

module.exports = router;
