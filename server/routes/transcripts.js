const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const { writeFile, unlink, readFile } = require("fs/promises");
const { randomUUID } = require("crypto");
const { tmpdir } = require("os");
const path = require("path");
const OpenAI = require("openai");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(express.json({ limit: "10mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

async function verifyCaseAccess(req, caseId) {
  const userId = req.session.userId;
  const userRole = req.session.userRole || "";
  if (userRole === "App Admin") return true;
  const { rows } = await pool.query(
    "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR trial_coordinator = $4 OR investigator = $5 OR social_worker = $6 OR confidential = false OR confidential IS NULL)",
    [caseId, userId, userId, userId, userId, userId]
  );
  return rows.length > 0;
}

async function verifyTranscriptAccess(req, transcriptId) {
  const { rows } = await pool.query("SELECT case_id FROM case_transcripts WHERE id = $1", [transcriptId]);
  if (!rows.length) return null;
  const hasAccess = await verifyCaseAccess(req, rows[0].case_id);
  return hasAccess ? rows[0].case_id : false;
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const whisperClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1",
});

const ALLOWED_AUDIO = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac",
  "audio/ogg", "audio/webm", "audio/flac", "audio/x-flac",
  "video/mp4", "video/webm",
];

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  filename: row.filename,
  contentType: row.content_type,
  fileSize: row.file_size,
  transcript: row.transcript || [],
  status: row.status,
  errorMessage: row.error_message,
  durationSeconds: row.duration_seconds,
  uploadedBy: row.uploaded_by,
  uploadedByName: row.uploaded_by_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    const errChunks = [];
    proc.stdout.on("data", d => chunks.push(d));
    proc.stderr.on("data", d => errChunks.push(d));
    proc.on("close", code => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exit ${code}: ${Buffer.concat(errChunks).toString().slice(-500)}`));
    });
    proc.on("error", reject);
  });
}

async function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath
    ]);
    let out = "";
    proc.stdout.on("data", d => out += d.toString());
    proc.on("close", code => {
      const dur = parseFloat(out.trim());
      if (code === 0 && !isNaN(dur)) resolve(dur);
      else reject(new Error("Could not determine audio duration"));
    });
    proc.on("error", reject);
  });
}

async function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y", "-i", inputPath, "-vn", "-ar", "16000", "-ac", "1",
      "-acodec", "pcm_s16le", "-f", "wav", outputPath
    ]);
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg convert exit ${code}`)));
    proc.on("error", reject);
  });
}

async function splitAudio(inputPath, chunkDurationSec, outputDir) {
  const duration = await getAudioDuration(inputPath);
  const chunks = [];
  let start = 0;
  let idx = 0;
  while (start < duration) {
    const outPath = path.join(outputDir, `chunk_${idx}.wav`);
    const overlapStart = Math.max(0, start - 1);
    const chunkLen = chunkDurationSec + (start > 0 ? 1 : 0);
    await new Promise((resolve, reject) => {
      const proc = spawn("ffmpeg", [
        "-y", "-i", inputPath, "-ss", String(overlapStart),
        "-t", String(chunkLen),
        "-vn", "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", "-f", "wav", outPath
      ]);
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(`split exit ${code}`)));
      proc.on("error", reject);
    });
    chunks.push({ path: outPath, offsetSec: overlapStart, index: idx });
    start += chunkDurationSec;
    idx++;
  }
  return { chunks, totalDuration: duration };
}

async function transcribeFile(filePath, offsetSec = 0) {
  const buffer = await readFile(filePath);
  const { toFile } = await import("openai");
  const file = await toFile(buffer, "audio.wav");
  const response = await whisperClient.audio.transcriptions.create({
    file,
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });
  const segments = (response.segments || []).map(s => ({
    speaker: "Speaker 1",
    text: s.text.trim(),
    startTime: Math.round((s.start + offsetSec) * 100) / 100,
    endTime: Math.round((s.end + offsetSec) * 100) / 100,
  }));
  return segments;
}

