const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { randomUUID } = require("crypto");

const router = express.Router();

const MS_CLIENT_ID = process.env.MS_CLIENT_ID;
const MS_CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const MS_REDIRECT_URI = process.env.MS_REDIRECT_URI || "";
const MS_SCOPES = "openid profile email Files.ReadWrite.All offline_access";

router.get("/configured", requireAuth, (req, res) => {
  res.json({ configured: !!(MS_CLIENT_ID && MS_CLIENT_SECRET) });
});

router.get("/status", requireAuth, async (req, res) => {
  try {
    if (!MS_CLIENT_ID || !MS_CLIENT_SECRET) return res.json({ connected: false, configured: false });
    const { rows } = await pool.query(
      "SELECT ms_access_token, ms_token_expiry, ms_account_email FROM users WHERE id = $1",
      [req.session.userId]
    );
    if (!rows.length || !rows[0].ms_access_token) return res.json({ connected: false, configured: true });
    const user = rows[0];
    const expired = user.ms_token_expiry && new Date(user.ms_token_expiry) < new Date();
    res.json({ connected: true, configured: true, email: user.ms_account_email, expired });
  } catch (err) {
    console.error("MS status error:", err.message);
    res.json({ connected: false, configured: !!MS_CLIENT_ID });
  }
});

router.get("/auth-url", requireAuth, (req, res) => {
  if (!MS_CLIENT_ID) return res.status(400).json({ error: "Microsoft integration not configured" });
  const redirectUri = MS_REDIRECT_URI || `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}/api/microsoft/callback`;
  const state = Buffer.from(JSON.stringify({ userId: req.session.userId })).toString("base64");
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${MS_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(MS_SCOPES)}&state=${state}&response_mode=query`;
  res.json({ url });
});

router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Missing code or state");
    const { userId } = JSON.parse(Buffer.from(state, "base64").toString());
    const redirectUri = MS_REDIRECT_URI || `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}/api/microsoft/callback`;

    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: MS_SCOPES,
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return res.status(400).send(`OAuth error: ${tokens.error_description || tokens.error}`);

    const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
    let accountEmail = null;
    try {
      const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const me = await meRes.json();
      accountEmail = me.mail || me.userPrincipalName || null;
    } catch {}

    await pool.query(
      `UPDATE users SET ms_access_token = $1, ms_refresh_token = $2, ms_token_expiry = $3, ms_account_email = $4 WHERE id = $5`,
      [tokens.access_token, tokens.refresh_token || null, expiry, accountEmail, userId]
    );
    res.send(`<html><body><script>window.close();</script><p>Microsoft account connected. You can close this window.</p></body></html>`);
  } catch (err) {
    console.error("MS callback error:", err.message);
    res.status(500).send("Failed to connect Microsoft account");
  }
});

async function getValidToken(userId) {
  const { rows } = await pool.query(
    "SELECT ms_access_token, ms_refresh_token, ms_token_expiry FROM users WHERE id = $1",
    [userId]
  );
  if (!rows.length || !rows[0].ms_access_token) return null;
  const user = rows[0];
  if (user.ms_token_expiry && new Date(user.ms_token_expiry) > new Date(Date.now() + 60000)) {
    return user.ms_access_token;
  }
  if (!user.ms_refresh_token) return null;
  try {
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: MS_CLIENT_ID,
        client_secret: MS_CLIENT_SECRET,
        refresh_token: user.ms_refresh_token,
        grant_type: "refresh_token",
        scope: MS_SCOPES,
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return null;
    const expiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
    await pool.query(
      `UPDATE users SET ms_access_token = $1, ms_refresh_token = $2, ms_token_expiry = $3 WHERE id = $4`,
      [tokens.access_token, tokens.refresh_token || user.ms_refresh_token, expiry, userId]
    );
    return tokens.access_token;
  } catch { return null; }
}

router.post("/disconnect", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET ms_access_token = NULL, ms_refresh_token = NULL, ms_token_expiry = NULL, ms_account_email = NULL WHERE id = $1`,
      [req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("MS disconnect error:", err.message);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

router.post("/upload-for-edit", requireAuth, async (req, res) => {
  try {
    const { docId } = req.body;
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Microsoft account not connected or token expired" });

    const { rows } = await pool.query("SELECT filename, content_type, file_data, case_id FROM case_documents WHERE id = $1", [docId]);
    if (rows.length) {
      const userId = req.session.userId;
      const userRole = req.session.userRole || "";
      if (userRole !== "App Admin") {
        const { rows: cRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2 OR confidential = false OR confidential IS NULL)", [rows[0].case_id, userId]);
        if (!cRows.length) return res.status(403).json({ error: "Access denied" });
      }
    }
    if (!rows.length) return res.status(404).json({ error: "Document not found" });
    const doc = rows[0];
    if (!doc.file_data) return res.status(400).json({ error: "No file data available" });

    const uploadRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/drive/root:/MattrMindr/${randomUUID()}_${doc.filename}:/content`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": doc.content_type || "application/octet-stream",
        },
        body: doc.file_data,
      }
    );
    if (!uploadRes.ok) {
      const errBody = await uploadRes.text();
      console.error("OneDrive upload failed:", errBody);
      return res.status(500).json({ error: "Failed to upload to OneDrive" });
    }
    const item = await uploadRes.json();
    const editUrl = item.webUrl || item["@microsoft.graph.downloadUrl"];
    res.json({ driveItemId: item.id, editUrl, webUrl: item.webUrl });
  } catch (err) {
    console.error("MS upload-for-edit error:", err.message);
    res.status(500).json({ error: "Failed to upload for editing" });
  }
});

router.post("/sync-back", requireAuth, async (req, res) => {
  try {
    const { docId, driveItemId } = req.body;
    const { rows: docCheck } = await pool.query("SELECT case_id FROM case_documents WHERE id = $1", [docId]);
    if (docCheck.length) {
      const userId = req.session.userId;
      const userRole = req.session.userRole || "";
      if (userRole !== "App Admin") {
        const { rows: cRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2 OR confidential = false OR confidential IS NULL)", [docCheck[0].case_id, userId]);
        if (!cRows.length) return res.status(403).json({ error: "Access denied" });
      }
    }
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Token expired" });

    const dlRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${driveItemId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) return res.status(500).json({ error: "Failed to download from OneDrive" });
    const buffer = Buffer.from(await dlRes.arrayBuffer());

    await pool.query("UPDATE case_documents SET file_data = $1, updated_at = NOW() WHERE id = $2", [buffer, docId]);
    res.json({ ok: true, size: buffer.length });
  } catch (err) {
    console.error("MS sync-back error:", err.message);
    res.status(500).json({ error: "Failed to sync back" });
  }
});

router.delete("/cleanup/:driveItemId", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (token) {
      await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${req.params.driveItemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("MS cleanup error:", err.message);
    res.json({ ok: true });
  }
});

module.exports = router;
