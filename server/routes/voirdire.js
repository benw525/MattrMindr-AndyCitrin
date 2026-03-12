const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const VOIRDIRE_BASE_URL = "https://voirdire.mattrmindr.com/app";
const VOIRDIRE_API_KEY = process.env.VOIRDIRE_API_KEY || "";

async function verifyCaseAccess(caseId, req) {
  const { rows } = await pool.query("SELECT * FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
  if (!rows.length) return null;
  const row = rows[0];
  if (!row.confidential) return row;
  const roles = req.session.userRoles || [req.session.userRole];
  if (roles.includes("App Admin")) return row;
  const uid = req.session.userId;
  if ([row.lead_attorney, row.second_attorney, row.case_manager, row.investigator, row.paralegal].includes(uid)) return row;
  const customTeam = Array.isArray(row.custom_team) ? row.custom_team : [];
  if (customTeam.some(m => m.userId === uid)) return row;
  return null;
}

async function getVoirdireCredentials(userId) {
  const { rows } = await pool.query(
    "SELECT voirdire_url, voirdire_token FROM users WHERE id = $1",
    [userId]
  );
  if (!rows.length || !rows[0].voirdire_url || !rows[0].voirdire_token) return null;
  return { voirdire_url: rows[0].voirdire_url, voirdire_token: rows[0].voirdire_token };
}

router.get("/status", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT voirdire_url, voirdire_token, voirdire_user_email FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (!rows.length) return res.json({ connected: false });
    const u = rows[0];
    res.json({
      connected: !!(u.voirdire_url && u.voirdire_token),
      url: u.voirdire_url || null,
      email: u.voirdire_user_email || null,
    });
  } catch (err) {
    console.error("Voir Dire status error:", err.message);
    res.json({ connected: false });
  }
});