async function processTranscription(transcriptId) {
  const tmp = tmpdir();
  const uid = randomUUID();
  const inputPath = path.join(tmp, `transcript_${uid}_input`);
  const wavPath = path.join(tmp, `transcript_${uid}.wav`);
  const chunkDir = path.join(tmp, `transcript_${uid}_chunks`);
  const cleanupFiles = [inputPath, wavPath];

  try {
    const { rows } = await pool.query(
      "SELECT audio_data, content_type FROM case_transcripts WHERE id = $1",
      [transcriptId]
    );
    if (!rows.length) throw new Error("Transcript record not found");

    await writeFile(inputPath, rows[0].audio_data);

    let duration;
    try {
      duration = await getAudioDuration(inputPath);
    } catch {
      duration = null;
    }

    await convertToWav(inputPath, wavPath);

    const wavStats = await readFile(wavPath);
    const wavSize = wavStats.length;
    const MAX_CHUNK_SIZE = 24 * 1024 * 1024;

    let allSegments = [];

    if (wavSize <= MAX_CHUNK_SIZE) {
      allSegments = await transcribeFile(wavPath, 0);
    } else {
      const bytesPerSec = 16000 * 2;
      const chunkDurationSec = Math.floor(MAX_CHUNK_SIZE / bytesPerSec);

      const { mkdir } = require("fs/promises");
      await mkdir(chunkDir, { recursive: true });

      const { chunks, totalDuration } = await splitAudio(wavPath, chunkDurationSec, chunkDir);
      if (duration == null) duration = totalDuration;

      for (const chunk of chunks) {
        const chunkSegments = await transcribeFile(chunk.path, chunk.offsetSec);
        allSegments.push(...chunkSegments);
        cleanupFiles.push(chunk.path);
      }
      cleanupFiles.push(chunkDir);

      allSegments.sort((a, b) => a.startTime - b.startTime);
      const deduped = [];
      for (const seg of allSegments) {
        if (deduped.length === 0) { deduped.push(seg); continue; }
        const prev = deduped[deduped.length - 1];
        if (Math.abs(seg.startTime - prev.startTime) < 1.5 && seg.text === prev.text) continue;
        if (seg.startTime < prev.endTime - 0.5 && seg.text === prev.text) continue;
        deduped.push(seg);
      }
      allSegments = deduped;
    }

    let currentSpeaker = 1;
    let maxSpeaker = 1;
    for (let i = 0; i < allSegments.length; i++) {
      if (i === 0) { allSegments[i].speaker = "Speaker 1"; continue; }
      const gap = allSegments[i].startTime - allSegments[i - 1].endTime;
      if (gap > 2.0 && maxSpeaker < 10) {
        currentSpeaker = currentSpeaker === 1 ? 2 : 1;
        if (currentSpeaker > maxSpeaker) maxSpeaker = currentSpeaker;
      }
      allSegments[i].speaker = `Speaker ${currentSpeaker}`;
    }

    await pool.query(
      `UPDATE case_transcripts SET transcript = $1, status = 'completed', duration_seconds = $2, updated_at = NOW() WHERE id = $3`,
      [JSON.stringify(allSegments), duration, transcriptId]
    );
  } catch (err) {
    console.error(`Transcription error for ${transcriptId}:`, err.message);
    await pool.query(
      `UPDATE case_transcripts SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [err.message.substring(0, 500), transcriptId]
    );
  } finally {
    for (const f of cleanupFiles) {
      try { await unlink(f); } catch {}
    }
    try {
      const { rmdir } = require("fs/promises");
      await rmdir(chunkDir).catch(() => {});
    } catch {}
  }
}

router.post("/upload", requireAuth, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });
    const caseId = parseInt(req.body.caseId);
    if (!caseId) return res.status(400).json({ error: "caseId is required" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });

    const mime = req.file.mimetype.toLowerCase();
    if (!ALLOWED_AUDIO.some(t => mime.includes(t.split("/")[1]) || mime === t)) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const allowedExts = [".mp3", ".wav", ".m4a", ".ogg", ".webm", ".mp4", ".aac", ".flac"];
      if (!allowedExts.includes(ext)) {
        return res.status(400).json({ error: `Unsupported audio format. Accepted: ${allowedExts.join(", ")}` });
      }
    }

    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [req.session.userId]);
    const uploaderName = userRows.length ? userRows[0].name : "";

    const { rows } = await pool.query(
      `INSERT INTO case_transcripts (case_id, filename, content_type, audio_data, file_size, uploaded_by, uploaded_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [caseId, req.file.originalname, req.file.mimetype, req.file.buffer, req.file.size, req.session.userId, uploaderName]
    );

    res.json(toFrontend(rows[0]));

    processTranscription(rows[0].id).catch(err => {
      console.error("Background transcription failed:", err.message);
    });
  } catch (err) {
    console.error("Transcript upload error:", err.message);
    res.status(500).json({ error: "Failed to upload audio file" });
  }
});

