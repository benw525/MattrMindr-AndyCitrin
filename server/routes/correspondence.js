const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const parseAttachments = (raw) => {
  if (!raw) return [];
  let arr = raw;
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr;
};

const toFrontend = (row) => {
  const atts = parseAttachments(row.attachments);
  return {
    id: row.id,
    caseId: row.case_id,
    fromEmail: row.from_email,
    fromName: row.from_name,
    toEmails: row.to_emails,
    ccEmails: row.cc_emails,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    attachments: atts.map(a => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    })),
    hasAttachments: atts.length > 0,
    receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
  };
};

router.get("/all/summary", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, case_id, from_email, from_name, subject, received_at FROM case_correspondence WHERE deleted_at IS NULL ORDER BY received_at DESC"
    );
    return res.json(rows.map(r => ({
      id: r.id,
      caseId: r.case_id,
      fromEmail: r.from_email,
      fromName: r.from_name,
      subject: r.subject,
      receivedAt: r.received_at instanceof Date ? r.received_at.toISOString() : r.received_at,
    })));
  } catch (err) {
    console.error("Correspondence summary error:", err);
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
    const attachments = parseAttachments(rows[0].attachments);
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= attachments.length) return res.status(404).json({ error: "Attachment not found" });
    const att = attachments[idx];
    const buffer = Buffer.from(att.data, "base64");
    const disposition = req.query.inline === "true" ? "inline" : "attachment";
    res.setHeader("Content-Type", att.contentType || "application/octet-stream");
    res.setHeader("Content-Disposition", `${disposition}; filename="${att.filename}"`);
    res.setHeader("Content-Length", buffer.length);
    return res.send(buffer);
  } catch (err) {
    console.error("Attachment download error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, case_id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments, received_at FROM case_correspondence WHERE case_id = $1 AND deleted_at IS NULL ORDER BY received_at DESC",
      [req.params.caseId]
    );
    const result = rows.map(toFrontend);
    console.log(`Correspondence fetch: case ${req.params.caseId}, ${rows.length} emails, attachments: [${result.map(e => e.attachments.length).join(",")}]`);
    return res.json(result);
  } catch (err) {
    console.error("Correspondence fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_correspondence SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Correspondence delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

const ATTORNEY_ROLES = ["Managing Partner", "Senior Partner", "Partner", "Associate Attorney", "Of Counsel", "App Admin"];

router.post("/batch-delete", requireAuth, async (req, res) => {
  try {
    const userRoles = req.session.userRoles || [req.session.userRole];
    if (!userRoles.some(r => ATTORNEY_ROLES.includes(r))) {
      return res.status(403).json({ error: "Only attorneys may batch delete correspondence" });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    const { rowCount } = await pool.query("UPDATE case_correspondence SET deleted_at = NOW() WHERE id = ANY($1) AND deleted_at IS NULL", [ids]);
    return res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error("Batch delete correspondence error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
