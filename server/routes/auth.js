const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db");
const { sendTempPasswordEmail, sendPasswordResetEmail } = require("../email");
const { requireAuth } = require("../middleware/auth");
const { generateSecret, generateURI, verifySync } = require("otplib");
const QRCode = require("qrcode");

const router = express.Router();

function generateTempPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%&*?";
  let pw = "";
  pw += upper[crypto.randomInt(upper.length)];
  pw += lower[crypto.randomInt(lower.length)];
  pw += digits[crypto.randomInt(digits.length)];
  pw += special[crypto.randomInt(special.length)];
  const all = upper + lower + digits + special;
  for (let i = 0; i < 6; i++) pw += all[crypto.randomInt(all.length)];
  const arr = pw.split("");
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}

function validatePassword(pw) {
  if (!pw || pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pw)) return "Password must contain at least 1 uppercase letter.";
  if (!/[a-z]/.test(pw)) return "Password must contain at least 1 lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must contain at least 1 number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must contain at least 1 special character.";
  return null;
}

function userPayload(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    roles: user.roles || [user.role],
    email: user.email,
    initials: user.initials,
    phone: user.phone,
    cell: user.cell,
    avatar: user.avatar,
    mustChangePassword: !!user.must_change_password,
    preferences: user.preferences || {},
    mfaEnabled: !!user.mfa_enabled,
    hasProfilePicture: !!(user.profile_picture && user.profile_picture_type),
  };
}

router.post("/login", async (req, res) => {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
      [email.trim()]
    );
    if (rows.length === 0) {
      console.log("Login failed — no account for email:", email.trim());
      return res.status(401).json({ error: "No account found with that email" });
    }
    const user = rows[0];

    if (user.deleted_at) {
      return res.status(401).json({ error: "This account has been deactivated. Contact your administrator." });
    }

    let authenticated = false;

    if (user.password_hash) {
      authenticated = await bcrypt.compare(password, user.password_hash);
    }

    if (!authenticated && user.temp_password && user.temp_password === password) {
      authenticated = true;
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        "UPDATE users SET password_hash = $1, temp_password = '', must_change_password = TRUE WHERE id = $2",
        [hash, user.id]
      );
      user.must_change_password = true;
    }

    if (!authenticated) {
      return res.status(401).json({ error: "Incorrect password" });
    }

    if (user.mfa_enabled && user.mfa_secret) {
      req.session.mfaPendingUserId = user.id;
      req.session.mfaRememberMe = !!rememberMe;
      console.log("[MFA] Login: setting mfaPendingUserId =", user.id, "sessionID =", req.sessionID, "secure =", req.secure, "proto =", req.protocol, "x-forwarded-proto =", req.get("x-forwarded-proto"));
      return req.session.save((err) => {
        if (err) console.error("[MFA] Session save error:", err);
        else console.log("[MFA] Session saved successfully, sessionID =", req.sessionID);
        res.json({ requireMfa: true, email: user.email });
      });
    }

    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    }

    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;
    req.session.userRoles = user.roles || [user.role];
    return res.json(userPayload(user));
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const pwErr = validatePassword(newPassword);
  if (pwErr) return res.status(400).json({ error: pwErr });
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const user = rows[0];

    if (user.password_hash && !user.must_change_password) {
      if (!currentPassword) return res.status(400).json({ error: "Current password is required" });
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1, must_change_password = FALSE, temp_password = '' WHERE id = $2",
      [hash, user.id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Change password error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/send-temp-password", requireAuth, async (req, res) => {
  const isAdmin = (req.session.userRoles || [req.session.userRole]).includes("App Admin");
  if (!isAdmin) return res.status(403).json({ error: "Only App Admin can send temporary passwords" });

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const user = rows[0];
    if (!user.email) return res.status(400).json({ error: "User has no email address" });

    const tempPw = generateTempPassword();
    await pool.query(
      "UPDATE users SET temp_password = $1, must_change_password = TRUE WHERE id = $2",
      [tempPw, user.id]
    );
    await sendTempPasswordEmail(user.email, user.name, tempPw);
    return res.json({ ok: true, message: `Temporary password sent to ${user.email}` });
  } catch (err) {
    console.error("Send temp password error:", err);
    return res.status(500).json({ error: "Failed to send temporary password email" });
  }
});

