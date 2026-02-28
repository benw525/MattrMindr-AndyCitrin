const express = require("express");
const OpenAI = require("openai");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { sendSMS, formatPhoneNumber, isConfigured } = require("../sms");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

router.get("/status", requireAuth, async (req, res) => {
  res.json({ configured: await isConfigured() });
});

router.get("/configs/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sc.*, u.name as created_by_name FROM sms_configs sc
       LEFT JOIN users u ON sc.created_by = u.id
       WHERE sc.case_id = $1 ORDER BY sc.created_at DESC`,
      [req.params.caseId]
    );
    const configs = rows.map(r => ({
      id: r.id,
      caseId: r.case_id,
      phoneNumbers: r.phone_numbers || [],
      contactName: r.contact_name,
      contactType: r.contact_type,
      notifyHearings: r.notify_hearings,
      notifyDeadlines: r.notify_deadlines,
      notifyCourtDates: r.notify_court_dates,
      notifyMeetings: r.notify_meetings,
      reminderDays: r.reminder_days || [1, 7],
      customMessage: r.custom_message,
      enabled: r.enabled,
      createdBy: r.created_by,
      createdByName: r.created_by_name || "",
      createdAt: r.created_at,
    }));
    res.json(configs);
  } catch (err) {
    console.error("SMS configs fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/configs", requireAuth, async (req, res) => {
  try {
    const { caseId, phoneNumbers, contactName, contactType, notifyHearings, notifyDeadlines, notifyCourtDates, notifyMeetings, reminderDays, customMessage } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });
    if (!phoneNumbers || phoneNumbers.length === 0) return res.status(400).json({ error: "At least one phone number required" });

    const formatted = phoneNumbers.map(p => formatPhoneNumber(p)).filter(Boolean);
    if (formatted.length === 0) return res.status(400).json({ error: "No valid phone numbers provided" });

    const { rows } = await pool.query(
      `INSERT INTO sms_configs (case_id, phone_numbers, contact_name, contact_type, notify_hearings, notify_deadlines, notify_court_dates, notify_meetings, reminder_days, custom_message, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [caseId, formatted, contactName || "", contactType || "client",
       notifyHearings !== false, notifyDeadlines === true, notifyCourtDates !== false, notifyMeetings === true,
       reminderDays || [1, 7], customMessage || "", req.session.userId]
    );

    const config = rows[0];
    const { generateScheduledMessages } = require("../sms-scheduler");
    await generateScheduledMessages(config.id).catch(err => console.error("Auto-schedule error:", err));

    res.status(201).json({
      id: config.id, caseId: config.case_id, phoneNumbers: config.phone_numbers,
      contactName: config.contact_name, contactType: config.contact_type,
      notifyHearings: config.notify_hearings, notifyDeadlines: config.notify_deadlines,
      notifyCourtDates: config.notify_court_dates, notifyMeetings: config.notify_meetings,
      reminderDays: config.reminder_days, customMessage: config.custom_message,
      enabled: config.enabled, createdBy: config.created_by, createdAt: config.created_at,
    });
  } catch (err) {
    console.error("SMS config create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/configs/:id", requireAuth, async (req, res) => {
  try {
    const { phoneNumbers, contactName, contactType, notifyHearings, notifyDeadlines, notifyCourtDates, notifyMeetings, reminderDays, customMessage, enabled } = req.body;
    const sets = [];
    const vals = [];
    let idx = 1;

    if (phoneNumbers !== undefined) {
      const formatted = phoneNumbers.map(p => formatPhoneNumber(p)).filter(Boolean);
      sets.push(`phone_numbers = $${idx++}`); vals.push(formatted);
    }
    if (contactName !== undefined) { sets.push(`contact_name = $${idx++}`); vals.push(contactName); }
    if (contactType !== undefined) { sets.push(`contact_type = $${idx++}`); vals.push(contactType); }
    if (notifyHearings !== undefined) { sets.push(`notify_hearings = $${idx++}`); vals.push(notifyHearings); }
    if (notifyDeadlines !== undefined) { sets.push(`notify_deadlines = $${idx++}`); vals.push(notifyDeadlines); }
    if (notifyCourtDates !== undefined) { sets.push(`notify_court_dates = $${idx++}`); vals.push(notifyCourtDates); }
    if (notifyMeetings !== undefined) { sets.push(`notify_meetings = $${idx++}`); vals.push(notifyMeetings); }
    if (reminderDays !== undefined) { sets.push(`reminder_days = $${idx++}`); vals.push(reminderDays); }
    if (customMessage !== undefined) { sets.push(`custom_message = $${idx++}`); vals.push(customMessage); }
    if (enabled !== undefined) { sets.push(`enabled = $${idx++}`); vals.push(enabled); }

    if (sets.length === 0) return res.json({ ok: true });

    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE sms_configs SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`, vals
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });

    const { generateScheduledMessages } = require("../sms-scheduler");
    await pool.query(`DELETE FROM sms_scheduled WHERE sms_config_id = $1 AND status = 'pending'`, [req.params.id]);
    if (rows[0].enabled) {
      await generateScheduledMessages(rows[0].id).catch(err => console.error("Re-schedule error:", err));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("SMS config update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/configs/:id", requireAuth, async (req, res) => {
  try {
    await pool.query(`UPDATE sms_scheduled SET status = 'cancelled' WHERE sms_config_id = $1 AND status = 'pending'`, [req.params.id]);
    const { rows } = await pool.query("DELETE FROM sms_configs WHERE id = $1 RETURNING *", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("SMS config delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/messages/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sm.*, u.name as sent_by_name FROM sms_messages sm
       LEFT JOIN users u ON sm.sent_by = u.id
       WHERE sm.case_id = $1 ORDER BY sm.sent_at DESC`,
      [req.params.caseId]
    );
    res.json(rows.map(r => ({
      id: r.id, caseId: r.case_id, direction: r.direction,
      phoneNumber: r.phone_number, body: r.body, twilioSid: r.twilio_sid,
      status: r.status, contactName: r.contact_name,
      sentBy: r.sent_by, sentByName: r.sent_by_name || "",
      sentAt: r.sent_at,
    })));
  } catch (err) {
    console.error("SMS messages fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/scheduled/:caseId", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sms_scheduled WHERE case_id = $1 AND status = 'pending' ORDER BY send_at ASC`,
      [req.params.caseId]
    );
    res.json(rows.map(r => ({
      id: r.id, configId: r.sms_config_id, caseId: r.case_id,
      eventType: r.event_type, eventTitle: r.event_title,
      eventDate: r.event_date, sendAt: r.send_at,
      phoneNumber: r.phone_number, messageBody: r.message_body,
      status: r.status,
    })));
  } catch (err) {
    console.error("SMS scheduled fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/send", requireAuth, async (req, res) => {
  try {
    const { caseId, phoneNumber, body, contactName } = req.body;
    if (!phoneNumber || !body) return res.status(400).json({ error: "Phone number and message body required" });

    const formatted = formatPhoneNumber(phoneNumber);
    if (!formatted) return res.status(400).json({ error: "Invalid phone number" });

    if (!(await isConfigured())) {
      await pool.query(
        `INSERT INTO sms_messages (case_id, direction, phone_number, body, status, contact_name, sent_by)
         VALUES ($1, 'outbound', $2, $3, 'not_configured', $4, $5)`,
        [caseId || null, formatted, body, contactName || "", req.session.userId]
      );
      return res.status(503).json({ error: "Twilio is not configured. Please connect your Twilio account in the integrations panel." });
    }

    const result = await sendSMS(formatted, body);

    await pool.query(
      `INSERT INTO sms_messages (case_id, direction, phone_number, body, twilio_sid, status, contact_name, sent_by)
       VALUES ($1, 'outbound', $2, $3, $4, $5, $6, $7)`,
      [caseId || null, formatted, body, result.sid, result.status || "sent", contactName || "", req.session.userId]
    );

    res.json({ ok: true, sid: result.sid, status: result.status });
  } catch (err) {
    console.error("SMS send error:", err);
    res.status(500).json({ error: err.message || "Failed to send SMS" });
  }
});

router.post("/draft", requireAuth, async (req, res) => {
  try {
    const { caseId, eventType, eventTitle, eventDate, contactName, contactType, customInstructions } = req.body;
    if (!caseId) return res.status(400).json({ error: "caseId required" });

    const caseRes = await pool.query("SELECT * FROM cases WHERE id = $1", [caseId]);
    const c = caseRes.rows[0];
    if (!c) return res.status(404).json({ error: "Case not found" });

    const usersRes = await pool.query("SELECT id, name FROM users");
    const userMap = {};
    usersRes.rows.forEach(u => { userMap[u.id] = u.name; });

    const systemPrompt = `You are drafting a short, professional SMS text message for a criminal defense attorney's office (Mobile County Public Defender). The message is to a ${contactType || "client"} about an upcoming case event. Keep it under 160 characters so it fits in a single SMS segment. Use plain, simple language. Be warm but professional. Include the date and what they need to know. Do NOT include legal advice. Do NOT use emojis. Write exactly ONE text message — do not provide multiple options, alternatives, or variations.`;

    const userPrompt = `Draft a single text message reminder (under 160 characters):
Recipient: ${contactName || "the client"} (${contactType || "client"})
Case: ${c.title || c.case_num || ""}
Defendant: ${c.defendant_name || ""}
Attorney: ${userMap[c.lead_attorney] || "Your attorney"}
Event: ${eventType || "hearing"} — ${eventTitle || "Court appearance"}
Date: ${eventDate || "upcoming"}
${customInstructions ? `Special instructions: ${customInstructions}` : ""}

Write ONLY the text message, nothing else. Keep it under 160 characters.`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 200,
      store: false,
    });

    res.json({ draft: resp.choices[0].message.content.trim() });
  } catch (err) {
    console.error("SMS draft error:", err);
    res.status(500).json({ error: "Failed to draft message" });
  }
});

