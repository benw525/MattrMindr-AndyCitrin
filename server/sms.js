const twilio = require("twilio");

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken || !hostname) {
    return null;
  }

  const res = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=twilio",
    {
      headers: {
        "Accept": "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  );
  const data = await res.json();
  const connectionSettings = data.items?.[0];

  if (
    !connectionSettings ||
    !connectionSettings.settings.account_sid ||
    !connectionSettings.settings.api_key ||
    !connectionSettings.settings.api_key_secret
  ) {
    return null;
  }

  return {
    accountSid: connectionSettings.settings.account_sid,
    apiKey: connectionSettings.settings.api_key,
    apiKeySecret: connectionSettings.settings.api_key_secret,
    phoneNumber: connectionSettings.settings.phone_number,
  };
}

async function getClient() {
  const creds = await getCredentials();
  if (!creds) return null;
  return twilio(creds.apiKey, creds.apiKeySecret, {
    accountSid: creds.accountSid,
  });
}

async function getFromNumber() {
  const creds = await getCredentials();
  return creds?.phoneNumber || null;
}

async function isConfigured() {
  const creds = await getCredentials();
  return !!(creds && creds.accountSid && creds.apiKey && creds.apiKeySecret && creds.phoneNumber);
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
  const client = await getClient();
  if (!client) throw new Error("Twilio is not configured. Please connect your Twilio account in the integrations panel.");
  const fromNumber = await getFromNumber();
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
