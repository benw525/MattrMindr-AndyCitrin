const express = require("express");
const router = express.Router();
const pool = require("../db");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: "Not authenticated" });
  next();
}

router.get("/channels", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { rows } = await pool.query(`
      SELECT cc.id, cc.type, cc.name, cc.case_id, cc.created_by, cc.created_at,
        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.channel_id = cc.id AND cm.created_at > ccm.last_read_at AND cm.sender_id != $1) AS unread_count,
        (SELECT body FROM chat_messages cm2 WHERE cm2.channel_id = cc.id ORDER BY cm2.created_at DESC LIMIT 1) AS last_message,
        (SELECT sender_id FROM chat_messages cm3 WHERE cm3.channel_id = cc.id ORDER BY cm3.created_at DESC LIMIT 1) AS last_sender_id,
        (SELECT created_at FROM chat_messages cm4 WHERE cm4.channel_id = cc.id ORDER BY cm4.created_at DESC LIMIT 1) AS last_message_at,
        (SELECT name FROM users u WHERE u.id = (SELECT sender_id FROM chat_messages cm5 WHERE cm5.channel_id = cc.id ORDER BY cm5.created_at DESC LIMIT 1)) AS last_sender_name
      FROM chat_channels cc
      JOIN chat_channel_members ccm ON ccm.channel_id = cc.id AND ccm.user_id = $1
      ORDER BY last_message_at DESC NULLS LAST, cc.created_at DESC
    `, [userId]);

    const channels = [];
    for (const r of rows) {
      const ch = {
        id: r.id, type: r.type, name: r.name, caseId: r.case_id,
        createdBy: r.created_by, createdAt: r.created_at,
        unreadCount: parseInt(r.unread_count) || 0,
        lastMessage: r.last_message || null,
        lastSenderId: r.last_sender_id || null,
        lastSenderName: r.last_sender_name || null,
        lastMessageAt: r.last_message_at || null,
      };

      if (r.type === "case") {
        const caseRes = await pool.query("SELECT case_num, client_name, title FROM cases WHERE id = $1", [r.case_id]);
        if (caseRes.rows[0]) {
          ch.caseName = caseRes.rows[0].case_num || caseRes.rows[0].title;
          ch.clientName = caseRes.rows[0].client_name;
        }
      } else if (r.type === "group") {
        const grpRes = await pool.query("SELECT name, description, avatar, created_by FROM chat_groups WHERE channel_id = $1", [r.id]);
        if (grpRes.rows[0]) {
          ch.groupName = grpRes.rows[0].name;
          ch.groupDescription = grpRes.rows[0].description;
          ch.groupAvatar = grpRes.rows[0].avatar;
          ch.groupCreatedBy = grpRes.rows[0].created_by;
        }
        const memRes = await pool.query("SELECT COUNT(*) FROM chat_channel_members WHERE channel_id = $1", [r.id]);
        ch.memberCount = parseInt(memRes.rows[0].count) || 0;
      } else if (r.type === "private") {
        const otherRes = await pool.query(
          "SELECT u.id, u.name, u.avatar, u.initials FROM chat_channel_members ccm JOIN users u ON u.id = ccm.user_id WHERE ccm.channel_id = $1 AND ccm.user_id != $2 LIMIT 1",
          [r.id, userId]
        );
        if (otherRes.rows[0]) {
          ch.otherUser = otherRes.rows[0];
        }
      }
      channels.push(ch);
    }
    res.json(channels);
  } catch (err) {
    console.error("Get channels error:", err);
    res.status(500).json({ error: "Failed to get channels" });
  }
});

router.post("/channels", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { type, name, caseId, memberIds } = req.body;
    if (!type) return res.status(400).json({ error: "type required" });

    const chRes = await pool.query(
      "INSERT INTO chat_channels (type, name, case_id, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
      [type, name || null, caseId || null, userId]
    );
    const channel = chRes.rows[0];

    await pool.query(
      "INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [channel.id, userId]
    );

    if (memberIds && Array.isArray(memberIds)) {
      for (const mid of memberIds) {
        await pool.query(
          "INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [channel.id, mid]
        );
      }
    }

    res.json({ id: channel.id, type: channel.type, name: channel.name, caseId: channel.case_id, createdBy: channel.created_by, createdAt: channel.created_at });
  } catch (err) {
    console.error("Create channel error:", err);
    res.status(500).json({ error: "Failed to create channel" });
  }
});

