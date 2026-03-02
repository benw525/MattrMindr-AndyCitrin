const express = require("express");
const OpenAI = require("openai");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

async function getTrainingContext(userId, agentId = null) {
  try {
    let result;
    if (!agentId) {
      result = await pool.query(
        `SELECT category, title, content FROM ai_training
         WHERE active = true AND (scope = 'office' OR (scope = 'personal' AND user_id = $1))
         ORDER BY scope DESC, created_at ASC`,
        [userId]
      );
    } else {
      result = await pool.query(
        `SELECT category, title, content FROM ai_training
         WHERE active = true AND (scope = 'office' OR (scope = 'personal' AND user_id = $1))
           AND ('all' = ANY(COALESCE(target_agents, '{all}')) OR $2 = ANY(COALESCE(target_agents, '{all}')))
         ORDER BY scope DESC, created_at ASC`,
        [userId, agentId]
      );
    }
    if (result.rows.length === 0) return "";
    let block = "\n\n=== CUSTOM TRAINING & GUIDELINES ===";
    let totalLen = 0;
    const MAX_TRAINING_CHARS = 8000;
    for (const row of result.rows) {
      const entry = `\n[${row.category}] ${row.title}: ${row.content}`;
      if (totalLen + entry.length > MAX_TRAINING_CHARS) {
        block += `\n[${row.category}] ${row.title}: ${row.content.substring(0, MAX_TRAINING_CHARS - totalLen - 100)}...`;
        break;
      }
      block += entry;
      totalLen += entry.length;
    }
    return block;
  } catch (err) {
    console.error("Training context load error:", err);
    return "";
  }
}

const NO_MARKDOWN = "\n\nIMPORTANT FORMATTING RULE: Do NOT use any markdown formatting in your response. No hashtags (#, ##, ###), no asterisks (* or **), no bullet symbols. Use plain text only. Use line breaks and numbered lists (1. 2. 3.) for structure. Use ALL CAPS for section headings instead of hashtags.";

async function aiCall(systemPrompt, userPrompt, jsonMode = false, userId = null, agentId = null) {
  let finalPrompt = systemPrompt + (jsonMode ? "" : NO_MARKDOWN);
  if (userId) {
    const training = await getTrainingContext(userId, agentId);
    if (training) finalPrompt += training;
  }
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: finalPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4000,
    store: false,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });
  return resp.choices[0].message.content;
}

router.post("/witness-prep", requireAuth, async (req, res) => {
  try {
    const { sessionId, witnessName, witnessType, expectedTestimony, caseContext, impeachmentNotes, existingDraft } = req.body;
    if (!witnessName) return res.status(400).json({ error: "witnessName is required" });

    let caseInfo = caseContext || "";
    if (sessionId && !caseInfo) {
      const sessRes = await pool.query(
        `SELECT ts.*, c.title, c.defendant_name, c.charge_description, c.charge_statute,
                c.charge_class, c.case_type, c.court, c.judge, c.charges
         FROM trial_sessions ts
         JOIN cases c ON c.id = ts.case_id
         WHERE ts.id = $1`,
        [sessionId]
      );
      if (sessRes.rows.length) {
        const s = sessRes.rows[0];
        const charges = (s.charges || []).map((ch, i) =>
          `${i + 1}. ${ch.description || ""} (${ch.statute || ""}) — ${ch.class || ""}`
        ).join("\n") || "Not specified";
        caseInfo = `Case: ${s.title}\nDefendant: ${s.defendant_name}\nCharges:\n${charges}\nCourt: ${s.court}\nJudge: ${s.judge}`;
      }
    }

    const systemPrompt = existingDraft
      ? `You are an experienced criminal defense trial attorney specializing in Alabama criminal law. The attorney has a draft cross-examination outline for a witness. Refine and improve it with better questions, stronger impeachment points, and more effective sequencing. Maintain the attorney's approach while strengthening the cross. `
      : `You are an experienced criminal defense trial attorney specializing in Alabama criminal law. You are preparing for cross-examination of a witness. Generate detailed, strategic cross-examination questions and impeachment points. Focus on undermining credibility, exposing inconsistencies, and supporting the defense theory. Reference Alabama Rules of Evidence where applicable.`;

    let userPrompt = existingDraft
      ? `Refine and improve this cross-examination outline:\n\n--- EXISTING DRAFT ---\n${existingDraft}\n--- END DRAFT ---\n\n`
      : "";

    userPrompt += `Prepare cross-examination material for the following witness:

Witness Name: ${witnessName}
Witness Type: ${witnessType || "Unknown"}
Expected Testimony: ${expectedTestimony || "Not provided"}
${impeachmentNotes ? `Known Impeachment Material: ${impeachmentNotes}` : ""}

${caseInfo ? `Case Context:\n${caseInfo}` : ""}

Provide:
1. **Cross-Examination Questions** — 8-12 strategic questions organized by topic, with notes on expected answers and follow-ups
2. **Impeachment Points** — Specific areas to attack credibility (bias, motive, prior inconsistent statements, perception issues, character)
3. **Key Admissions to Obtain** — Facts the witness must concede that help the defense
4. **Objection Risks** — Likely prosecution objections to your cross-exam lines and how to respond
5. **Redirect Anticipation** — What the prosecution will try to rehabilitate on redirect and how to preempt it`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'witness-prep');
    res.json({ result });
  } catch (err) {
    console.error("Witness prep error:", err);
    res.status(500).json({ error: "AI witness preparation failed" });
  }
});