router.get("/case/:caseId", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, req.params.caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      `SELECT id, case_id, filename, content_type, file_size, status, error_message, duration_seconds, uploaded_by, uploaded_by_name, created_at, updated_at,
       jsonb_array_length(transcript) as segment_count
       FROM case_transcripts WHERE case_id = $1 ORDER BY created_at DESC`,
      [req.params.caseId]
    );
    res.json(rows.map(r => ({
      ...toFrontend({ ...r, transcript: [] }),
      segmentCount: r.segment_count || 0,
    })));
  } catch (err) {
    console.error("Get transcripts error:", err.message);
    res.status(500).json({ error: "Failed to load transcripts" });
  }
});

router.get("/:id/detail", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT id, case_id, filename, content_type, file_size, transcript, status, error_message, duration_seconds, uploaded_by, uploaded_by_name, created_at, updated_at FROM case_transcripts WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Get transcript detail error:", err.message);
    res.status(500).json({ error: "Failed to load transcript" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { transcript } = req.body;
    if (!transcript || !Array.isArray(transcript)) {
      return res.status(400).json({ error: "transcript array is required" });
    }
    const { rows } = await pool.query(
      "UPDATE case_transcripts SET transcript = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [JSON.stringify(transcript), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Update transcript error:", err.message);
    res.status(500).json({ error: "Failed to update transcript" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { rowCount } = await pool.query("DELETE FROM case_transcripts WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Transcript not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete transcript error:", err.message);
    res.status(500).json({ error: "Failed to delete transcript" });
  }
});

router.get("/:id/download-audio", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT filename, content_type, audio_data FROM case_transcripts WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    const { filename, content_type, audio_data } = rows[0];
    res.set("Content-Type", content_type || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(audio_data);
  } catch (err) {
    console.error("Download audio error:", err.message);
    res.status(500).json({ error: "Failed to download audio" });
  }
});

router.get("/:id/export", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT filename, transcript, duration_seconds FROM case_transcripts WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    const { filename, transcript, duration_seconds } = rows[0];
    const segments = transcript || [];

    let text = `TRANSCRIPT: ${filename}\n`;
    if (duration_seconds) text += `Duration: ${Math.floor(duration_seconds / 60)}m ${Math.round(duration_seconds % 60)}s\n`;
    text += `Exported: ${new Date().toLocaleString()}\n`;
    text += "─".repeat(60) + "\n\n";

    for (const seg of segments) {
      const mins = Math.floor(seg.startTime / 60);
      const secs = Math.round(seg.startTime % 60);
      const ts = `[${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}]`;
      text += `${ts} ${seg.speaker}:\n${seg.text}\n\n`;
    }

    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="${filename.replace(/\.[^.]+$/, "")}_transcript.txt"`);
    res.send(text);
  } catch (err) {
    console.error("Export transcript error:", err.message);
    res.status(500).json({ error: "Failed to export transcript" });
  }
});

module.exports = router;
