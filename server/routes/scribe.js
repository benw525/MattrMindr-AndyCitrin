const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { randomUUID } = require("crypto");

const router = express.Router();

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
    const { url, token, email } = req.body;
    if (!url || !token) return res.status(400).json({ error: "URL and token are required" });
    const baseUrl = url.replace(/\/+$/, "");
    try {
      const verifyRes = await fetch(`${baseUrl}/api/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!verifyRes.ok) return res.status(400).json({ error: "Could not verify Scribe connection. Check URL and token." });
    } catch {
      return res.status(400).json({ error: "Could not reach Scribe server. Check the URL." });
    }
    await pool.query(
      "UPDATE users SET scribe_url = $1, scribe_token = $2, scribe_user_email = $3 WHERE id = $4",
      [baseUrl, token, email || null, req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Scribe connect error:", err.message);
    res.status(500).json({ error: "Failed to connect Scribe" });
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
      "SELECT id, filename, case_id, content_type FROM case_transcripts WHERE id = $1",
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

    const sendRes = await fetch(`${scribe_url}/api/transcripts/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${scribe_token}`,
      },
      body: JSON.stringify({
        sourceId: `mattrmindr-${transcript.id}`,
        filename: transcript.filename,
        caseId: transcript.case_id,
        downloadUrl,
        contentType: transcript.content_type,
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
    const statusRes = await fetch(`${scribe_url}/api/transcripts/${req.params.scribeTranscriptId}/status`, {
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

    const importRes = await fetch(`${scribe_url}/api/transcripts/${tRows[0].scribe_transcript_id}`, {
      headers: { Authorization: `Bearer ${scribe_token}` },
    });
    if (!importRes.ok) return res.status(500).json({ error: "Could not fetch transcript from Scribe" });
    const data = await importRes.json();

    if (data.transcript) {
      await pool.query(
        "UPDATE case_transcripts SET transcript = $1, scribe_status = 'completed', status = 'completed', updated_at = NOW() WHERE id = $2",
        [JSON.stringify(data.transcript), req.params.transcriptId]
      );
    }

    res.json({ ok: true, segments: (data.transcript || []).length });
  } catch (err) {
    console.error("Scribe import error:", err.message);
    res.status(500).json({ error: "Failed to import from Scribe" });
  }
});

module.exports = router;