router.post("/jury-selection", requireAuth, async (req, res) => {
  try {
    const { sessionId, jurorName, jurorNotes, demographics, seatNumber, caseContext } = req.body;
    if (!jurorNotes && !jurorName) return res.status(400).json({ error: "jurorName or jurorNotes required" });

    let caseInfo = caseContext || "";
    if (sessionId && !caseInfo) {
      const sessRes = await pool.query(
        `SELECT ts.*, c.title, c.defendant_name, c.charge_description, c.case_type, c.charges
         FROM trial_sessions ts
         JOIN cases c ON c.id = ts.case_id
         WHERE ts.id = $1`,
        [sessionId]
      );
      if (sessRes.rows.length) {
        const s = sessRes.rows[0];
        const charges = (s.charges || []).map((ch, i) =>
          `${i + 1}. ${ch.description || ""} (${ch.statute || ""}) — ${ch.class || ""}`
        ).join("\n") || "Not specified";
        caseInfo = `Case: ${s.title}\nDefendant: ${s.defendant_name}\nCharges:\n${charges}\nCase Type: ${s.case_type}`;
      }
    }

    const systemPrompt = `You are an expert jury consultant working with a criminal defense team in Alabama. Analyze potential juror information and provide strategic guidance for voir dire. Identify potential biases, red flags, and favorable indicators. Reference Batson v. Kentucky considerations where relevant. `;

    const userPrompt = `Analyze this potential juror for jury selection:

${jurorName ? `Juror Name: ${jurorName}` : ""}
${seatNumber ? `Seat Number: ${seatNumber}` : ""}
${demographics ? `Demographics: ${demographics}` : ""}
Juror Notes/Responses: ${jurorNotes || "No notes provided"}

${caseInfo ? `Case Context:\n${caseInfo}` : ""}

Provide:
1. **Bias Assessment** — Identify potential biases for or against the defense (rate: Favorable / Neutral / Unfavorable / Strike)
2. **Red Flags** — Specific concerns that suggest this juror may be problematic for the defense
3. **Favorable Indicators** — Signs this juror may be sympathetic to the defense
4. **Follow-Up Voir Dire Questions** — 5-8 specific questions to ask this juror to better evaluate them
5. **Strike Recommendation** — Whether to use a peremptory strike, challenge for cause, or keep this juror, with reasoning
6. **Rehabilitation Risk** — If challenged for cause, how likely the prosecution can rehabilitate this juror`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'jury-selection');
    res.json({ result });
  } catch (err) {
    console.error("Jury selection error:", err);
    res.status(500).json({ error: "AI jury selection analysis failed" });
  }
});

