const sgMail = require("@sendgrid/mail");

let connectionSettings;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? "depl " + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error("X-Replit-Token not found");
  }

  connectionSettings = await fetch(
    "https://" + hostname + "/api/v2/connection?include_secrets=true&connector_names=sendgrid",
    {
      headers: {
        Accept: "application/json",
        "X-Replit-Token": xReplitToken,
      },
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || !connectionSettings.settings.api_key || !connectionSettings.settings.from_email) {
    throw new Error("SendGrid not connected");
  }
  return { apiKey: connectionSettings.settings.api_key, email: connectionSettings.settings.from_email };
}

async function sendEmail({ to, subject, text, html }) {
  const { apiKey, email: fromEmail } = await getCredentials();
  sgMail.setApiKey(apiKey);
  const msg = {
    to,
    from: fromEmail,
    subject,
    text,
    html: html || text,
  };
  await sgMail.send(msg);
}

async function sendTempPasswordEmail(toEmail, userName, tempPassword) {
  await sendEmail({
    to: toEmail,
    subject: "MattrMindr — Your Temporary Password",
    text: `Hi ${userName},\n\nLog in to mattrmindr.com with this temporary password:\n\n${tempPassword}\n\nAfter your first login, you will be required to change your password.\n\nThank you,\nMattrMindr`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 30px;">
        <h2 style="color: #1e3a5f; font-family: 'Playfair Display', Georgia, serif;">MattrMindr</h2>
        <p>Hi ${userName},</p>
        <p>Log in to <a href="https://mattrmindr.com" style="color: #2563eb;">mattrmindr.com</a> with this temporary password:</p>
        <div style="background: #f0f4f8; border: 1px solid #d0d7de; border-radius: 6px; padding: 16px; text-align: center; margin: 20px 0;">
          <span style="font-family: monospace; font-size: 22px; letter-spacing: 2px; color: #1e3a5f; font-weight: bold;">${tempPassword}</span>
        </div>
        <p>After your first login, you will be required to change your password.</p>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 30px;">Thank you,<br>MattrMindr</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(toEmail, userName, resetToken, appUrl) {
  const resetLink = `${appUrl}?reset=${resetToken}`;
  await sendEmail({
    to: toEmail,
    subject: "MattrMindr — Password Reset",
    text: `Hi ${userName},\n\nA password reset was requested for your account. Use this temporary code to reset your password:\n\n${resetToken}\n\nOr click this link: ${resetLink}\n\nThis code expires in 1 hour. If you did not request this, you can safely ignore this email.\n\nThank you,\nMattrMindr`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 500px; margin: 0 auto; padding: 30px;">
        <h2 style="color: #1e3a5f; font-family: 'Playfair Display', Georgia, serif;">MattrMindr</h2>
        <p>Hi ${userName},</p>
        <p>A password reset was requested for your account. Use this temporary code to reset your password:</p>
        <div style="background: #f0f4f8; border: 1px solid #d0d7de; border-radius: 6px; padding: 16px; text-align: center; margin: 20px 0;">
          <span style="font-family: monospace; font-size: 22px; letter-spacing: 2px; color: #1e3a5f; font-weight: bold;">${resetToken}</span>
        </div>
        <p style="margin: 16px 0;"><a href="${resetLink}" style="display: inline-block; background: #1e3a5f; color: #ffffff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600;">Reset Password</a></p>
        <p style="color: #94a3b8; font-size: 13px;">This code expires in 1 hour. If you did not request this, you can safely ignore this email.</p>
        <p style="color: #94a3b8; font-size: 13px; margin-top: 30px;">Thank you,<br>MattrMindr</p>
      </div>
    `,
  });
}

module.exports = { sendEmail, sendTempPasswordEmail, sendPasswordResetEmail };
