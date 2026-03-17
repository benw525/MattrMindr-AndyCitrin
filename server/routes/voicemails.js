const express = require("express");
const { spawn } = require("child_process");
const { writeFile, unlink, readFile } = require("fs/promises");
const { randomUUID } = require("crypto");
const { tmpdir } = require("os");
const path = require("path");
const OpenAI = require("openai");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isS3Configured, uploadToS3, downloadFromS3 } = require("../s3");

const router = express.Router();

async function uploadVmToS3(vmId, buffer, contentType) {
  if (!isS3Configured()) return null;
  const ext = contentType === "audio/wav" ? "wav" : contentType === "audio/mpeg" ? "mp3" : "audio";
  const key = `voicemails/${vmId}/audio.${ext}`;
  await uploadToS3(key, buffer, contentType);
  await pool.query("UPDATE case_voicemails SET s3_key = $1 WHERE id = $2", [key, vmId]);
  return key;
}

async function getVmBuffer(row) {
  if (row.s3_key && isS3Configured()) {
    try { return await downloadFromS3(row.s3_key); } catch (e) { console.error("S3 VM download fallback:", e.message); }
  }
  return row.audio_data || null;
}

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
              (audio_data IS NOT NULL OR s3_key IS NOT NULL) as has_audio, audio_mime, notes, received_at, created_at
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
                 (audio_data IS NOT NULL OR s3_key IS NOT NULL) as has_audio, audio_mime, notes, received_at, created_at`,
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
                 (audio_data IS NOT NULL OR s3_key IS NOT NULL) as has_audio, audio_mime, notes, received_at, created_at`,
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

router.post("/:id/transcribe", requireAuth, async (req, res) => {
  const tmp = tmpdir();
  const uid = randomUUID();
  const inputPath = path.join(tmp, `vm_${uid}_input`);
  const wavPath = path.join(tmp, `vm_${uid}.wav`);

  try {
    const { rows } = await pool.query(
      "SELECT id, audio_data, audio_mime, s3_key FROM case_voicemails WHERE id = $1 AND deleted_at IS NULL",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Voicemail not found" });
    const audioBuffer = await getVmBuffer(rows[0]);
    if (!audioBuffer) return res.status(400).json({ error: "No audio data to transcribe" });
    await writeFile(inputPath, audioBuffer);

    await new Promise((resolve, reject) => {
      const proc = spawn("ffmpeg", [
        "-y", "-i", inputPath, "-vn", "-ar", "16000", "-ac", "1",
        "-acodec", "pcm_s16le", "-f", "wav", wavPath
      ]);
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg convert exit ${code}`)));
      proc.on("error", reject);
    });

    const wavBuffer = await readFile(wavPath);
    const { toFile } = await import("openai");
    const file = await toFile(wavBuffer, "voicemail.wav");

    const directKey = process.env.OPENAI_API_KEY;
    const whisperClient = directKey
      ? new OpenAI({ apiKey: directKey })
      : new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
        });

    let response;
    try {
      response = await whisperClient.audio.transcriptions.create({
        file,
        model: "whisper-1",
        response_format: "text",
      });
    } catch (err) {
      const isUnsupported = err.status === 404 || err.status === 400 || err.status === 422 || err.status === 501
        || (err.message && (err.message.includes("deployment") || err.message.includes("Unknown model") || err.message.includes("not found") || err.message.includes("not supported")));
      if (isUnsupported) {
        return res.status(422).json({ error: "Audio transcription (Whisper) is not available through the current AI provider. Set the OPENAI_API_KEY environment variable with a direct OpenAI API key to enable transcription." });
      }
      throw err;
    }

    const transcriptText = typeof response === "string" ? response : response.text || "";

    const { rows: updated } = await pool.query(
      `UPDATE case_voicemails SET transcript_text = $1
       WHERE id = $2 AND deleted_at IS NULL
       RETURNING id, case_id, caller_name, caller_number, duration, transcript_text,
                 (audio_data IS NOT NULL OR s3_key IS NOT NULL) as has_audio, audio_mime, notes, received_at, created_at`,
      [transcriptText, req.params.id]
    );

    console.log(`Voicemail ${req.params.id} transcribed successfully (${transcriptText.length} chars)`);
    return res.json(toFrontend(updated[0]));
  } catch (err) {
    console.error("Voicemail transcribe error:", err);
    return res.status(500).json({ error: "Transcription failed: " + err.message });
  } finally {
    try { await unlink(inputPath); } catch {}
    try { await unlink(wavPath); } catch {}
  }
});

router.get("/:id/audio", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT audio_data, audio_mime, s3_key FROM case_voicemails WHERE id = $1 AND deleted_at IS NULL",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "No audio" });
    const audioBuffer = await getVmBuffer(rows[0]);
    if (!audioBuffer) return res.status(404).json({ error: "No audio" });
    res.setHeader("Content-Type", rows[0].audio_mime || "audio/mpeg");
    return res.send(audioBuffer);
  } catch (err) {
    console.error("Voicemail audio error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
