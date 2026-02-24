const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  fromEmail: row.from_email,
  fromName: row.from_name,
  toEmails: row.to_emails,
  ccEmails: row.cc_emails,
  subject: row.subject,
  bodyText: row.body_text,
  bodyHtml: row.body_html,
  attachments: Array.isArray(row.attachments) ? row.attachments.map(a => ({
    filename: a.filename,
    contentType: a.contentType,
    size: a.size,
  })) : [],
  hasAttachments: Array.isArray(row.attachments) && row.attachments.length > 0,
  receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, case_id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments, received_at FROM case_correspondence WHERE case_id = $1 ORDER BY received_at DESC",
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Correspondence fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/attachment/:id/:index", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT attachments FROM case_correspondence WHERE id = $1",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    const attachments = rows[0].attachments || [];
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= attachments.length) return res.status(404).json({ error: "Attachment not found" });
    const att = attachments[idx];
    const buffer = Buffer.from(att.data, "base64");
    res.setHeader("Content-Type", att.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${att.filename}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch (err) {
    console.error("Attachment download error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM case_correspondence WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Correspondence delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
