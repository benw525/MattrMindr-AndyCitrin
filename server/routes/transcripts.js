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
const { isR2Configured, uploadToR2, downloadFromR2, streamFromR2, deleteFromR2, createMultipartUpload, uploadPart, completeMultipartUpload, abortMultipartUpload } = require("../r2");

const router = express.Router();
router.use(express.json({ limit: "10mb" }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

async function verifyCaseAccess(req, caseId) {
  const userId = req.session.userId;
  const userRole = req.session.userRole || "";
  if (userRole === "App Admin") return true;
  const { rows } = await pool.query(
    "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $3 OR case_manager = $4 OR investigator = $5 OR paralegal = $6 OR confidential = false OR confidential IS NULL)",
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


const ALLOWED_AUDIO = [
  "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac",
  "audio/ogg", "audio/webm", "audio/flac", "audio/x-flac",
  "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo",
];

const VIDEO_MIMES = ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"];

function isVideoMime(mime) {
  return VIDEO_MIMES.some(v => mime.includes(v.split("/")[1]) || mime === v);
}

const toFrontend = (row) => ({
  id: row.id,
  caseId: row.case_id,
  filename: row.filename,
  description: row.description || '',
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
  isVideo: row.is_video || false,
  videoContentType: row.video_content_type || null,
  scribeTranscriptId: row.scribe_transcript_id || null,
  scribeStatus: row.scribe_status || null,
  summaries: row.summaries || null,
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

function getWhisperClient() {
  const directKey = process.env.OPENAI_API_KEY;
  if (directKey) {
    return new OpenAI({ apiKey: directKey });
  }
  return openai;
}

async function transcribeFile(filePath, offsetSec = 0) {
  const buffer = await readFile(filePath);
  const { toFile } = await import("openai");
  const file = await toFile(buffer, "audio.wav");
  const whisperClient = getWhisperClient();
  let response;
  try {
    response = await whisperClient.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });
  } catch (err) {
    const isUnsupported = err.status === 404 || err.status === 400 || err.status === 422 || err.status === 501
      || (err.message && (err.message.includes("deployment") || err.message.includes("Unknown model") || err.message.includes("not found") || err.message.includes("not supported")));
    if (isUnsupported) {
      throw new Error("Audio transcription (Whisper) is not available through the current AI provider. Set the OPENAI_API_KEY environment variable with a direct OpenAI API key to enable transcription.");
    }
    throw err;
  }
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
      "SELECT audio_data, content_type, r2_audio_key FROM case_transcripts WHERE id = $1",
      [transcriptId]
    );
    if (!rows.length) throw new Error("Transcript record not found");

    let audioBuffer = rows[0].audio_data;
    if (!audioBuffer && rows[0].r2_audio_key && isR2Configured()) {
      audioBuffer = await downloadFromR2(rows[0].r2_audio_key);
    }
    if (!audioBuffer) throw new Error("No audio data available");

    await writeFile(inputPath, audioBuffer);

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

const CHUNK_SIZE = 20 * 1024 * 1024;
const pendingChunks = new Map();

router.post("/upload/init", requireAuth, express.json(), async (req, res) => {
  try {
    const { caseId, filename, contentType, fileSize, totalChunks } = req.body;
    if (!caseId || !filename || !totalChunks) return res.status(400).json({ error: "Missing required fields" });
    if (fileSize > 100 * 1024 * 1024) return res.status(400).json({ error: "File too large (max 100MB)" });
    if (totalChunks > 10) return res.status(400).json({ error: "Too many chunks" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });

    const uploadId = randomUUID();
    const pendingData = {
      caseId, filename, contentType, fileSize, totalChunks,
      userId: req.session.userId,
      chunks: new Array(totalChunks).fill(null),
      received: 0,
      createdAt: Date.now(),
      useR2Multipart: false,
      r2AudioKey: null,
      r2MultipartUploadId: null,
      r2Parts: [],
    };

    if (isR2Configured()) {
      const r2Key = `transcripts/${caseId}/${randomUUID()}/audio`;
      const r2UploadId = await createMultipartUpload(r2Key, contentType || "application/octet-stream");
      pendingData.useR2Multipart = true;
      pendingData.r2AudioKey = r2Key;
      pendingData.r2MultipartUploadId = r2UploadId;
    }

    pendingChunks.set(uploadId, pendingData);

    setTimeout(() => {
      const p = pendingChunks.get(uploadId);
      if (p && p.useR2Multipart && p.r2MultipartUploadId) {
        abortMultipartUpload(p.r2AudioKey, p.r2MultipartUploadId).catch(() => {});
      }
      pendingChunks.delete(uploadId);
    }, 30 * 60 * 1000);

    res.json({ uploadId, totalChunks });
  } catch (err) {
    console.error("Chunk init error:", err.message);
    res.status(500).json({ error: "Failed to initialize upload" });
  }
});

router.post("/upload/chunk", requireAuth, upload.single("chunk"), async (req, res) => {
  try {
    const { uploadId, chunkIndex } = req.body;
    if (!uploadId || chunkIndex === undefined || !req.file) {
      return res.status(400).json({ error: "Missing uploadId, chunkIndex, or chunk data" });
    }
    const pending = pendingChunks.get(uploadId);
    if (!pending) return res.status(404).json({ error: "Upload session not found or expired" });
    if (pending.userId !== req.session.userId) return res.status(403).json({ error: "Access denied" });

    const idx = parseInt(chunkIndex);
    if (idx < 0 || idx >= pending.totalChunks) return res.status(400).json({ error: "Invalid chunk index" });

    if (pending.useR2Multipart) {
      const partNumber = idx + 1;
      const partResult = await uploadPart(pending.r2AudioKey, pending.r2MultipartUploadId, partNumber, req.file.buffer);
      pending.r2Parts[idx] = partResult;
      pending.chunks[idx] = true;
    } else {
      pending.chunks[idx] = req.file.buffer;
    }

    if (pending.chunks[idx] !== null && pending.chunks[idx] !== undefined) {
      const wasNull = pending.received < pending.totalChunks;
      pending.received = pending.chunks.filter(c => c !== null).length;
    }

    res.json({ received: pending.received, totalChunks: pending.totalChunks });
  } catch (err) {
    console.error("Chunk upload error:", err.message);
    res.status(500).json({ error: "Failed to upload chunk" });
  }
});

router.post("/upload/complete", requireAuth, express.json(), async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ error: "Missing uploadId" });
    const pending = pendingChunks.get(uploadId);
    if (!pending) return res.status(404).json({ error: "Upload session not found or expired" });
    if (pending.userId !== req.session.userId) return res.status(403).json({ error: "Access denied" });

    const missing = pending.chunks.findIndex(c => c === null);
    if (missing !== -1) return res.status(400).json({ error: `Missing chunk ${missing}` });

    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [pending.userId]);
    const uploaderName = userRows.length ? userRows[0].name : "";

    const mime = (pending.contentType || "").toLowerCase();
    const isVideo = isVideoMime(mime) || [".mp4", ".webm", ".mov", ".avi"].includes(path.extname(pending.filename).toLowerCase());

    let r2AudioKey = null;
    let r2VideoKey = null;
    let fullBuffer = null;

    if (pending.useR2Multipart) {
      await completeMultipartUpload(pending.r2AudioKey, pending.r2MultipartUploadId, pending.r2Parts.filter(Boolean));
      r2AudioKey = pending.r2AudioKey;

      if (isVideo) {
        r2VideoKey = pending.r2AudioKey.replace(/\/audio$/, "/video");
        const videoData = await downloadFromR2(r2AudioKey);
        await uploadToR2(r2VideoKey, videoData, pending.contentType);
      }
    } else {
      fullBuffer = Buffer.concat(pending.chunks);

      if (isR2Configured()) {
        const baseKey = `transcripts/${pending.caseId}/${randomUUID()}`;
        r2AudioKey = `${baseKey}/audio`;
        await uploadToR2(r2AudioKey, fullBuffer, pending.contentType);
        if (isVideo) {
          r2VideoKey = `${baseKey}/video`;
          await uploadToR2(r2VideoKey, fullBuffer, pending.contentType);
        }
      }
    }

    pendingChunks.delete(uploadId);

    const storeInDb = !r2AudioKey;
    const { rows } = await pool.query(
      `INSERT INTO case_transcripts (case_id, filename, content_type, audio_data, file_size, uploaded_by, uploaded_by_name, is_video, video_data, video_content_type, r2_audio_key, r2_video_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [pending.caseId, pending.filename, pending.contentType,
       storeInDb ? fullBuffer : null, pending.fileSize, pending.userId, uploaderName,
       isVideo, isVideo && storeInDb ? fullBuffer : null, isVideo ? pending.contentType : null,
       r2AudioKey, r2VideoKey]
    );

    res.json(toFrontend(rows[0]));

    processTranscription(rows[0].id).catch(err => {
      console.error("Background transcription failed:", err.message);
    });
  } catch (err) {
    console.error("Chunk complete error:", err.message);
    res.status(500).json({ error: "Failed to complete upload" });
  }
});

router.post("/upload", requireAuth, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No audio file provided" });
    const caseId = parseInt(req.body.caseId);
    if (!caseId) return res.status(400).json({ error: "caseId is required" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });

    const mime = req.file.mimetype.toLowerCase();
    if (!ALLOWED_AUDIO.some(t => mime.includes(t.split("/")[1]) || mime === t)) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const allowedExts = [".mp3", ".wav", ".m4a", ".ogg", ".webm", ".mp4", ".aac", ".flac", ".mov", ".avi"];
      if (!allowedExts.includes(ext)) {
        return res.status(400).json({ error: `Unsupported format. Accepted: ${allowedExts.join(", ")}` });
      }
    }

    const isVideo = isVideoMime(mime) || [".mp4", ".webm", ".mov", ".avi"].includes(path.extname(req.file.originalname).toLowerCase());

    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [req.session.userId]);
    const uploaderName = userRows.length ? userRows[0].name : "";

    let r2AudioKey = null;
    let r2VideoKey = null;
    if (isR2Configured()) {
      const baseKey = `transcripts/${caseId}/${randomUUID()}`;
      r2AudioKey = `${baseKey}/audio`;
      await uploadToR2(r2AudioKey, req.file.buffer, req.file.mimetype);
      if (isVideo) {
        r2VideoKey = `${baseKey}/video`;
        await uploadToR2(r2VideoKey, req.file.buffer, req.file.mimetype);
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO case_transcripts (case_id, filename, content_type, audio_data, file_size, uploaded_by, uploaded_by_name, is_video, video_data, video_content_type, r2_audio_key, r2_video_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [caseId, req.file.originalname, req.file.mimetype,
       isR2Configured() ? null : req.file.buffer, req.file.size, req.session.userId, uploaderName,
       isVideo, isVideo && !isR2Configured() ? req.file.buffer : null, isVideo ? req.file.mimetype : null,
       r2AudioKey, r2VideoKey]
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

router.get("/case/:caseId/folders", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, req.params.caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT * FROM transcript_folders WHERE case_id = $1 ORDER BY sort_order, created_at",
      [req.params.caseId]
    );
    return res.json(rows);
  } catch (err) {
    console.error("Transcript folders fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/case/:caseId/reorder-folders", requireAuth, async (req, res) => {
  try {
    const { folders } = req.body;
    if (!Array.isArray(folders)) return res.status(400).json({ error: "folders array required" });
    for (const f of folders) {
      await pool.query("UPDATE transcript_folders SET sort_order = $1 WHERE id = $2", [f.sortOrder, f.id]);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("Reorder transcript folders error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/case/:caseId", requireAuth, async (req, res) => {
  try {
    if (!(await verifyCaseAccess(req, req.params.caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      `SELECT id, case_id, filename, description, content_type, file_size, status, error_message, duration_seconds, uploaded_by, uploaded_by_name, created_at, updated_at, is_video, video_content_type, scribe_transcript_id, scribe_status,
       jsonb_array_length(transcript) as segment_count
       FROM case_transcripts WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
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
      "SELECT id, case_id, filename, description, content_type, file_size, transcript, status, error_message, duration_seconds, uploaded_by, uploaded_by_name, created_at, updated_at, is_video, video_content_type, scribe_transcript_id, scribe_status, summaries FROM case_transcripts WHERE id = $1",
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
    const { transcript, filename, description } = req.body;
    const setClauses = [];
    const values = [];
    let idx = 1;
    if (transcript && Array.isArray(transcript)) {
      setClauses.push(`transcript = $${idx++}`);
      values.push(JSON.stringify(transcript));
    }
    if (filename !== undefined) {
      setClauses.push(`filename = $${idx++}`);
      values.push(filename);
    }
    if (description !== undefined) {
      setClauses.push(`description = $${idx++}`);
      values.push(description);
    }
    if (setClauses.length === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }
    setClauses.push("updated_at = NOW()");
    values.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE case_transcripts SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
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
    const { rowCount } = await pool.query("UPDATE case_transcripts SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
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
      "SELECT filename, content_type, audio_data, r2_audio_key FROM case_transcripts WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    const { filename, content_type, audio_data, r2_audio_key } = rows[0];
    res.set("Content-Type", content_type || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    if (r2_audio_key && isR2Configured()) {
      try {
        const data = await downloadFromR2(r2_audio_key);
        return res.send(data);
      } catch {}
    }
    res.send(audio_data);
  } catch (err) {
    console.error("Download audio error:", err.message);
    res.status(500).json({ error: "Failed to download audio" });
  }
});

router.get("/:id/video", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });

    const { rows } = await pool.query(
      "SELECT video_content_type, video_data, r2_video_key, is_video FROM case_transcripts WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length || !rows[0].is_video) return res.status(404).json({ error: "Video not found" });
    const { video_content_type, video_data, r2_video_key } = rows[0];
    const contentType = video_content_type || "video/mp4";
    const rangeHeader = req.headers.range;

    if (r2_video_key && isR2Configured()) {
      try {
        if (rangeHeader) {
          const r2Resp = await streamFromR2(r2_video_key, rangeHeader);
          res.status(206);
          res.set("Content-Type", contentType);
          res.set("Accept-Ranges", "bytes");
          if (r2Resp.contentRange) res.set("Content-Range", r2Resp.contentRange);
          if (r2Resp.contentLength) res.set("Content-Length", r2Resp.contentLength);
          return r2Resp.stream.pipe(res);
        } else {
          const data = await downloadFromR2(r2_video_key);
          res.set("Content-Type", contentType);
          res.set("Content-Length", data.length);
          res.set("Accept-Ranges", "bytes");
          return res.send(data);
        }
      } catch {}
    }

    if (!video_data) return res.status(404).json({ error: "Video data not available" });

    if (rangeHeader) {
      const total = video_data.length;
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;
      res.status(206);
      res.set("Content-Range", `bytes ${start}-${end}/${total}`);
      res.set("Accept-Ranges", "bytes");
      res.set("Content-Length", chunkSize);
      res.set("Content-Type", contentType);
      return res.send(video_data.slice(start, end + 1));
    }

    res.set("Content-Type", contentType);
    res.set("Content-Length", video_data.length);
    res.set("Accept-Ranges", "bytes");
    res.send(video_data);
  } catch (err) {
    console.error("Video stream error:", err.message);
    res.status(500).json({ error: "Failed to stream video" });
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
    const format = (req.query.format || "txt").toLowerCase();
    const baseName = filename.replace(/\.[^.]+$/, "");

    const fmtTs = (sec) => {
      const m = Math.floor(sec / 60);
      const s = Math.round(sec % 60);
      return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}]`;
    };

    if (format === "docx") {
      const docx = require("docx");
      const children = [];
      children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `TRANSCRIPT: ${filename}`, bold: true, size: 28 })], spacing: { after: 100 } }));
      if (duration_seconds) children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Duration: ${Math.floor(duration_seconds / 60)}m ${Math.round(duration_seconds % 60)}s`, size: 20, color: "666666" })], spacing: { after: 50 } }));
      children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Exported: ${new Date().toLocaleString()}`, size: 20, color: "666666" })], spacing: { after: 200 } }));
      children.push(new docx.Paragraph({ border: { bottom: { color: "999999", space: 1, style: docx.BorderStyle.SINGLE, size: 6 } }, spacing: { after: 200 } }));
      for (const seg of segments) {
        children.push(new docx.Paragraph({
          children: [
            new docx.TextRun({ text: `${fmtTs(seg.startTime)} `, color: "999999", size: 20 }),
            new docx.TextRun({ text: `${seg.speaker}: `, bold: true, size: 22 }),
            new docx.TextRun({ text: seg.text, size: 22 }),
          ],
          spacing: { after: 120 },
        }));
      }
      const doc = new docx.Document({ sections: [{ children }] });
      const buffer = await docx.Packer.toBuffer(doc);
      res.set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.set("Content-Disposition", `attachment; filename="${baseName}_transcript.docx"`);
      res.send(buffer);
    } else if (format === "pdf") {
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(chunks);
        res.set("Content-Type", "application/pdf");
        res.set("Content-Disposition", `attachment; filename="${baseName}_transcript.pdf"`);
        res.send(pdfBuffer);
      });
      doc.fontSize(16).font("Helvetica-Bold").text(`TRANSCRIPT: ${filename}`, { underline: false });
      doc.moveDown(0.3);
      if (duration_seconds) doc.fontSize(10).font("Helvetica").fillColor("#666666").text(`Duration: ${Math.floor(duration_seconds / 60)}m ${Math.round(duration_seconds % 60)}s`);
      doc.fontSize(10).font("Helvetica").fillColor("#666666").text(`Exported: ${new Date().toLocaleString()}`);
      doc.moveDown(0.5);
      doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke("#cccccc");
      doc.moveDown(0.5);
      for (const seg of segments) {
        doc.fillColor("#999999").fontSize(9).font("Courier").text(fmtTs(seg.startTime), { continued: true });
        doc.fillColor("#000000").fontSize(11).font("Helvetica-Bold").text(` ${seg.speaker}: `, { continued: true });
        doc.font("Helvetica").text(seg.text);
        doc.moveDown(0.3);
      }
      doc.end();
    } else {
      let text = `TRANSCRIPT: ${filename}\n`;
      if (duration_seconds) text += `Duration: ${Math.floor(duration_seconds / 60)}m ${Math.round(duration_seconds % 60)}s\n`;
      text += `Exported: ${new Date().toLocaleString()}\n`;
      text += "─".repeat(60) + "\n\n";
      for (const seg of segments) {
        text += `${fmtTs(seg.startTime)} ${seg.speaker}:\n${seg.text}\n\n`;
      }
      res.set("Content-Type", "text/plain; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="${baseName}_transcript.txt"`);
      res.send(text);
    }
  } catch (err) {
    console.error("Export transcript error:", err.message);
    res.status(500).json({ error: "Failed to export transcript" });
  }
});

