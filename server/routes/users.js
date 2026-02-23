const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, name, role, email, initials, phone, cell, ext, avatar, offices FROM users ORDER BY name");
    return res.json(rows.map(r => ({ ...r, offices: r.offices || [] })));
  } catch (err) {
    console.error("Users fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  const { name, role, email, initials, phone, cell, ext, avatar, offices } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
  try {
    const { rows: mx } = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM users");
    const nextId = (parseInt(mx[0].max_id) || 0) + 1;
    const { rows } = await pool.query(
      `INSERT INTO users (id, name, role, email, initials, phone, cell, ext, avatar, offices)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, role, email, initials, phone, cell, ext, avatar, offices`,
      [nextId, name.trim(), role || "Attorney", email || "", initials || "", phone || "", cell || "", ext || "", avatar || "#4C7AC9", offices || []]
    );
    return res.status(201).json({ ...rows[0], offices: rows[0].offices || [] });
  } catch (err) {
    console.error("User create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("User delete error:", err);
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
