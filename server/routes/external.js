const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { generateToken, requireExternalAuth } = require("../middleware/external-auth");

const router = express.Router();

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
      [email.trim()]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid email or password" });
    const user = rows[0];
    let authenticated = false;
    if (user.password_hash) authenticated = await bcrypt.compare(password, user.password_hash);
    if (!authenticated && user.temp_password && user.temp_password === password) authenticated = true;
    if (!authenticated) return res.status(401).json({ error: "Invalid email or password" });
    const token = generateToken(user.id);
    return res.json({
      token,
      user: { id: String(user.id), email: user.email, fullName: user.name },
    });
  } catch (err) {
    console.error("External login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/auth", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL",
      [email.trim()]
    );
    if (!rows.length) return res.status(401).json({ error: "Invalid email or password" });
    const user = rows[0];
    let authenticated = false;
    if (user.password_hash) authenticated = await bcrypt.compare(password, user.password_hash);
    if (!authenticated && user.temp_password && user.temp_password === password) authenticated = true;
    if (!authenticated) return res.status(401).json({ error: "Invalid email or password" });
    const token = generateToken(user.id);
    return res.json({
      token,
      user: { id: String(user.id), email: user.email, fullName: user.name },
    });
  } catch (err) {
    console.error("External auth error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/auth/verify", requireExternalAuth, (req, res) => {
  return res.json({ valid: true, user: req.extUser });
});

router.get("/cases", requireExternalAuth, async (req, res) => {
  try {
    const user = req.extUser;
    const roles = user.roles || [user.role];
    const q = (req.query.q || "").trim();

    const { rows: pinnedRows } = await pool.query(
      "SELECT pinned_cases FROM users WHERE id = $1",
      [user.id]
    );
    const pinnedIds = new Set((pinnedRows[0]?.pinned_cases || []).map(Number));

    let baseQuery, params;
    if (roles.includes("App Admin")) {
      baseQuery = "SELECT id, case_num, title, client_name FROM cases WHERE deleted_at IS NULL AND status != 'Closed'";
      params = [];
    } else {
      baseQuery = `SELECT id, case_num, title, client_name FROM cases
        WHERE deleted_at IS NULL AND status != 'Closed'
        AND (lead_attorney = $1 OR second_attorney = $1 OR case_manager = $1 OR investigator = $1 OR paralegal = $1)`;
      params = [user.id];
    }

    if (q) {
      const paramIdx = params.length + 1;
      baseQuery += ` AND (LOWER(title) LIKE $${paramIdx} OR LOWER(case_num) LIKE $${paramIdx} OR LOWER(client_name) LIKE $${paramIdx})`;
      params.push(`%${q.toLowerCase()}%`);
    }

    baseQuery += " ORDER BY title ASC";

    const { rows } = await pool.query(baseQuery, params);

    const cases = rows.map(c => ({
      id: String(c.id),
      name: c.title || c.client_name,
      caseNumber: c.case_num,
      pinned: pinnedIds.has(c.id),
    }));

    cases.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return a.name.localeCompare(b.name);
    });

    return res.json({ cases });
  } catch (err) {
    console.error("External cases error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/cases/:id", requireExternalAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1 AND deleted_at IS NULL", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Case not found" });
    const c = rows[0];
    const user = req.extUser;
    const roles = user.roles || [user.role];
    if (!roles.includes("App Admin")) {
      if (![c.lead_attorney, c.second_attorney, c.case_manager, c.investigator, c.paralegal].includes(user.id)) {
        return res.status(403).json({ error: "No access to this case" });
      }
    }
    const { rows: parties } = await pool.query("SELECT * FROM case_parties WHERE case_id = $1", [req.params.id]);
    const { rows: notes } = await pool.query("SELECT id, case_id, type, body, author_name, author_role, created_at FROM case_notes WHERE case_id = $1 ORDER BY created_at DESC LIMIT 50", [req.params.id]);
    return res.json({ ...c, parties, recentNotes: notes });
  } catch (err) {
    console.error("External case detail error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/cases/:id/jury-analysis", requireExternalAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.id);
    const { rows: caseRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
    if (!caseRows.length) return res.status(404).json({ error: "Case not found" });
    const { jurors, strikeStrategy, causeChallenges, causeStrategy, daubertChallenge, source } = req.body;
    if (!jurors || !Array.isArray(jurors)) return res.status(400).json({ error: "jurors array is required" });
    const sanitizedDaubert = daubertChallenge ? String(daubertChallenge).slice(0, 10000) : null;
    const { rows } = await pool.query(
      `INSERT INTO jury_analyses (case_id, jurors, strike_strategy, cause_challenges, cause_strategy, daubert_challenge, imported_by, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (case_id) DO UPDATE SET jurors = $2, strike_strategy = $3, cause_challenges = $4, cause_strategy = $5, daubert_challenge = $6, imported_at = NOW(), imported_by = $7, source = $8
       RETURNING *`,
      [caseId, JSON.stringify(jurors), strikeStrategy || "", JSON.stringify(causeChallenges || []), causeStrategy || "", sanitizedDaubert, req.extUser.id, source || "external"]
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error("External jury analysis import error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/cases/:id/files", requireExternalAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.id);
    const { rows: caseRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
    if (!caseRows.length) return res.status(404).json({ error: "Case not found" });

    const user = req.extUser;
    const roles = user.roles || [user.role];
    if (!roles.includes("App Admin")) {
      const { rows: accessRows } = await pool.query(
        "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2)",
        [caseId, user.id]
      );
      if (!accessRows.length) return res.status(403).json({ error: "No access to this case" });
    }

    const filename = (req.query.filename || "").trim();

    if (filename) {
      const { rows: tRows } = await pool.query(
        "SELECT id FROM case_transcripts WHERE case_id = $1 AND LOWER(filename) = LOWER($2) AND deleted_at IS NULL LIMIT 1",
        [caseId, filename]
      );
      if (tRows.length) {
        return res.json({ exists: true, fileId: String(tRows[0].id) });
      }
      return res.json({ exists: false });
    }

    const { rows: docs } = await pool.query(
      "SELECT id, filename, content_type, file_size, doc_type, created_at FROM case_documents WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [caseId]
    );
    const { rows: transcripts } = await pool.query(
      "SELECT id, filename, content_type, file_size, status, created_at FROM case_transcripts WHERE case_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [caseId]
    );
    return res.json({ documents: docs, transcripts });
  } catch (err) {
    console.error("External case files error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/cases/:id/files", requireExternalAuth, async (req, res) => {
  try {
    const caseId = parseInt(req.params.id);
    const { rows: caseRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
    if (!caseRows.length) return res.status(404).json({ error: "Case not found" });

    const user = req.extUser;
    const roles = user.roles || [user.role];
    if (!roles.includes("App Admin")) {
      const { rows: accessRows } = await pool.query(
        "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2)",
        [caseId, user.id]
      );
      if (!accessRows.length) return res.status(403).json({ error: "No access to this case" });
    }

    const { filename, description, type, duration, replaceFileId, transcript } = req.body;
    if (!filename) return res.status(400).json({ error: "Filename is required" });

    const contentType = type === "video" ? "video/mp4" : "audio/mpeg";

    if (replaceFileId) {
      const { rows: existing } = await pool.query(
        "SELECT id FROM case_transcripts WHERE id = $1 AND case_id = $2 AND deleted_at IS NULL",
        [replaceFileId, caseId]
      );
      if (!existing.length) return res.status(404).json({ error: "File to replace not found" });

      await pool.query(
        `UPDATE case_transcripts SET
          filename = $1, content_type = $2, duration_seconds = $3, description = $4,
          transcript = $5, transcript_versions = $6, summaries = $7, pipeline_log = $8,
          is_video = $9, status = 'completed', scribe_status = 'completed', updated_at = NOW()
        WHERE id = $10 AND case_id = $11`,
        [
          filename, contentType, duration || null, description || '',
          transcript?.segments ? JSON.stringify(transcript.segments) : '[]',
          transcript?.versions ? JSON.stringify(transcript.versions) : null,
          transcript?.summaries ? JSON.stringify(transcript.summaries) : null,
          transcript?.pipelineLog ? JSON.stringify(transcript.pipelineLog) : null,
          type === "video",
          replaceFileId, caseId,
        ]
      );
      return res.json({ fileId: String(replaceFileId), replaced: true });
    }

    const { rows: inserted } = await pool.query(
      `INSERT INTO case_transcripts (case_id, filename, content_type, duration_seconds, description, transcript, transcript_versions, summaries, pipeline_log, is_video, status, scribe_status, uploaded_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', 'completed', $11, NOW(), NOW())
       RETURNING id`,
      [
        caseId, filename, contentType, duration || null, description || '',
        transcript?.segments ? JSON.stringify(transcript.segments) : '[]',
        transcript?.versions ? JSON.stringify(transcript.versions) : null,
        transcript?.summaries ? JSON.stringify(transcript.summaries) : null,
        transcript?.pipelineLog ? JSON.stringify(transcript.pipelineLog) : null,
        type === "video",
        user.id,
      ]
    );
    return res.status(201).json({ fileId: String(inserted[0].id), replaced: false });
  } catch (err) {
    console.error("External case file create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
