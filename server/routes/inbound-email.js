const express = require("express");
const multer = require("multer");
const { simpleParser } = require("mailparser");
const pool = require("../db");
const { extractText } = require("../utils/extract-text");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, fieldSize: 50 * 1024 * 1024 } });

router.post("/", upload.any(), async (req, res) => {
  try {
    console.log("=== INBOUND EMAIL DEBUG ===");
    console.log("Body fields:", Object.keys(req.body));
    console.log("attachment-info:", req.body["attachment-info"] || "NONE");
    console.log("req.files count:", req.files ? req.files.length : "null/undefined");
    if (req.files && req.files.length > 0) {
      req.files.forEach((f, i) => console.log(`  file[${i}]: fieldname=${f.fieldname}, originalname=${f.originalname}, mimetype=${f.mimetype}, size=${f.size}`));
    }

    let to, cc, from, subject, text, html, attachments = [];

    if (req.body.email) {
      console.log("Raw MIME mode detected — parsing with mailparser");
      const parsed = await simpleParser(req.body.email);
      to = parsed.to ? parsed.to.text : "";
      cc = parsed.cc ? parsed.cc.text : "";
      from = parsed.from ? parsed.from.text : "";
      subject = parsed.subject || "";
      text = parsed.text || "";
      html = parsed.html || "";

      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
          if (att.contentDisposition === "inline" && att.contentId) continue;
          attachments.push({
            filename: att.filename || "attachment",
            contentType: att.contentType || "application/octet-stream",
            size: att.size || att.content.length,
            data: att.content.toString("base64"),
          });
        }
      }
      console.log("Parsed from raw MIME:", attachments.length, "attachments");
    } else {
      console.log("Parsed mode detected");
      to = req.body.to || "";
      cc = req.body.cc || "";
      from = req.body.from || "";
      subject = req.body.subject || "";
      text = req.body.text || "";
      html = req.body.html || "";

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          attachments.push({
            filename: file.originalname,
            contentType: file.mimetype,
            size: file.size,
            data: file.buffer.toString("base64"),
          });
        }
      }

      if (attachments.length === 0 && req.body["attachment-info"]) {
        try {
          const info = JSON.parse(req.body["attachment-info"]);
          console.log("attachment-info parsed:", JSON.stringify(info));
          console.log("WARNING: attachment-info present but no files received from multer");
        } catch (e) {
          console.log("attachment-info parse error:", e.message);
        }
      }
    }

    let envelopeTo = "";
    if (req.body.envelope) {
      try {
        const env = JSON.parse(req.body.envelope);
        envelopeTo = (env.to || []).join(" ");
        console.log("Envelope to:", envelopeTo);
      } catch (e) {
        console.log("Envelope parse error:", e.message);
      }
    }

    console.log("=== END DEBUG ===");

    const allAddresses = `${to} ${cc} ${envelopeTo}`.toLowerCase();

    const fromName = from.replace(/<.*>/, "").trim().replace(/^"(.*)"$/, "$1") || from;
    const fromEmail = (from.match(/<(.+)>/) || [, from])[1] || from;

    const isFilingsEmail = /filings@/i.test(allAddresses);
    if (isFilingsEmail) {
      const courtNumPattern = /(\d{1,3}-[A-Za-z]{1,5}-\d{4}-\d+(?:\.\d+)?)/;
      const courtMatch = (subject || "").match(courtNumPattern);
      let courtCaseNumber = "";
      let caseId = null;

      if (courtMatch) {
        courtCaseNumber = courtMatch[1].trim().toUpperCase();
        console.log(`Filings email: extracted court case number "${courtCaseNumber}" from subject`);
        const { rows: matchedCases } = await pool.query(
          "SELECT id FROM cases WHERE UPPER(TRIM(court_case_number)) = $1 AND deleted_at IS NULL LIMIT 1",
          [courtCaseNumber]
        );
        if (matchedCases.length > 0) {
          caseId = matchedCases[0].id;
        } else {
          console.log(`Filings email: no case found with court_case_number="${courtCaseNumber}"`);
        }
      } else {
        console.log("Filings email: no court case number found in subject:", subject);
      }

      if (!caseId) {
        await pool.query(
          `INSERT INTO unmatched_filings_emails (from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments, court_case_number, attachment_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [fromEmail, fromName, to, cc, subject, text, html, JSON.stringify(attachments), courtCaseNumber, attachments.length]
        );
        console.log(`Filings email: stored as unmatched (court_case_number="${courtCaseNumber}")`);
        return res.status(200).send("OK");
      }
      console.log(`Filings email: matched to case ID ${caseId}`);

      if (!attachments || attachments.length === 0) {
        await pool.query(
          `INSERT INTO case_correspondence (case_id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments, is_voicemail)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)`,
          [caseId, fromEmail, fromName, to, cc, subject, text, html, JSON.stringify(attachments)]
        );
        console.log(`Filings email: no attachments, saved to correspondence for case ${caseId}`);
      }

      const pdfAttachments = attachments.filter(a => a.contentType === "application/pdf");
      for (const pdfAtt of pdfAttachments) {
        try {
          const fileBuffer = Buffer.from(pdfAtt.data, "base64");
          let extractedText = "";
          try {
            extractedText = await extractText(fileBuffer, "application/pdf", pdfAtt.filename);
          } catch (pErr) {
            console.error("Filings PDF text extraction error:", pErr.message);
          }

          const { rows: filingRows } = await pool.query(
            `INSERT INTO case_filings (case_id, filename, original_filename, content_type, file_data, extracted_text, file_size, source, source_email_from)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'email', $8)
             RETURNING id`,
            [caseId, pdfAtt.filename, pdfAtt.filename, "application/pdf", fileBuffer, extractedText, pdfAtt.size, fromEmail]
          );

          if (filingRows.length > 0 && extractedText) {
            const filingId = filingRows[0].id;
            try {
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
              console.log(`Filings email: auto-classified: ${classification.suggestedName || pdfAtt.filename} (${classification.filedBy || "unknown"})`);

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
                      console.log(`Filings email: auto-created hearing deadline: "${hd.description}" on ${hd.date} for case ${caseId}`);
                    }
                  } catch (dlErr) {
                    console.error("Auto-create hearing deadline error:", dlErr.message);
                  }
                }
              }
            } catch (classifyErr) {
              console.error("Filings email auto-classify error:", classifyErr.message);
            }
          }
          console.log(`Filings email: filing created from ${pdfAtt.filename} for case ${caseId}`);
        } catch (pErr) {
          console.error("Filings email PDF processing error:", pErr.message);
        }
      }

      console.log(`Filings email processed: case ${caseId}, court number "${courtCaseNumber}", ${pdfAttachments.length} PDFs`);
      return res.status(200).send("OK");
    }

    const caseMatch = allAddresses.match(/case-(\d+)@/);
    if (!caseMatch) {
      console.log("Inbound email: no case address found in:", allAddresses);
      return res.status(200).send("OK");
    }

    const caseId = parseInt(caseMatch[1]);
    const caseCheck = await pool.query("SELECT id FROM cases WHERE id = $1 AND deleted_at IS NULL", [caseId]);
    if (caseCheck.rows.length === 0) {
      console.log("Inbound email: case not found:", caseId);
      return res.status(200).send("OK");
    }

    const isVoicemail = /voice\s*message/i.test(subject);

    await pool.query(
      `INSERT INTO case_correspondence (case_id, from_email, from_name, to_emails, cc_emails, subject, body_text, body_html, attachments, is_voicemail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [caseId, fromEmail, fromName, to, cc, subject, text, html, JSON.stringify(attachments), isVoicemail]
    );

    if (isVoicemail) {
      console.log(`Voicemail detected from email: "${subject}" for case ${caseId}`);
    }

    console.log(`Inbound email saved: case ${caseId}, from ${fromEmail}, subject "${subject}", ${attachments.length} attachments`);

    const pdfAttachments = attachments.filter(a => a.contentType === "application/pdf");
    for (const pdfAtt of pdfAttachments) {
      try {
        const fileBuffer = Buffer.from(pdfAtt.data, "base64");
        let extractedText = "";
        try {
          extractedText = await extractText(fileBuffer, "application/pdf", pdfAtt.filename);
        } catch (pErr) {
          console.error("PDF text extraction error:", pErr.message);
        }

        const firstPage = extractedText.substring(0, 5000).toUpperCase();
        const filingMarkers = ["NOTICE OF ELECTRONIC FILING", "ALAFILE E-NOTICE"];
        const matchedMarker = filingMarkers.find(m => firstPage.includes(m));
        const isFiling = !!matchedMarker;
        console.log(`PDF triage: "${pdfAtt.filename}" → ${isFiling ? `FILING (${matchedMarker} detected)` : "DOCUMENT (no filing marker)"}`);

        if (isFiling) {
          const { rows: filingRows } = await pool.query(
            `INSERT INTO case_filings (case_id, filename, original_filename, content_type, file_data, extracted_text, file_size, source, source_email_from)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'email', $8)
             RETURNING id`,
            [caseId, pdfAtt.filename, pdfAtt.filename, "application/pdf", fileBuffer, extractedText, pdfAtt.size, fromEmail]
          );

          if (filingRows.length > 0 && extractedText) {
            const filingId = filingRows[0].id;
            try {
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
              console.log(`Filing auto-classified: ${classification.suggestedName || pdfAtt.filename} (${classification.filedBy || "unknown"})`);

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
                      console.log(`Auto-created hearing deadline: "${hd.description}" on ${hd.date} for case ${caseId}`);
                    }
                  } catch (dlErr) {
                    console.error("Auto-create hearing deadline error:", dlErr.message);
                  }
                }
              }
            } catch (classifyErr) {
              console.error("Auto-classify filing error:", classifyErr.message);
            }
          }
          console.log(`PDF filing created from email: ${pdfAtt.filename} for case ${caseId}`);
        } else {
          const { rows: docRows } = await pool.query(
            `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by_name, file_size)
             VALUES ($1, $2, $3, $4, $5, 'Other', $6, $7)
             RETURNING id`,
            [caseId, pdfAtt.filename, "application/pdf", fileBuffer, extractedText, `Email: ${fromEmail}`, pdfAtt.size]
          );

          if (docRows.length > 0 && extractedText) {
            const docId = docRows[0].id;
            try {
              const OpenAI = require("openai");
              const openai = new OpenAI({
                apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
                baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
              });
              const docClassifyPrompt = `You are a document classification assistant for a personal injury law firm. Analyze the document text and classify it. Return ONLY valid JSON with these fields:
- "suggestedName" (string — descriptive document name based on content)
- "docType" (one of: "Police Report", "Medical Records", "Accident Report", "Witness Statement", "Insurance Correspondence", "Expert Report", "Demand Letter", "Settlement Agreement", "Discovery Material", "Court Order", "Billing Records", "Other")`;
              const textSnippet = extractedText.substring(0, 12000);
              const resp = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: docClassifyPrompt },
                  { role: "user", content: `Classify this document:\n\n${textSnippet}` },
                ],
                temperature: 0.3,
                max_tokens: 1000,
                store: false,
                response_format: { type: "json_object" },
              });
              const classification = JSON.parse(resp.choices[0].message.content);
              const sets = [];
              const setVals = [];
              let si = 1;
              if (classification.suggestedName) { sets.push(`filename = $${si++}`); setVals.push(classification.suggestedName); }
              if (classification.docType) { sets.push(`doc_type = $${si++}`); setVals.push(classification.docType); }
              if (sets.length > 0) {
                setVals.push(docId);
                await pool.query(`UPDATE case_documents SET ${sets.join(", ")} WHERE id = $${si}`, setVals);
              }
              console.log(`PDF document auto-classified: ${classification.suggestedName || pdfAtt.filename} (${classification.docType || "Other"})`);
            } catch (classifyErr) {
              console.error("Auto-classify PDF document error:", classifyErr.message);
            }
          }
          console.log(`PDF document created from email: ${pdfAtt.filename} for case ${caseId}`);
        }
      } catch (pdfErr) {
        console.error("Process PDF from email error:", pdfErr.message);
      }
    }

    const audioMimeTypes = [
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/wave", "audio/x-wav",
      "audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac",
      "audio/ogg", "audio/webm", "audio/flac", "audio/x-flac",
      "video/mp4", "video/webm",
    ];
    const audioExts = [".mp3", ".wav", ".m4a", ".ogg", ".webm", ".mp4", ".aac", ".flac"];
    const audioAttachments = attachments.filter(a => {
      if (audioMimeTypes.includes(a.contentType)) return true;
      const ext = (a.filename || "").toLowerCase().match(/\.[^.]+$/);
      return ext && audioExts.includes(ext[0]);
    });
    if (isVoicemail && audioAttachments.length > 0) {
      for (const audioAtt of audioAttachments) {
        try {
          const fileBuffer = Buffer.from(audioAtt.data, "base64");
          await pool.query(
            `INSERT INTO case_voicemails (case_id, caller_name, caller_number, audio_data, audio_mime, received_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [caseId, fromName || "Unknown", "", fileBuffer, audioAtt.contentType]
          );
          console.log(`Voicemail audio saved to case_voicemails: ${audioAtt.filename} for case ${caseId}`);
        } catch (audioErr) {
          console.error("Process voicemail audio error:", audioErr.message);
        }
      }
    } else {
      for (const audioAtt of audioAttachments) {
        try {
          const fileBuffer = Buffer.from(audioAtt.data, "base64");
          const { rows: tRows } = await pool.query(
            `INSERT INTO case_transcripts (case_id, filename, content_type, audio_data, file_size, uploaded_by_name)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [caseId, audioAtt.filename, audioAtt.contentType, fileBuffer, audioAtt.size, `Email: ${fromEmail}`]
          );
          if (tRows.length > 0) {
            const { processTranscription } = require("./transcripts");
            processTranscription(tRows[0].id).catch(err => {
              console.error("Auto-transcription from email failed:", err.message);
            });
            console.log(`Audio transcript created from email: ${audioAtt.filename} for case ${caseId} (auto-transcribing)`);
          }
        } catch (audioErr) {
          console.error("Process audio from email error:", audioErr.message);
        }
      }
    }

    const docTypes = [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
    ];
    const docAttachments = attachments.filter(a => docTypes.includes(a.contentType));
    for (const docAtt of docAttachments) {
      try {
        const fileBuffer = Buffer.from(docAtt.data, "base64");
        let extractedText = "";
        try {
          extractedText = await extractText(fileBuffer, docAtt.contentType, docAtt.filename);
        } catch (eErr) {
          console.error("Doc text extraction error:", eErr.message);
        }

        const { rows: docRows } = await pool.query(
          `INSERT INTO case_documents (case_id, filename, content_type, file_data, extracted_text, doc_type, uploaded_by_name, file_size)
           VALUES ($1, $2, $3, $4, $5, 'Other', $6, $7)
           RETURNING id`,
          [caseId, docAtt.filename, docAtt.contentType, fileBuffer, extractedText, `Email: ${fromEmail}`, docAtt.size]
        );

        if (docRows.length > 0 && extractedText) {
          const docId = docRows[0].id;
          try {
            const OpenAI = require("openai");
            const openai = new OpenAI({
              apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
              baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
            });
            const classifyPrompt = `You are a document classification assistant for a personal injury law firm. Analyze the document text and classify it. Return ONLY valid JSON with these fields:
- "suggestedName" (string — descriptive document name based on content)
- "docType" (one of: "Police Report", "Medical Records", "Accident Report", "Witness Statement", "Insurance Correspondence", "Expert Report", "Demand Letter", "Settlement Agreement", "Discovery Material", "Court Order", "Billing Records", "Other")`;
            const textSnippet = extractedText.substring(0, 12000);
            const resp = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: classifyPrompt },
                { role: "user", content: `Classify this document:\n\n${textSnippet}` },
              ],
              temperature: 0.3,
              max_tokens: 1000,
              store: false,
              response_format: { type: "json_object" },
            });
            const classification = JSON.parse(resp.choices[0].message.content);
            const sets = [];
            const setVals = [];
            let si = 1;
            if (classification.suggestedName) { sets.push(`filename = $${si++}`); setVals.push(classification.suggestedName); }
            if (classification.docType) { sets.push(`doc_type = $${si++}`); setVals.push(classification.docType); }
            if (sets.length > 0) {
              setVals.push(docId);
              await pool.query(`UPDATE case_documents SET ${sets.join(", ")} WHERE id = $${si}`, setVals);
            }
            console.log(`Document auto-classified: ${classification.suggestedName || docAtt.filename} (${classification.docType || "Other"})`);
          } catch (classifyErr) {
            console.error("Auto-classify document error:", classifyErr.message);
          }
        }
        console.log(`Document created from email: ${docAtt.filename} for case ${caseId}`);
      } catch (docErr) {
        console.error("Create document from email error:", docErr.message);
      }
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Inbound email error:", err);
    return res.status(200).send("OK");
  }
});

module.exports = router;
