const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, role, email, initials, phone, cell, avatar FROM users ORDER BY id");
    return res.json(rows);
  } catch (err) {
    console.error("Users fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
