const express = require("express");
const OpenAI = require("openai");
const pool = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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
        `SELECT ts.*, c.title, c.client_name, c.case_type, c.court, c.judge,
                c.state_jurisdiction, c.injury_type, c.incident_description,
                c.liability_assessment, c.comparative_fault_pct
         FROM trial_sessions ts
         JOIN cases c ON c.id = ts.case_id
         WHERE ts.id = $1`,
        [sessionId]
      );
      if (sessRes.rows.length) {
        const s = sessRes.rows[0];
        caseInfo = `Case: ${s.title}\nClient/Plaintiff: ${s.client_name}\nCase Type: ${s.case_type}\nState: ${s.state_jurisdiction || "Not specified"}\nInjury: ${s.injury_type || "Not specified"}\nIncident: ${s.incident_description || "Not provided"}\nLiability: ${s.liability_assessment || "Not assessed"}\nComparative Fault: ${s.comparative_fault_pct ? s.comparative_fault_pct + "%" : "N/A"}\nCourt: ${s.court}\nJudge: ${s.judge}`;
      }
    }

    const systemPrompt = existingDraft
      ? `You are an experienced personal injury trial attorney. The attorney has a draft cross-examination outline for a witness in a civil/PI trial. Refine and improve it with better questions, stronger impeachment points, and more effective sequencing. Maintain the attorney's approach while strengthening the cross. Consider the applicable state's rules of evidence and civil procedure.`
      : `You are an experienced personal injury trial attorney. You are preparing for cross-examination of a witness in a civil/PI trial. Generate detailed, strategic cross-examination questions and impeachment points. Focus on undermining credibility, exposing inconsistencies, and supporting the plaintiff's theory of liability and damages. Reference applicable rules of evidence where appropriate.`;

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
1. CROSS-EXAMINATION QUESTIONS — 8-12 strategic questions organized by topic, with notes on expected answers and follow-ups
2. IMPEACHMENT POINTS — Specific areas to attack credibility (bias, motive, prior inconsistent statements, perception issues, financial interest)
3. KEY ADMISSIONS TO OBTAIN — Facts the witness must concede that help the plaintiff's case (liability, causation, damages)
4. OBJECTION RISKS — Likely defense objections to your cross-exam lines and how to respond
5. REDIRECT ANTICIPATION — What defense counsel will try to rehabilitate on redirect and how to preempt it`;

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
        `SELECT ts.*, c.title, c.client_name, c.case_type, c.state_jurisdiction,
                c.injury_type, c.incident_description
         FROM trial_sessions ts
         JOIN cases c ON c.id = ts.case_id
         WHERE ts.id = $1`,
        [sessionId]
      );
      if (sessRes.rows.length) {
        const s = sessRes.rows[0];
        caseInfo = `Case: ${s.title}\nClient/Plaintiff: ${s.client_name}\nCase Type: ${s.case_type}\nState: ${s.state_jurisdiction || "Not specified"}\nInjury: ${s.injury_type || "Not specified"}\nIncident: ${s.incident_description || "Not provided"}`;
      }
    }

    const systemPrompt = `You are an expert jury consultant working with a plaintiff's personal injury trial team. Analyze potential juror information and provide strategic guidance for voir dire in a civil PI case. Identify potential biases related to personal injury litigation, insurance, medical treatment, and tort reform. Consider Batson v. Kentucky where relevant. Tailor your analysis to the applicable state's jury selection rules and practices.`;

    const userPrompt = `Analyze this potential juror for jury selection in a personal injury trial:

${jurorName ? `Juror Name: ${jurorName}` : ""}
${seatNumber ? `Seat Number: ${seatNumber}` : ""}
${demographics ? `Demographics: ${demographics}` : ""}
Juror Notes/Responses: ${jurorNotes || "No notes provided"}

${caseInfo ? `Case Context:\n${caseInfo}` : ""}

