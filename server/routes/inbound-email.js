const express = require("express");
const multer = require("multer");
const pool = require("../db");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post("/", upload.any(), async (req, res) => {
  try {
    const to = req.body.to || "";
    const cc = req.body.cc || "";
    const from = req.body.from || "";
    const subject = req.body.subject || "";
    const text = req.body.text || "";
    const html = req.body.html || "";

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

    const attachments = [];
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

    const envInfo = req.body.envelope ? JSON.parse(req.body.envelope) : null;
    const numAttach = req.body["attachment-info"] ? Object.keys(JSON.parse(req.body["attachment-info"])).length : 0;

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
