const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM calendar_feeds WHERE user_id = $1 ORDER BY created_at",
      [req.session.userId]
    );
    res.json(rows.map(r => ({ id: r.id, name: r.name, url: r.url, active: r.active, createdAt: r.created_at })));
  } catch (err) {
    console.error("Get calendar feeds error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, url } = req.body;
    if (!name || !url) return res.status(400).json({ error: "name and url are required" });
    const { rows } = await pool.query(
      "INSERT INTO calendar_feeds (user_id, name, url) VALUES ($1, $2, $3) RETURNING *",
      [req.session.userId, name.trim(), url.trim()]
    );
    const r = rows[0];
    res.json({ id: r.id, name: r.name, url: r.url, active: r.active, createdAt: r.created_at });
  } catch (err) {
    console.error("Create calendar feed error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", requireAuth, async (req, res) => {
  try {
    const { active } = req.body;
    const { rows } = await pool.query(
      "UPDATE calendar_feeds SET active = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
      [active, req.params.id, req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Feed not found" });
    const r = rows[0];
    res.json({ id: r.id, name: r.name, url: r.url, active: r.active, createdAt: r.created_at });
  } catch (err) {
    console.error("Update calendar feed error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "DELETE FROM calendar_feeds WHERE id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    if (!rowCount) return res.status(404).json({ error: "Feed not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete calendar feed error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/proxy", requireAuth, async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: "url parameter is required" });
    const parsed = new URL(url);
    if (!["http:", "https:", "webcal:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Invalid URL protocol" });
    }
    const fetchUrl = url.replace(/^webcal:\/\//i, "https://");
    const response = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "MattrMindr/1.0 (Calendar Sync)",
        "Accept": "text/calendar, text/plain, */*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Remote server returned HTTP ${response.status}`);
    const text = await response.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("Response is not a valid iCal feed");
    res.set("Content-Type", "text/calendar; charset=utf-8");
    res.send(text);
  } catch (err) {
    console.error("Calendar proxy error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
