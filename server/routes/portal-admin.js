const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { sendEmail } = require("../email");

router.use(requireAuth);

router.get("/:caseId/settings", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM client_portal_settings WHERE case_id = $1",
      [req.params.caseId]
    );
    if (rows.length === 0) {
      return res.json({
        case_id: parseInt(req.params.caseId),
        show_stage: true,
        show_next_court_date: false,
        show_attorney_name: true,
        show_case_type: true,
        show_accident_date: false,
        show_documents: true,
        show_messaging: true,
        show_medical_treatments: false,
        show_negotiations: false,
        show_case_value: false,
        status_message: "",
      });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Portal settings GET error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/settings", async (req, res) => {
  const caseId = req.params.caseId;
  const s = req.body;
  try {
    const { rows } = await pool.query(
      "SELECT id FROM client_portal_settings WHERE case_id = $1",
      [caseId]
    );
    if (rows.length === 0) {
      await pool.query(
        `INSERT INTO client_portal_settings
         (case_id, show_stage, show_next_court_date, show_attorney_name, show_case_type,
          show_accident_date, show_documents, show_messaging, show_medical_treatments,
          show_negotiations, show_case_value, status_message, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [caseId, s.show_stage, s.show_next_court_date, s.show_attorney_name, s.show_case_type,
         s.show_accident_date, s.show_documents, s.show_messaging, s.show_medical_treatments,
         s.show_negotiations, s.show_case_value, s.status_message || "", req.session.userId]
      );
    } else {
      await pool.query(
        `UPDATE client_portal_settings SET
         show_stage=$1, show_next_court_date=$2, show_attorney_name=$3, show_case_type=$4,
         show_accident_date=$5, show_documents=$6, show_messaging=$7, show_medical_treatments=$8,
         show_negotiations=$9, show_case_value=$10, status_message=$11, updated_by=$12, updated_at=NOW()
         WHERE case_id=$13`,
        [s.show_stage, s.show_next_court_date, s.show_attorney_name, s.show_case_type,
         s.show_accident_date, s.show_documents, s.show_messaging, s.show_medical_treatments,
         s.show_negotiations, s.show_case_value, s.status_message || "", req.session.userId, caseId]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Portal settings PUT error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:caseId/clients", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, email, phone, is_active, last_login, created_at FROM client_users WHERE case_id = $1 ORDER BY created_at DESC",
      [req.params.caseId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Portal clients GET error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId/clients", async (req, res) => {
  const { name, email, phone, sendWelcomeEmail } = req.body;
  if (!name || !email) return res.status(400).json({ error: "Name and email are required" });
  try {
    const existing = await pool.query("SELECT id FROM client_users WHERE LOWER(email) = LOWER($1)", [email.trim()]);
    if (existing.rows.length > 0) return res.status(400).json({ error: "A client with this email already exists" });

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let tempPassword = "";
    for (let i = 0; i < 10; i++) tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));

    const hash = await bcrypt.hash(tempPassword, 10);
    const { rows } = await pool.query(
      `INSERT INTO client_users (case_id, name, email, phone, password_hash, must_change_password, created_by)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6) RETURNING id, name, email, phone, is_active, created_at`,
      [req.params.caseId, name.trim(), email.trim(), phone || "", hash, req.session.userId]
    );

    if (sendWelcomeEmail) {
      try {
        await sendEmail({
          to: email.trim(),
          subject: "MattrMindr — Client Portal Access",
          text: `Hi ${name},\n\nYou have been given access to the MattrMindr Client Portal to view updates on your case.\n\nLog in at: ${req.headers.origin || "https://mattrmindr.com"}/portal\n\nEmail: ${email.trim()}\nTemporary Password: ${tempPassword}\n\nYou will be asked to change your password on first login.\n\nThank you,\nMattrMindr`,
          html: `
            <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 30px;">
              <h2 style="color: #1e3a5f; font-family: 'Playfair Display', Georgia, serif;">MattrMindr</h2>
              <p>Hi ${name},</p>
              <p>You have been given access to the <strong>MattrMindr Client Portal</strong> to view updates on your case.</p>
              <p>Log in at: <a href="${req.headers.origin || "https://mattrmindr.com"}/portal" style="color: #2563eb;">${req.headers.origin || "https://mattrmindr.com"}/portal</a></p>
              <p><strong>Email:</strong> ${email.trim()}</p>
              <div style="background: #f0f4f8; border: 1px solid #d0d7de; border-radius: 6px; padding: 16px; text-align: center; margin: 20px 0;">
                <span style="font-family: monospace; font-size: 22px; letter-spacing: 2px; color: #1e3a5f; font-weight: bold;">${tempPassword}</span>
              </div>
              <p>You will be asked to change your password on first login.</p>
              <p style="color: #94a3b8; font-size: 13px; margin-top: 30px;">Thank you,<br>MattrMindr</p>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error("Portal welcome email error:", emailErr.message);
      }
    }

    res.json({ ...rows[0], tempPassword });
  } catch (err) {
    console.error("Portal create client error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:caseId/clients/:clientId", async (req, res) => {
  try {
    await pool.query("UPDATE client_users SET is_active = FALSE WHERE id = $1 AND case_id = $2", [req.params.clientId, req.params.caseId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Portal deactivate client error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:caseId/messages", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, sender_type, sender_name, body, read_at, created_at FROM client_messages WHERE case_id = $1 ORDER BY created_at ASC",
      [req.params.caseId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Portal admin messages GET error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/:caseId/messages", async (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: "Message is required" });
  try {
    const { rows: userRows } = await pool.query("SELECT name FROM users WHERE id = $1", [req.session.userId]);
    const senderName = userRows[0]?.name || "Firm";
    const { rows } = await pool.query(
      `INSERT INTO client_messages (case_id, sender_type, sender_id, sender_name, body)
       VALUES ($1, 'firm', $2, $3, $4) RETURNING *`,
      [req.params.caseId, req.session.userId, senderName, body.trim()]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Portal admin send message error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:caseId/messages/:msgId/read", async (req, res) => {
  try {
    await pool.query(
      "UPDATE client_messages SET read_at = NOW() WHERE id = $1 AND case_id = $2 AND read_at IS NULL",
      [req.params.msgId, req.params.caseId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Portal mark read error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/unread-summary", async (req, res) => {
  try {
    const userId = req.session.userId;
    const userRoles = req.session.userRoles || [req.session.userRole];
    const isAdmin = userRoles.includes("App Admin");

    const staffFilter = isAdmin
      ? ""
      : " AND (c.lead_attorney = $1 OR c.second_attorney = $1 OR c.case_manager = $1 OR c.investigator = $1 OR c.paralegal = $1 OR c.custom_team::jsonb @> $2::jsonb)";
    const params = isAdmin ? [] : [userId, JSON.stringify([{ userId }])];

    const msgRows = await pool.query(
      `SELECT cm.id, cm.case_id, cm.sender_name, cm.body, cm.created_at,
              c.title AS case_title, c.client_name
       FROM client_messages cm
       JOIN cases c ON c.id = cm.case_id
       WHERE cm.sender_type = 'client' AND cm.read_at IS NULL${staffFilter}
       ORDER BY cm.created_at DESC`,
      params
    );
    const docRows = await pool.query(
      `SELECT cd.id, cd.case_id, cd.filename, cd.created_at,
              c.title AS case_title, c.client_name
       FROM case_documents cd
       JOIN cases c ON c.id = cd.case_id
       WHERE cd.source = 'client' AND cd.firm_viewed_at IS NULL${staffFilter}
       ORDER BY cd.created_at DESC`,
      params
    );
    const grouped = {};
    for (const m of msgRows.rows) {
      if (!grouped[m.case_id]) grouped[m.case_id] = { caseId: m.case_id, caseTitle: m.case_title, clientName: m.client_name, messages: [], documents: [] };
      grouped[m.case_id].messages.push({ id: m.id, body: m.body, senderName: m.sender_name, createdAt: m.created_at });
    }
    for (const d of docRows.rows) {
      if (!grouped[d.case_id]) grouped[d.case_id] = { caseId: d.case_id, caseTitle: d.case_title, clientName: d.client_name, messages: [], documents: [] };
      grouped[d.case_id].documents.push({ id: d.id, filename: d.filename, createdAt: d.created_at });
    }
    const result = Object.values(grouped).map(g => ({
      ...g,
      messageCount: g.messages.length,
      documentCount: g.documents.length,
    }));
    res.json(result);
  } catch (err) {
    console.error("Unread summary error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
