const jwt = require("jsonwebtoken");
const pool = require("../db");

const JWT_SECRET = process.env.EXTERNAL_JWT_SECRET || process.env.SESSION_SECRET || "lextrack-external-jwt-secret";

function generateToken(userId) {
  return jwt.sign({ userId, type: "integration" }, JWT_SECRET, { expiresIn: "30d" });
}

async function requireExternalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      "SELECT id, name, role, roles, email FROM users WHERE id = $1 AND deleted_at IS NULL",
      [decoded.userId]
    );
    if (!rows.length) return res.status(401).json({ error: "User not found" });
    req.extUser = rows[0];
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ error: "Token expired" });
    if (err.name === "JsonWebTokenError") return res.status(401).json({ error: "Invalid token" });
    console.error("External auth error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

module.exports = { generateToken, requireExternalAuth };