router.post("/objection-coach", requireAuth, async (req, res) => {
  try {
    const { scenario, caseContext } = req.body;
    if (!scenario) return res.status(400).json({ error: "scenario is required" });

    const systemPrompt = `You are an expert trial attorney and evidence law professor specializing in Alabama Rules of Evidence and Alabama criminal procedure. Given a trial scenario, identify all applicable objections with specific rule citations. Provide both offensive objections (to make) and defensive responses (if opposing counsel objects). Always cite the specific Alabama Rule of Evidence or Alabama Rule of Criminal Procedure. `;

    const userPrompt = `Analyze this trial scenario for applicable objections:

Scenario: ${scenario}

${caseContext ? `Case Context: ${caseContext}` : ""}

Provide:
1. **Applicable Objections** — List each objection with:
   - Objection name and Alabama Rules of Evidence citation (e.g., "Hearsay — Ala. R. Evid. 801, 802")
   - When to raise it (specific trigger words or actions)
   - Exact language to use when objecting
   - Likelihood of being sustained (High/Medium/Low)
2. **Exceptions & Responses** — If opposing counsel raises these objections against you:
   - Available exceptions or workarounds (e.g., hearsay exceptions under Rule 803, 804)
   - Offer of proof strategies
3. **Strategic Considerations** — Whether to object or let it go for tactical reasons
4. **Preservation for Appeal** — What needs to be on the record to preserve the issue
5. **Related Alabama Case Law** — Relevant Alabama appellate decisions on these evidentiary issues`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'objection-coach');
    res.json({ result });
  } catch (err) {
    console.error("Objection coach error:", err);
    res.status(500).json({ error: "AI objection analysis failed" });
  }
});

router.post("/opening-builder", requireAuth, async (req, res) => {
  try {
    const { sessionId, caseContext, customInstructions, existingDraft } = req.body;

    let trialData = "";
    if (sessionId) {
      const [sessRes, witnessRes, exhibitRes, motionRes] = await Promise.all([
        pool.query(
          `SELECT ts.*, c.title, c.defendant_name, c.charge_description, c.charge_statute,
                  c.charge_class, c.case_type, c.court, c.judge, c.charges
           FROM trial_sessions ts
           JOIN cases c ON c.id = ts.case_id
           WHERE ts.id = $1`,
          [sessionId]
        ),
        pool.query(
          `SELECT name, type, expected_testimony, status FROM trial_witnesses WHERE trial_session_id = $1 ORDER BY call_order`,
          [sessionId]
        ),
        pool.query(
          `SELECT exhibit_number, description, type, status FROM trial_exhibits WHERE trial_session_id = $1 ORDER BY exhibit_number`,
          [sessionId]
        ),
        pool.query(
          `SELECT title, type, status, ruling_summary FROM trial_motions WHERE trial_session_id = $1`,
          [sessionId]
        ),
      ]);

      if (sessRes.rows.length) {
        const s = sessRes.rows[0];
        const charges = (s.charges || []).map((ch, i) =>
          `${i + 1}. ${ch.description || ""} (${ch.statute || ""}) — ${ch.class || ""}`
        ).join("\n") || "Not specified";

        const witnesses = witnessRes.rows.map(w =>
          `- ${w.name} (${w.type}, ${w.status}): ${(w.expected_testimony || "").substring(0, 200)}`
        ).join("\n") || "No witnesses";

        const exhibits = exhibitRes.rows.map(e =>
          `- Exhibit ${e.exhibit_number}: ${e.description} (${e.type}, ${e.status})`
        ).join("\n") || "No exhibits";

        const motions = motionRes.rows.map(m =>
          `- ${m.title} (${m.type}, ${m.status})${m.ruling_summary ? ": " + m.ruling_summary : ""}`
        ).join("\n") || "No motions";

        trialData = `Case: ${s.title}
Defendant: ${s.defendant_name}
Charges:
${charges}
Court: ${s.court} | Judge: ${s.judge}

Witnesses:
${witnesses}

Exhibits:
${exhibits}

Motions & Rulings:
${motions}`;
      }
    }

    if (!trialData && !caseContext) {
      return res.status(400).json({ error: "sessionId or caseContext required" });
    }

    const systemPrompt = existingDraft
      ? `You are a master criminal defense trial attorney helping refine an opening statement for an Alabama criminal trial. The attorney has provided a draft opening statement. Review it and provide a refined, improved version that strengthens the narrative, improves persuasive elements, and ensures it follows best practices for Alabama criminal defense opening statements. Maintain the attorney's voice and core theory while enhancing impact. `
      : `You are a master criminal defense trial attorney preparing an opening statement for an Alabama criminal trial. Craft a compelling, persuasive opening statement outline that introduces the defense theory, humanizes the defendant, and sets up the evidence the jury will hear. Use storytelling techniques effective with Alabama juries. `;

    let userPrompt = existingDraft
      ? `Refine and improve this opening statement draft:\n\n--- EXISTING DRAFT ---\n${existingDraft}\n--- END DRAFT ---\n\nTrial Data:\n${trialData || caseContext}`
      : `Build an opening statement outline based on the following trial data:\n\n${trialData || caseContext}`;

    if (customInstructions) userPrompt += `\n\nAdditional Instructions: ${customInstructions}`;

    userPrompt += `\n\nProvide:
1. **Opening Hook/Theme** — A powerful opening line or theme that frames the entire case
2. **Defendant Introduction** — Humanize the defendant; who they are beyond the charges
3. **Theory of the Case** — Clear, simple narrative of what happened from the defense perspective
4. **Promise of Evidence** — Preview the evidence the jury will hear that supports the defense
5. **Witness Preview** — Brief preview of key witnesses and what they will establish
6. **Burden of Proof Framework** — Introduce reasonable doubt concepts early
7. **Addressing Anticipated State Evidence** — Acknowledge and reframe the State's strongest points
8. **Emotional Foundation** — Connect with jurors' values of fairness and justice
9. **Closing Theme** — Tie back to the opening hook; set up what you will ask in closing`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'opening-builder');
    res.json({ result });
  } catch (err) {
    console.error("Opening builder error:", err);
    res.status(500).json({ error: "AI opening statement builder failed" });
  }
});

