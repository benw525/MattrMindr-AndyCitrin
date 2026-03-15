const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isR2Configured, uploadToR2, downloadFromR2, deleteFromR2 } = require("../r2");

const router = express.Router();
const ppUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const USER_FIELDS = "id, name, role, roles, email, initials, phone, cell, ext, avatar, offices, deleted_at, ((profile_picture IS NOT NULL AND profile_picture_type IS NOT NULL) OR s3_profile_picture_key IS NOT NULL) as has_profile_picture";

function normalizeUser(r) {
  return {
    ...r,
    roles: r.roles && r.roles.length ? r.roles : [r.role],
    offices: r.offices || [],
    deletedAt: r.deleted_at ? r.deleted_at.toISOString() : null,
    hasProfilePicture: !!r.has_profile_picture,
  };
}

const isAppAdmin = (req) => (req.session.userRoles || [req.session.userRole]).includes("App Admin");

router.get("/", requireAuth, async (req, res) => {
  try {
    const includeDeleted = req.query.deleted === "true";
    if (includeDeleted) {
      if (!isAppAdmin(req)) return res.status(403).json({ error: "Only App Admin can view deactivated staff" });
      const { rows } = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE deleted_at IS NOT NULL ORDER BY name`);
      return res.json(rows.map(normalizeUser));
    }
    const { rows } = await pool.query(`SELECT ${USER_FIELDS} FROM users WHERE deleted_at IS NULL ORDER BY name`);
    return res.json(rows.map(normalizeUser));
  } catch (err) {
    console.error("Users fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Only App Admin can create users" });

  const { name, role, roles, email, initials, phone, cell, ext, avatar, offices } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
  if (!email || !email.trim()) return res.status(400).json({ error: "Email is required" });
  try {
    const { rows: existing } = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [email.trim()]);
    if (existing.length > 0) return res.status(400).json({ error: "A user with that email already exists" });

    const { rows: mx } = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM users");
    const nextId = (parseInt(mx[0].max_id) || 0) + 1;
    const primaryRole = (roles && roles.length) ? roles[0] : (role || "Attorney");
    const rolesArr = (roles && roles.length) ? roles : [primaryRole];
    const { rows } = await pool.query(
      `INSERT INTO users (id, name, role, roles, email, initials, phone, cell, ext, avatar, offices, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)
       RETURNING ${USER_FIELDS}`,
      [nextId, name.trim(), primaryRole, rolesArr, email.trim(), initials || "", phone || "", cell || "", ext || "", avatar || "#4C7AC9", offices || []]
    );
    return res.status(201).json(normalizeUser(rows[0]));
  } catch (err) {
    console.error("User create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.id);
  const requesterId = req.session.userId;

  if (requesterId !== targetId && !isAppAdmin(req)) {
    return res.status(403).json({ error: "Not authorized to edit this profile" });
  }

  const { name, email, phone, cell, ext } = req.body;
  const newName = name?.trim() || null;

  const sets = [];
  const vals = [];
  let idx = 1;
  if (newName) {
    const initials = newName.split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 3).toUpperCase();
    sets.push(`name = $${idx++}`, `initials = $${idx++}`);
    vals.push(newName, initials);
  }
  if (email !== undefined) { sets.push(`email = $${idx++}`); vals.push(email || ""); }
  if (phone !== undefined) { sets.push(`phone = $${idx++}`); vals.push(phone || ""); }
  if (cell  !== undefined) { sets.push(`cell  = $${idx++}`); vals.push(cell  || ""); }
  if (ext   !== undefined) { sets.push(`ext   = $${idx++}`); vals.push(ext   || ""); }

  if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

  vals.push(targetId);
  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx} AND deleted_at IS NULL RETURNING ${USER_FIELDS}`,
      vals
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(normalizeUser(rows[0]));
  } catch (err) {
    console.error("User update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Only App Admin can remove users" });
  try {
    const { rows } = await pool.query(
      "UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  } catch (err) {
    console.error("User soft-delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/:id/restore", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Only App Admin can restore users" });
  try {
    const { rows } = await pool.query(
      `UPDATE users SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING ${USER_FIELDS}`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(normalizeUser(rows[0]));
  } catch (err) {
    console.error("User restore error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id/offices", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Only App Admin can change offices" });
  const { offices } = req.body;
  if (!Array.isArray(offices)) return res.status(400).json({ error: "offices must be an array" });
  try {
    const { rows } = await pool.query(
      `UPDATE users SET offices = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING ${USER_FIELDS}`,
      [offices, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(normalizeUser(rows[0]));
  } catch (err) {
    console.error("User offices update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id/roles", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Only App Admin can change roles" });
  const { roles } = req.body;
  if (!Array.isArray(roles) || roles.length === 0) return res.status(400).json({ error: "roles must be a non-empty array" });
  try {
    const primaryRole = roles[0];
    const { rows } = await pool.query(
      `UPDATE users SET role = $1, roles = $2 WHERE id = $3 AND deleted_at IS NULL RETURNING ${USER_FIELDS}`,
      [primaryRole, roles, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    return res.json(normalizeUser(rows[0]));
  } catch (err) {
    console.error("User roles update error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

router.post("/:id/profile-picture", requireAuth, ppUpload.single("picture"), async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (req.session.userId !== targetId && !isAppAdmin(req)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    if (!req.file) return res.status(400).json({ error: "No image file provided" });
    if (!ALLOWED_IMAGE_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ error: "Only JPEG, PNG, WebP, and GIF images are supported" });
    }
    const ext = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : req.file.mimetype === "image/gif" ? "gif" : "jpg";
    let s3Key = null;
    if (isR2Configured()) {
      try {
        s3Key = `profile-pictures/${targetId}/avatar.${ext}`;
        await uploadToR2(s3Key, req.file.buffer, req.file.mimetype);
      } catch (e) { console.error("S3 profile pic pre-upload failed, using BYTEA:", e.message); s3Key = null; }
    }
    await pool.query(
      "UPDATE users SET profile_picture = $1, profile_picture_type = $2, s3_profile_picture_key = $3 WHERE id = $4",
      [s3Key ? null : req.file.buffer, req.file.mimetype, s3Key, targetId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Profile picture upload error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id/profile-picture", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT profile_picture, profile_picture_type, s3_profile_picture_key FROM users WHERE id = $1",
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "No profile picture" });
    let buffer = null;
    let contentType = rows[0].profile_picture_type || "image/jpeg";
    if (rows[0].s3_profile_picture_key && isR2Configured()) {
      try { buffer = await downloadFromR2(rows[0].s3_profile_picture_key); } catch (e) { console.error("S3 profile pic download fallback:", e.message); }
    }
    if (!buffer && rows[0].profile_picture) {
      buffer = rows[0].profile_picture;
    }
    if (!buffer) return res.status(404).json({ error: "No profile picture" });
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.send(buffer);
  } catch (err) {
    console.error("Profile picture fetch error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id/profile-picture", requireAuth, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (req.session.userId !== targetId && !isAppAdmin(req)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const { rows } = await pool.query("SELECT s3_profile_picture_key FROM users WHERE id = $1", [targetId]);
    if (rows[0]?.s3_profile_picture_key && isR2Configured()) {
      deleteFromR2(rows[0].s3_profile_picture_key).catch(e => console.error("S3 profile pic delete error:", e.message));
    }
    await pool.query(
      "UPDATE users SET profile_picture = NULL, profile_picture_type = NULL, s3_profile_picture_key = NULL WHERE id = $1",
      [targetId]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Profile picture delete error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
