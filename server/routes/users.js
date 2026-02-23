const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, role, email, initials, phone, cell, avatar, offices FROM users ORDER BY id");
    return res.json(rows.map(r => ({ ...r, offices: r.offices || [] })));
  } catch (err) {
    console.error("Users fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id/offices", requireAuth, async (req, res) => {
  const { offices } = req.body;
  if (!Array.isArray(offices)) return res.status(400).json({ error: "offices must be an array" });
  try {
    const { rows } = await pool.query(
      "UPDATE users SET offices = $1 WHERE id = $2 RETURNING id, offices",
      [offices, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ id: rows[0].id, offices: rows[0].offices || [] });
  } catch (err) {
    console.error("User offices update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
