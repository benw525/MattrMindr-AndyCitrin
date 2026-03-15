const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const path = require("path");
const fs = require("fs");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isR2Configured, uploadToR2, downloadFromR2 } = require("../r2");

async function getTemplateBuffer(row) {
  if (row.s3_key && isR2Configured()) {
    try { return await downloadFromR2(row.s3_key); } catch (e) { console.error("S3 template download fallback:", e.message); }
  }
  return row.docx_data || null;
}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const SYSTEM_TEMPLATES_DIR = path.join(__dirname, "..", "system-templates");

function loadSystemTemplate(filename) {
  const filePath = path.join(SYSTEM_TEMPLATES_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

function extractBodyXml(buffer) {
  const zip = new PizZip(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return "";
  const xml = docFile.asText();
  const bodyMatch = xml.match(/<w:body>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return "";
  let body = bodyMatch[1];
  body = body.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, "");
  return body.trim();
}

function escapeXml(str) {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildCoSXml(cosBuffer, servedParties) {
  const bodyXml = extractBodyXml(cosBuffer);
  if (!bodyXml) return "";
  const paragraphs = bodyXml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  const partyTokens = ["ATTORNEY", "ATTORNEY_FIRM", "ATTORNEY_ADDRESS", "ATTORNEY_PHONE", "ATTORNEY_EMAIL"];
  const headerPs = [];
  const partyPs = [];
  const footerPs = [];
  let inPartyBlock = false;
  for (const p of paragraphs) {
    const hasPartyPh = partyTokens.some(t => p.includes(`{{${t}}}`));
    if (hasPartyPh) {
      partyPs.push(p);
      inPartyBlock = true;
    } else if (!inPartyBlock) {
      headerPs.push(p);
    } else {
      footerPs.push(p);
    }
  }
  let result = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  result += headerPs.join("");
  for (let i = 0; i < servedParties.length; i++) {
    const party = servedParties[i];
    for (const p of partyPs) {
      let filled = p;
      filled = filled.replace(/\{\{ATTORNEY\}\}/g, escapeXml(party.attorney));
      filled = filled.replace(/\{\{ATTORNEY_FIRM\}\}/g, escapeXml(party.firm));
      filled = filled.replace(/\{\{ATTORNEY_ADDRESS\}\}/g, escapeXml(party.address));
      filled = filled.replace(/\{\{ATTORNEY_PHONE\}\}/g, escapeXml(party.phone));
      filled = filled.replace(/\{\{ATTORNEY_EMAIL\}\}/g, escapeXml(party.email));
      result += filled;
    }
    if (i < servedParties.length - 1) result += '<w:p/>';
  }
  result += footerPs.join("");
  return result;
}

function assemblePleading(mainBuffer, headerXml, signatureXml, cosXml) {
  const zip = new PizZip(mainBuffer);
  const docFile = zip.file("word/document.xml");
  let xml = docFile.asText();
  const bodyMatch = xml.match(/(<w:body>)([\s\S]*)(<\/w:body>)/);
  if (!bodyMatch) return mainBuffer;
  let bodyContent = bodyMatch[2];
  let sectPr = "";
  const sectPrMatch = bodyContent.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/);
  if (sectPrMatch) {
    sectPr = sectPrMatch[0];
    bodyContent = bodyContent.replace(sectPr, "");
  }
  const assembled = (headerXml || "") + bodyContent + (signatureXml || "") + (cosXml || "") + sectPr;
  xml = xml.replace(/(<w:body>)[\s\S]*(<\/w:body>)/, `$1${assembled}$2`);
  zip.file("word/document.xml", xml);
  return zip.generate({ type: "nodebuffer" });
}

const TEMPLATE_FIELDS = "id, name, tags, created_by, created_by_name, placeholders, visibility, category, sub_type, use_system_header, use_system_signature, use_system_cos, created_at, updated_at";

const toFrontend = (row) => ({
  id: row.id,
  name: row.name,
  tags: row.tags || [],
  createdBy: row.created_by,
  createdByName: row.created_by_name,
  placeholders: row.placeholders || [],
  visibility: row.visibility || "global",
  category: row.category || "General",
  subType: row.sub_type || "",
  useSystemHeader: row.use_system_header !== false,
  useSystemSignature: row.use_system_signature !== false,
  useSystemCos: row.use_system_cos !== false,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

const isShareholder = (req) => (req.session.userRoles || [req.session.userRole]).includes("Shareholder");
const canEditTemplate = (req, template) => {
  return template.created_by === req.session.userId || isShareholder(req);
};

function extractAngleBracketPlaceholders(text) {
  const regex = /<<([A-Za-z0-9_]+)>>/g;
  const found = [];
  const seen = new Set();
  let match;
  while ((match = regex.exec(text)) !== null) {
    const token = match[1];
    if (!seen.has(token)) {
      seen.add(token);
      const label = token.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      found.push({ token, label });
    }
  }
  return found;
}

function scanDocxForPlaceholders(buffer) {
  try {
    const zip = new PizZip(buffer);
    const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
    let allText = "";
    for (const xmlPath of xmlFiles) {
      const file = zip.file(xmlPath);
      if (!file) continue;
      allText += " " + file.asText();
    }
    return extractAngleBracketPlaceholders(allText);
  } catch (err) {
    console.error("scanDocxForPlaceholders error:", err.message);
    return [];
  }
}

function detectPleadingSections(buffer) {
  try {
    const zip = new PizZip(buffer);
    const docFile = zip.file("word/document.xml");
    if (!docFile) return { hasHeader: false, hasSignature: false, hasCos: false };
    const xml = docFile.asText();

    const textContent = xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();

    const headerTokenPatterns = ["{{court}}", "{{county}}", "{{plaintiffs}}", "{{defendants}}", "{{case_number}}",
      "<<court>>", "<<county>>", "<<plaintiffs>>", "<<defendants>>", "<<case_number>>"];
    const headerTextPatterns = [/in the circuit court/i, /in the district court/i, /in the superior court/i,
      /in the court of/i, /civil action/i, /case no\b/i, /cause no\b/i,
      /\bplaintiff\s*[,)]/i, /\bdefendant\s*[,)]/i, /\bv\.\s/i, /\bvs\.\s/i];
    const headerTokenHits = headerTokenPatterns.filter(t => xml.toLowerCase().includes(t)).length;
    const headerTextHits = headerTextPatterns.filter(p => p.test(textContent)).length;
    const hasHeader = headerTokenHits >= 2 || headerTextHits >= 2 || (headerTokenHits >= 1 && headerTextHits >= 1);

    const sigTokenPatterns = ["{{signature}}", "{{attorney_name}}", "{{attorney_firm}}", "{{attorney_code}}",
      "<<signature>>", "<<attorney_name>>", "<<attorney_firm>>", "<<attorney_code>>"];
    const sigTextPatterns = [/respectfully submitted/i, /\/s\//i, /attorney for/i, /bar no/i, /bar number/i,
      /counsel for/i, /attorney at law/i];
    const sigTokenHits = sigTokenPatterns.filter(t => xml.toLowerCase().includes(t)).length;
    const sigTextHits = sigTextPatterns.filter(p => p.test(textContent)).length;
    const hasSignature = sigTokenHits >= 2 || sigTextHits >= 2 || (sigTokenHits >= 1 && sigTextHits >= 1);

    const cosTokenPatterns = ["{{attorney}}", "{{attorney_firm}}", "{{attorney_address}}"];
    const cosTextPatterns = [/certificate of service/i, /i hereby certify/i, /served upon/i,
      /was served/i, /mailing a copy/i, /electronic.{0,20}service/i,
      /certif.{0,30}(mail|serv|deliver|filing)/i, /true and correct copy/i,
      /undersigned.{0,30}certif/i, /hand.{0,10}deliver/i, /first.class mail/i,
      /u\.?\s*s\.?\s*mail/i, /cm.{0,5}ecf/i, /efiling/i, /e-fil/i];
    const cosTokenHits = cosTokenPatterns.filter(t => xml.toLowerCase().includes(t)).length;
    const cosTextHits = cosTextPatterns.filter(p => p.test(textContent)).length;
    const hasCos = cosTextHits >= 1 || cosTokenHits >= 1;

    return { hasHeader, hasSignature, hasCos };
  } catch (err) {
    console.error("detectPleadingSections error:", err.message);
    return { hasHeader: false, hasSignature: false, hasCos: false };
  }
}

function mergeAngleBracketRuns(xml) {
  let prev = "";
  while (prev !== xml) {
    prev = xml;
    xml = xml.replace(/(&lt;)(<\/w:t><\/w:r><w:r(?:\s[^>]*)?>?<w:t(?:\s[^>]*)?>)(&lt;)/g, "$1$3");
    xml = xml.replace(/(&lt;&lt;[A-Za-z0-9_]*)(<\/w:t><\/w:r><w:r(?:\s[^>]*)?>?<w:t(?:\s[^>]*)?>)([A-Za-z0-9_]*&gt;)/g, "$1$3");
    xml = xml.replace(/(&gt;)(<\/w:t><\/w:r><w:r(?:\s[^>]*)?>?<w:t(?:\s[^>]*)?>)(&gt;)/g, "$1$3");
    xml = xml.replace(/(<<[A-Za-z0-9_]*)(<\/w:t><\/w:r><w:r(?:\s[^>]*)?>?<w:t(?:\s[^>]*)?>)([A-Za-z0-9_]*>>)/g, "$1$3");
  }
  return xml;
}

function convertAngleBracketsInDocx(buffer) {
  const zip = new PizZip(buffer);
  const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
  for (const xmlPath of xmlFiles) {
    const file = zip.file(xmlPath);
    if (!file) continue;
    let xml = file.asText();
    xml = mergeAngleBracketRuns(xml);
    xml = xml.replace(/&lt;&lt;([A-Za-z0-9_]+)&gt;&gt;/g, "{{$1}}");
    xml = xml.replace(/<<([A-Za-z0-9_]+)>>/g, "{{$1}}");
    zip.file(xmlPath, xml);
  }
  return zip.generate({ type: "nodebuffer" });
}

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

    const detectedPlaceholders = isDoc
      ? extractAngleBracketPlaceholders(text)
      : scanDocxForPlaceholders(req.file.buffer);

    const paragraphs = text.split("\n").filter(p => p.trim());
    return res.json({ text, paragraphs, isDoc, detectedPlaceholders });
  } catch (err) {
    console.error("Template upload/parse error:", err);
    return res.status(500).json({ error: "Failed to parse document. Please ensure the file is a valid Word document (.doc or .docx)." });
  }
});

