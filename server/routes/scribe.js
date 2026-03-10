const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { randomUUID } = require("crypto");

const router = express.Router();

const SCRIBE_BASE_URL = "https://scribe.mattrmindr.com";
const SCRIBE_API_KEY = process.env.SCRIBE_API_KEY || "";

const downloadTokens = new Map();

router.get("/status", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT scribe_url, scribe_token, scribe_user_email FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (!rows.length) return res.json({ connected: false });
    const u = rows[0];
    res.json({
      connected: !!(u.scribe_url && u.scribe_token),
      url: u.scribe_url || null,
      email: u.scribe_user_email || null,
    });
  } catch (err) {
    console.error("Scribe status error:", err.message);
    res.json({ connected: false });
  }
});

router.post("/connect", requireAuth, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    try {
      const loginRes = await fetch(`${SCRIBE_BASE_URL}/api/external/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(SCRIBE_API_KEY ? { "X-API-Key": SCRIBE_API_KEY } : {}),
        },
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(() => ({}));
        return res.status(401).json({ error: errData.error || "Invalid Scribe credentials" });
      }
      const loginData = await loginRes.json();
      const userToken = loginData.token || loginData.accessToken || null;
      if (!userToken) {
        return res.status(401).json({ error: "Login succeeded but no access token was returned. Contact your Scribe administrator." });
      }

      await pool.query(
        "UPDATE users SET scribe_url = $1, scribe_token = $2, scribe_user_email = $3 WHERE id = $4",
        [SCRIBE_BASE_URL, userToken, email, req.session.userId]
      );
      res.json({ ok: true });
    } catch (fetchErr) {
      console.error("Scribe connect fetch error:", fetchErr.message);
      return res.status(400).json({ error: "Could not reach MattrMindrScribe. Please try again later." });
    }
  } catch (err) {
    console.error("Scribe connect error:", err.message);
    res.status(500).json({ error: "Failed to connect to Scribe" });
  }
});

router.post("/disconnect", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE users SET scribe_url = NULL, scribe_token = NULL, scribe_user_email = NULL WHERE id = $1",
      [req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Scribe disconnect error:", err.message);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

router.post("/send/:transcriptId", requireAuth, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      "SELECT scribe_url, scribe_token FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (!userRows.length || !userRows[0].scribe_url || !userRows[0].scribe_token) {
      return res.status(400).json({ error: "Scribe not connected" });
    }
    const { scribe_url, scribe_token } = userRows[0];

    const { rows: tRows } = await pool.query(
      "SELECT id, filename, case_id, content_type, file_size, description FROM case_transcripts WHERE id = $1",
      [req.params.transcriptId]
    );
    if (!tRows.length) return res.status(404).json({ error: "Transcript not found" });
    const userId = req.session.userId;
    const userRole = req.session.userRole || "";
    if (userRole !== "App Admin") {
      const { rows: cRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2 OR confidential = false OR confidential IS NULL)", [tRows[0].case_id, userId]);
      if (!cRows.length) return res.status(403).json({ error: "Access denied" });
    }
    const transcript = tRows[0];

    const dlToken = randomUUID();
    downloadTokens.set(dlToken, {
      transcriptId: transcript.id,
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    setTimeout(() => downloadTokens.delete(dlToken), 30 * 60 * 1000);

    const host = req.get("host");
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const downloadUrl = `${protocol}://${host}/api/scribe/download/${dlToken}`;

    const { rows: caseInfo } = await pool.query("SELECT title, client_name FROM cases WHERE id = $1", [transcript.case_id]);
    const caseName = caseInfo[0]?.title || caseInfo[0]?.client_name || "";

    const sendRes = await fetch(`${scribe_url}/api/external/receive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${scribe_token}`,
      },
      body: JSON.stringify({
        filename: transcript.filename,
        fileUrl: downloadUrl,
        contentType: transcript.content_type,
        fileSize: transcript.file_size || null,
        description: transcript.description || "",
        caseId: String(transcript.case_id),
        caseName,
      }),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      console.error("Scribe send failed:", errText);
      return res.status(500).json({ error: "Scribe rejected the request" });
    }
    const sendData = await sendRes.json();
    const scribeTranscriptId = sendData.transcriptId || sendData.id || null;

    if (scribeTranscriptId) {
      await pool.query(
        "UPDATE case_transcripts SET scribe_transcript_id = $1, scribe_status = 'sent' WHERE id = $2",
        [scribeTranscriptId, transcript.id]
      );
    }

    res.json({ ok: true, scribeTranscriptId });
  } catch (err) {
    console.error("Scribe send error:", err.message);
    res.status(500).json({ error: "Failed to send to Scribe" });
  }
});