router.post("/closing-builder", requireAuth, async (req, res) => {
  try {
    const { sessionId, caseContext, customInstructions, existingDraft } = req.body;

    let trialData = "";
    if (sessionId) {
      const [sessRes, witnessRes, exhibitRes, logRes, motionRes] = await Promise.all([
        pool.query(
          `SELECT ts.*, c.title, c.defendant_name, c.charge_description, c.charge_statute,
                  c.charge_class, c.case_type, c.court, c.judge, c.charges
           FROM trial_sessions ts
           JOIN cases c ON c.id = ts.case_id
           WHERE ts.id = $1`,
          [sessionId]
        ),
        pool.query(
          `SELECT name, type, expected_testimony, status FROM trial_witnesses WHERE trial_session_id = $1 ORDER BY call_order`,
          [sessionId]
        ),
        pool.query(
          `SELECT exhibit_number, description, type, status FROM trial_exhibits WHERE trial_session_id = $1 ORDER BY exhibit_number`,
          [sessionId]
        ),
        pool.query(
          `SELECT trial_day, category, content FROM trial_log_entries WHERE trial_session_id = $1 ORDER BY trial_day, entry_time`,
          [sessionId]
        ),
        pool.query(
          `SELECT title, type, status, ruling_summary FROM trial_motions WHERE trial_session_id = $1`,
          [sessionId]
        ),
      ]);

      if (sessRes.rows.length) {
        const s = sessRes.rows[0];
        const charges = (s.charges || []).map((ch, i) =>
          `${i + 1}. ${ch.description || ""} (${ch.statute || ""}) — ${ch.class || ""}`
        ).join("\n") || "Not specified";

        const witnesses = witnessRes.rows.map(w =>
          `- ${w.name} (${w.type}, ${w.status}): ${(w.expected_testimony || "").substring(0, 200)}`
        ).join("\n") || "No witnesses";

        const exhibits = exhibitRes.rows.map(e =>
          `- Exhibit ${e.exhibit_number}: ${e.description} (${e.type}, ${e.status})`
        ).join("\n") || "No exhibits";

        const logEntries = logRes.rows.map(l =>
          `[Day ${l.trial_day}][${l.category}] ${(l.content || "").substring(0, 200)}`
        ).join("\n") || "No log entries";

        const motions = motionRes.rows.map(m =>
          `- ${m.title} (${m.type}, ${m.status})${m.ruling_summary ? ": " + m.ruling_summary : ""}`
        ).join("\n") || "No motions";

        trialData = `Case: ${s.title}
Defendant: ${s.defendant_name}
Charges:
${charges}
Court: ${s.court} | Judge: ${s.judge}

Witnesses:
${witnesses}

Exhibits:
${exhibits}

Motions & Rulings:
${motions}

Trial Log:
${logEntries}`;
      }
    }

    if (!trialData && !caseContext) {
      return res.status(400).json({ error: "sessionId or caseContext required" });
    }

    const systemPrompt = existingDraft
      ? `You are a master criminal defense trial attorney helping refine a closing argument for an Alabama criminal trial. The attorney has provided a draft closing argument. Review it and provide a refined, improved version that strengthens persuasive elements, tightens the narrative, and ensures maximum impact with the jury. Maintain the attorney's voice and core theory while enhancing impact. `
      : `You are a master criminal defense trial attorney preparing a closing argument for an Alabama criminal trial. Build a compelling, persuasive closing argument outline that weaves together the evidence, witness testimony, and defense theory. Reference specific evidence and testimony. Use rhetorical techniques effective with Alabama juries. `;

    let userPrompt = existingDraft
      ? `Refine and improve this closing argument draft:\n\n--- EXISTING DRAFT ---\n${existingDraft}\n--- END DRAFT ---\n\nTrial Data:\n${trialData || caseContext}`
      : `Build a closing argument outline based on the following trial data:\n\n${trialData || caseContext}`;

    if (customInstructions) userPrompt += `\nAdditional Instructions: ${customInstructions}`;

    userPrompt += `\n\nProvide:
1. **Opening Hook** — A powerful opening theme or statement to frame the closing
2. **Burden of Proof Reminder** — Emphasis on reasonable doubt and the State's burden
3. **Evidence Analysis** — Walk through the key evidence, highlighting weaknesses in the prosecution's case
4. **Witness Credibility** — Address each key witness's credibility, inconsistencies, and motivations
5. **Defense Theory** — Clear articulation of the defense narrative
6. **Exhibit References** — How to use admitted exhibits to support the defense
7. **Addressing the State's Strongest Points** — Preemptive responses to the prosecution's best arguments
8. **Emotional Appeal** — Connection to jurors' sense of justice and fairness
9. **Closing Theme** — Tie back to the opening hook and deliver the final ask for acquittal`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'closing-builder');
    res.json({ result });
  } catch (err) {
    console.error("Closing builder error:", err);
    res.status(500).json({ error: "AI closing argument builder failed" });
  }
});