router.get("/suggest-numbers/:caseId", requireAuth, async (req, res) => {
  try {
    const caseId = req.params.caseId;
    const suggestions = [];

    const caseRes = await pool.query("SELECT defendant_name FROM cases WHERE id = $1", [caseId]);
    if (!caseRes.rows[0]) return res.status(404).json({ error: "Case not found" });
    const defName = caseRes.rows[0].defendant_name || "";

    const [partiesRes, expertsRes, miscRes, contactsRes] = await Promise.all([
      pool.query("SELECT party_type, data FROM case_parties WHERE case_id = $1", [caseId]),
      pool.query("SELECT expert_type, data FROM case_experts WHERE case_id = $1", [caseId]),
      pool.query("SELECT contact_type, data FROM case_misc_contacts WHERE case_id = $1", [caseId]),
      pool.query("SELECT name, phone, category FROM contacts WHERE deleted_at IS NULL AND phone != '' AND phone IS NOT NULL"),
    ]);

    partiesRes.rows.forEach(p => {
      const d = p.data || {};
      const phone = d.phone || d.cellPhone || d.homePhone || "";
      if (phone) {
        const name = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(" ") || p.party_type;
        suggestions.push({ name, phone, type: p.party_type === "Defendant" ? "client" : "party", source: "Case Parties" });
      }
    });

    expertsRes.rows.forEach(e => {
      const d = e.data || {};
      if (d.phone) suggestions.push({ name: d.name || e.expert_type, phone: d.phone, type: "expert", source: "Case Experts" });
    });

    miscRes.rows.forEach(m => {
      const d = m.data || {};
      if (d.phone) suggestions.push({ name: d.name || m.contact_type, phone: d.phone, type: "misc", source: "Case Contacts" });
    });

    if (defName) {
      contactsRes.rows.forEach(c => {
        if (c.name && c.phone && c.name.toLowerCase().includes(defName.split(" ")[0]?.toLowerCase())) {
          suggestions.push({ name: c.name, phone: c.phone, type: c.category?.toLowerCase() || "contact", source: "Contacts" });
        }
      });
    }

    contactsRes.rows.forEach(c => {
      if (c.category === "Family Member" && c.phone) {
        suggestions.push({ name: c.name, phone: c.phone, type: "family", source: "Contacts" });
      }
    });

    const seen = new Set();
    const unique = suggestions.filter(s => {
      const key = (formatPhoneNumber(s.phone) || s.phone) + s.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json(unique);
  } catch (err) {
    console.error("SMS suggest numbers error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/inbound", async (req, res) => {
  try {
    const from = req.body.From || "";
    const to = req.body.To || "";
    const body = req.body.Body || "";
    const sid = req.body.MessageSid || req.body.SmsSid || "";

    console.log(`Inbound SMS: from=${from}, to=${to}, body="${body.substring(0, 80)}"`);

    const formatted = formatPhoneNumber(from);
    if (!formatted || !body.trim()) {
      console.log("Inbound SMS: missing phone or body, ignoring");
      res.type("text/xml").send("<Response></Response>");
      return;
    }

    const caseMatch = await pool.query(
      `SELECT DISTINCT case_id, contact_name FROM sms_messages
       WHERE phone_number = $1 AND case_id IS NOT NULL AND direction = 'outbound'
       ORDER BY case_id DESC`,
      [formatted]
    );

    if (caseMatch.rows.length === 0) {
      const configMatch = await pool.query(
        `SELECT case_id, contact_name FROM sms_configs
         WHERE $1 = ANY(phone_numbers) AND case_id IS NOT NULL
         ORDER BY case_id DESC`,
        [formatted]
      );
      if (configMatch.rows.length > 0) {
        caseMatch.rows.push(...configMatch.rows);
      }
    }

    if (caseMatch.rows.length === 0) {
      await pool.query(
        `INSERT INTO sms_messages (case_id, direction, phone_number, body, twilio_sid, status, contact_name)
         VALUES (NULL, 'inbound', $1, $2, $3, 'received', '')`,
        [formatted, body.trim(), sid]
      );
      console.log("Inbound SMS: no matching case, stored as unlinked");
    } else {
      for (const match of caseMatch.rows) {
        await pool.query(
          `INSERT INTO sms_messages (case_id, direction, phone_number, body, twilio_sid, status, contact_name)
           VALUES ($1, 'inbound', $2, $3, $4, 'received', $5)`,
          [match.case_id, formatted, body.trim(), sid, match.contact_name || ""]
        );
        console.log(`Inbound SMS: stored for case ${match.case_id}`);
      }
    }

    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    console.error("Inbound SMS error:", err);
    res.type("text/xml").send("<Response></Response>");
  }
});

module.exports = router;
