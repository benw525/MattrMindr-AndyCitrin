const pool = require("./db");
const { sendSMS, isConfigured } = require("./sms");

async function generateScheduledMessages(configId) {
  const configRes = await pool.query("SELECT * FROM sms_configs WHERE id = $1", [configId]);
  const config = configRes.rows[0];
  if (!config || !config.enabled) return;

  const caseId = config.case_id;
  const reminderDays = config.reminder_days || [1, 7];
  const phoneNumbers = config.phone_numbers || [];
  if (phoneNumbers.length === 0) return;

  const events = [];

  if (config.notify_court_dates || config.notify_hearings || config.notify_meetings || config.notify_deadlines) {
    const caseRes = await pool.query("SELECT * FROM cases WHERE id = $1", [caseId]);
    const c = caseRes.rows[0];
    if (c) {
      if (config.notify_court_dates && c.next_court_date) {
        events.push({ type: "court_date", title: "Court Date", date: c.next_court_date });
      }
      if (config.notify_court_dates && c.trial_date) {
        events.push({ type: "court_date", title: "Trial Date", date: c.trial_date });
      }
      if (config.notify_meetings && c.mediation_date) {
        events.push({ type: "appointment", title: "Mediation", date: c.mediation_date });
      }
      if (config.notify_deadlines && c.statute_of_limitations_date) {
        events.push({ type: "deadline", title: "Statute of Limitations", date: c.statute_of_limitations_date });
      }
    }
  }

  if (config.notify_deadlines || config.notify_hearings || config.notify_meetings) {
    const deadRes = await pool.query("SELECT * FROM deadlines WHERE case_id = $1 AND date >= CURRENT_DATE", [caseId]);
    deadRes.rows.forEach(d => {
      const type = (d.type || "").toLowerCase();
      if (config.notify_deadlines && (type === "filing" || type === "deadline" || type === "motion" || type === "sol" || type === "statute of limitations")) {
        events.push({ type: "deadline", title: d.title, date: d.date });
      }
      if (config.notify_hearings && (type === "hearing" || type === "court date" || type === "court appearance")) {
        events.push({ type: "hearing", title: d.title, date: d.date });
      }
      if (config.notify_meetings && (type === "appointment" || type === "treatment" || type === "mediation" || type === "deposition" || type === "ime")) {
        events.push({ type: "appointment", title: d.title, date: d.date });
      }
    });
  }

  const caseRes2 = await pool.query("SELECT title, client_name FROM cases WHERE id = $1", [caseId]);
  const caseName = caseRes2.rows[0]?.title || "";
  const clientName = caseRes2.rows[0]?.client_name || "";

  for (const event of events) {
    const eventDate = new Date(event.date);
    if (isNaN(eventDate.getTime())) continue;

    for (const daysBefore of reminderDays) {
      const sendAt = new Date(eventDate);
      sendAt.setDate(sendAt.getDate() - daysBefore);
      sendAt.setHours(9, 0, 0, 0);

      if (sendAt <= new Date()) continue;

      const existing = await pool.query(
        `SELECT id FROM sms_scheduled WHERE sms_config_id = $1 AND event_title = $2 AND event_date = $3 AND send_at::date = $4::date AND status = 'pending'`,
        [configId, event.title, event.date, sendAt]
      );
      if (existing.rows.length > 0) continue;

      const dateStr = eventDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      let messageBody = config.custom_message || "";
      if (!messageBody) {
        const daysText = daysBefore === 0 ? "today" : daysBefore === 1 ? "tomorrow" : `in ${daysBefore} days`;
        messageBody = `Reminder: ${config.contact_name || clientName || "You"} have a ${event.title || event.type} scheduled ${daysText} on ${dateStr}. If you have questions, please contact our office.`;
      }

      for (const phone of phoneNumbers) {
        await pool.query(
          `INSERT INTO sms_scheduled (sms_config_id, case_id, event_type, event_title, event_date, send_at, phone_number, message_body)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [configId, caseId, event.type, event.title, event.date, sendAt, phone, messageBody]
        );
      }
    }
  }
}

async function processScheduledMessages() {
  if (!(await isConfigured())) return;

  try {
    const { rows } = await pool.query(
      `SELECT ss.*, sc.contact_name FROM sms_scheduled ss
       LEFT JOIN sms_configs sc ON ss.sms_config_id = sc.id
       WHERE ss.status = 'pending' AND ss.send_at <= NOW()
       ORDER BY ss.send_at ASC LIMIT 20`
    );

    for (const msg of rows) {
      try {
        const result = await sendSMS(msg.phone_number, msg.message_body);
        await pool.query(
          `UPDATE sms_scheduled SET status = 'sent', twilio_sid = $1, sent_at = NOW() WHERE id = $2`,
          [result.sid, msg.id]
        );
        await pool.query(
          `INSERT INTO sms_messages (case_id, direction, phone_number, body, twilio_sid, status, contact_name)
           VALUES ($1, 'outbound', $2, $3, $4, 'sent', $5)`,
          [msg.case_id, msg.phone_number, msg.message_body, result.sid, msg.contact_name || ""]
        );
      } catch (err) {
        console.error(`SMS send failed for scheduled message ${msg.id}:`, err.message);
        await pool.query(
          `UPDATE sms_scheduled SET status = 'failed', error = $1 WHERE id = $2`,
          [err.message, msg.id]
        );
        await pool.query(
          `INSERT INTO sms_messages (case_id, direction, phone_number, body, status, contact_name)
           VALUES ($1, 'outbound', $2, $3, 'failed', $4)`,
          [msg.case_id, msg.phone_number, msg.message_body, msg.contact_name || ""]
        );
      }
    }
  } catch (err) {
    console.error("SMS scheduler error:", err);
  }
}

async function scheduleForNewEvent(caseId, eventType, eventTitle, eventDate) {
  try {
    const { rows: configs } = await pool.query(
      `SELECT * FROM sms_configs WHERE case_id = $1 AND enabled = true`, [caseId]
    );
    for (const config of configs) {
      const typeMatch =
        (eventType === "hearing" && config.notify_hearings) ||
        (eventType === "court_date" && config.notify_court_dates) ||
        (eventType === "deadline" && config.notify_deadlines) ||
        (eventType === "meeting" && config.notify_meetings) ||
        (eventType === "appointment" && config.notify_meetings);
      if (!typeMatch) continue;

      const reminderDays = config.reminder_days || [1, 7];
      const eDate = new Date(eventDate);
      if (isNaN(eDate.getTime())) continue;

      const dateStr = eDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

      for (const daysBefore of reminderDays) {
        const sendAt = new Date(eDate);
        sendAt.setDate(sendAt.getDate() - daysBefore);
        sendAt.setHours(9, 0, 0, 0);
        if (sendAt <= new Date()) continue;

        const daysText = daysBefore === 0 ? "today" : daysBefore === 1 ? "tomorrow" : `in ${daysBefore} days`;
        const messageBody = config.custom_message ||
          `Reminder: ${config.contact_name || "You"} have a ${eventTitle || eventType} scheduled ${daysText} on ${dateStr}. If you have questions, please contact our office.`;

        for (const phone of (config.phone_numbers || [])) {
          const exists = await pool.query(
            `SELECT id FROM sms_scheduled WHERE sms_config_id = $1 AND event_title = $2 AND event_date = $3 AND send_at::date = $4::date AND phone_number = $5 AND status = 'pending'`,
            [config.id, eventTitle, eventDate, sendAt, phone]
          );
          if (exists.rows.length > 0) continue;
          await pool.query(
            `INSERT INTO sms_scheduled (sms_config_id, case_id, event_type, event_title, event_date, send_at, phone_number, message_body)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [config.id, caseId, eventType, eventTitle, eventDate, sendAt, phone, messageBody]
          );
        }
      }
    }
  } catch (err) {
    console.error("Schedule for new event error:", err);
  }
}

async function cancelForEvent(caseId, eventTitle, eventDate) {
  try {
    if (eventDate) {
      await pool.query(
        `UPDATE sms_scheduled SET status = 'cancelled' WHERE case_id = $1 AND event_title = $2 AND event_date = $3 AND status = 'pending'`,
        [caseId, eventTitle, eventDate]
      );
    } else {
      await pool.query(
        `UPDATE sms_scheduled SET status = 'cancelled' WHERE case_id = $1 AND event_title = $2 AND status = 'pending'`,
        [caseId, eventTitle]
      );
    }
  } catch (err) {
    console.error("Cancel for event error:", err);
  }
}

module.exports = { generateScheduledMessages, processScheduledMessages, scheduleForNewEvent, cancelForEvent };
