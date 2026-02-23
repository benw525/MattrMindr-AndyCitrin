const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");

const router = express.Router();

const DEMO_PIN = "1234";

router.post("/login", async (req, res) => {
  const { userId, pin } = req.body;
  if (!userId || !pin) {
    return res.status(400).json({ error: "userId and pin are required" });
  }
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (rows.length === 0) {
      return res.status(401).json({ error: "User not found" });
    }
    const user = rows[0];
    if (pin !== DEMO_PIN) {
      return res.status(401).json({ error: "Incorrect PIN" });
    }
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userRole = user.role;
    return res.json({
      id: user.id,
      name: user.name,
      role: user.role,
      email: user.email,
      initials: user.initials,
      phone: user.phone,
      cell: user.cell,
      avatar: user.avatar,
    });
  } catch (err) {
    console.error("Login error:", err);
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
    const user = rows[0];
    return res.json({
      id: user.id,
      name: user.name,
      role: user.role,
      email: user.email,
      initials: user.initials,
      phone: user.phone,
      cell: user.cell,
      avatar: user.avatar,
    });
  } catch (err) {
    console.error("Me error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
