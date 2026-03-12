const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const isAppAdmin = (req) => {
  const roles = req.session.userRoles || (req.session.userRole ? [req.session.userRole] : []);
  return roles.includes("App Admin");
};

const PERMISSION_KEYS = [
  { key: "view_cases", category: "Cases", label: "View Cases" },
  { key: "create_cases", category: "Cases", label: "Create Cases" },
  { key: "edit_cases", category: "Cases", label: "Edit Cases" },
  { key: "delete_cases", category: "Cases", label: "Delete Cases" },
  { key: "view_case_financials", category: "Cases", label: "View Case Financials (Insurance, Damages, Liens, Expenses)" },
  { key: "edit_case_financials", category: "Cases", label: "Edit Case Financials" },

  { key: "view_documents", category: "Documents & Filings", label: "View Documents" },
  { key: "upload_documents", category: "Documents & Filings", label: "Upload Documents" },
  { key: "delete_documents", category: "Documents & Filings", label: "Delete Documents" },
  { key: "view_filings", category: "Documents & Filings", label: "View Filings" },
  { key: "upload_filings", category: "Documents & Filings", label: "Upload Filings" },
  { key: "delete_filings", category: "Documents & Filings", label: "Delete Filings" },
  { key: "view_templates", category: "Documents & Filings", label: "View & Use Templates" },
  { key: "manage_templates", category: "Documents & Filings", label: "Create/Edit/Delete Templates" },

  { key: "view_correspondence", category: "Correspondence", label: "View Emails" },
  { key: "view_sms", category: "Correspondence", label: "View Text Messages" },
  { key: "send_sms", category: "Correspondence", label: "Send Text Messages" },
  { key: "view_voicemails", category: "Correspondence", label: "View Voicemails" },
  { key: "manage_voicemails", category: "Correspondence", label: "Add/Edit/Delete Voicemails" },

  { key: "view_unmatched", category: "Unmatched", label: "View Unmatched Section" },
  { key: "assign_unmatched_emails", category: "Unmatched", label: "Assign Unmatched Emails to Cases" },
  { key: "assign_unmatched_texts", category: "Unmatched", label: "Assign Unmatched Texts to Cases" },

  { key: "view_tasks", category: "Tasks & Deadlines", label: "View Tasks" },
  { key: "create_tasks", category: "Tasks & Deadlines", label: "Create Tasks" },
  { key: "edit_tasks", category: "Tasks & Deadlines", label: "Edit Tasks" },
  { key: "complete_tasks", category: "Tasks & Deadlines", label: "Complete Tasks" },
  { key: "delete_tasks", category: "Tasks & Deadlines", label: "Delete Tasks" },
  { key: "view_deadlines", category: "Tasks & Deadlines", label: "View Calendar & Deadlines" },
  { key: "create_deadlines", category: "Tasks & Deadlines", label: "Create Deadlines" },
  { key: "edit_deadlines", category: "Tasks & Deadlines", label: "Edit Deadlines" },
  { key: "delete_deadlines", category: "Tasks & Deadlines", label: "Delete Deadlines" },

  { key: "view_notes", category: "Notes & Activity", label: "View Notes" },
  { key: "create_notes", category: "Notes & Activity", label: "Create Notes" },
  { key: "edit_notes", category: "Notes & Activity", label: "Edit Notes" },
  { key: "delete_notes", category: "Notes & Activity", label: "Delete Notes" },
  { key: "view_activity", category: "Notes & Activity", label: "View Activity Log" },

  { key: "view_contacts", category: "Contacts", label: "View Contacts" },
  { key: "create_contacts", category: "Contacts", label: "Create Contacts" },
  { key: "edit_contacts", category: "Contacts", label: "Edit Contacts" },
  { key: "delete_contacts", category: "Contacts", label: "Delete Contacts" },
  { key: "merge_contacts", category: "Contacts", label: "Merge Contacts" },

  { key: "view_medical_treatments", category: "Medical", label: "View Medical Treatments" },
  { key: "edit_medical_treatments", category: "Medical", label: "Add/Edit Medical Treatments" },
  { key: "view_medical_records", category: "Medical", label: "View Medical Records" },
  { key: "upload_medical_records", category: "Medical", label: "Upload Medical Records" },

  { key: "view_transcripts", category: "Transcripts", label: "View Transcripts" },
  { key: "upload_transcripts", category: "Transcripts", label: "Upload Transcripts" },
  { key: "edit_transcripts", category: "Transcripts", label: "Edit Transcripts" },
  { key: "delete_transcripts", category: "Transcripts", label: "Delete Transcripts" },

  { key: "use_ai_center", category: "AI & Automation", label: "Access AI Center" },
  { key: "use_ai_agents", category: "AI & Automation", label: "Run AI Agents on Cases" },
  { key: "use_advocate_ai", category: "AI & Automation", label: "Use Advocate AI" },
  { key: "manage_ai_training", category: "AI & Automation", label: "Manage AI Training Data" },

  { key: "view_reports", category: "Reports & Analytics", label: "View Reports" },
  { key: "export_reports", category: "Reports & Analytics", label: "Export Reports (CSV)" },
  { key: "view_timelog", category: "Reports & Analytics", label: "View Time Log" },
  { key: "create_time_entries", category: "Reports & Analytics", label: "Create Time Entries" },
  { key: "edit_time_entries", category: "Reports & Analytics", label: "Edit/Delete Time Entries" },

  { key: "view_trial_center", category: "Trial Center", label: "Access Trial Center" },
  { key: "edit_trial_center", category: "Trial Center", label: "Edit Trial Center Data" },

  { key: "view_collaborate", category: "Collaborate", label: "Access Collaborate Chat" },
  { key: "create_channels", category: "Collaborate", label: "Create Chat Channels" },

  { key: "view_staff", category: "Staff & Administration", label: "View Staff List" },
  { key: "manage_client_portal", category: "Staff & Administration", label: "Manage Client Portal" },
  { key: "batch_operations", category: "Staff & Administration", label: "Perform Batch Case Operations" },

  { key: "access_customization", category: "Customization", label: "Access Customization Section" },
  { key: "manage_task_flows", category: "Customization", label: "Create/Edit Task Flows" },
  { key: "manage_dashboard_widgets", category: "Customization", label: "Create/Edit Dashboard Widgets" },
  { key: "manage_custom_reports", category: "Customization", label: "Create/Edit Custom Reports" },
  { key: "manage_permissions", category: "Customization", label: "Manage Permissions" },

  { key: "view_deleted_data", category: "Deleted Data", label: "View Deleted Data" },
  { key: "restore_deleted_data", category: "Deleted Data", label: "Restore Deleted Data" },
  { key: "purge_deleted_data", category: "Deleted Data", label: "Permanently Purge Deleted Data" },
];