Provide:
1. BIAS ASSESSMENT — Identify potential biases for or against the plaintiff (rate: Favorable / Neutral / Unfavorable / Strike). Consider attitudes toward lawsuits, insurance companies, medical treatment, and personal responsibility
2. RED FLAGS — Specific concerns: ties to insurance industry, tort reform views, prior jury service in PI cases, skepticism about injury claims, corporate employment
3. FAVORABLE INDICATORS — Signs this juror may be sympathetic: personal injury experience, empathy indicators, distrust of insurance companies, healthcare workers
4. FOLLOW-UP VOIR DIRE QUESTIONS — 5-8 specific questions to ask this juror, focusing on attitudes toward PI litigation, damages, and insurance
5. STRIKE RECOMMENDATION — Whether to use a peremptory strike, challenge for cause, or keep this juror, with reasoning
6. REHABILITATION RISK — If challenged for cause, how likely defense counsel can rehabilitate this juror`;

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

    const systemPrompt = `You are an expert trial attorney and evidence law professor with expertise in civil trial procedure and the rules of evidence. Given a trial scenario from a personal injury case, identify all applicable objections with specific rule citations. Provide both offensive objections (to make) and defensive responses (if opposing counsel objects). Cite the applicable Federal Rules of Evidence or state equivalents. Consider common PI trial issues like medical evidence, expert testimony (Daubert/Frye), insurance references, and damages evidence.`;

    const userPrompt = `Analyze this trial scenario for applicable objections in a personal injury trial:

Scenario: ${scenario}

${caseContext ? `Case Context: ${caseContext}` : ""}

Provide:
1. APPLICABLE OBJECTIONS — List each objection with:
   - Objection name and Rules of Evidence citation (e.g., "Hearsay — FRE 801, 802" or applicable state rule)
   - When to raise it (specific trigger words or actions)
   - Exact language to use when objecting
   - Likelihood of being sustained (High/Medium/Low)
2. EXCEPTIONS & RESPONSES — If opposing counsel raises these objections against you:
   - Available exceptions or workarounds (e.g., hearsay exceptions under Rule 803, 804, business records, medical records)
   - Offer of proof strategies
