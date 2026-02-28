const twilio = require("twilio");

function getClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return twilio(accountSid, authToken);
}

function getFromNumber() {
  return process.env.TWILIO_PHONE_NUMBER || null;
}

function isConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

function formatPhoneNumber(number) {
  if (!number) return null;
  const digits = number.replace(/[^\d+]/g, "");
  if (digits.startsWith("+1") && digits.length === 12) return digits;
  if (digits.startsWith("1") && digits.length === 11) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.startsWith("+") && digits.length >= 11) return digits;
  return null;
}

async function sendSMS(to, body) {
  const client = getClient();
  if (!client) throw new Error("Twilio is not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.");
  const fromNumber = getFromNumber();
  if (!fromNumber) throw new Error("No Twilio phone number configured.");
  const formatted = formatPhoneNumber(to);
  if (!formatted) throw new Error(`Invalid phone number: "${to}". Expected 10-digit US number or E.164 format.`);
  if (!body || body.trim().length === 0) throw new Error("Message body cannot be empty.");
  try {
    const message = await client.messages.create({
      body: body.trim(),
      from: fromNumber,
      to: formatted,
    });
    return { sid: message.sid, status: message.status, to: formatted };
  } catch (err) {
    const msg = err.message || "Unknown Twilio error";
    if (err.code === 21211) throw new Error(`Invalid phone number: ${to}`);
    if (err.code === 21608) throw new Error("Twilio phone number is not SMS-capable or not verified.");
    if (err.code === 21610) throw new Error("Recipient has opted out of messages.");
    throw new Error(`SMS send failed: ${msg}`);
  }
}

module.exports = { sendSMS, formatPhoneNumber, isConfigured, getClient, getFromNumber };
