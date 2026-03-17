const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isS3Configured, uploadToS3, downloadFromS3 } = require("../s3");

const router = express.Router();

const OO_URL = process.env.ONLYOFFICE_URL;
const OO_PASSWORD = process.env.ONLYOFFICE_PASSWORD;
const OO_USER = process.env.ONLYOFFICE_USER || "admin";
const OO_ROOM_ID = process.env.ONLYOFFICE_ROOM_ID;

let cachedSession = null;

async function getSession() {
  if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession.token;
  if (!OO_URL || !OO_PASSWORD) return null;
  try {
    const res = await fetch(`${OO_URL}/api/2.0/authentication`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: OO_USER, password: OO_PASSWORD }),
    });
    const data = await res.json();
    if (!data.response?.token) return null;
    cachedSession = { token: data.response.token, expiresAt: Date.now() + 10 * 60 * 1000 };
    return cachedSession.token;
  } catch (err) {
    console.error("ONLYOFFICE auth error:", err.message);
    return null;
  }
}

router.get("/status", requireAuth, async (req, res) => {
  const configured = !!(OO_URL && OO_PASSWORD && OO_ROOM_ID);
  if (!configured) return res.json({ configured: false, available: false });
  const token = await getSession();
  res.json({ configured, available: !!token, url: OO_URL || null });
});

router.post("/view", requireAuth, async (req, res) => {
  try {
    const { docId } = req.body;
    const token = await getSession();
    if (!token) return res.status(500).json({ error: "ONLYOFFICE not available" });

    const { rows } = await pool.query("SELECT filename, content_type, file_data, s3_key, case_id FROM case_documents WHERE id = $1", [docId]);
    if (!rows.length) return res.status(404).json({ error: "Document not found" });
    const doc = rows[0];
    const userId = req.session.userId;
    const userRole = req.session.userRole || "";
    if (userRole !== "App Admin") {
      const { rows: cRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2 OR confidential = false OR confidential IS NULL)", [doc.case_id, userId]);
      if (!cRows.length) return res.status(403).json({ error: "Access denied" });
    }

    let fileBuffer = doc.file_data;
    if (!fileBuffer && doc.s3_key && isS3Configured()) {
      try {
        fileBuffer = await downloadFromS3(doc.s3_key);
      } catch (s3Err) {
        console.error("ONLYOFFICE view S3 download error:", s3Err.message);
        return res.status(500).json({ error: "File storage service error. Please try again." });
      }
    }
    if (!fileBuffer) return res.status(400).json({ error: "No file data available" });

    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer], { type: doc.content_type }), doc.filename);

    if (!OO_ROOM_ID) return res.status(500).json({ error: "ONLYOFFICE room not configured" });

    const uploadRes = await fetch(`${OO_URL}/api/2.0/files/${OO_ROOM_ID}/upload`, {
      method: "POST",
      headers: { Authorization: token },
      body: formData,
    });
    if (!uploadRes.ok) {
      console.error("ONLYOFFICE view upload failed:", uploadRes.status);
      return res.status(500).json({ error: "Upload to DocSpace failed" });
    }
    const uploadData = await uploadRes.json();
    const fileId = uploadData.response?.id;
    if (!fileId) return res.status(500).json({ error: "Upload to DocSpace failed" });

    const editorRes = await fetch(`${OO_URL}/api/2.0/files/file/${fileId}/openedit`, {
      headers: { Authorization: token },
    });
    if (!editorRes.ok) {
      console.error("ONLYOFFICE openedit failed:", editorRes.status);
      return res.status(500).json({ error: "Failed to open document in DocSpace" });
    }
    const editorData = await editorRes.json();
    const editorResponse = editorData.response || {};

    if (!req.session.ooViewSessions) req.session.ooViewSessions = {};
    req.session.ooViewSessions[String(fileId)] = { docId, userId: req.session.userId, createdAt: Date.now() };

    res.json({
      fileId,
      editorUrl: editorResponse.editorUrl || `${OO_URL}/web-apps/apps/api/documents/api.js`,
      editorConfig: {
        document: editorResponse.document || null,
        documentType: editorResponse.documentType || null,
        editorConfig: editorResponse.editorConfig || null,
        token: editorResponse.token || null,
        type: editorResponse.type || "embedded",
      },
    });
  } catch (err) {
    console.error("ONLYOFFICE view error:", err.message);
    res.status(500).json({ error: "Failed to open document viewer" });
  }
});