3. STRATEGIC CONSIDERATIONS — Whether to object or let it go for tactical reasons
4. PRESERVATION FOR APPEAL — What needs to be on the record to preserve the issue
5. RELATED CASE LAW — Relevant appellate decisions on these evidentiary issues in PI cases`;

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
          `SELECT ts.*, c.title, c.client_name, c.case_type, c.court, c.judge,
                  c.state_jurisdiction, c.injury_type, c.injury_description,
                  c.incident_description, c.incident_location, c.liability_assessment,
                  c.comparative_fault_pct, c.case_value_estimate, c.demand_amount
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
Client/Plaintiff: ${s.client_name}
Case Type: ${s.case_type} | State: ${s.state_jurisdiction || "Not specified"}
Injury: ${s.injury_type || "Not specified"} — ${s.injury_description || "Not provided"}
Incident: ${s.incident_description || "Not provided"}
Location: ${s.incident_location || "Not specified"}
Liability: ${s.liability_assessment || "Not assessed"}
Comparative Fault: ${s.comparative_fault_pct ? s.comparative_fault_pct + "%" : "N/A"}
Case Value: ${s.case_value_estimate ? "$" + s.case_value_estimate : "Not estimated"}
Demand: ${s.demand_amount ? "$" + s.demand_amount : "Not set"}
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
      ? `You are a master plaintiff's personal injury trial attorney helping refine an opening statement for a civil PI trial. The attorney has provided a draft opening statement. Review it and provide a refined, improved version that strengthens the narrative, improves persuasive elements, and ensures it follows best practices for plaintiff's opening statements in personal injury cases. Maintain the attorney's voice and core theory while enhancing impact.`
      : `You are a master plaintiff's personal injury trial attorney preparing an opening statement for a civil PI trial. Craft a compelling, persuasive opening statement outline that introduces the plaintiff's story, establishes liability, and previews the damages evidence the jury will hear. Use storytelling techniques that create empathy and connection with the jury.`;

    let userPrompt = existingDraft
      ? `Refine and improve this opening statement draft:\n\n--- EXISTING DRAFT ---\n${existingDraft}\n--- END DRAFT ---\n\nTrial Data:\n${trialData || caseContext}`
      : `Build an opening statement outline based on the following trial data:\n\n${trialData || caseContext}`;

    if (customInstructions) userPrompt += `\n\nAdditional Instructions: ${customInstructions}`;

    userPrompt += `\n\nProvide:
1. OPENING HOOK/THEME — A powerful opening line or theme that frames the entire case and connects to the jury's values
2. CLIENT INTRODUCTION — Humanize the plaintiff; who they were before the accident and how their life has changed
3. THE INCIDENT — Clear, vivid narrative of what happened, establishing the defendant's negligence
4. INJURIES & IMPACT — Preview the medical evidence and the real-world impact on the client's life
5. PROMISE OF EVIDENCE — Preview the evidence the jury will hear that supports liability and damages
6. WITNESS PREVIEW — Brief preview of key witnesses and what they will establish
7. DAMAGES FRAMEWORK — Set up the jury to understand the full scope of damages (economic and non-economic)
8. ADDRESSING ANTICIPATED DEFENSE ARGUMENTS — Acknowledge and preemptively address the defense's likely arguments (comparative fault, pre-existing conditions, etc.)
9. CLOSING THEME — Tie back to the opening hook; set up what you will ask for in closing`;

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
          `SELECT ts.*, c.title, c.client_name, c.case_type, c.court, c.judge,
                  c.state_jurisdiction, c.injury_type, c.injury_description,
                  c.incident_description, c.liability_assessment,
                  c.case_value_estimate, c.demand_amount
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
Client/Plaintiff: ${s.client_name}
Case Type: ${s.case_type} | State: ${s.state_jurisdiction || "Not specified"}
Injury: ${s.injury_type || "Not specified"} — ${s.injury_description || "Not provided"}
Incident: ${s.incident_description || "Not provided"}
Liability: ${s.liability_assessment || "Not assessed"}
Case Value: ${s.case_value_estimate ? "$" + s.case_value_estimate : "Not estimated"}
Demand: ${s.demand_amount ? "$" + s.demand_amount : "Not set"}
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
      ? `You are a master plaintiff's personal injury trial attorney helping refine a closing argument for a civil PI trial. The attorney has provided a draft closing argument. Review it and provide a refined, improved version that strengthens persuasive elements, tightens the narrative, and ensures maximum impact with the jury. Maintain the attorney's voice and core theory while enhancing impact.`
      : `You are a master plaintiff's personal injury trial attorney preparing a closing argument for a civil PI trial. Build a compelling, persuasive closing argument outline that weaves together the evidence, witness testimony, medical evidence, and the plaintiff's story. Reference specific evidence and testimony. Use rhetorical techniques that connect with jurors' sense of justice and fairness.`;

    let userPrompt = existingDraft
      ? `Refine and improve this closing argument draft:\n\n--- EXISTING DRAFT ---\n${existingDraft}\n--- END DRAFT ---\n\nTrial Data:\n${trialData || caseContext}`
      : `Build a closing argument outline based on the following trial data:\n\n${trialData || caseContext}`;

    if (customInstructions) userPrompt += `\nAdditional Instructions: ${customInstructions}`;

    userPrompt += `\n\nProvide:
1. OPENING HOOK — A powerful opening theme or statement that captures the case's essence
2. LIABILITY SUMMARY — Walk through the evidence proving the defendant's negligence (duty, breach, causation)
3. EVIDENCE ANALYSIS — Highlight the key evidence and how it supports the plaintiff's case
4. WITNESS CREDIBILITY — Address each key witness's credibility and what their testimony established
5. DAMAGES PRESENTATION — Break down economic damages (medical bills, lost wages, future costs) and non-economic damages (pain, suffering, loss of enjoyment)
6. EXHIBIT REFERENCES — How to use admitted exhibits to support the damages claim
7. ADDRESSING DEFENSE ARGUMENTS — Preemptive responses to comparative fault, pre-existing conditions, and other defense arguments
8. THE ASK — Clear, specific damages amount with rationale for each category (use per diem or multiplier arguments as appropriate)
9. CLOSING THEME — Emotional appeal connecting to justice, accountability, and making the client whole`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'closing-builder');
    res.json({ result });
  } catch (err) {
    console.error("Closing builder error:", err);
    res.status(500).json({ error: "AI closing argument builder failed" });
  }
});