router.get("/:id/suggest-name", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT transcript, filename FROM case_transcripts WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    const segments = rows[0].transcript || [];
    if (!segments.length) return res.status(400).json({ error: "No transcript content available to suggest a name" });
    const textContent = segments.map(s => `${s.speaker}: ${s.text}`).join("\n").slice(0, 2000);
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: "You are a legal assistant at a plaintiff personal injury law firm. Given the beginning of a transcript, suggest a short, descriptive filename (without file extension). Focus on identifying the type of recording (deposition, client interview, expert consultation, IME, mediation, hearing, etc.), the key participant(s), and the subject matter. Keep it concise — under 60 characters. Return ONLY the suggested filename, nothing else."
        },
        {
          role: "user",
          content: `Current filename: ${rows[0].filename}\n\nTranscript content:\n${textContent}`
        }
      ],
      max_tokens: 100,
      temperature: 0.3,
    });
    const suggestedName = (completion.choices[0]?.message?.content || "").trim();
    if (!suggestedName) return res.status(500).json({ error: "AI did not return a suggestion" });
    res.json({ suggestedName });
  } catch (err) {
    console.error("Suggest name error:", err.message);
    res.status(500).json({ error: "Failed to suggest name" });
  }
});

router.get("/:id/history", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT id, transcript_id, change_type, change_description, changed_by, created_at FROM transcript_history WHERE transcript_id = $1 ORDER BY created_at DESC LIMIT 50",
      [req.params.id]
    );
    res.json(rows.map(r => ({
      id: r.id,
      transcriptId: r.transcript_id,
      changeType: r.change_type,
      changeDescription: r.change_description,
      changedBy: r.changed_by,
      createdAt: r.created_at,
    })));
  } catch (err) {
    console.error("Get transcript history error:", err.message);
    res.status(500).json({ error: "Failed to load history" });
  }
});

