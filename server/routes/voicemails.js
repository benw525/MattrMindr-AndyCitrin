const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const ALLOWED_AUDIO_MIMES = new Set([
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/x-m4a",
  "audio/aac", "audio/flac", "audio/x-flac", "audio/amr",
]);

const audioFilter = (_req, file, cb) => {
  if (ALLOWED_AUDIO_MIMES.has(file.mimetype)) return cb(null, true);
  cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "audio"));
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: audioFilter,
});

const handleMulterError = (err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Audio file exceeds 25 MB limit" });
    if (err.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: "Invalid file type — only audio files are accepted" });
    return res.status(400).json({ error: "Upload error: " + err.message });
  }
  next(err);
};

const SAFE_MIMES = {
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", webm: "audio/webm",
  mp4: "audio/mp4", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", amr: "audio/amr",
};
const safeMime = (raw) => {
  for (const [, mime] of Object.entries(SAFE_MIMES)) {
    if (raw && raw.includes(mime.split("/")[1])) return mime;
  }
  return "audio/mpeg";
};

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

const RETURNING_COLS = `id, case_id, caller_name, caller_number, duration, transcript_text,
                 (audio_data IS NOT NULL) as has_audio, audio_mime, notes, received_at, created_at`;

const requireCaseAccess = async (req, res, next) => {
  try {
    let caseId = req.params.caseId;
    if (!caseId) {
      const { rows } = await pool.query(
        "SELECT case_id FROM case_voicemails WHERE id = $1 AND deleted_at IS NULL", [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Not found" });
      caseId = rows[0].case_id;
      req._vmCaseId = caseId;
    }
    const { rows: caseRows } = await pool.query("SELECT confidential, team FROM cases WHERE id = $1", [caseId]);
    if (caseRows.length === 0) return res.status(404).json({ error: "Case not found" });
    const c = caseRows[0];
    if (c.confidential) {
      const user = req.user;
      const team = Array.isArray(c.team) ? c.team : [];
      const isTeamMember = team.some(t => t.name === user.name || t.email === user.email);
      if (!isTeamMember && user.role !== "App Admin" && user.role !== "Managing Partner") {
        return res.status(403).json({ error: "Access denied — this case is confidential" });
      }
    }
    next();
  } catch (err) {
    console.error("Case access check error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

router.get("/:caseId", requireAuth, requireCaseAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${RETURNING_COLS} FROM case_voicemails
       WHERE case_id = $1 AND deleted_at IS NULL ORDER BY received_at DESC`,
      [req.params.caseId]
    );
    return res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Voicemails fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId", requireAuth, requireCaseAccess, upload.single("audio"), handleMulterError, async (req, res) => {
  try {
    const { callerName, callerNumber, duration, transcriptText, notes, receivedAt } = req.body;
    const audioData = req.file ? req.file.buffer : null;
    const audioMime = req.file ? safeMime(req.file.mimetype) : "";
    const { rows } = await pool.query(
      `INSERT INTO case_voicemails (case_id, caller_name, caller_number, duration, transcript_text, notes, received_at, audio_data, audio_mime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${RETURNING_COLS}`,
      [req.params.caseId, callerName || '', callerNumber || '', duration || null, transcriptText || '', notes || '', receivedAt || new Date(), audioData, audioMime]
    );
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Voicemail create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, requireCaseAccess, upload.single("audio"), handleMulterError, async (req, res) => {
  try {
    const { callerName, callerNumber, duration, transcriptText, notes, receivedAt } = req.body;

    if (req.file) {
      const { rows } = await pool.query(
        `UPDATE case_voicemails
         SET caller_name = COALESCE($1, caller_name),
             caller_number = COALESCE($2, caller_number),
             duration = COALESCE($3, duration),
             transcript_text = COALESCE($4, transcript_text),
             notes = COALESCE($5, notes),
             received_at = COALESCE($6, received_at),
             audio_data = $7,
             audio_mime = $8
         WHERE id = $9 AND deleted_at IS NULL
         RETURNING ${RETURNING_COLS}`,
        [callerName, callerNumber, duration, transcriptText, notes, receivedAt, req.file.buffer, safeMime(req.file.mimetype), req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Not found" });
      return res.json(toFrontend(rows[0]));
    } else {
      const { rows } = await pool.query(
        `UPDATE case_voicemails
         SET caller_name = COALESCE($1, caller_name),
             caller_number = COALESCE($2, caller_number),
             duration = COALESCE($3, duration),
             transcript_text = COALESCE($4, transcript_text),
             notes = COALESCE($5, notes),
             received_at = COALESCE($6, received_at)
         WHERE id = $7 AND deleted_at IS NULL
         RETURNING ${RETURNING_COLS}`,
        [callerName, callerNumber, duration, transcriptText, notes, receivedAt, req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: "Not found" });
      return res.json(toFrontend(rows[0]));
    }
  } catch (err) {
    console.error("Voicemail update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, requireCaseAccess, async (req, res) => {
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

router.get("/:id/audio", requireAuth, requireCaseAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT audio_data, audio_mime FROM case_voicemails WHERE id = $1 AND deleted_at IS NULL",
      [req.params.id]
    );
    if (rows.length === 0 || !rows[0].audio_data) return res.status(404).json({ error: "No audio" });
    res.setHeader("Content-Type", safeMime(rows[0].audio_mime));
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(rows[0].audio_data);
  } catch (err) {
    console.error("Voicemail audio error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/transcribe", requireAuth, requireCaseAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT audio_data, audio_mime, caller_name FROM case_voicemails WHERE id = $1 AND deleted_at IS NULL",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    if (!rows[0].audio_data) return res.status(400).json({ error: "No audio file attached to this voicemail" });

    const OpenAI = require("openai");
    const { toFile } = require("openai");
    const openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });

    const mime = safeMime(rows[0].audio_mime);
    const ext = mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : mime.includes("webm") ? "webm" : mime.includes("mp4") ? "m4a" : "mp3";
    const file = await toFile(rows[0].audio_data, `voicemail.${ext}`, { type: mime });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "text",
    });

    const transcriptText = typeof transcription === "string" ? transcription : transcription.text || "";

    const { rows: updated } = await pool.query(
      `UPDATE case_voicemails SET transcript_text = $1 WHERE id = $2 AND deleted_at IS NULL
       RETURNING ${RETURNING_COLS}`,
      [transcriptText, req.params.id]
    );

    console.log(`Whisper transcription complete for voicemail ${req.params.id}: ${transcriptText.length} chars`);
    return res.json(toFrontend(updated[0]));
  } catch (err) {
    console.error("Voicemail transcription error:", err);
    return res.status(500).json({ error: "Transcription failed: " + (err.message || "Unknown error") });
  }
});

router.post("/:id/upload-audio", requireAuth, requireCaseAccess, upload.single("audio"), handleMulterError, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });
    const { rows } = await pool.query(
      `UPDATE case_voicemails SET audio_data = $1, audio_mime = $2 WHERE id = $3 AND deleted_at IS NULL
       RETURNING ${RETURNING_COLS}`,
      [req.file.buffer, safeMime(req.file.mimetype), req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Voicemail audio upload error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