router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });

  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
      [email.trim()]
    );
    if (rows.length === 0) {
      return res.json({ ok: true, message: "If an account exists with that email, a reset code has been sent." });
    }
    const user = rows[0];

    const resetToken = generateTempPassword();
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      "UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3",
      [resetToken, expires, user.id]
    );

    const appUrl = process.env.APP_URL || "https://andycitrin.mattrmindr.com";

    await sendPasswordResetEmail(user.email, user.name, resetToken, appUrl);
    return res.json({ ok: true, message: "If an account exists with that email, a reset code has been sent." });
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/reset-password", async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: "Email, code, and new password are required" });
  const rpErr = validatePassword(newPassword);
  if (rpErr) return res.status(400).json({ error: rpErr });

  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
      [email.trim()]
    );
    if (rows.length === 0) return res.status(400).json({ error: "Invalid reset code" });
    const user = rows[0];

    if (!user.password_reset_token || user.password_reset_token !== code) {
      return res.status(400).json({ error: "Invalid reset code" });
    }
    if (user.password_reset_expires && new Date(user.password_reset_expires) < new Date()) {
      return res.status(400).json({ error: "Reset code has expired. Please request a new one." });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password_hash = $1, must_change_password = FALSE, temp_password = '', password_reset_token = '', password_reset_expires = NULL WHERE id = $2",
      [hash, user.id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: "Could not log out" });
    res.clearCookie("lextrack.sid");
    return res.json({ ok: true });
  });
});

router.get("/me", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [req.session.userId]);
    if (rows.length === 0) return res.status(401).json({ error: "User not found" });
    return res.json(userPayload(rows[0]));
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/preferences", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT preferences FROM users WHERE id = $1", [req.session.userId]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    return res.json(rows[0].preferences || {});
  } catch (err) {
    console.error("Get preferences error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/preferences", requireAuth, async (req, res) => {
  try {
    const incoming = req.body || {};
    const { rows } = await pool.query("SELECT preferences FROM users WHERE id = $1", [req.session.userId]);
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    const current = rows[0].preferences || {};
    const merged = { ...current };
    for (const [key, val] of Object.entries(incoming)) {
      if (val && typeof val === "object" && !Array.isArray(val) && current[key] && typeof current[key] === "object" && !Array.isArray(current[key])) {
        merged[key] = { ...current[key], ...val };
      } else {
        merged[key] = val;
      }
    }
    await pool.query("UPDATE users SET preferences = $1 WHERE id = $2", [JSON.stringify(merged), req.session.userId]);
    return res.json(merged);
  } catch (err) {
    console.error("Save preferences error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/mfa/setup", requireAuth, async (req, res) => {
  try {
    const secret = generateSecret();
    const { rows } = await pool.query("SELECT email FROM users WHERE id = $1", [req.session.userId]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const otpauth = generateURI({ issuer: "MattrMindr", label: rows[0].email, secret, type: "totp" });
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    await pool.query("UPDATE users SET mfa_secret = $1 WHERE id = $2", [secret, req.session.userId]);
    return res.json({ secret, qrCode: qrDataUrl });
  } catch (err) {
    console.error("MFA setup error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/mfa/verify-setup", requireAuth, async (req, res) => {
  try {
    const code = req.body.code || req.body.token;
    if (!code) return res.status(400).json({ error: "Code is required" });
    const { rows } = await pool.query("SELECT mfa_secret FROM users WHERE id = $1", [req.session.userId]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    if (!rows[0].mfa_secret) return res.status(400).json({ error: "MFA not set up" });
    const result = verifySync({ token: code.toString(), secret: rows[0].mfa_secret, window: 2 });
    if (!result.valid) return res.status(400).json({ error: "Invalid code. Try again." });
    await pool.query("UPDATE users SET mfa_enabled = TRUE WHERE id = $1", [req.session.userId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("MFA verify-setup error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/mfa/verify", async (req, res) => {
  try {
    const code = req.body.code || req.body.token;
    if (!code) return res.status(400).json({ error: "Code is required" });
    const pendingUserId = req.session.mfaPendingUserId;
    console.log("[MFA] Verify: sessionID =", req.sessionID, "mfaPendingUserId =", pendingUserId, "session keys =", Object.keys(req.session), "cookie =", req.headers.cookie?.substring(0, 80));
    if (!pendingUserId) return res.status(400).json({ error: "No MFA verification pending" });
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [pendingUserId]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const user = rows[0];
    const result = verifySync({ token: code.toString(), secret: user.mfa_secret, window: 2 });
    if (!result.valid) return res.status(401).json({ error: "Invalid verification code" });

    if (req.session.mfaRememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
    }

    delete req.session.mfaPendingUserId;
    delete req.session.mfaRememberMe;
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role;
    req.session.userRoles = user.roles || [user.role];
    return res.json(userPayload(user));
  } catch (err) {
    console.error("MFA verify error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/mfa/disable", requireAuth, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password is required" });
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.session.userId]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Incorrect password" });
    await pool.query("UPDATE users SET mfa_enabled = FALSE, mfa_secret = NULL WHERE id = $1", [req.session.userId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("MFA disable error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