router.post("/upload-for-edit", requireAuth, async (req, res) => {
  try {
    const { docId } = req.body;
    const token = await getSession();
    if (!token) return res.status(500).json({ error: "ONLYOFFICE not available" });

    const { rows } = await pool.query("SELECT filename, content_type, file_data, s3_key, case_id FROM case_documents WHERE id = $1", [docId]);
    if (rows.length) {
      const userId = req.session.userId;
      const userRole = req.session.userRole || "";
      if (userRole !== "App Admin") {
        const { rows: cRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2 OR confidential = false OR confidential IS NULL)", [rows[0].case_id, userId]);
        if (!cRows.length) return res.status(403).json({ error: "Access denied" });
      }
    }
    if (!rows.length) return res.status(404).json({ error: "Document not found" });
    const doc = rows[0];
    let fileBuffer = doc.file_data;
    if (!fileBuffer && doc.s3_key && isS3Configured()) {
      try {
        fileBuffer = await downloadFromS3(doc.s3_key);
      } catch (s3Err) {
        console.error("ONLYOFFICE S3 download error:", s3Err.message);
        return res.status(500).json({ error: "File storage service error. Please try again." });
      }
    }
    if (!fileBuffer) return res.status(400).json({ error: "No file data available" });

    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer], { type: doc.content_type }), doc.filename);

    const uploadRes = await fetch(`${OO_URL}/api/2.0/files/${OO_ROOM_ID}/upload`, {
      method: "POST",
      headers: { Authorization: token },
      body: formData,
    });
    const uploadData = await uploadRes.json();
    const fileId = uploadData.response?.id;
    if (!fileId) return res.status(500).json({ error: "Upload to DocSpace failed" });

    const editorRes = await fetch(`${OO_URL}/api/2.0/files/file/${fileId}/openedit`, {
      headers: { Authorization: token },
    });
    const editorData = await editorRes.json();
    const editorResponse = editorData.response || {};

    if (!req.session.ooEditSessions) req.session.ooEditSessions = {};
    req.session.ooEditSessions[String(fileId)] = { docId, userId: req.session.userId, createdAt: Date.now() };

    res.json({
      fileId,
      editorUrl: editorResponse.editorUrl || `${OO_URL}/doceditor?fileId=${fileId}`,
      editorConfig: {
        document: editorResponse.document || null,
        documentType: editorResponse.documentType || null,
        editorConfig: editorResponse.editorConfig || null,
        token: editorResponse.token || null,
        type: editorResponse.type || "desktop",
      },
    });
  } catch (err) {
    console.error("ONLYOFFICE upload error:", err.message);
    res.status(500).json({ error: "Failed to upload for editing" });
  }
});