router.post("/:id/history", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { changeType, changeDescription, previousState } = req.body;
    if (!changeType) return res.status(400).json({ error: "changeType is required" });
    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [req.session.userId]);
    const changedBy = userRows.length ? userRows[0].name : "Unknown";
    const { rows } = await pool.query(
      "INSERT INTO transcript_history (transcript_id, change_type, change_description, previous_state, changed_by) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [req.params.id, changeType, changeDescription || null, previousState ? JSON.stringify(previousState) : null, changedBy]
    );
    res.json({
      id: rows[0].id,
      transcriptId: rows[0].transcript_id,
      changeType: rows[0].change_type,
      changeDescription: rows[0].change_description,
      changedBy: rows[0].changed_by,
      createdAt: rows[0].created_at,
    });
  } catch (err) {
    console.error("Save transcript history error:", err.message);
    res.status(500).json({ error: "Failed to save history" });
  }
});

router.post("/:id/revert/:historyId", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { rows: historyRows } = await pool.query(
      "SELECT previous_state FROM transcript_history WHERE id = $1 AND transcript_id = $2",
      [req.params.historyId, req.params.id]
    );
    if (!historyRows.length) return res.status(404).json({ error: "History entry not found" });
    if (!historyRows[0].previous_state) return res.status(400).json({ error: "No previous state to revert to" });
    const { rows: currentRows } = await pool.query("SELECT transcript FROM case_transcripts WHERE id = $1", [req.params.id]);
    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [req.session.userId]);
    const changedBy = userRows.length ? userRows[0].name : "Unknown";
    await pool.query(
      "INSERT INTO transcript_history (transcript_id, change_type, change_description, previous_state, changed_by) VALUES ($1, $2, $3, $4, $5)",
      [req.params.id, "revert", "Reverted to previous version", currentRows.length ? JSON.stringify(currentRows[0].transcript) : null, changedBy]
    );
    const { rows } = await pool.query(
      "UPDATE case_transcripts SET transcript = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [JSON.stringify(historyRows[0].previous_state), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Revert transcript error:", err.message);
    res.status(500).json({ error: "Failed to revert transcript" });
  }
});

