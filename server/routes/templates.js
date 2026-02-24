const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const toFrontend = (row) => ({
  id: row.id,
  name: row.name,
  tags: row.tags || [],
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  placeholders: row.placeholders || [],
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, tags, created_by, created_by_name, placeholders, created_at, updated_at FROM doc_templates ORDER BY name"
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Templates fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  if (!req.file.originalname.endsWith(".docx")) return res.status(400).json({ error: "Only .docx files are supported" });

  try {
    const result = await mammoth.extractRawText({ buffer: req.file.buffer });
    const text = result.value || "";

    const paragraphs = text.split("\n").filter(p => p.trim());

    return res.json({ text, paragraphs });
  } catch (err) {
    console.error("Template upload/parse error:", err);
    return res.status(500).json({ error: "Failed to parse document" });
  }
});

router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { name, tags, placeholders } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Template name is required" });

  let parsedTags = [];
  let parsedPlaceholders = [];
  try {
    parsedTags = JSON.parse(tags || "[]");
    parsedPlaceholders = JSON.parse(placeholders || "[]");
  } catch { }

  try {
    const zip = new PizZip(req.file.buffer);

    const sorted = [...parsedPlaceholders].sort((a, b) => (b.original || "").length - (a.original || "").length);

    const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
    for (const xmlPath of xmlFiles) {
      const file = zip.file(xmlPath);
      if (!file) continue;
      let xml = file.asText();
      for (const ph of sorted) {
        if (!ph.original) continue;
        const escaped = ph.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const tagPattern = new RegExp(escaped.split("").map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("(?:<[^>]*>)*"), "g");
        const simplePattern = new RegExp(escaped, "g");
        xml = xml.replace(simplePattern, `{{${ph.token}}}`);
      }
      zip.file(xmlPath, xml);
    }

    const modifiedBuffer = zip.generate({ type: "nodebuffer" });

    const { rows } = await pool.query(
      `INSERT INTO doc_templates (name, tags, created_by, created_by_name, placeholders, docx_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, tags, created_by, created_by_name, placeholders, created_at, updated_at`,
      [
        name.trim(),
        parsedTags,
        req.session.userId,
        req.session.userName,
        JSON.stringify(parsedPlaceholders),
        modifiedBuffer,
      ]
    );
    return res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Template save error:", err);
    return res.status(500).json({ error: "Failed to save template" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const { name, tags, placeholders } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE doc_templates SET name=$1, tags=$2, placeholders=$3, updated_at=NOW()
       WHERE id=$4 RETURNING id, name, tags, created_by, created_by_name, placeholders, created_at, updated_at`,
      [
        name || "",
        Array.isArray(tags) ? tags : JSON.parse(tags || "[]"),
        JSON.stringify(Array.isArray(placeholders) ? placeholders : JSON.parse(placeholders || "[]")),
        req.params.id,
      ]
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
    const { rows } = await pool.query("DELETE FROM doc_templates WHERE id=$1 RETURNING id", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
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