router.post("/sync-back", requireAuth, async (req, res) => {
  try {
    const { docId, fileId } = req.body;
    const editSession = (req.session.ooEditSessions || {})[String(fileId)];
    if (!editSession || editSession.docId !== docId || editSession.userId !== req.session.userId) {
      return res.status(403).json({ error: "No active editing session for this file" });
    }
    const { rows: docCheck } = await pool.query("SELECT case_id FROM case_documents WHERE id = $1", [docId]);
    if (docCheck.length) {
      const userId = req.session.userId;
      const userRole = req.session.userRole || "";
      if (userRole !== "App Admin") {
        const { rows: cRows } = await pool.query("SELECT id FROM cases WHERE id = $1 AND (lead_attorney = $2 OR second_attorney = $2 OR case_manager = $2 OR investigator = $2 OR paralegal = $2 OR confidential = false OR confidential IS NULL)", [docCheck[0].case_id, userId]);
        if (!cRows.length) return res.status(403).json({ error: "Access denied" });
      }
    }
    const token = await getSession();
    if (!token) return res.status(500).json({ error: "ONLYOFFICE not available" });

    const infoRes = await fetch(`${OO_URL}/api/2.0/files/file/${fileId}`, {
      headers: { Authorization: token },
    });
    const baseVersion = infoRes.ok ? (await infoRes.json()).response?.version : null;
    console.log("ONLYOFFICE sync-back: base version", baseVersion, "— waiting for Document Server save...");

    let saved = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise(r => setTimeout(r, attempt === 0 ? 3000 : 2000));
      const checkRes = await fetch(`${OO_URL}/api/2.0/files/file/${fileId}`, {
        headers: { Authorization: token },
      });
      if (checkRes.ok) {
        const info = (await checkRes.json()).response;
        if (info && baseVersion !== null && info.version > baseVersion) {
          console.log("ONLYOFFICE sync-back: version bumped to", info.version, "after", attempt + 1, "checks");
          saved = true;
          break;
        }
      }
    }
    if (!saved && baseVersion !== null) {
      console.warn("ONLYOFFICE sync-back: version did not change after polling, downloading anyway");
    }

    const dlRes = await fetch(`${OO_URL}/filehandler.ashx?action=download&fileid=${fileId}`, {
      headers: { Authorization: token, Cookie: `asc_auth_key=${token}` },
    });
    if (!dlRes.ok) {
      console.error("ONLYOFFICE sync-back download failed:", dlRes.status, dlRes.statusText);
      return res.status(500).json({ error: "Failed to download from DocSpace" });
    }
    const buffer = Buffer.from(await dlRes.arrayBuffer());
    if (buffer.length === 0) {
      console.error("ONLYOFFICE sync-back: downloaded empty file");
      return res.status(500).json({ error: "Downloaded empty file from DocSpace" });
    }

    const { rows: docRows } = await pool.query("SELECT filename, content_type, s3_key FROM case_documents WHERE id = $1", [docId]);
    if (!docRows.length) return res.status(404).json({ error: "Document not found" });
    const docRow = docRows[0];

    if (isS3Configured()) {
      const { randomUUID } = require("crypto");
      const newS3Key = `documents/${randomUUID()}/${docRow.filename}`;
      await uploadToS3(newS3Key, buffer, docRow.content_type || "application/octet-stream");
      await pool.query("UPDATE case_documents SET file_data = NULL, s3_key = $1, content_html = NULL WHERE id = $2", [newS3Key, docId]);
    } else {
      await pool.query("UPDATE case_documents SET file_data = $1, s3_key = NULL, content_html = NULL WHERE id = $2", [buffer, docId]);
    }
    res.json({ ok: true, size: buffer.length });
  } catch (err) {
    console.error("ONLYOFFICE sync-back error:", err.message);
    res.status(500).json({ error: "Failed to sync back" });
  }
});

router.delete("/cleanup/:fileId", requireAuth, async (req, res) => {
  try {
    const fid = req.params.fileId;
    const editSession = (req.session.ooEditSessions || {})[String(fid)];
    const viewSession = (req.session.ooViewSessions || {})[String(fid)];
    if (!editSession && !viewSession) {
      return res.status(403).json({ error: "No active session for this file" });
    }
    if ((editSession && editSession.userId !== req.session.userId) ||
        (viewSession && viewSession.userId !== req.session.userId)) {
      return res.status(403).json({ error: "No active session for this file" });
    }
    const token = await getSession();
    if (token) {
      try {
        await fetch(`${OO_URL}/api/2.0/files/file/${fid}`, {
          method: "DELETE",
          headers: { Authorization: token },
        });
      } catch {}
    }
    if (editSession) delete req.session.ooEditSessions[String(fid)];
    if (viewSession) delete req.session.ooViewSessions[String(fid)];
    res.json({ ok: true });
  } catch (err) {
    console.error("ONLYOFFICE cleanup error:", err.message);
    res.json({ ok: true });
  }
});

module.exports = router;