router.post("/jury-instructions", requireAuth, async (req, res) => {
  try {
    const { sessionId, charges, defenseTheory, requestedInstructions, caseContext } = req.body;

    let chargesText = "";
    let existingInstructions = "";

    if (sessionId) {
      const [sessRes, instrRes] = await Promise.all([
        pool.query(
          `SELECT ts.*, c.title, c.defendant_name, c.charges, c.charge_description, c.charge_class
           FROM trial_sessions ts
           JOIN cases c ON c.id = ts.case_id
           WHERE ts.id = $1`,
          [sessionId]
        ),
        pool.query(
          `SELECT instruction_text, status, source FROM trial_jury_instructions WHERE trial_session_id = $1`,
          [sessionId]
        ),
      ]);

      if (sessRes.rows.length) {
        const s = sessRes.rows[0];
        chargesText = (s.charges || []).map((ch, i) =>
          `${i + 1}. ${ch.description || ""} (${ch.statute || ""}) — ${ch.class || ""}`
        ).join("\n") || s.charge_description || "Not specified";
      }

      if (instrRes.rows.length) {
        existingInstructions = instrRes.rows.map(i =>
          `- [${i.status}] ${(i.instruction_text || "").substring(0, 200)}${i.source ? ` (Source: ${i.source})` : ""}`
        ).join("\n");
      }
    }

    if (!chargesText && charges) {
      chargesText = Array.isArray(charges) ? charges.map((ch, i) =>
        `${i + 1}. ${ch.description || ch} (${ch.statute || ""}) — ${ch.class || ""}`
      ).join("\n") : charges;
    }

    if (!chargesText && !caseContext) {
      return res.status(400).json({ error: "sessionId, charges, or caseContext required" });
    }

    const systemPrompt = `You are an Alabama criminal law expert specializing in jury instructions. Based on the charges and defense theory, recommend appropriate jury instructions following Alabama Pattern Jury Instructions — Criminal. Cite specific APJI numbers and Alabama Code sections. Identify both standard instructions and any special defense instructions that should be requested. `;

    const userPrompt = `Review and recommend jury instructions for this case:

Charges:
${chargesText}

${defenseTheory ? `Defense Theory: ${defenseTheory}` : ""}
${requestedInstructions ? `Already Requested Instructions: ${requestedInstructions}` : ""}
${existingInstructions ? `Existing Instructions in Case:\n${existingInstructions}` : ""}
${caseContext ? `Additional Context: ${caseContext}` : ""}

Provide:
1. **Required Standard Instructions** — Instructions that must be given for these charges (cite APJI numbers)
2. **Lesser Included Offense Instructions** — Any lesser included offenses the defense should request and why
3. **Defense-Specific Instructions** — Instructions supporting the defense theory (self-defense, alibi, mental state, etc.)
4. **Burden of Proof Instructions** — Recommended language emphasizing reasonable doubt
5. **Cautionary Instructions** — Instructions regarding witness credibility, eyewitness identification, accomplice testimony, etc.
6. **Instructions to Object To** — Any prosecution-requested instructions that should be opposed and grounds for objection
7. **Preservation Notes** — How to properly preserve objections to refused instructions for appeal`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'jury-instructions');
    res.json({ result });
  } catch (err) {
    console.error("Jury instructions error:", err);
    res.status(500).json({ error: "AI jury instructions analysis failed" });
  }
});

