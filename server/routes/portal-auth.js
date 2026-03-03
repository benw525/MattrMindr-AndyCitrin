const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { requireClientAuth } = require("../middleware/clientAuth");

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
  try {
    const { rows } = await pool.query(
      "SELECT cu.*, c.title as case_title, c.client_name FROM client_users cu JOIN cases c ON cu.case_id = c.id WHERE LOWER(cu.email) = LOWER($1)",
      [email.trim()]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Invalid email or password" });
    const client = rows[0];
    if (!client.is_active) return res.status(401).json({ error: "Account is deactivated" });
    const valid = await bcrypt.compare(password, client.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    await pool.query("UPDATE client_users SET last_login = NOW() WHERE id = $1", [client.id]);
    req.session.clientId = client.id;
    req.session.clientCaseId = client.case_id;
    req.session.isClient = true;
    req.session.userId = null;
    res.json({
      id: client.id,
      name: client.name,
      email: client.email,
      caseId: client.case_id,
      caseTitle: client.case_title,
      mustChangePassword: client.must_change_password,
    });
  } catch (err) {
    console.error("Client login error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/me", requireClientAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cu.id, cu.name, cu.email, cu.case_id, cu.must_change_password,
              c.title as case_title, c.client_name
       FROM client_users cu
       JOIN cases c ON cu.case_id = c.id
       WHERE cu.id = $1`,
      [req.session.clientId]
    );
    if (rows.length === 0) return res.status(401).json({ error: "Client not found" });
    const client = rows[0];
    res.json({
      id: client.id,
      name: client.name,
      email: client.email,
      caseId: client.case_id,
      caseTitle: client.case_title,
      mustChangePassword: client.must_change_password,
    });
  } catch (err) {
    console.error("Client /me error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("lextrack.sid");
    res.json({ ok: true });
  });
});

router.post("/change-password", requireClientAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  try {
    const { rows } = await pool.query("SELECT password_hash FROM client_users WHERE id = $1", [req.session.clientId]);
    if (rows.length === 0) return res.status(401).json({ error: "Client not found" });
    if (currentPassword) {
      const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE client_users SET password_hash = $1, must_change_password = FALSE WHERE id = $2",
      [hash, req.session.clientId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Client change-password error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