router.post("/jury-instructions", requireAuth, async (req, res) => {
  try {
    const { sessionId, caseType, defenseTheory, plaintiffTheory, requestedInstructions, caseContext } = req.body;

    let caseDetails = "";
    let existingInstructions = "";

    if (sessionId) {
      const [sessRes, instrRes] = await Promise.all([
        pool.query(
          `SELECT ts.*, c.title, c.client_name, c.case_type, c.state_jurisdiction,
                  c.injury_type, c.liability_assessment, c.comparative_fault_pct
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
        caseDetails = `Case Type: ${s.case_type || "Personal Injury"}\nState: ${s.state_jurisdiction || "Not specified"}\nInjury: ${s.injury_type || "Not specified"}\nLiability: ${s.liability_assessment || "Not assessed"}\nComparative Fault: ${s.comparative_fault_pct ? s.comparative_fault_pct + "%" : "N/A"}`;
      }

      if (instrRes.rows.length) {
        existingInstructions = instrRes.rows.map(i =>
          `- [${i.status}] ${(i.instruction_text || "").substring(0, 200)}${i.source ? ` (Source: ${i.source})` : ""}`
        ).join("\n");
      }
    }

    if (!caseDetails && caseType) {
      caseDetails = `Case Type: ${caseType}`;
    }

    if (!caseDetails && !caseContext) {
      return res.status(400).json({ error: "sessionId, caseType, or caseContext required" });
    }

    const systemPrompt = `You are a civil litigation expert specializing in jury instructions for personal injury trials. Based on the case type, claims, and theories, recommend appropriate jury instructions following the applicable state's pattern civil jury instructions and/or federal pattern jury instructions. Identify both standard instructions and special instructions that should be requested by the plaintiff. Consider negligence, comparative fault, damages (economic and non-economic), causation, and any special doctrines applicable to the case type.`;

    const userPrompt = `Review and recommend jury instructions for this personal injury case:

${caseDetails}

${plaintiffTheory ? `Plaintiff's Theory: ${plaintiffTheory}` : ""}
${defenseTheory ? `Anticipated Defense Theory: ${defenseTheory}` : ""}
${requestedInstructions ? `Already Requested Instructions: ${requestedInstructions}` : ""}
${existingInstructions ? `Existing Instructions in Case:\n${existingInstructions}` : ""}
${caseContext ? `Additional Context: ${caseContext}` : ""}

Provide:
1. REQUIRED STANDARD INSTRUCTIONS — Instructions that must be given for this type of civil case (negligence, burden of proof, proximate cause)
2. COMPARATIVE FAULT INSTRUCTIONS — Instructions on the applicable comparative/contributory fault standard for this jurisdiction
3. DAMAGES INSTRUCTIONS — Instructions for economic damages, non-economic damages, future damages, mitigation of damages
4. PLAINTIFF-SPECIFIC INSTRUCTIONS — Instructions supporting the plaintiff's theory (res ipsa loquitur, negligence per se, spoliation, etc.)
5. CAUSATION INSTRUCTIONS — Instructions on proximate cause, concurrent causation, aggravation of pre-existing condition
6. INSTRUCTIONS TO OBJECT TO — Any defense-requested instructions that should be opposed (e.g., overly broad mitigation, improper collateral source references)
7. PRESERVATION NOTES — How to properly preserve objections to refused instructions for appeal`;

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

    const systemPrompt = `You are a personal injury legal research specialist with deep expertise in tort law, negligence, products liability, premises liability, medical malpractice, and insurance law across U.S. jurisdictions. Given a legal issue, provide relevant case law citations, statutes, and rules. Focus on landmark decisions from the applicable state and federal courts. Include U.S. Supreme Court cases where relevant.
IMPORTANT: Only cite real cases and real statutes. If you are not confident a citation is accurate, indicate that it should be verified. Always include the year and court for each citation.`;

    const userPrompt = `Research the following legal issue:

Legal Issue: ${legalIssue}

${caseContext ? `Case Context: ${caseContext}` : ""}

Provide:
1. KEY CASES — Most relevant appellate decisions with full citations, holdings, and how they apply to PI litigation
2. FEDERAL AUTHORITY — Relevant U.S. Supreme Court and federal circuit decisions
3. APPLICABLE STATUTES — Relevant state statutes and code sections with key text
4. RULES OF PROCEDURE & EVIDENCE — Relevant civil procedure rules and evidentiary rules
5. TORT LAW PRINCIPLES — Applicable tort doctrines (negligence, strict liability, vicarious liability, etc.)
6. PRACTICE TIPS — How to effectively argue this issue in a PI case
7. OPPOSING ARGUMENTS — What the defense will likely argue and how to counter it`;

    const result = await aiCall(systemPrompt, userPrompt, false, req.session.userId, 'case-law-search');
    res.json({ result });
  } catch (err) {
    console.error("Case law search error:", err);
    res.status(500).json({ error: "AI case law search failed" });
  }
});

module.exports = router;
