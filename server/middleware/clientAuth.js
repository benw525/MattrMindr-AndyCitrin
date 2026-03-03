const pool = require("../db");

async function requireClientAuth(req, res, next) {
  if (!req.session || !req.session.clientId || !req.session.isClient) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT is_active FROM client_users WHERE id = $1",
      [req.session.clientId]
    );
    if (rows.length === 0 || !rows[0].is_active) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Account deactivated" });
    }
  } catch (err) {
    console.error("Client auth middleware error:", err);
  }
  next();
}

module.exports = { requireClientAuth };
