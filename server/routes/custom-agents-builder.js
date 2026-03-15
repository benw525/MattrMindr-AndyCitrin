const express = require("express");
const pool = require("../db");
const multer = require("multer");
const OpenAI = require("openai");
const { requireAuth } = require("../middleware/auth");
const { extractText } = require("../utils/extract-text");
const { isR2Configured, uploadToR2, downloadFromR2, deleteFromR2 } = require("../r2");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const VALID_MODELS = ["gpt-4o", "gpt-4o-mini", "claude-3.5-sonnet", "gemini-2.0-flash"];

let standardOpenAIClient;
try {
  standardOpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "placeholder" });
} catch (e) { standardOpenAIClient = null; }

function resolveModel(model) {
  if (!VALID_MODELS.includes(model)) return "gpt-4o-mini";
  if (!model.startsWith("gpt-") && !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) return "gpt-4o-mini";
  return model;
}

function getClientForModel(model) {
  if (model.startsWith("gpt-")) {
    if (!standardOpenAIClient) standardOpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "placeholder" });
    return standardOpenAIClient;
  }
  if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  if (!standardOpenAIClient) standardOpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "placeholder" });
  return standardOpenAIClient;
}

const toFrontend = (r) => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  systemPrompt: r.system_prompt,
  contextSources: r.context_sources || [],
  needsCase: r.needs_case,
  interactionMode: r.interaction_mode,
  model: r.model,
  visibility: r.visibility,
  sharedWith: r.shared_with || [],
  instructionFilename: r.instruction_filename || null,
  hasInstructionFile: !!(r.instruction_file || r.s3_instruction_key),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM custom_agents WHERE user_id = $1 OR visibility = 'shared_office' OR (visibility = 'shared_users' AND $1 = ANY(shared_with)) ORDER BY updated_at DESC`,
      [req.session.userId]
    );
    res.json(rows.map(toFrontend));
  } catch (err) {
    console.error("Custom agents list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, systemPrompt, contextSources, needsCase, interactionMode, model, visibility, sharedWith } = req.body;
    if (!name || !systemPrompt) return res.status(400).json({ error: "Name and system prompt required" });
    const { rows } = await pool.query(
      `INSERT INTO custom_agents (user_id, name, system_prompt, context_sources, needs_case, interaction_mode, model, visibility, shared_with)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.session.userId, name, systemPrompt, JSON.stringify(contextSources || []), needsCase !== false, interactionMode || "single", resolveModel(model || "gpt-4o-mini"), visibility || "private", sharedWith || []]
    );
    res.status(201).json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Custom agent create error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", requireAuth, async (req, res) => {
  try {
    const d = req.body;
    const { rows } = await pool.query(
      `UPDATE custom_agents SET name=COALESCE($1,name), system_prompt=COALESCE($2,system_prompt), context_sources=COALESCE($3,context_sources), needs_case=COALESCE($4,needs_case), interaction_mode=COALESCE($5,interaction_mode), model=COALESCE($6,model), visibility=COALESCE($7,visibility), shared_with=COALESCE($8,shared_with), updated_at=NOW() WHERE id=$9 AND user_id=$10 RETURNING *`,
      [d.name, d.systemPrompt, d.contextSources ? JSON.stringify(d.contextSources) : null, d.needsCase, d.interactionMode, d.model ? resolveModel(d.model) : null, d.visibility, d.sharedWith, req.params.id, req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Custom agent update error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const { rows: existing } = await pool.query("SELECT s3_instruction_key FROM custom_agents WHERE id=$1 AND user_id=$2", [req.params.id, req.session.userId]);
    if (existing.length && existing[0].s3_instruction_key && isR2Configured()) {
      deleteFromR2(existing[0].s3_instruction_key).catch(e => console.error("S3 agent delete error:", e.message));
    }
    const { rows } = await pool.query("DELETE FROM custom_agents WHERE id=$1 AND user_id=$2 RETURNING id", [req.params.id, req.session.userId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("Custom agent delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

async function fetchCaseContext(caseId, sources) {
  const context = [];
  for (const src of sources) {
    try {
      if (src === "notes") {
        const { rows } = await pool.query("SELECT content FROM case_notes WHERE case_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20", [caseId]);
        if (rows.length) context.push("=== CASE NOTES ===\n" + rows.map(r => r.content).join("\n---\n"));
      } else if (src === "filings") {
        const { rows } = await pool.query("SELECT filename, filed_by, doc_type, filing_date FROM case_filings WHERE case_id=$1 AND deleted_at IS NULL ORDER BY filing_date DESC LIMIT 20", [caseId]);
        if (rows.length) context.push("=== FILINGS ===\n" + rows.map(r => `${r.filename} (${r.doc_type || "N/A"}, filed by: ${r.filed_by || "N/A"}, date: ${r.filing_date || "N/A"})`).join("\n"));
      } else if (src === "documents") {
        const { rows } = await pool.query("SELECT filename, doc_type, summary FROM case_documents WHERE case_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20", [caseId]);
        if (rows.length) context.push("=== DOCUMENTS ===\n" + rows.map(r => `${r.filename} (${r.doc_type || "N/A"})${r.summary ? ": " + r.summary : ""}`).join("\n"));
      } else if (src === "medical_records") {
        const { rows } = await pool.query("SELECT mr.provider_name, mr.date_of_service, mr.description, mr.summary FROM medical_records mr WHERE mr.case_id=$1 AND mr.deleted_at IS NULL ORDER BY mr.date_of_service DESC LIMIT 30", [caseId]);
        if (rows.length) context.push("=== MEDICAL RECORDS ===\n" + rows.map(r => `${r.provider_name || "Unknown"} (${r.date_of_service || "N/A"}): ${r.description || ""} ${r.summary || ""}`).join("\n"));
      }
    } catch (e) {}
  }
  return context.join("\n\n");
}

router.post("/:id/run", requireAuth, async (req, res) => {
  try {
    const { rows: agentRows } = await pool.query("SELECT * FROM custom_agents WHERE id=$1", [req.params.id]);
    if (!agentRows.length) return res.status(404).json({ error: "Agent not found" });
    const agent = agentRows[0];

    const { prompt, caseId } = req.body;
    if (!prompt) return res.status(400).json({ error: "Prompt required" });

    let systemContent = agent.system_prompt;
    if (agent.instruction_text) {
      systemContent += "\n\n=== UPLOADED INSTRUCTION DOCUMENT ===\n" + agent.instruction_text.substring(0, 30000);
    }
    if (agent.needs_case && caseId) {
      const caseContext = await fetchCaseContext(caseId, agent.context_sources || []);
      if (caseContext) systemContent += "\n\n=== CASE DATA ===\n" + caseContext;
    }

    const model = resolveModel(agent.model);
    const client = getClientForModel(model);

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      store: false,
    });

    res.json({ response: completion.choices[0].message.content, model });
  } catch (err) {
    console.error("Custom agent run error:", err);
    res.status(500).json({ error: "Agent execution failed" });
  }
});

router.post("/:id/chat", requireAuth, async (req, res) => {
  try {
    const { rows: agentRows } = await pool.query("SELECT * FROM custom_agents WHERE id=$1", [req.params.id]);
    if (!agentRows.length) return res.status(404).json({ error: "Agent not found" });
    const agent = agentRows[0];

    const { messages, caseId } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Messages array required" });

    let systemContent = agent.system_prompt;
    if (agent.instruction_text) {
      systemContent += "\n\n=== UPLOADED INSTRUCTION DOCUMENT ===\n" + agent.instruction_text.substring(0, 30000);
    }
    if (agent.needs_case && caseId) {
      const caseContext = await fetchCaseContext(caseId, agent.context_sources || []);
      if (caseContext) systemContent += "\n\n=== CASE DATA ===\n" + caseContext;
    }

    const model = resolveModel(agent.model);
    const client = getClientForModel(model);

    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "system", content: systemContent }, ...messages],
      temperature: 0.3,
      max_tokens: 4000,
      store: false,
    });

    res.json({ response: completion.choices[0].message.content, model });
  } catch (err) {
    console.error("Custom agent chat error:", err);
    res.status(500).json({ error: "Agent chat failed" });
  }
});