const ATTORNEY_ROLES = ["Managing Partner", "Senior Partner", "Partner", "Associate Attorney", "Of Counsel", "App Admin"];


router.post("/folders", requireAuth, async (req, res) => {
  try {
    const { caseId, name } = req.body;
    if (!caseId || !name) return res.status(400).json({ error: "caseId and name are required" });
    if (!(await verifyCaseAccess(req, caseId))) return res.status(403).json({ error: "Access denied" });
    const { rows: maxRows } = await pool.query("SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM transcript_folders WHERE case_id = $1", [caseId]);
    const { rows } = await pool.query(
      "INSERT INTO transcript_folders (case_id, name, sort_order) VALUES ($1, $2, $3) RETURNING *",
      [caseId, name, maxRows[0].next]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create transcript folder error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/folders/:id", requireAuth, async (req, res) => {
  try {
    const { name, collapsed } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;
    if (name !== undefined) { sets.push(`name = $${idx++}`); vals.push(name); }
    if (collapsed !== undefined) { sets.push(`collapsed = $${idx++}`); vals.push(!!collapsed); }
    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE transcript_folders SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Update transcript folder error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/folders/:id", requireAuth, async (req, res) => {
  try {
    await pool.query("UPDATE case_transcripts SET folder_id = NULL WHERE folder_id = $1", [req.params.id]);
    const { rowCount } = await pool.query("DELETE FROM transcript_folders WHERE id = $1", [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("Delete transcript folder error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


router.put("/:id/move", requireAuth, async (req, res) => {
  try {
    const { folderId } = req.body;
    const { rows } = await pool.query(
      "UPDATE case_transcripts SET folder_id = $1 WHERE id = $2 RETURNING id, folder_id",
      [folderId || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json(rows[0]);
  } catch (err) {
    console.error("Move transcript error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/batch-delete", requireAuth, async (req, res) => {
  try {
    const userRoles = req.session.userRoles || [req.session.userRole];
    if (!userRoles.some(r => ATTORNEY_ROLES.includes(r))) {
      return res.status(403).json({ error: "Only attorneys may batch delete transcripts" });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    const { rowCount } = await pool.query("UPDATE case_transcripts SET deleted_at = NOW() WHERE id = ANY($1) AND deleted_at IS NULL", [ids]);
    return res.json({ ok: true, deleted: rowCount });
  } catch (err) {
    console.error("Batch delete transcripts error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/summarize", requireAuth, async (req, res) => {
  try {
    const access = await verifyTranscriptAccess(req, req.params.id);
    if (access === null) return res.status(404).json({ error: "Transcript not found" });
    if (access === false) return res.status(403).json({ error: "Access denied" });
    const { rows } = await pool.query(
      "SELECT ct.id, ct.transcript, ct.filename, ct.case_id, c.title as case_title, c.client_name FROM case_transcripts ct LEFT JOIN cases c ON c.id = ct.case_id WHERE ct.id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    const row = rows[0];
    const segments = typeof row.transcript === "string" ? JSON.parse(row.transcript) : (row.transcript || []);
    if (!segments.length) return res.status(400).json({ error: "Transcript has no content to summarize" });
    const fullText = segments.map(s => `${s.speaker || "Speaker"}: ${s.text}`).join("\n");
    const textSnippet = fullText.substring(0, 12000);

    const systemPrompt = `You are a personal injury attorney's transcript analysis assistant. Summarize the provided transcript for an attorney reviewing a personal injury case. Focus on information relevant to the claim.

Provide a structured summary with these sections:
KEY FACTS & TIMELINE
PEOPLE & ROLES (speakers, witnesses, parties mentioned)
LIABILITY-RELEVANT STATEMENTS (fault indicators, admissions, scene descriptions)
DAMAGES-RELEVANT STATEMENTS (injuries, treatments, pain descriptions, financial losses)
INCONSISTENCIES OR CONCERNS
BOTTOM LINE

Be concise but thorough. Flag anything that could help or hurt the case.
Do not use markdown formatting like headers with # or bold with **. Use plain text with section names in ALL CAPS followed by a colon.`;

    const resp = await openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Summarize this transcript from "${row.filename}" for the case "${row.case_title || "Unknown"}" (Client: ${row.client_name || "Unknown"}):\n\n${textSnippet}` },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      store: false,
    });

    const summaryText = resp.choices[0]?.message?.content || "";
    const summaries = [{ title: "AI Transcript Summary", content: summaryText, type: "ai_generated", generatedAt: new Date().toISOString() }];

    await pool.query("UPDATE case_transcripts SET summaries = $1, updated_at = NOW() WHERE id = $2", [JSON.stringify(summaries), req.params.id]);

    res.json({ summaries });
  } catch (err) {
    console.error("Transcript summarize error:", err);
    res.status(500).json({ error: "AI transcript summary failed" });
  }
});

module.exports = router;
module.exports.processTranscription = processTranscription;
