const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  callerName: row.caller_name,
  callerNumber: row.caller_number,
  duration: row.duration,
  transcriptText: row.transcript_text,
  hasAudio: !!row.has_audio,
  audioMime: row.audio_mime,
  notes: row.notes,
  receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : row.received_at,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
});

router.get("/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, case_id, caller_name, caller_number, duration, transcript_text,
              (audio_data IS NOT NULL) as has_audio, audio_mime, notes, received_at, created_at
       FROM case_voicemails
       WHERE case_id = $1 AND deleted_at IS NULL
       ORDER BY received_at DESC`,
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Voicemails fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, async (req, res) => {
  try {
    const { callerName, callerNumber, duration, transcriptText, notes, receivedAt } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO case_voicemails (case_id, caller_name, caller_number, duration, transcript_text, notes, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, case_id, caller_name, caller_number, duration, transcript_text,
                 (audio_data IS NOT NULL) as has_audio, audio_mime, notes, received_at, created_at`,
      [req.params.caseId, callerName || '', callerNumber || '', duration || null, transcriptText || '', notes || '', receivedAt || new Date()]
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Voicemail create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const { callerName, callerNumber, duration, transcriptText, notes, receivedAt } = req.body;
    const { rows } = await pool.query(
      `UPDATE case_voicemails
       SET caller_name = COALESCE($1, caller_name),
           caller_number = COALESCE($2, caller_number),
           duration = COALESCE($3, duration),
           transcript_text = COALESCE($4, transcript_text),
           notes = COALESCE($5, notes),
           received_at = COALESCE($6, received_at)
       WHERE id = $7 AND deleted_at IS NULL
       RETURNING id, case_id, caller_name, caller_number, duration, transcript_text,
                 (audio_data IS NOT NULL) as has_audio, audio_mime, notes, received_at, created_at`,
      [callerName, callerNumber, duration, transcriptText, notes, receivedAt, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Voicemail update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE case_voicemails SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Voicemail delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id/audio", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT audio_data, audio_mime FROM case_voicemails WHERE id = $1 AND deleted_at IS NULL",
      [req.params.id]
    );
    if (rows.length === 0 || !rows[0].audio_data) return res.status(404).json({ error: "No audio" });
    res.setHeader("Content-Type", rows[0].audio_mime || "audio/mpeg");
    return res.send(rows[0].audio_data);
  } catch (err) {
    console.error("Voicemail audio error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