router.post("/preview", requireAuth, async (req, res) => {
  try {
    const { systemPrompt, prompt, model: requestedModel, caseId, contextSources, needsCase } = req.body;
    if (!systemPrompt || !prompt) return res.status(400).json({ error: "System prompt and prompt required" });

    let systemContent = systemPrompt;
    if (needsCase && caseId) {
      const caseContext = await fetchCaseContext(caseId, contextSources || []);
      if (caseContext) systemContent += "\n\n=== CASE DATA ===\n" + caseContext;
    }

    const model = resolveModel(requestedModel || "gpt-4o-mini");
    const client = getClientForModel(model);

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      store: false,
    });

    res.json({ response: completion.choices[0].message.content, model });
  } catch (err) {
    console.error("Custom agent preview error:", err);
    res.status(500).json({ error: "Preview failed" });
  }
});

router.post("/:id/upload-instructions", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const buffer = req.file.buffer;
    const filename = req.file.originalname;
    const mimeType = req.file.mimetype;

    let text = "";
    try {
      text = await extractText(buffer, mimeType, filename);
    } catch (e) {
      text = buffer.toString("utf8").substring(0, 50000);
    }

    let s3Key = null;
    if (isR2Configured()) {
      try {
        s3Key = `custom-agents/${req.params.id}/${filename}`;
        await uploadToR2(s3Key, buffer, mimeType);
      } catch (e) { console.error("S3 agent instruction pre-upload failed, using BYTEA:", e.message); s3Key = null; }
    }
    const { rows } = await pool.query(
      "UPDATE custom_agents SET instruction_file=$1, instruction_filename=$2, instruction_text=$3, s3_instruction_key=$4, updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *",
      [s3Key ? null : buffer, filename, text, s3Key, req.params.id, req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Custom agent upload instructions error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

router.get("/:id/download-instructions", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT instruction_file, instruction_filename, s3_instruction_key FROM custom_agents WHERE id=$1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    let buffer = null;
    if (rows[0].s3_instruction_key && isR2Configured()) {
      try { buffer = await downloadFromR2(rows[0].s3_instruction_key); } catch (e) { console.error("S3 instruction download fallback:", e.message); }
    }
    if (!buffer) {
      buffer = rows[0].instruction_file;
    }
    if (!buffer) return res.status(404).json({ error: "Not found" });
    res.setHeader("Content-Disposition", `attachment; filename="${rows[0].instruction_filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error("Custom agent download instructions error:", err);
    res.status(500).json({ error: "Download failed" });
  }
});

router.delete("/:id/clear-instructions", requireAuth, async (req, res) => {
  try {
    const { rows: existing } = await pool.query("SELECT s3_instruction_key FROM custom_agents WHERE id=$1 AND user_id=$2", [req.params.id, req.session.userId]);
    if (existing.length && existing[0].s3_instruction_key && isR2Configured()) {
      deleteFromR2(existing[0].s3_instruction_key).catch(e => console.error("S3 instruction delete error:", e.message));
    }
    const { rows } = await pool.query(
      "UPDATE custom_agents SET instruction_file=NULL, instruction_filename=NULL, instruction_text=NULL, s3_instruction_key=NULL, updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *",
      [req.params.id, req.session.userId]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(toFrontend(rows[0]));
  } catch (err) {
    console.error("Custom agent clear instructions error:", err);
    res.status(500).json({ error: "Clear failed" });
  }
});

router.get("/available-models", requireAuth, (req, res) => {
  const hasIntegration = !!process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  res.json({
    models: VALID_MODELS.map(m => ({
      id: m,
      name: m,
      provider: m.startsWith("gpt-") ? "OpenAI" : m.startsWith("claude") ? "Anthropic" : "Google",
      available: m.startsWith("gpt-") || hasIntegration,
    })),
    hasIntegration,
  });
});

module.exports = router;
