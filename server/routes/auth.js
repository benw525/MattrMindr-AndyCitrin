const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db");
const { sendTempPasswordEmail, sendPasswordResetEmail } = require("../email");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += chars[crypto.randomInt(chars.length)];
  return pw;
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
  };
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
      [email.trim()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: "No account found with that email" });
    }
    const user = rows[0];

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

    req.session.userId = user.id;
    req.session.userName = user.name;
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
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }
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

    const appUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "https://mattrmindr.replit.app";

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
  if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });

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

module.exports = router;
