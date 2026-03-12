const express = require("express");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");
const { extractText } = require("../utils/extract-text");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html,
              court_case_number, received_at, attachment_count
       FROM unmatched_filings_emails
       WHERE assigned_case_id IS NULL
       ORDER BY received_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error("Unmatched emails fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/assign/:id", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { caseId } = req.body;
    if (!caseId) { client.release(); return res.status(400).json({ error: "caseId required" }); }

    const caseCheck = await client.query("SELECT id FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
    if (caseCheck.rows.length === 0) { client.release(); return res.status(404).json({ error: "Case not found" }); }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE unmatched_filings_emails SET assigned_case_id = $1 WHERE id = $2 AND assigned_case_id IS NULL
       RETURNING *`,
      [caseId, req.params.id]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      return res.status(404).json({ error: "Email not found or already assigned" });
    }

    const email = rows[0];
    const attachments = email.attachments || [];

    await client.query(
      `INSERT INTO case_correspondence (case_id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments, is_voicemail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
      [caseId, email.from_email, email.from_name, email.to_emails, email.cc_emails, email.subject, email.body_text, email.body_html, JSON.stringify(attachments)]
    );

    const pdfAttachments = attachments.filter(a => a.contentType === "application/pdf");
    for (const pdfAtt of pdfAttachments) {
      try {
        const fileBuffer = Buffer.from(pdfAtt.data, "base64");
        let extractedText = "";
        try {
          extractedText = await extractText(fileBuffer, "application/pdf", pdfAtt.filename);
        } catch (pErr) {
          console.error("Unmatched assign: PDF text extraction error:", pErr.message);
        }

        await client.query(
          `INSERT INTO case_filings (case_id, filename, original_filename, content_type, file_data, extracted_text, file_size, source, source_email_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'email', $8)`,
          [caseId, pdfAtt.filename, pdfAtt.filename, "application/pdf", fileBuffer, extractedText, pdfAtt.size, email.from_email]
        );
        console.log(`Unmatched assign: filing created from ${pdfAtt.filename} for case ${caseId}`);
      } catch (pErr) {
        console.error("Unmatched assign: PDF processing error:", pErr.message);
      }
    }

    await client.query("COMMIT");
    client.release();

    for (const pdfAtt of pdfAttachments) {
      try {
        const fileBuffer = Buffer.from(pdfAtt.data, "base64");
        let extractedText = "";
        try {
          extractedText = await extractText(fileBuffer, "application/pdf", pdfAtt.filename);
        } catch (_) {}

        if (!extractedText) continue;

        const { rows: filingRows } = await pool.query(
          `SELECT id FROM case_filings WHERE case_id = $1 AND original_filename = $2 ORDER BY id DESC LIMIT 1`,
          [caseId, pdfAtt.filename]
        );
        if (filingRows.length === 0) continue;
        const filingId = filingRows[0].id;

        const OpenAI = require("openai");
        const openai = new OpenAI({
          apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
          baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
        });
        const classifyPrompt = `You are a court filing classification assistant for a personal injury law firm. Analyze the court filing text and classify it. Return ONLY valid JSON with these fields:
- "suggestedName" (string — proper legal filing name)
- "filedBy" (one of: "Plaintiff", "Defendant", "Court", "Third Party", "Other")
- "docType" (string — filing type)
- "filingDate" (string — YYYY-MM-DD format, or null if not found)
- "summary" (string — 2-3 sentence summary)
- "hearingDates" (array of objects with "date" (YYYY-MM-DD) and "description" (string — e.g., "Motion Hearing", "Status Conference", "Mediation", "Deposition", "Trial Date"). Extract ALL hearing dates, court dates, or scheduled appearances mentioned in the filing. Return empty array [] if none found.)`;
        const textSnippet = extractedText.substring(0, 12000);
        const resp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: classifyPrompt },
            { role: "user", content: `Classify this court filing:\n\n${textSnippet}` },
          ],
          temperature: 0.3,
          max_tokens: 2000,
          store: false,
          response_format: { type: "json_object" },
        });
        const classification = JSON.parse(resp.choices[0].message.content);
        const sets = [];
        const setVals = [];
        let si = 1;
        if (classification.suggestedName) { sets.push(`filename = $${si++}`); setVals.push(classification.suggestedName); }
        if (classification.filedBy) { sets.push(`filed_by = $${si++}`); setVals.push(classification.filedBy); }
        if (classification.docType) { sets.push(`doc_type = $${si++}`); setVals.push(classification.docType); }
        if (classification.filingDate) { sets.push(`filing_date = $${si++}`); setVals.push(classification.filingDate); }
        if (classification.summary) { sets.push(`summary = $${si++}`); setVals.push(classification.summary); }
        if (sets.length > 0) {
          setVals.push(filingId);
          await pool.query(`UPDATE case_filings SET ${sets.join(", ")} WHERE id = $${si}`, setVals);
        }
        console.log(`Unmatched assign: auto-classified: ${classification.suggestedName || pdfAtt.filename}`);

        if (Array.isArray(classification.hearingDates) && classification.hearingDates.length > 0) {
          for (const hd of classification.hearingDates) {
            if (!hd.date || !hd.description) continue;
            try {
              const { rows: existing } = await pool.query(
                `SELECT id FROM deadlines WHERE case_id = $1 AND date = $2 AND LOWER(title) = LOWER($3)`,
                [caseId, hd.date, hd.description]
              );
              if (existing.length === 0) {
                await pool.query(
                  `INSERT INTO deadlines (case_id, title, date, type, rule, assigned) VALUES ($1, $2, $3, 'Hearing', '', NULL)`,
                  [caseId, hd.description, hd.date]
                );
                console.log(`Unmatched assign: auto-created hearing deadline: "${hd.description}" on ${hd.date}`);
              }
            } catch (dlErr) {
              console.error("Unmatched assign: auto-create hearing deadline error:", dlErr.message);
            }
          }
        }
      } catch (classifyErr) {
        console.error("Unmatched assign: auto-classify error:", classifyErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    client.release();
    console.error("Unmatched email assign error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/reprocess", requireAuth, async (req, res) => {
  try {
    const { rows: unmatched } = await pool.query(
      `SELECT id, court_case_number, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments, attachment_count
       FROM unmatched_filings_emails WHERE assigned_case_id IS NULL ORDER BY id`
    );
    if (unmatched.length === 0) return res.json({ matched: 0, remaining: 0 });

    let matched = 0;
    for (const email of unmatched) {
      const ccn = (email.court_case_number || "").trim().toUpperCase();
      const ccnBase = ccn.replace(/\.\d+$/, "");
      if (!ccn && !ccnBase) continue;

      const { rows: matchedCases } = await pool.query(
        "SELECT id FROM cases WHERE (UPPER(TRIM(court_case_number)) = $1 OR UPPER(TRIM(court_case_number)) = $2) AND deleted_at IS NULL LIMIT 1",
        [ccn, ccnBase]
      );
      if (matchedCases.length === 0) continue;

      const caseId = matchedCases[0].id;
      const attachments = email.attachments || [];

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        await client.query("UPDATE unmatched_filings_emails SET assigned_case_id = $1 WHERE id = $2", [caseId, email.id]);

        await client.query(
          `INSERT INTO case_correspondence (case_id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments, is_voicemail)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
          [caseId, email.from_email, email.from_name, email.to_emails, email.cc_emails, email.subject, email.body_text, email.body_html, JSON.stringify(attachments)]
        );

        const pdfAttachments = attachments.filter(a => a.contentType === "application/pdf");
        for (const pdfAtt of pdfAttachments) {
          try {
            const fileBuffer = Buffer.from(pdfAtt.data, "base64");
            let extractedText = "";
            try {
              extractedText = await extractText(fileBuffer, "application/pdf", pdfAtt.filename);
            } catch (pErr) {
              console.error("Reprocess: PDF text extraction error:", pErr.message);
            }

            await client.query(
              `INSERT INTO case_filings (case_id, filename, original_filename, content_type, file_data, extracted_text, file_size, source, source_email_from)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'email', $8)`,
              [caseId, pdfAtt.filename, pdfAtt.filename, "application/pdf", fileBuffer, extractedText, pdfAtt.size, email.from_email]
            );
          } catch (pErr) {
            console.error("Reprocess: PDF processing error:", pErr.message);
          }
        }

        await client.query("COMMIT");
        client.release();

        for (const pdfAtt of pdfAttachments) {
          try {
            const fileBuffer = Buffer.from(pdfAtt.data, "base64");
            let extractedText = "";
            try { extractedText = await extractText(fileBuffer, "application/pdf", pdfAtt.filename); } catch (_) {}
            if (!extractedText) continue;

            const { rows: filingRows } = await pool.query(
              `SELECT id FROM case_filings WHERE case_id = $1 AND original_filename = $2 ORDER BY id DESC LIMIT 1`,
              [caseId, pdfAtt.filename]
            );
            if (filingRows.length === 0) continue;
            const filingId = filingRows[0].id;

            const OpenAI = require("openai");
            const openai = new OpenAI({
              apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
              baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
            });
            const classifyPrompt = `You are a court filing classification assistant for a personal injury law firm. Analyze the court filing text and classify it. Return ONLY valid JSON with these fields:
- "suggestedName" (string — proper legal filing name)
- "filedBy" (one of: "Plaintiff", "Defendant", "Court", "Third Party", "Other")
- "docType" (string — filing type)
- "filingDate" (string — YYYY-MM-DD format, or null if not found)
- "summary" (string — 2-3 sentence summary)
- "hearingDates" (array of objects with "date" (YYYY-MM-DD) and "description" (string — e.g., "Motion Hearing", "Status Conference", "Mediation", "Deposition", "Trial Date"). Extract ALL hearing dates, court dates, or scheduled appearances mentioned in the filing. Return empty array [] if none found.)`;
            const textSnippet = extractedText.substring(0, 12000);
            const resp = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: classifyPrompt },
                { role: "user", content: `Classify this court filing:\n\n${textSnippet}` },
              ],
              temperature: 0.3,
              max_tokens: 2000,
              store: false,
              response_format: { type: "json_object" },
            });
            const classification = JSON.parse(resp.choices[0].message.content);
            const sets = [];
            const setVals = [];
            let si = 1;
            if (classification.suggestedName) { sets.push(`filename = $${si++}`); setVals.push(classification.suggestedName); }
            if (classification.filedBy) { sets.push(`filed_by = $${si++}`); setVals.push(classification.filedBy); }
            if (classification.docType) { sets.push(`doc_type = $${si++}`); setVals.push(classification.docType); }
            if (classification.filingDate) { sets.push(`filing_date = $${si++}`); setVals.push(classification.filingDate); }
            if (classification.summary) { sets.push(`summary = $${si++}`); setVals.push(classification.summary); }
            if (sets.length > 0) {
              setVals.push(filingId);
              await pool.query(`UPDATE case_filings SET ${sets.join(", ")} WHERE id = $${si}`, setVals);
            }
            console.log(`Reprocess: auto-classified: ${classification.suggestedName || pdfAtt.filename}`);

            if (Array.isArray(classification.hearingDates) && classification.hearingDates.length > 0) {
              for (const hd of classification.hearingDates) {
                if (!hd.date || !hd.description) continue;
                try {
                  const { rows: existing } = await pool.query(
                    `SELECT id FROM deadlines WHERE case_id = $1 AND date = $2 AND LOWER(title) = LOWER($3)`,
                    [caseId, hd.date, hd.description]
                  );
                  if (existing.length === 0) {
                    await pool.query(
                      `INSERT INTO deadlines (case_id, title, date, type, rule, assigned) VALUES ($1, $2, $3, 'Hearing', '', NULL)`,
                      [caseId, hd.description, hd.date]
                    );
                    console.log(`Reprocess: auto-created hearing deadline: "${hd.description}" on ${hd.date}`);
                  }
                } catch (dlErr) {
                  console.error("Reprocess: auto-create hearing deadline error:", dlErr.message);
                }
              }
            }
          } catch (classifyErr) {
            console.error("Reprocess: auto-classify error:", classifyErr.message);
          }
        }

        matched++;
        console.log(`Reprocess: matched unmatched email ${email.id} (${ccn}) to case ${caseId}`);
      } catch (txErr) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        client.release();
        console.error(`Reprocess: transaction failed for email ${email.id}:`, txErr.message);
      }
    }

    const { rows: remaining } = await pool.query(
      "SELECT COUNT(*) as cnt FROM unmatched_filings_emails WHERE assigned_case_id IS NULL"
    );

    res.json({ matched, remaining: parseInt(remaining[0].cnt) });
  } catch (err) {
    console.error("Reprocess unmatched emails error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
