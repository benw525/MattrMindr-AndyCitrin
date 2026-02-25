const express = require("express");
const multer = require("multer");
const { simpleParser } = require("mailparser");
const pool = require("../db");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/", upload.any(), async (req, res) => {
  try {
    console.log("=== INBOUND EMAIL DEBUG ===");
    console.log("Body fields:", Object.keys(req.body));
    console.log("attachment-info:", req.body["attachment-info"] || "NONE");
    console.log("req.files count:", req.files ? req.files.length : "null/undefined");
    if (req.files && req.files.length > 0) {
      req.files.forEach((f, i) => console.log(`  file[${i}]: fieldname=${f.fieldname}, originalname=${f.originalname}, mimetype=${f.mimetype}, size=${f.size}`));
    }

    let to, cc, from, subject, text, html, attachments = [];

    if (req.body.email) {
      console.log("Raw MIME mode detected — parsing with mailparser");
      const parsed = await simpleParser(req.body.email);
      to = parsed.to ? parsed.to.text : "";
      cc = parsed.cc ? parsed.cc.text : "";
      from = parsed.from ? parsed.from.text : "";
      subject = parsed.subject || "";
      text = parsed.text || "";
      html = parsed.html || "";

      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
          if (att.contentDisposition === "inline" && att.contentId) continue;
          attachments.push({
            filename: att.filename || "attachment",
            contentType: att.contentType || "application/octet-stream",
            size: att.size || att.content.length,
            data: att.content.toString("base64"),
          });
        }
      }
      console.log("Parsed from raw MIME:", attachments.length, "attachments");
    } else {
      console.log("Parsed mode detected");
      to = req.body.to || "";
      cc = req.body.cc || "";
      from = req.body.from || "";
      subject = req.body.subject || "";
      text = req.body.text || "";
      html = req.body.html || "";

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          attachments.push({
            filename: file.originalname,
            contentType: file.mimetype,
            size: file.size,
            data: file.buffer.toString("base64"),
          });
        }
      }

      if (attachments.length === 0 && req.body["attachment-info"]) {
        try {
          const info = JSON.parse(req.body["attachment-info"]);
          console.log("attachment-info parsed:", JSON.stringify(info));
          console.log("WARNING: attachment-info present but no files received from multer");
        } catch (e) {
          console.log("attachment-info parse error:", e.message);
        }
      }
    }

    console.log("=== END DEBUG ===");

    const allAddresses = `${to} ${cc}`.toLowerCase();
    const caseMatch = allAddresses.match(/case-(\d+)@/);
    if (!caseMatch) {
      console.log("Inbound email: no case address found in:", allAddresses);
      return res.status(200).send("OK");
    }

    const caseId = parseInt(caseMatch[1]);
    const caseCheck = await pool.query("SELECT id FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
    if (caseCheck.rows.length === 0) {
      console.log("Inbound email: case not found:", caseId);
      return res.status(200).send("OK");
    }

    const fromName = from.replace(/<.*>/, "").trim().replace(/^"(.*)"$/, "$1") || from;
    const fromEmail = (from.match(/<(.+)>/) || [, from])[1] || from;

    await pool.query(
      `INSERT INTO case_correspondence (case_id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [caseId, fromEmail, fromName, to, cc, subject, text, html, JSON.stringify(attachments)]
    );

    console.log(`Inbound email saved: case ${caseId}, from ${fromEmail}, subject "${subject}", ${attachments.length} attachments`);
    return res.status(200).send("OK");
  } catch (err) {
    console.error("Inbound email error:", err);
    return res.status(200).send("OK");
  }
});

module.exports = router;
