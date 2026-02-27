const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const OFFICE_ROLES = ["Public Defender","Chief Deputy Public Defender","Deputy Public Defender","Senior Trial Attorney","App Admin"];
function canManageOffice(roles) {
  return (roles || []).some(r => OFFICE_ROLES.includes(r));
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const result = await pool.query(
      `SELECT t.*, u.name AS created_by_name
       FROM ai_training t
       LEFT JOIN users u ON t.user_id = u.id
       WHERE (t.scope = 'office') OR (t.scope = 'personal' AND t.user_id = $1)
       ORDER BY t.scope DESC, t.created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Get training error:", err);
    res.status(500).json({ error: "Failed to load training entries" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const userRoles = req.session.userRoles || [req.session.userRole];
    const { scope, category, title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Title and content required" });
    if (scope === "office" && !canManageOffice(userRoles)) {
      return res.status(403).json({ error: "Insufficient permissions for office-wide training" });
    }
    const result = await pool.query(
      `INSERT INTO ai_training (user_id, scope, category, title, content, source_type)
       VALUES ($1, $2, $3, $4, $5, 'text') RETURNING *`,
      [userId, scope || "personal", category || "General", title, content]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Create training error:", err);
    res.status(500).json({ error: "Failed to create training entry" });
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const userId = req.session.userId;
    const userRoles = req.session.userRoles || [req.session.userRole];
    const { scope, category, title } = req.body;
    if (!req.file) return res.status(400).json({ error: "File required" });
    if (!title) return res.status(400).json({ error: "Title required" });
    if (scope === "office" && !canManageOffice(userRoles)) {
      return res.status(403).json({ error: "Insufficient permissions for office-wide training" });
    }

    let extractedText = "";
    const filename = req.file.originalname;
    const ext = filename.toLowerCase().split(".").pop();

    if (ext === "pdf") {
      const pdfParse = require("pdf-parse");
      const parsed = await pdfParse(req.file.buffer);
      extractedText = parsed.text || "";
    } else if (ext === "txt") {
      extractedText = req.file.buffer.toString("utf-8");
    } else if (ext === "docx") {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      extractedText = result.value || "";
    } else {
      return res.status(400).json({ error: "Unsupported file type. Use PDF, TXT, or DOCX." });
    }

    if (!extractedText.trim()) return res.status(400).json({ error: "Could not extract text from file" });

    const result = await pool.query(
      `INSERT INTO ai_training (user_id, scope, category, title, content, source_type, filename)
       VALUES ($1, $2, $3, $4, $5, 'document', $6) RETURNING *`,
      [userId, scope || "personal", category || "General", title, extractedText.substring(0, 50000), filename]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Upload training doc error:", err);
    res.status(500).json({ error: "Failed to upload training document" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const userRoles = req.session.userRoles || [req.session.userRole];
    const { id } = req.params;

    const existing = await pool.query("SELECT * FROM ai_training WHERE id = $1", [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "Entry not found" });
    const entry = existing.rows[0];

    if (entry.scope === "personal" && entry.user_id !== userId) {
      return res.status(403).json({ error: "Cannot edit another user's personal training" });
    }
    if (entry.scope === "office" && !canManageOffice(userRoles)) {
      return res.status(403).json({ error: "Insufficient permissions to edit office training" });
    }

    const { title, content, category, active } = req.body;
    const result = await pool.query(
      `UPDATE ai_training SET
        title = COALESCE($1, title),
        content = COALESCE($2, content),
        category = COALESCE($3, category),
        active = COALESCE($4, active),
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [title || null, content || null, category || null, active !== undefined ? active : null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update training error:", err);
    res.status(500).json({ error: "Failed to update training entry" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const userRoles = req.session.userRoles || [req.session.userRole];
    const { id } = req.params;

    const existing = await pool.query("SELECT * FROM ai_training WHERE id = $1", [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: "Entry not found" });
    const entry = existing.rows[0];

    if (entry.scope === "personal" && entry.user_id !== userId) {
      return res.status(403).json({ error: "Cannot delete another user's personal training" });
    }
    if (entry.scope === "office" && !canManageOffice(userRoles)) {
      return res.status(403).json({ error: "Insufficient permissions to delete office training" });
    }

    await pool.query("DELETE FROM ai_training WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete training error:", err);
    res.status(500).json({ error: "Failed to delete training entry" });
  }
});

module.exports = router;