router.post("/case-law-search", requireAuth, async (req, res) => {
  try {
    const { legalIssue, caseContext } = req.body;
    if (!legalIssue) return res.status(400).json({ error: "legalIssue is required" });

    const systemPrompt = `You are a criminal defense legal research specialist with deep expertise in Alabama case law, Alabama Rules of Evidence, Alabama Rules of Criminal Procedure, and federal constitutional law as applied in Alabama courts. Given a legal issue, provide relevant case law citations, statutes, and rules. Focus primarily on Alabama Supreme Court and Alabama Court of Criminal Appeals decisions. Include federal circuit (11th Circuit) and U.S. Supreme Court cases where relevant. 
IMPORTANT: Only cite real cases and real statutes. If you are not confident a citation is accurate, indicate that it should be verified. Always include the year and court for each citation.`;

    const userPrompt = `Research the following legal issue:

Legal Issue: ${legalIssue}

${caseContext ? `Case Context: ${caseContext}` : ""}

Provide:
1. **Key Alabama Cases** — Most relevant Alabama appellate decisions with full citations, holdings, and how they apply
2. **Federal Authority** — Relevant U.S. Supreme Court and 11th Circuit decisions
3. **Alabama Statutes** — Applicable Alabama Code sections with relevant text
4. **Alabama Rules** — Relevant Rules of Evidence or Criminal Procedure
5. **Constitutional Issues** — Any constitutional dimensions (4th, 5th, 6th, 8th, 14th Amendment)
6. **Practice Tips** — How to effectively argue this issue in Alabama courts
7. **Opposing Arguments** — What the State will likely argue and how to counter it`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'case-law-search');
    res.json({ result });
  } catch (err) {
    console.error("Case law search error:", err);
    res.status(500).json({ error: "AI case law search failed" });
  }
});

module.exports = router;