router.get("/keys", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  res.json(PERMISSION_KEYS);
});

router.get("/", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name as user_name
       FROM permissions p
       LEFT JOIN users u ON p.target_type = 'user' AND p.target_value = u.id::text
       ORDER BY p.target_type, p.target_value, p.permission_key`
    );
    res.json(rows);
  } catch (err) {
    console.error("Permissions fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const { permission_key, target_type, target_value, granted, expires_at } = req.body;
    if (!permission_key || !target_type || !target_value) {
      return res.status(400).json({ error: "permission_key, target_type, and target_value are required" });
    }
    if (!["role", "user"].includes(target_type)) {
      return res.status(400).json({ error: "target_type must be 'role' or 'user'" });
    }
    if (!PERMISSION_KEYS.find(pk => pk.key === permission_key)) {
      return res.status(400).json({ error: "Invalid permission_key" });
    }

    const { rows } = await pool.query(
      `INSERT INTO permissions (permission_key, target_type, target_value, granted, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (permission_key, target_type, target_value) DO UPDATE
       SET granted = EXCLUDED.granted, expires_at = EXCLUDED.expires_at, created_by = EXCLUDED.created_by, updated_at = NOW()
       RETURNING *`,
      [permission_key, target_type, target_value, granted !== false, expires_at || null, req.session.userId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Permission create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/bulk", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const { permissions } = req.body;
    if (!Array.isArray(permissions) || permissions.length === 0) {
      return res.status(400).json({ error: "permissions array required" });
    }

    const validKeys = new Set(PERMISSION_KEYS.map(pk => pk.key));
    const results = [];
    for (const perm of permissions) {
      const { permission_key, target_type, target_value, granted, expires_at } = perm;
      if (!permission_key || !target_type || !target_value) continue;
      if (!["role", "user"].includes(target_type)) continue;
      if (!validKeys.has(permission_key)) continue;

      const { rows } = await pool.query(
        `INSERT INTO permissions (permission_key, target_type, target_value, granted, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (permission_key, target_type, target_value) DO UPDATE
         SET granted = EXCLUDED.granted, expires_at = EXCLUDED.expires_at, created_by = EXCLUDED.created_by, updated_at = NOW()
         RETURNING *`,
        [permission_key, target_type, target_value, granted !== false, expires_at || null, req.session.userId]
      );
      if (rows.length > 0) results.push(rows[0]);
    }
    res.json(results);
  } catch (err) {
    console.error("Permission bulk create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const { rows } = await pool.query("DELETE FROM permissions WHERE id = $1 RETURNING *", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Permission not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Permission delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/delete-bulk", requireAuth, async (req, res) => {
  if (!isAppAdmin(req)) return res.status(403).json({ error: "Admin access required" });
  try {
    const { target_type, target_value, permission_keys } = req.body;
    if (!target_type || !target_value) return res.status(400).json({ error: "target_type and target_value required" });

    if (Array.isArray(permission_keys) && permission_keys.length > 0) {
      await pool.query(
        `DELETE FROM permissions WHERE target_type = $1 AND target_value = $2 AND permission_key = ANY($3)`,
        [target_type, target_value, permission_keys]
      );
    } else {
      await pool.query(
        `DELETE FROM permissions WHERE target_type = $1 AND target_value = $2`,
        [target_type, target_value]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Permission bulk delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/check", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const userRoles = req.session.userRoles || (req.session.userRole ? [req.session.userRole] : []);

    if (userRoles.includes("App Admin")) {
      return res.json({ permissions: {}, isAdmin: true });
    }

    const { rows } = await pool.query(
      `SELECT permission_key, target_type, target_value, granted, expires_at
       FROM permissions
       WHERE (target_type = 'user' AND target_value = $1)
          OR (target_type = 'role' AND target_value = ANY($2))`,
      [userId.toString(), userRoles]
    );

    const now = new Date();
    const perms = {};
    const rolePerms = {};
    for (const row of rows) {
      if (row.expires_at && new Date(row.expires_at) < now) continue;
      if (row.target_type === "user") {
        perms[row.permission_key] = row.granted;
      } else {
        if (!(row.permission_key in rolePerms)) {
          rolePerms[row.permission_key] = row.granted;
        } else if (row.granted === false) {
          rolePerms[row.permission_key] = false;
        }
      }
    }
    for (const [key, val] of Object.entries(rolePerms)) {
      if (!(key in perms)) perms[key] = val;
    }

    res.json({ permissions: perms, isAdmin: false });
  } catch (err) {
    console.error("Permission check error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