router.post("/connect", requireAuth, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

    try {
      const loginRes = await fetch(`${VOIRDIRE_BASE_URL}/api/external/auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(VOIRDIRE_API_KEY ? { "X-API-Key": VOIRDIRE_API_KEY } : {}),
        },
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(() => ({}));
        return res.status(401).json({ error: errData.error || "Invalid Voir Dire Analyst credentials" });
      }
      const loginData = await loginRes.json();
      const userToken = loginData.token || loginData.accessToken || null;
      if (!userToken) {
        return res.status(401).json({ error: "Login succeeded but no access token was returned. Contact your Voir Dire Analyst administrator." });
      }

      await pool.query(
        "UPDATE users SET voirdire_url = $1, voirdire_token = $2, voirdire_user_email = $3 WHERE id = $4",
        [VOIRDIRE_BASE_URL, userToken, email, req.session.userId]
      );
      res.json({ ok: true });
    } catch (fetchErr) {
      console.error("Voir Dire connect fetch error:", fetchErr.message);
      return res.status(400).json({ error: "Could not reach Voir Dire Analyst. Please try again later." });
    }
  } catch (err) {
    console.error("Voir Dire connect error:", err.message);
    res.status(500).json({ error: "Failed to connect to Voir Dire Analyst" });
  }
});

router.post("/disconnect", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE users SET voirdire_url = NULL, voirdire_token = NULL, voirdire_user_email = NULL WHERE id = $1",
      [req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Voir Dire disconnect error:", err.message);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

router.get("/list-jurors", requireAuth, async (req, res) => {
  try {
    const creds = await getVoirdireCredentials(req.session.userId);
    if (!creds) return res.status(400).json({ error: "Voir Dire Analyst not connected" });

    const listRes = await fetch(`${creds.voirdire_url}/api/external/jurors`, {
      headers: {
        Authorization: `Bearer ${creds.voirdire_token}`,
        ...(VOIRDIRE_API_KEY ? { "X-API-Key": VOIRDIRE_API_KEY } : {}),
      },
    });
    if (!listRes.ok) {
      const errText = await listRes.text().catch(() => "");
      console.error("Voir Dire list-jurors failed:", listRes.status, errText);
      if (listRes.status === 401) return res.status(401).json({ error: "Voir Dire session expired. Please reconnect in Settings." });
      return res.status(500).json({ error: "Could not fetch jurors from Voir Dire Analyst" });
    }
    const contentType = listRes.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      console.error("Voir Dire list-jurors returned non-JSON:", contentType);
      return res.status(500).json({ error: "Voir Dire Analyst returned an unexpected response" });
    }
    const data = await listRes.json();
    const jurors = (data.jurors || data || []).map(j => ({
      id: j.id,
      name: j.name || j.jurorName || "Unknown",
      seat_number: j.seatNumber || j.seat_number || null,
      demographics: j.demographics || "",
      notes: j.notes || j.observations || "",
      strike_type: j.strikeType || j.strike_type || "none",
      is_selected: j.isSelected || j.is_selected || false,
      bias_rating: j.biasRating || j.bias_rating || null,
      occupation: j.occupation || "",
      age: j.age || null,
      questionnaire: j.questionnaire || j.questionnaireResponses || null,
      analysis: j.analysis || j.aiAnalysis || null,
      case_id: j.caseId || j.case_id || null,
      case_name: j.caseName || j.case_name || null,
      created_at: j.createdAt || j.created_at || null,
    }));
    res.json({ jurors });
  } catch (err) {
    console.error("Voir Dire list-jurors error:", err.message);
    res.status(500).json({ error: "Failed to list jurors from Voir Dire Analyst" });
  }
});

router.post("/import-jurors", requireAuth, async (req, res) => {
  try {
    const { jurorIds, sessionId } = req.body;
    if (!jurorIds || !Array.isArray(jurorIds) || jurorIds.length === 0) return res.status(400).json({ error: "jurorIds array is required" });
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    const { rows: sessRows } = await pool.query("SELECT id, case_id FROM trial_sessions WHERE id = $1", [sessionId]);
    if (!sessRows.length) return res.status(404).json({ error: "Trial session not found" });

    const caseRow = await verifyCaseAccess(sessRows[0].case_id, req);
    if (!caseRow) return res.status(403).json({ error: "Access denied" });

    const creds = await getVoirdireCredentials(req.session.userId);
    if (!creds) return res.status(400).json({ error: "Voir Dire Analyst not connected" });

    const listRes = await fetch(`${creds.voirdire_url}/api/external/jurors`, {
      headers: {
        Authorization: `Bearer ${creds.voirdire_token}`,
        ...(VOIRDIRE_API_KEY ? { "X-API-Key": VOIRDIRE_API_KEY } : {}),
      },
    });
    if (!listRes.ok) {
      if (listRes.status === 401) return res.status(401).json({ error: "Voir Dire session expired. Please reconnect in Settings." });
      return res.status(500).json({ error: "Could not fetch jurors from Voir Dire Analyst" });
    }
    const data = await listRes.json();
    const allJurors = data.jurors || data || [];

    const selected = allJurors.filter(j => jurorIds.includes(String(j.id)) || jurorIds.includes(j.id));
    if (selected.length === 0) return res.status(404).json({ error: "No matching jurors found in Voir Dire Analyst" });

    const imported = [];
    for (const j of selected) {
      const name = j.name || j.jurorName || "Unknown";
      const seatNumber = j.seatNumber || j.seat_number || null;
      const demographics = j.demographics || "";
      const occupation = j.occupation || "";
      const age = j.age || null;
      const notes = [
        j.notes || j.observations || "",
        occupation ? `Occupation: ${occupation}` : "",
        age ? `Age: ${age}` : "",
        j.biasRating || j.bias_rating ? `Bias Rating: ${j.biasRating || j.bias_rating}` : "",
        j.analysis || j.aiAnalysis ? `\nVoir Dire Analysis:\n${j.analysis || j.aiAnalysis}` : "",
        j.questionnaire || j.questionnaireResponses ? `\nQuestionnaire:\n${typeof (j.questionnaire || j.questionnaireResponses) === "string" ? (j.questionnaire || j.questionnaireResponses) : JSON.stringify(j.questionnaire || j.questionnaireResponses, null, 2)}` : "",
      ].filter(Boolean).join("\n");
      const strikeType = j.strikeType || j.strike_type || "none";
      const isSelected = j.isSelected || j.is_selected || false;

      const { rows: existCheck } = await pool.query(
        "SELECT id FROM trial_jurors WHERE session_id = $1 AND voirdire_juror_id = $2",
        [sessionId, String(j.id)]
      );
      if (existCheck.length > 0) {
        await pool.query(
          `UPDATE trial_jurors SET name = $1, seat_number = $2, demographics = $3, notes = $4, strike_type = $5, is_selected = $6, updated_at = NOW() WHERE id = $7`,
          [name, seatNumber, demographics, notes, strikeType, isSelected, existCheck[0].id]
        );
        imported.push({ id: existCheck[0].id, name, updated: true });
      } else {
        const { rows: ins } = await pool.query(
          `INSERT INTO trial_jurors (session_id, name, seat_number, demographics, notes, strike_type, is_selected, voirdire_juror_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()) RETURNING id`,
          [sessionId, name, seatNumber, demographics, notes, strikeType, isSelected, String(j.id)]
        );
        imported.push({ id: ins[0].id, name, updated: false });
      }
    }

    res.json({ ok: true, imported, count: imported.length });
  } catch (err) {
    console.error("Voir Dire import-jurors error:", err.message);
    res.status(500).json({ error: "Failed to import jurors from Voir Dire Analyst" });
  }
});

module.exports = router;