router.delete("/channels/:id", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const channelId = req.params.id;
    const chRes = await pool.query("SELECT * FROM chat_channels WHERE id = $1", [channelId]);
    if (!chRes.rows[0]) return res.status(404).json({ error: "Channel not found" });
    const ch = chRes.rows[0];

    if (ch.type === "group" && ch.created_by === userId) {
      await pool.query("DELETE FROM chat_channels WHERE id = $1", [channelId]);
    } else {
      await pool.query("DELETE FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2", [channelId, userId]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Delete channel error:", err);
    res.status(500).json({ error: "Failed to delete channel" });
  }
});

router.get("/channels/:id/messages", requireAuth, async (req, res) => {
  try {
    const channelId = req.params.id;
    const before = req.query.before;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    let query = `
      SELECT cm.id, cm.channel_id, cm.sender_id, cm.body, cm.mentions, cm.attachment_name, cm.attachment_url, cm.created_at,
        u.name AS sender_name, u.avatar AS sender_avatar, u.initials AS sender_initials
      FROM chat_messages cm
      JOIN users u ON u.id = cm.sender_id
      WHERE cm.channel_id = $1
    `;
    const params = [channelId];
    if (before) {
      params.push(before);
      query += ` AND cm.id < $${params.length}`;
    }
    query += ` ORDER BY cm.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);
    res.json(rows.reverse().map(r => ({
      id: r.id, channelId: r.channel_id, senderId: r.sender_id, body: r.body,
      mentions: r.mentions || [], attachmentName: r.attachment_name, attachmentUrl: r.attachment_url,
      createdAt: r.created_at, senderName: r.sender_name, senderAvatar: r.sender_avatar, senderInitials: r.sender_initials,
    })));
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Failed to get messages" });
  }
});

router.post("/channels/:id/messages", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const channelId = req.params.id;
    const { body, attachmentName, attachmentUrl } = req.body;
    if (!body && !attachmentName) return res.status(400).json({ error: "body required" });

    const memCheck = await pool.query("SELECT id FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2", [channelId, userId]);
    if (memCheck.rows.length === 0) return res.status(403).json({ error: "Not a member of this channel" });

    const usersRes = await pool.query("SELECT id, name FROM users WHERE deleted_at IS NULL");
    const mentions = [];
    const msgBody = body || "";
    usersRes.rows.forEach(u => {
      if (msgBody.includes(`@${u.name}`)) mentions.push(u.id);
    });

    const msgRes = await pool.query(
      `INSERT INTO chat_messages (channel_id, sender_id, body, mentions, attachment_name, attachment_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [channelId, userId, msgBody, mentions, attachmentName || null, attachmentUrl || null]
    );

    await pool.query(
      "UPDATE chat_channel_members SET last_read_at = NOW() WHERE channel_id = $1 AND user_id = $2",
      [channelId, userId]
    );

    await pool.query("DELETE FROM chat_typing WHERE channel_id = $1 AND user_id = $2", [channelId, userId]);

    const userRes = await pool.query("SELECT name, avatar, initials FROM users WHERE id = $1", [userId]);
    const u = userRes.rows[0] || {};

    res.json({
      id: msgRes.rows[0].id, channelId: parseInt(channelId), senderId: userId, body: msgBody,
      mentions, attachmentName: attachmentName || null, attachmentUrl: attachmentUrl || null,
      createdAt: msgRes.rows[0].created_at, senderName: u.name, senderAvatar: u.avatar, senderInitials: u.initials,
    });
  } catch (err) {
    console.error("Send message error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.put("/channels/:id/read", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE chat_channel_members SET last_read_at = NOW() WHERE channel_id = $1 AND user_id = $2",
      [req.params.id, req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Mark read error:", err);
    res.status(500).json({ error: "Failed to mark read" });
  }
});

router.get("/search", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const q = req.query.q;
    if (!q || q.trim().length < 2) return res.json([]);

    const { rows } = await pool.query(`
      SELECT cm.id, cm.channel_id, cm.body, cm.created_at, cm.sender_id,
        u.name AS sender_name, cc.type AS channel_type, cc.name AS channel_name, cc.case_id
      FROM chat_messages cm
      JOIN chat_channel_members ccm ON ccm.channel_id = cm.channel_id AND ccm.user_id = $1
      JOIN users u ON u.id = cm.sender_id
      JOIN chat_channels cc ON cc.id = cm.channel_id
      WHERE cm.body ILIKE $2
      ORDER BY cm.created_at DESC
      LIMIT 30
    `, [userId, `%${q.trim()}%`]);

    const results = [];
    for (const r of rows) {
      const item = {
        id: r.id, channelId: r.channel_id, body: r.body, createdAt: r.created_at,
        senderId: r.sender_id, senderName: r.sender_name,
        channelType: r.channel_type, channelName: r.channel_name, caseId: r.case_id,
      };
      if (r.channel_type === "case" && r.case_id) {
        const cRes = await pool.query("SELECT case_num, client_name FROM cases WHERE id = $1", [r.case_id]);
        if (cRes.rows[0]) { item.caseName = cRes.rows[0].case_num; item.clientName = cRes.rows[0].client_name; }
      }
      if (r.channel_type === "group") {
        const gRes = await pool.query("SELECT name FROM chat_groups WHERE channel_id = $1", [r.channel_id]);
        if (gRes.rows[0]) item.groupName = gRes.rows[0].name;
      }
      if (r.channel_type === "private") {
        const oRes = await pool.query(
          "SELECT u.name FROM chat_channel_members ccm JOIN users u ON u.id = ccm.user_id WHERE ccm.channel_id = $1 AND ccm.user_id != $2 LIMIT 1",
          [r.channel_id, userId]
        );
        if (oRes.rows[0]) item.otherUserName = oRes.rows[0].name;
      }
      results.push(item);
    }
    res.json(results);
  } catch (err) {
    console.error("Search messages error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/case-channels", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT cc.id, cc.case_id, c.case_num, c.client_name, c.title,
        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.channel_id = cc.id) AS message_count
      FROM chat_channels cc
      JOIN cases c ON c.id = cc.case_id
      WHERE cc.type = 'case'
      ORDER BY c.case_num
    `);
    res.json(rows.map(r => ({
      channelId: r.id, caseId: r.case_id, caseNum: r.case_num,
      clientName: r.client_name, title: r.title,
      messageCount: parseInt(r.message_count) || 0,
    })));
  } catch (err) {
    console.error("Get case channels error:", err);
    res.status(500).json({ error: "Failed to get case channels" });
  }
});

router.post("/groups", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { name, description, avatar, memberIds } = req.body;
    if (!name) return res.status(400).json({ error: "name required" });

    const chRes = await pool.query(
      "INSERT INTO chat_channels (type, name, created_by) VALUES ('group', $1, $2) RETURNING *",
      [name, userId]
    );
    const channel = chRes.rows[0];

    await pool.query(
      "INSERT INTO chat_groups (channel_id, name, description, avatar, created_by) VALUES ($1, $2, $3, $4, $5)",
      [channel.id, name, description || "", avatar || "#4C7AC9", userId]
    );

    await pool.query(
      "INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [channel.id, userId]
    );

    if (memberIds && Array.isArray(memberIds)) {
      for (const mid of memberIds) {
        if (mid !== userId) {
          await pool.query(
            "INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [channel.id, mid]
          );
        }
      }
    }

    res.json({ id: channel.id, name, description: description || "", avatar: avatar || "#4C7AC9", createdBy: userId });
  } catch (err) {
    console.error("Create group error:", err);
    res.status(500).json({ error: "Failed to create group" });
  }
});

router.put("/groups/:id", requireAuth, async (req, res) => {
  try {
    const channelId = req.params.id;
    const { name, description, avatar } = req.body;
    const sets = [];
    const params = [];
    if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
    if (description !== undefined) { params.push(description); sets.push(`description = $${params.length}`); }
    if (avatar !== undefined) { params.push(avatar); sets.push(`avatar = $${params.length}`); }
    if (sets.length > 0) {
      params.push(channelId);
      await pool.query(`UPDATE chat_groups SET ${sets.join(", ")} WHERE channel_id = $${params.length}`, params);
      if (name !== undefined) {
        await pool.query("UPDATE chat_channels SET name = $1 WHERE id = $2", [name, channelId]);
      }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Update group error:", err);
    res.status(500).json({ error: "Failed to update group" });
  }
});

router.get("/groups/:id/members", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT u.id, u.name, u.avatar, u.initials, u.role FROM chat_channel_members ccm JOIN users u ON u.id = ccm.user_id WHERE ccm.channel_id = $1 ORDER BY u.name",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Get group members error:", err);
    res.status(500).json({ error: "Failed to get members" });
  }
});

router.post("/groups/:id/members", requireAuth, async (req, res) => {
  try {
    const { userIds } = req.body;
    if (!userIds || !Array.isArray(userIds)) return res.status(400).json({ error: "userIds required" });
    for (const uid of userIds) {
      await pool.query(
        "INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [req.params.id, uid]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Add group members error:", err);
    res.status(500).json({ error: "Failed to add members" });
  }
});

router.delete("/groups/:id/members/:userId", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM chat_channel_members WHERE channel_id = $1 AND user_id = $2",
      [req.params.id, req.params.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Remove group member error:", err);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

router.get("/private", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { rows } = await pool.query(`
      SELECT cc.id, cc.created_at,
        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.channel_id = cc.id AND cm.created_at > ccm.last_read_at AND cm.sender_id != $1) AS unread_count,
        (SELECT body FROM chat_messages cm2 WHERE cm2.channel_id = cc.id ORDER BY cm2.created_at DESC LIMIT 1) AS last_message,
        (SELECT created_at FROM chat_messages cm3 WHERE cm3.channel_id = cc.id ORDER BY cm3.created_at DESC LIMIT 1) AS last_message_at
      FROM chat_channels cc
      JOIN chat_channel_members ccm ON ccm.channel_id = cc.id AND ccm.user_id = $1
      WHERE cc.type = 'private'
      ORDER BY last_message_at DESC NULLS LAST
    `, [userId]);

    const convos = [];
    for (const r of rows) {
      const otherRes = await pool.query(
        "SELECT u.id, u.name, u.avatar, u.initials FROM chat_channel_members ccm JOIN users u ON u.id = ccm.user_id WHERE ccm.channel_id = $1 AND ccm.user_id != $2 LIMIT 1",
        [r.id, userId]
      );
      convos.push({
        channelId: r.id, createdAt: r.created_at,
        unreadCount: parseInt(r.unread_count) || 0,
        lastMessage: r.last_message, lastMessageAt: r.last_message_at,
        otherUser: otherRes.rows[0] || null,
      });
    }
    res.json(convos);
  } catch (err) {
    console.error("Get private chats error:", err);
    res.status(500).json({ error: "Failed to get private chats" });
  }
});

router.post("/private", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { otherUserId } = req.body;
    if (!otherUserId) return res.status(400).json({ error: "otherUserId required" });
    if (otherUserId === userId) return res.status(400).json({ error: "Cannot message yourself" });

    const existing = await pool.query(`
      SELECT cc.id FROM chat_channels cc
      JOIN chat_channel_members m1 ON m1.channel_id = cc.id AND m1.user_id = $1
      JOIN chat_channel_members m2 ON m2.channel_id = cc.id AND m2.user_id = $2
      WHERE cc.type = 'private'
      LIMIT 1
    `, [userId, otherUserId]);

    if (existing.rows.length > 0) {
      return res.json({ channelId: existing.rows[0].id, existing: true });
    }

    const chRes = await pool.query(
      "INSERT INTO chat_channels (type, created_by) VALUES ('private', $1) RETURNING *",
      [userId]
    );
    const channel = chRes.rows[0];
    await pool.query("INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2)", [channel.id, userId]);
    await pool.query("INSERT INTO chat_channel_members (channel_id, user_id) VALUES ($1, $2)", [channel.id, otherUserId]);

    res.json({ channelId: channel.id, existing: false });
  } catch (err) {
    console.error("Start private chat error:", err);
    res.status(500).json({ error: "Failed to start private chat" });
  }
});

router.post("/channels/:id/typing", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO chat_typing (channel_id, user_id, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (channel_id, user_id) DO UPDATE SET updated_at = NOW()`,
      [req.params.id, req.session.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/channels/:id/typing", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name FROM chat_typing ct JOIN users u ON u.id = ct.user_id
       WHERE ct.channel_id = $1 AND ct.user_id != $2 AND ct.updated_at > NOW() - INTERVAL '5 seconds'`,
      [req.params.id, req.session.userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });
    const base64Data = req.file.buffer.toString("base64");
    const dataUrl = `data:${req.file.mimetype};base64,${base64Data}`;
    res.json({ attachmentName: req.file.originalname, attachmentUrl: dataUrl });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/unread", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const { rows } = await pool.query(`
      SELECT COALESCE(SUM(
        (SELECT COUNT(*) FROM chat_messages cm WHERE cm.channel_id = ccm.channel_id AND cm.created_at > ccm.last_read_at AND cm.sender_id != $1)
      ), 0) AS total
      FROM chat_channel_members ccm WHERE ccm.user_id = $1
    `, [userId]);
    res.json({ unread: parseInt(rows[0].total) || 0 });
  } catch (err) {
    console.error("Get unread error:", err);
    res.status(500).json({ error: "Failed to get unread count" });
  }
});

module.exports = router;