router.post("/detect-pleading-sections", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  try {
    const result = detectPleadingSections(req.file.buffer);
    return res.json(result);
  } catch (err) {
    console.error("Detect pleading sections error:", err);
    return res.status(500).json({ error: "Failed to analyze document" });
  }
});

router.post("/", requireAuth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const fname = req.file.originalname.toLowerCase();
  if (!fname.endsWith(".docx") && !fname.endsWith(".doc")) {
    return res.status(400).json({ error: "Only .doc and .docx files are supported" });
  }

  const { name, tags, placeholders, category, subType } = req.body;
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

    docxBuffer = convertAngleBracketsInDocx(docxBuffer);

    const manualPhs = parsedPlaceholders.filter(ph => ph.original);
    if (manualPhs.length > 0) {
      const zip = new PizZip(docxBuffer);
      const sorted = [...manualPhs].sort((a, b) => (b.original || "").length - (a.original || "").length);
      const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];
      for (const xmlPath of xmlFiles) {
        const file = zip.file(xmlPath);
        if (!file) continue;
        let xml = file.asText();
        for (const ph of sorted) {
          if (!ph.original) continue;
          const escaped = ph.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const simplePattern = new RegExp(escaped, "g");
          xml = xml.replace(simplePattern, `{{${ph.token}}}`);
        }
        zip.file(xmlPath, xml);
      }
      docxBuffer = zip.generate({ type: "nodebuffer" });
    }

    const storedPlaceholders = parsedPlaceholders.map(ph => ({
      token: ph.token,
      label: ph.label,
      ...(ph.original ? { original: ph.original } : {}),
      ...(ph.mapping && ph.mapping !== "_manual" ? { mapping: ph.mapping } : {}),
    }));

    const useSystemHeader = req.body.useSystemHeader !== "false";
    const useSystemSignature = req.body.useSystemSignature !== "false";
    const useSystemCos = req.body.useSystemCos !== "false";

    let s3Key = null;
    if (isR2Configured()) {
      try {
        const { randomUUID } = require("crypto");
        s3Key = `templates/${randomUUID()}/${name.trim()}.docx`;
        await uploadToR2(s3Key, docxBuffer, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      } catch (e) { console.error("S3 template pre-upload failed, using BYTEA:", e.message); s3Key = null; }
    }

    const { rows } = await pool.query(
      `INSERT INTO doc_templates (name, tags, created_by, created_by_name, placeholders, docx_data, visibility, category, sub_type, use_system_header, use_system_signature, use_system_cos, s3_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING ${TEMPLATE_FIELDS}`,
      [
        name.trim(),
        parsedTags,
        req.session.userId,
        req.session.userName,
        JSON.stringify(storedPlaceholders),
        s3Key ? null : docxBuffer,
        req.body.visibility === "personal" ? "personal" : "global",
        category || "General",
        subType || "",
        useSystemHeader,
        useSystemSignature,
        useSystemCos,
        s3Key,
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
    const { rows } = await pool.query("SELECT docx_data, placeholders, created_by, s3_key FROM doc_templates WHERE id = $1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (!canEditTemplate(req, rows[0])) return res.status(403).json({ error: "Permission denied" });

    const templateBuffer = await getTemplateBuffer(rows[0]);
    if (!templateBuffer) return res.status(400).json({ error: "No template data" });
    const oldPlaceholders = rows[0].placeholders || [];
    const zip = new PizZip(templateBuffer);
    let xml = "";
    const xmlFile = zip.file("word/document.xml");
    if (xmlFile) xml = xmlFile.asText();

    let cleanXml = xml;
    for (const ph of oldPlaceholders) {
      const tokenPattern = new RegExp(`\\{\\{${ph.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}`, "g");
      cleanXml = cleanXml.replace(tokenPattern, (ph.original || `<<${ph.token}>>`));
    }

    const cleanZip = new PizZip(templateBuffer);
    cleanZip.file("word/document.xml", cleanXml);
    const cleanBuffer = cleanZip.generate({ type: "nodebuffer" });

    const result = await mammoth.extractRawText({ buffer: cleanBuffer });
    const text = result.value || "";

    const positioned = [];
    const usedRanges = [];
    for (const ph of oldPlaceholders) {
      const searchText = ph.original || `<<${ph.token}>>`;
      let searchFrom = 0;
      let idx = -1;
      while (true) {
        idx = text.indexOf(searchText, searchFrom);
        if (idx === -1) break;
        const overlaps = usedRanges.some(r => !(idx + searchText.length <= r.start || idx >= r.end));
        if (!overlaps) break;
        searchFrom = idx + 1;
      }
      if (idx !== -1) {
        usedRanges.push({ start: idx, end: idx + searchText.length });
        positioned.push({
          id: Date.now() + Math.random(),
          label: ph.label,
          token: ph.token,
          original: ph.original || "",
          start: idx,
          end: idx + searchText.length,
          autoDetected: !ph.original,
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
  const { name, tags, placeholders, visibility, reprocessDocx, category, subType, useSystemHeader, useSystemSignature, useSystemCos } = req.body;
  try {
    const { rows: existing } = await pool.query("SELECT created_by, docx_data, placeholders AS old_placeholders, s3_key FROM doc_templates WHERE id = $1", [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: "Not found" });
    if (!canEditTemplate(req, existing[0])) return res.status(403).json({ error: "Only the creator or a Shareholder can edit this template" });

    const sets = ["updated_at = NOW()"];
    const vals = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (tags !== undefined) { sets.push(`tags = $${idx++}`); vals.push(Array.isArray(tags) ? tags : JSON.parse(tags || "[]")); }
    if (visibility !== undefined) { sets.push(`visibility = $${idx++}`); vals.push(visibility === "personal" ? "personal" : "global"); }
    if (category !== undefined) { sets.push(`category = $${idx++}`); vals.push(category); }
    if (subType !== undefined) { sets.push(`sub_type = $${idx++}`); vals.push(subType); }
    if (useSystemHeader !== undefined) { sets.push(`use_system_header = $${idx++}`); vals.push(useSystemHeader); }
    if (useSystemSignature !== undefined) { sets.push(`use_system_signature = $${idx++}`); vals.push(useSystemSignature); }
    if (useSystemCos !== undefined) { sets.push(`use_system_cos = $${idx++}`); vals.push(useSystemCos); }

    let parsedNewPhs = [];
    if (placeholders !== undefined) {
      parsedNewPhs = Array.isArray(placeholders) ? placeholders : JSON.parse(placeholders || "[]");
      const storedPhs = parsedNewPhs.map(ph => ({
        token: ph.token,
        label: ph.label,
        ...(ph.original ? { original: ph.original } : {}),
        ...(ph.mapping && ph.mapping !== "_manual" ? { mapping: ph.mapping } : {}),
      }));
      sets.push(`placeholders = $${idx++}`);
      vals.push(JSON.stringify(storedPhs));
    }

    if (reprocessDocx && placeholders !== undefined) {
      const oldPhs = existing[0].old_placeholders || [];
      const existingBuffer = await getTemplateBuffer(existing[0]);
      if (!existingBuffer) return res.status(400).json({ error: "No template data" });
      const zip = new PizZip(existingBuffer);
      const xmlFiles = ["word/document.xml", "word/header1.xml", "word/header2.xml", "word/header3.xml", "word/footer1.xml", "word/footer2.xml", "word/footer3.xml"];

      for (const xmlPath of xmlFiles) {
        const file = zip.file(xmlPath);
        if (!file) continue;
        let xml = file.asText();

        for (const ph of oldPhs) {
          const tokenPattern = new RegExp(`\\{\\{${ph.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}`, "g");
          xml = xml.replace(tokenPattern, (ph.original || `<<${ph.token}>>`));
        }

        xml = xml.replace(/&lt;&lt;([A-Za-z0-9_]+)&gt;&gt;/g, "{{$1}}");
        xml = xml.replace(/<<([A-Za-z0-9_]+)>>/g, "{{$1}}");

        const manualPhs = parsedNewPhs.filter(ph => ph.original);
        const sorted = [...manualPhs].sort((a, b) => (b.original || "").length - (a.original || "").length);
        for (const ph of sorted) {
          if (!ph.original) continue;
          const escaped = ph.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const simplePattern = new RegExp(escaped, "g");
          xml = xml.replace(simplePattern, `{{${ph.token}}}`);
        }

        zip.file(xmlPath, xml);
      }

      const newDocxData = zip.generate({ type: "nodebuffer" });
      let reprocessS3Key = null;
      if (isR2Configured()) {
        try {
          const tplName = name || "template";
          reprocessS3Key = `templates/${req.params.id}/${tplName}.docx`;
          await uploadToR2(reprocessS3Key, newDocxData, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        } catch (e) { console.error("S3 template reprocess pre-upload failed, using BYTEA:", e.message); reprocessS3Key = null; }
      }
      sets.push(`docx_data = $${idx++}`);
      vals.push(reprocessS3Key ? null : newDocxData);
      if (reprocessS3Key) {
        sets.push(`s3_key = $${idx++}`);
        vals.push(reprocessS3Key);
      }
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
    const { rows: existing } = await pool.query("SELECT created_by, s3_key FROM doc_templates WHERE id = $1", [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: "Not found" });
    if (!canEditTemplate(req, existing[0])) return res.status(403).json({ error: "Only the creator or a Shareholder can delete this template" });
    if (existing[0].s3_key && isR2Configured()) {
      const { deleteFromR2 } = require("../r2");
      deleteFromR2(existing[0].s3_key).catch(e => console.error("S3 template delete error:", e.message));
    }
    await pool.query("DELETE FROM doc_templates WHERE id=$1", [req.params.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Template delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/generate", requireAuth, async (req, res) => {
  const { values, caseId, includeCoS } = req.body;
  if (!values || typeof values !== "object") return res.status(400).json({ error: "Values required" });

  try {
    const { rows } = await pool.query("SELECT * FROM doc_templates WHERE id=$1", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Template not found" });

    const template = rows[0];
    const isPleading = (template.category || "General") === "Pleadings";
    const allPhs = [...(template.placeholders || [])];

    const HEADER_TOKENS = ["COURT", "COUNTY", "STATE", "PLAINTIFFS", "CASE_NUMBER", "DEFENDANTS"];
    const SIG_TOKENS = ["SIGNATURE", "ATTORNEY_NAME", "ATTORNEY_CODE", "CLIENT_TYPE", "CLIENT_NAME", "ATTORNEY_FIRM", "ATTORNEY_ADDRESS", "ATTORNEY_PHONE", "ATTORNEY_EMAIL"];
    if (isPleading) {
      const existing = new Set(allPhs.map(p => p.token));
      for (const token of [...HEADER_TOKENS, ...SIG_TOKENS]) {
        if (!existing.has(token)) {
          allPhs.push({ token, label: token.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) });
        }
      }
    }

    const resolvedValues = {};
    for (const ph of allPhs) {
      const val = values[ph.token];
      if (val === undefined || val === null || val === "") {
        resolvedValues[ph.token] = `<<${ph.token}>>`;
      } else {
        resolvedValues[ph.token] = val;
      }
    }
    for (const [k, v] of Object.entries(values)) {
      if (!(k in resolvedValues)) {
        resolvedValues[k] = v || `<<${k}>>`;
      }
    }

    let docxBuffer = await getTemplateBuffer(template);
    if (!docxBuffer) return res.status(400).json({ error: "No template data" });

    if (isPleading) {
      const useSystemHeader = template.use_system_header !== false;
      const useSystemSignature = template.use_system_signature !== false;
      const useSystemCos = template.use_system_cos !== false;

      const headerBuf = useSystemHeader ? loadSystemTemplate("case-header.docx") : null;
      const sigBuf = useSystemSignature ? loadSystemTemplate("case-signature.docx") : null;
      const cosBuf = (includeCoS && useSystemCos) ? loadSystemTemplate("certificate-of-service.docx") : null;

      const headerXml = headerBuf ? extractBodyXml(headerBuf) : "";
      const sigXml = sigBuf ? extractBodyXml(sigBuf) : "";

      let cosXml = "";
      if (includeCoS && cosBuf && caseId) {
        const { rows: partyRows } = await pool.query(
          "SELECT * FROM case_parties WHERE case_id = $1 ORDER BY created_at", [caseId]
        );
        const servedParties = [];
        for (const p of partyRows) {
          const d = p.data || {};
          if (d.isOurClient) continue;
          if (d.isProSe) {
            const name = p.entity_kind === "corporation"
              ? (d.entityName || "")
              : [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
            servedParties.push({
              attorney: name + " (Pro Se)",
              firm: "",
              address: [d.address, d.city, d.state, d.zip].filter(Boolean).join(", "),
              phone: (d.phones || [])[0]?.number || "",
              email: d.email || "",
            });
          } else {
            const repBy = d.representedBy || "";
            if (repBy) {
              const { rows: contactRows } = await pool.query(
                "SELECT * FROM contacts WHERE name ILIKE $1 AND category = 'Attorney' AND deleted_at IS NULL LIMIT 1", [repBy]
              );
              const contact = contactRows[0];
              if (contact) {
                servedParties.push({
                  attorney: contact.name || repBy,
                  firm: contact.firm || "",
                  address: contact.address || "",
                  phone: contact.phone || "",
                  email: contact.email || "",
                });
              } else {
                servedParties.push({ attorney: repBy, firm: "", address: "", phone: "", email: "" });
              }
            } else {
              const name = p.entity_kind === "corporation"
                ? (d.entityName || "")
                : [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ");
              if (name) {
                servedParties.push({
                  attorney: name,
                  firm: "",
                  address: [d.address, d.city, d.state, d.zip].filter(Boolean).join(", "),
                  phone: (d.phones || [])[0]?.number || "",
                  email: d.email || "",
                });
              }
            }
          }
        }
        if (servedParties.length > 0 && cosBuf) {
          cosXml = buildCoSXml(cosBuf, servedParties);
        }
      }
      docxBuffer = assemblePleading(docxBuffer, headerXml, sigXml, cosXml);
    }

    const zip = new PizZip(docxBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: "{{", end: "}}" },
    });

    doc.render(resolvedValues);

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