router.get("/download/:token", async (req, res) => {
  try {
    const entry = downloadTokens.get(req.params.token);
    if (!entry || Date.now() > entry.expiresAt) {
      return res.status(403).json({ error: "Token expired or invalid" });
    }

    const { rows } = await pool.query(
      "SELECT audio_data, content_type, filename, r2_audio_key FROM case_transcripts WHERE id = $1",
      [entry.transcriptId]
    );
    if (!rows.length) return res.status(404).json({ error: "Transcript not found" });
    const t = rows[0];

    let audioBuffer = t.audio_data;
    if (!audioBuffer && t.r2_audio_key) {
      try {
        const { isR2Configured, downloadFromR2 } = require("../r2");
        if (isR2Configured()) audioBuffer = await downloadFromR2(t.r2_audio_key);
      } catch {}
    }
    if (!audioBuffer) return res.status(404).json({ error: "No audio data available" });

    res.setHeader("Content-Type", t.content_type || "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${t.filename}"`);
    res.send(audioBuffer);
  } catch (err) {
    console.error("Scribe download error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/transcript-status/:scribeTranscriptId", requireAuth, async (req, res) => {
  try {
    const { rows: userRows } = await pool.query(
      "SELECT scribe_url, scribe_token FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (!userRows.length || !userRows[0].scribe_url) {
      return res.status(400).json({ error: "Scribe not connected" });
    }
    const { scribe_url, scribe_token } = userRows[0];
    const statusRes = await fetch(`${scribe_url}/api/external/transcripts/${req.params.scribeTranscriptId}/status`, {
      headers: { Authorization: `Bearer ${scribe_token}` },
    });
    if (!statusRes.ok) return res.status(500).json({ error: "Could not fetch Scribe status" });
    const data = await statusRes.json();
    res.json(data);
  } catch (err) {
    console.error("Scribe transcript status error:", err.message);
    res.status(500).json({ error: "Failed to get status" });
  }
});

router.post("/import/:transcriptId", requireAuth, async (req, res) => {
  try {
    const { rows: tRows } = await pool.query(
      "SELECT id, scribe_transcript_id, case_id FROM case_transcripts WHERE id = $1",
      [req.params.transcriptId]
    );
    if (!tRows.length) return res.status(404).json({ error: "Transcript not found" });
    if (!tRows[0].scribe_transcript_id) return res.status(400).json({ error: "No Scribe transcript ID linked" });
    const userId = req.session.userId;
    const userRole = req.session.userRole || "";
    if (userRole !== "App Admin") {
      const { rows: cRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2 OR confidential = false OR confidential IS NULL)", [tRows[0].case_id, userId]);
      if (!cRows.length) return res.status(403).json({ error: "Access denied" });
    }

    const { rows: userRows } = await pool.query(
      "SELECT scribe_url, scribe_token FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (!userRows.length || !userRows[0].scribe_url) {
      return res.status(400).json({ error: "Scribe not connected" });
    }
    const { scribe_url, scribe_token } = userRows[0];

    const importRes = await fetch(`${scribe_url}/api/external/transcripts/${tRows[0].scribe_transcript_id}/status`, {
      headers: { Authorization: `Bearer ${scribe_token}` },
    });
    if (!importRes.ok) return res.status(500).json({ error: "Could not fetch transcript from Scribe" });
    const data = await importRes.json();

    if (data.status === "completed" && data.segments) {
      const updateFields = [
        "transcript = $1",
        "duration_seconds = $2",
        "pipeline_log = $3",
        "scribe_status = 'completed'",
        "status = 'completed'",
        "updated_at = NOW()",
      ];
      const params = [
        JSON.stringify(data.segments),
        data.duration || null,
        data.pipelineLog ? JSON.stringify(data.pipelineLog) : null,
      ];
      if (data.summaries) {
        params.push(JSON.stringify(data.summaries));
        updateFields.push(`summaries = $${params.length}`);
      }
      params.push(req.params.transcriptId);
      updateFields.push("");
      await pool.query(
        `UPDATE case_transcripts SET ${updateFields.filter(Boolean).join(", ")} WHERE id = $${params.length}`,
        params
      );
    } else if (data.status === "failed") {
      await pool.query(
        "UPDATE case_transcripts SET scribe_status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2",
        [data.errorMessage || "Transcription failed", req.params.transcriptId]
      );
    }

    res.json({ ok: true, status: data.status, segments: (data.segments || []).length, hasSummaries: !!(data.summaries && data.summaries.length) });
  } catch (err) {
    console.error("Scribe import error:", err.message);
    res.status(500).json({ error: "Failed to import from Scribe" });
  }
});

async function getScribeCredentials(userId) {
  const { rows } = await pool.query(
    "SELECT scribe_url, scribe_token FROM users WHERE id = $1",
    [userId]
  );
  if (!rows.length || !rows[0].scribe_url || !rows[0].scribe_token) return null;
  return { scribe_url: rows[0].scribe_url, scribe_token: rows[0].scribe_token };
}

router.get("/list-transcripts", requireAuth, async (req, res) => {
  try {
    const creds = await getScribeCredentials(req.session.userId);
    if (!creds) return res.status(400).json({ error: "Scribe not connected" });

    const listRes = await fetch(`${creds.scribe_url}/api/transcripts`, {
      headers: { Authorization: `Bearer ${creds.scribe_token}` },
    });
    if (!listRes.ok) {
      const errText = await listRes.text().catch(() => "");
      console.error("Scribe list-transcripts failed:", listRes.status, errText);
      return res.status(500).json({ error: "Could not fetch transcripts from Scribe" });
    }
    const contentType = listRes.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.error("Scribe list-transcripts returned non-JSON:", contentType);
      return res.status(500).json({ error: "Scribe returned an unexpected response" });
    }
    const data = await listRes.json();
    const transcripts = (data.transcripts || data || []).map(t => ({
      id: t.id,
      filename: t.filename || t.title || "Untitled",
      duration: t.duration || t.durationSeconds || null,
      status: t.status || "unknown",
      caseId: t.caseId || t.case_id || null,
      caseName: t.caseName || t.case_name || null,
      hasSummaries: !!(t.summaries && t.summaries.length > 0) || t.hasSummaries || false,
      createdAt: t.createdAt || t.created_at || null,
      updatedAt: t.updatedAt || t.updated_at || null,
    }));
    res.json({ transcripts });
  } catch (err) {
    console.error("Scribe list-transcripts error:", err.message);
    res.status(500).json({ error: "Failed to list Scribe transcripts" });
  }
});

router.post("/import-new", requireAuth, async (req, res) => {
  try {
    const { scribeTranscriptId, caseId } = req.body;
    if (!scribeTranscriptId || !caseId) return res.status(400).json({ error: "scribeTranscriptId and caseId are required" });

    const userId = req.session.userId;
    const userRole = req.session.userRole || "";
    const { rows: caseRows } = await pool.query("SELECT id, title, client_name FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
    if (!caseRows.length) return res.status(404).json({ error: "Case not found" });
    if (userRole !== "App Admin") {
      const { rows: cRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2 OR confidential = false OR confidential IS NULL)", [caseId, userId]);
      if (!cRows.length) return res.status(403).json({ error: "Access denied to this case" });
    }

    const { rows: existing } = await pool.query(
      "SELECT id FROM case_transcripts WHERE scribe_transcript_id = $1 AND deleted_at IS NULL",
      [String(scribeTranscriptId)]
    );
    if (existing.length) return res.status(409).json({ error: "This Scribe transcript has already been imported", existingId: existing[0].id });

    const creds = await getScribeCredentials(userId);
    if (!creds) return res.status(400).json({ error: "Scribe not connected" });

    const fetchRes = await fetch(`${creds.scribe_url}/api/external/transcripts/${scribeTranscriptId}/status`, {
      headers: { Authorization: `Bearer ${creds.scribe_token}` },
    });
    if (!fetchRes.ok) return res.status(500).json({ error: "Could not fetch transcript from Scribe" });
    const data = await fetchRes.json();

    if (data.status !== "completed") {
      return res.status(400).json({ error: `Transcript is not ready (status: ${data.status})` });
    }

    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
    const uploaderName = userRows[0]?.name || "Unknown";

    const { rows: inserted } = await pool.query(
      `INSERT INTO case_transcripts (case_id, filename, content_type, duration_seconds, description, transcript, summaries, pipeline_log, status, scribe_transcript_id, scribe_status, uploaded_by, uploaded_by_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, 'completed', $10, $11, NOW(), NOW())
       RETURNING id`,
      [
        caseId,
        data.filename || data.title || "Scribe Import",
        data.contentType || "audio/mpeg",
        data.duration || null,
        data.description || "",
        data.segments ? JSON.stringify(data.segments) : "[]",
        data.summaries ? JSON.stringify(data.summaries) : null,
        data.pipelineLog ? JSON.stringify(data.pipelineLog) : null,
        String(scribeTranscriptId),
        userId,
        uploaderName,
      ]
    );

    res.json({ ok: true, transcriptId: inserted[0].id });
  } catch (err) {
    console.error("Scribe import-new error:", err.message);
    res.status(500).json({ error: "Failed to import transcript from Scribe" });
  }
});

module.exports = router;
