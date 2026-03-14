const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const router = express.Router();

const pendingOAuthStates = new Map();

const MS_SCOPES = "openid profile email Files.ReadWrite.All Calendars.ReadWrite Contacts.ReadWrite offline_access";

async function getMsCredentials() {
  const envId = process.env.MS_CLIENT_ID;
  const envSecret = process.env.MS_CLIENT_SECRET;
  const envRedirect = process.env.MS_REDIRECT_URI || "";
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, redirectUri: envRedirect };
  try {
    const { rows } = await pool.query("SELECT key, value FROM integration_configs WHERE key IN ('ms_client_id', 'ms_client_secret', 'ms_redirect_uri')");
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });
    if (map.ms_client_id && map.ms_client_secret) return { clientId: map.ms_client_id, clientSecret: map.ms_client_secret, redirectUri: map.ms_redirect_uri || "" };
  } catch {}
  return null;
}

router.get("/configured", requireAuth, async (req, res) => {
  const creds = await getMsCredentials();
  res.json({ configured: !!creds });
});

router.get("/status", requireAuth, async (req, res) => {
  try {
    const creds = await getMsCredentials();
    if (!creds) return res.json({ connected: false, configured: false });
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
    res.json({ connected: false, configured: false });
  }
});

router.get("/auth-url", requireAuth, async (req, res) => {
  const creds = await getMsCredentials();
  if (!creds) return res.status(400).json({ error: "Microsoft integration not configured" });
  const redirectUri = creds.redirectUri || `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}/api/microsoft/callback`;
  const nonce = crypto.randomBytes(32).toString("hex");
  const statePayload = { userId: req.session.userId, nonce };
  pendingOAuthStates.set(nonce, { userId: req.session.userId, createdAt: Date.now() });
  setTimeout(() => pendingOAuthStates.delete(nonce), 600000);
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64");
  const url = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${creds.clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(MS_SCOPES)}&state=${state}&response_mode=query`;
  res.json({ url });
});

router.post("/configure", requireAuth, async (req, res) => {
  const { rows: uRows } = await pool.query("SELECT role FROM users WHERE id = $1", [req.session.userId]);
  if (!uRows.length || uRows[0].role !== "App Admin") return res.status(403).json({ error: "Admin access required" });
  const { clientId, clientSecret, redirectUri } = req.body;
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Client ID and Client Secret are required" });
  try {
    const upsert = "INSERT INTO integration_configs (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()";
    await pool.query(upsert, ["ms_client_id", clientId.trim()]);
    await pool.query(upsert, ["ms_client_secret", clientSecret.trim()]);
    if (redirectUri) await pool.query(upsert, ["ms_redirect_uri", redirectUri.trim()]);
    res.json({ success: true });
  } catch (err) {
    console.error("MS configure error:", err.message);
    res.status(500).json({ error: "Failed to save configuration" });
  }
});

router.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) return res.status(400).send("Missing code or state");
    const parsed = JSON.parse(Buffer.from(state, "base64").toString());
    const { userId, nonce } = parsed;
    if (!nonce || !pendingOAuthStates.has(nonce)) return res.status(400).send("Invalid or expired OAuth state");
    const stored = pendingOAuthStates.get(nonce);
    if (stored.userId !== userId) return res.status(400).send("OAuth state mismatch");
    pendingOAuthStates.delete(nonce);
    const creds = await getMsCredentials();
    if (!creds) return res.status(400).send("Microsoft integration not configured");
    const redirectUri = creds.redirectUri || `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}/api/microsoft/callback`;

    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
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
  const creds = await getMsCredentials();
  if (!creds) return null;
  try {
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
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
      `UPDATE users SET ms_access_token = NULL, ms_refresh_token = NULL, ms_token_expiry = NULL, ms_account_email = NULL, ms_calendar_sync = false WHERE id = $1`,
      [req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("MS disconnect error:", err.message);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

router.get("/calendar/settings", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT ms_calendar_sync, ms_sync_deadline_types FROM users WHERE id = $1", [req.session.userId]);
    const user = rows[0] || {};
    res.json({ calendarSync: user.ms_calendar_sync || false, syncDeadlineTypes: user.ms_sync_deadline_types || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/calendar/settings", requireAuth, async (req, res) => {
  try {
    const { calendarSync, syncDeadlineTypes } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;
    if (calendarSync !== undefined) { sets.push(`ms_calendar_sync = $${idx++}`); vals.push(!!calendarSync); }
    if (syncDeadlineTypes !== undefined) { sets.push(`ms_sync_deadline_types = $${idx++}`); vals.push(JSON.stringify(syncDeadlineTypes)); }
    if (sets.length === 0) return res.json({ ok: true });
    vals.push(req.session.userId);
    await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`, vals);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/calendar/push-deadline", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Not connected to Microsoft" });
    const { deadlineId } = req.body;
    const uid = req.session.userId;
    const roles = req.session.userRoles || [req.session.userRole];
    const isAdmin = roles.includes("App Admin");
    let query = "SELECT d.*, c.title as case_title, c.case_num FROM deadlines d LEFT JOIN cases c ON d.case_id = c.id WHERE d.id = $1";
    const params = [deadlineId];
    if (!isAdmin) {
      query += " AND (c.lead_attorney = $2 OR c.second_attorney = $2 OR c.case_manager = $2 OR c.investigator = $2 OR c.paralegal = $2)";
      params.push(uid);
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: "Deadline not found" });
    const dl = rows[0];
    const dateStr = dl.date instanceof Date ? dl.date.toISOString().split("T")[0] : dl.date;
    const event = {
      subject: `[MattrMindr] ${dl.title}`,
      body: { contentType: "Text", content: `Case: ${dl.case_title || ""}${dl.case_num ? ` (${dl.case_num})` : ""}\nType: ${dl.type || "Filing"}\nRule: ${dl.rule || ""}` },
      start: { dateTime: `${dateStr}T09:00:00`, timeZone: "UTC" },
      end: { dateTime: `${dateStr}T09:30:00`, timeZone: "UTC" },
      isAllDay: false,
      isReminderOn: true,
      reminderMinutesBeforeStart: 1440,
      categories: ["MattrMindr"],
    };
    if (dl.outlook_event_id) {
      const upRes = await fetch(`https://graph.microsoft.com/v1.0/me/events/${dl.outlook_event_id}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event),
      });
      if (upRes.ok) { const ev = await upRes.json(); return res.json({ ok: true, eventId: ev.id, updated: true }); }
    }
    const createRes = await fetch("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event),
    });
    if (!createRes.ok) { const err = await createRes.json(); return res.status(createRes.status).json({ error: err.error?.message || "Failed to create event" }); }
    const created = await createRes.json();
    await pool.query("UPDATE deadlines SET outlook_event_id = $1 WHERE id = $2", [created.id, deadlineId]);
    res.json({ ok: true, eventId: created.id, created: true });
  } catch (err) {
    console.error("Push deadline to Outlook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/calendar/sync-all", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Not connected to Microsoft" });
    const uid = req.session.userId;
    const { rows: userRows } = await pool.query("SELECT ms_sync_deadline_types FROM users WHERE id = $1", [uid]);
    const allowedTypes = (userRows.length && userRows[0].ms_sync_deadline_types) || [];
    const roles = req.session.userRoles || [req.session.userRole];
    const isAdmin = roles.includes("App Admin");
    let dlQuery = `SELECT d.*, c.title as case_title, c.case_num FROM deadlines d LEFT JOIN cases c ON d.case_id = c.id WHERE d.deleted_at IS NULL AND d.date >= CURRENT_DATE`;
    const dlParams = [];
    if (!isAdmin) {
      dlParams.push(uid);
      dlQuery += ` AND (c.lead_attorney = $1 OR c.second_attorney = $1 OR c.case_manager = $1 OR c.investigator = $1 OR c.paralegal = $1)`;
    }
    dlQuery += ` ORDER BY d.date`;
    const { rows: dlRows } = await pool.query(dlQuery, dlParams);
    let pushed = 0, errors = 0, skipped = 0;
    for (const dl of dlRows) {
      if (allowedTypes.length > 0 && !allowedTypes.includes(dl.type || "Filing")) { skipped++; continue; }
      try {
        const dateStr = dl.date instanceof Date ? dl.date.toISOString().split("T")[0] : dl.date;
        const event = {
          subject: `[MattrMindr] ${dl.title}`,
          body: { contentType: "Text", content: `Case: ${dl.case_title || ""}${dl.case_num ? ` (${dl.case_num})` : ""}\nType: ${dl.type || "Filing"}\nRule: ${dl.rule || ""}` },
          start: { dateTime: `${dateStr}T09:00:00`, timeZone: "UTC" },
          end: { dateTime: `${dateStr}T09:30:00`, timeZone: "UTC" },
          isAllDay: false,
          isReminderOn: true,
          reminderMinutesBeforeStart: 1440,
          categories: ["MattrMindr"],
        };
        if (dl.outlook_event_id) {
          const upRes = await fetch(`https://graph.microsoft.com/v1.0/me/events/${dl.outlook_event_id}`, {
            method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event),
          });
          if (upRes.ok) { pushed++; continue; }
        }
        const createRes = await fetch("https://graph.microsoft.com/v1.0/me/events", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event),
        });
        if (createRes.ok) { const cr = await createRes.json(); await pool.query("UPDATE deadlines SET outlook_event_id = $1 WHERE id = $2", [cr.id, dl.id]); pushed++; }
        else errors++;
      } catch { errors++; }
    }
    res.json({ ok: true, pushed, errors, skipped, total: dlRows.length });
  } catch (err) {
    console.error("Sync all deadlines error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/calendar/events", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Not connected to Microsoft" });
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: "start and end query params required" });
    const graphRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${start}T00:00:00Z&endDateTime=${end}T23:59:59Z&$top=200&$select=id,subject,start,end,location,bodyPreview,categories,isAllDay`,
      { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } }
    );
    if (!graphRes.ok) { const err = await graphRes.json(); return res.status(graphRes.status).json({ error: err.error?.message || "Graph API error" }); }
    const data = await graphRes.json();
    const events = (data.value || []).map(ev => ({
      id: ev.id,
      title: ev.subject || "(No Subject)",
      date: (ev.start?.dateTime || "").split("T")[0],
      endDate: (ev.end?.dateTime || "").split("T")[0],
      location: ev.location?.displayName || "",
      notes: ev.bodyPreview || "",
      isAllDay: ev.isAllDay,
      isMattrMindr: (ev.categories || []).includes("MattrMindr"),
      source: "Outlook",
    }));
    res.json(events);
  } catch (err) {
    console.error("Fetch Outlook events error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/calendar/event/:eventId", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Not connected to Microsoft" });
    const delRes = await fetch(`https://graph.microsoft.com/v1.0/me/events/${req.params.eventId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!delRes.ok && delRes.status !== 404) return res.status(delRes.status).json({ error: "Failed to delete event" });
    await pool.query("UPDATE deadlines SET outlook_event_id = NULL WHERE outlook_event_id = $1", [req.params.eventId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete Outlook event error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/contacts", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Not connected to Microsoft" });
    let allContacts = [];
    let nextLink = "https://graph.microsoft.com/v1.0/me/contacts?$top=100&$select=id,displayName,givenName,surname,emailAddresses,mobilePhone,businessPhones,homePhones,companyName,jobTitle,businessAddress";
    while (nextLink && allContacts.length < 500) {
      const graphRes = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } });
      if (!graphRes.ok) { const err = await graphRes.json(); return res.status(graphRes.status).json({ error: err.error?.message || "Graph API error" }); }
      const data = await graphRes.json();
      allContacts = allContacts.concat((data.value || []).map(c => ({
        outlookId: c.id,
        name: c.displayName || `${c.givenName || ""} ${c.surname || ""}`.trim(),
        email: (c.emailAddresses || [])[0]?.address || "",
        phone: c.mobilePhone || (c.businessPhones || [])[0] || (c.homePhones || [])[0] || "",
        company: c.companyName || "",
        jobTitle: c.jobTitle || "",
        address: c.businessAddress ? [c.businessAddress.street, c.businessAddress.city, c.businessAddress.state, c.businessAddress.postalCode].filter(Boolean).join(", ") : "",
      })));
      nextLink = data["@odata.nextLink"] || null;
    }
    res.json(allContacts);
  } catch (err) {
    console.error("Fetch Outlook contacts error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/contacts/import", requireAuth, async (req, res) => {
  try {
    const { contacts: incoming, category } = req.body;
    if (!incoming || !incoming.length) return res.status(400).json({ error: "No contacts provided" });
    const cat = category || "Other";
    let imported = 0, skipped = 0;
    for (const c of incoming) {
      if (!c.name || !c.name.trim()) { skipped++; continue; }
      const existing = await pool.query("SELECT id FROM contacts WHERE LOWER(name) = LOWER($1) AND deleted_at IS NULL", [c.name.trim()]);
      if (existing.rows.length) { skipped++; continue; }
      await pool.query(
        `INSERT INTO contacts (name, category, phone, email, address, company) VALUES ($1,$2,$3,$4,$5,$6)`,
        [c.name.trim(), cat, c.phone || "", c.email || "", c.address || "", c.company || c.firm || ""]
      );
      imported++;
    }
    res.json({ ok: true, imported, skipped });
  } catch (err) {
    console.error("Import Outlook contacts error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/contacts/export", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Not connected to Microsoft" });
    const { contactIds } = req.body;
    if (!contactIds || !contactIds.length) return res.status(400).json({ error: "No contact IDs provided" });
    const { rows } = await pool.query("SELECT * FROM contacts WHERE id = ANY($1) AND deleted_at IS NULL", [contactIds]);
    let exported = 0, errors = 0;
    for (const c of rows) {
      try {
        const nameParts = (c.name || "").split(" ");
        const givenName = nameParts[0] || "";
        const surname = nameParts.slice(1).join(" ") || "";
        const body = {
          givenName, surname, displayName: c.name || "",
          emailAddresses: c.email ? [{ address: c.email, name: c.name }] : [],
          mobilePhone: c.phone || null,
          companyName: c.company || c.firm || "",
        };
        const createRes = await fetch("https://graph.microsoft.com/v1.0/me/contacts", {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (createRes.ok) exported++; else errors++;
      } catch { errors++; }
    }
    res.json({ ok: true, exported, errors, total: rows.length });
  } catch (err) {
    console.error("Export contacts to Outlook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

async function pushDeadlineToOutlook(userId, deadlineId) {
  try {
    const { rows: userRows } = await pool.query("SELECT ms_calendar_sync, ms_sync_deadline_types FROM users WHERE id = $1", [userId]);
    if (!userRows.length || !userRows[0].ms_calendar_sync) return;
    const allowedTypes = userRows[0].ms_sync_deadline_types || [];
    const token = await getValidToken(userId);
    if (!token) return;
    const { rows } = await pool.query("SELECT d.*, c.title as case_title, c.case_num FROM deadlines d LEFT JOIN cases c ON d.case_id = c.id WHERE d.id = $1", [deadlineId]);
    if (!rows.length) return;
    const dl = rows[0];
    if (allowedTypes.length > 0 && !allowedTypes.includes(dl.type || "Filing")) return;
    const dateStr = dl.date instanceof Date ? dl.date.toISOString().split("T")[0] : dl.date;
    const event = {
      subject: `[MattrMindr] ${dl.title}`,
      body: { contentType: "Text", content: `Case: ${dl.case_title || ""}${dl.case_num ? ` (${dl.case_num})` : ""}\nType: ${dl.type || "Filing"}\nRule: ${dl.rule || ""}` },
      start: { dateTime: `${dateStr}T09:00:00`, timeZone: "UTC" },
      end: { dateTime: `${dateStr}T09:30:00`, timeZone: "UTC" },
      isAllDay: false,
      isReminderOn: true,
      reminderMinutesBeforeStart: 1440,
      categories: ["MattrMindr"],
    };
    if (dl.outlook_event_id) {
      const upRes = await fetch(`https://graph.microsoft.com/v1.0/me/events/${dl.outlook_event_id}`, {
        method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event),
      });
      if (upRes.ok) return;
    }
    const createRes = await fetch("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(event),
    });
    if (createRes.ok) {
      const cr = await createRes.json();
      await pool.query("UPDATE deadlines SET outlook_event_id = $1 WHERE id = $2", [cr.id, deadlineId]);
    }
  } catch (err) {
    console.error("Auto-push deadline to Outlook error:", err.message);
  }
}

async function deleteOutlookEvent(userId, outlookEventId) {
  try {
    if (!outlookEventId) return;
    const token = await getValidToken(userId);
    if (!token) return;
    await fetch(`https://graph.microsoft.com/v1.0/me/events/${outlookEventId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.error("Auto-delete Outlook event error:", err.message);
  }
}

// ── OneDrive Link Resolution ──
router.post("/onedrive/resolve-link", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Not connected to Microsoft" });
    const { url } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ error: "URL is required" });
    const shareUrl = url.trim();
    const encodedUrl = Buffer.from(shareUrl).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const shareId = "u!" + encodedUrl;
    const graphRes = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem?$expand=children($select=id,name,size,file,folder)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!graphRes.ok) {
      const errBody = await graphRes.json().catch(() => ({}));
      const errMsg = errBody.error?.message || "Unable to access this link";
      if (graphRes.status === 404) return res.status(404).json({ error: "Link not found or expired" });
      if (graphRes.status === 403) return res.status(403).json({ error: "Access denied — you may need permission to view this link" });
      return res.status(graphRes.status).json({ error: errMsg });
    }
    const item = await graphRes.json();
    const result = { isFolder: !!item.folder, items: [] };
    if (item.folder && item.children) {
      result.items = item.children.map(c => ({
        id: c.id, name: c.name, size: c.size || 0,
        mimeType: c.file?.mimeType || "", isFile: !!c.file,
        driveId: item.parentReference?.driveId || "",
      }));
    } else if (item.file) {
      result.items = [{
        id: item.id, name: item.name, size: item.size || 0,
        mimeType: item.file.mimeType || "", isFile: true,
        driveId: item.parentReference?.driveId || "",
      }];
    } else {
      return res.status(400).json({ error: "Link does not point to a file or folder" });
    }
    res.json(result);
  } catch (err) {
    console.error("OneDrive resolve link error:", err.message);
    res.status(500).json({ error: "Failed to resolve OneDrive link" });
  }
});

router.post("/onedrive/import-file", requireAuth, async (req, res) => {
  try {
    const token = await getValidToken(req.session.userId);
    if (!token) return res.status(401).json({ error: "Not connected to Microsoft" });
    const { driveId, itemId, caseId, docType, folderId } = req.body;
    if (!itemId || !caseId) return res.status(400).json({ error: "itemId and caseId are required" });

    const uid = req.session.userId;
    const roles = req.session.userRoles || [req.session.userRole];
    const isAdmin = roles.includes("App Admin");
    if (!isAdmin) {
      const { rows: caseRows } = await pool.query(
        "SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2)",
        [caseId, uid]
      );
      if (!caseRows.length) return res.status(403).json({ error: "Access denied to this case" });
    }

    const metaUrl = driveId
      ? `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?$select=name,size,file`
      : `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}?$select=name,size,file`;
    const metaRes = await fetch(metaUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!metaRes.ok) return res.status(metaRes.status).json({ error: "Cannot access file metadata" });
    const meta = await metaRes.json();
    const filename = meta.name || "unknown";
    const mimeType = meta.file?.mimeType || "application/octet-stream";
    const fileSize = meta.size || 0;

    if (fileSize > 25 * 1024 * 1024) return res.status(400).json({ error: `File too large (${(fileSize / 1048576).toFixed(1)} MB). Maximum is 25 MB.` });

    const downloadUrl = driveId
      ? `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}/content`
      : `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/content`;
    const dlRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!dlRes.ok) return res.status(dlRes.status).json({ error: "Failed to download file from OneDrive" });
    const arrayBuf = await dlRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    const userName = req.session.userName || "";
    let folderVal = null;
    if (folderId) {
      folderVal = parseInt(folderId);
      if (isNaN(folderVal)) folderVal = null;
    }

    const { extractText } = require("../utils/extract-text");
    let extractedText = "";
    try { extractedText = await extractText(buffer, mimeType, filename); } catch {}
    const ocrStatus = (extractedText && extractedText.trim().length > 0) ? "complete" : "failed";
    const { rows } = await pool.query(
      `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by, uploaded_by_name, file_size, ocr_status, folder_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, case_id, filename, content_type, extracted_text, summary, doc_type, uploaded_by, uploaded_by_name, file_size, created_at, folder_id, sort_order, ocr_status`,
      [caseId, filename, mimeType, buffer, extractedText, docType || "Other", uid, userName, buffer.length, ocrStatus, folderVal, "OneDrive"]
    );
    const saved = rows[0];
    res.status(201).json({
      id: saved.id, caseId: saved.case_id, filename: saved.filename, contentType: saved.content_type,
      summary: saved.summary || null, docType: saved.doc_type, uploadedBy: saved.uploaded_by,
      uploadedByName: saved.uploaded_by_name, fileSize: saved.file_size, createdAt: saved.created_at,
      folderId: saved.folder_id, sortOrder: saved.sort_order, ocrStatus: saved.ocr_status,
    });
  } catch (err) {
    console.error("OneDrive import file error:", err.message);
    res.status(500).json({ error: "Failed to import file from OneDrive" });
  }
});

module.exports = router;
module.exports.pushDeadlineToOutlook = pushDeadlineToOutlook;
module.exports.deleteOutlookEvent = deleteOutlookEvent;
