const fs   = require("fs");
const path = require("path");
const vm   = require("vm");
const pool = require("./db");

// Load firmData.js from the React src folder and parse it in a sandbox
const firmDataSrc = fs.readFileSync(
  path.join(__dirname, "../lextrack/src/firmData.js"), "utf8"
).replace(/export const /g, "var ");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(firmDataSrc, sandbox);
const { USERS, CASES, DEADLINES } = sandbox;

const orNull = (val) => (val && String(val).trim() && String(val) !== "0") ? val : null;

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Users
    console.log(`Seeding ${USERS.length} users...`);
    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (id, name, role, email, initials, phone, cell, avatar)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name=$2, role=$3, email=$4, initials=$5, phone=$6, cell=$7, avatar=$8`,
        [u.id, u.name, u.role, u.email, u.initials, u.phone || "", u.cell || "", u.avatar || "#4C7AC9"]
      );
    }

    // Cases — use OVERWRITE ON CONFLICT so re-seeding is safe
    console.log(`Seeding ${CASES.length} cases...`);
    for (const c of CASES) {
      await client.query(
        `INSERT INTO cases
          (id, case_num, title, client, insured, plaintiff, claim_num, file_num, claim_spec,
           type, status, stage, lead_attorney, second_attorney, paralegal,
           trial_date, answer_filed, written_disc, party_depo, expert_depo,
           witness_depo, mediation, mediator, judge, dol)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (id) DO UPDATE SET
           case_num=$2, title=$3, client=$4, insured=$5, plaintiff=$6,
           claim_num=$7, file_num=$8, claim_spec=$9, type=$10, status=$11, stage=$12,
           lead_attorney=$13, second_attorney=$14, paralegal=$15,
           trial_date=$16, answer_filed=$17, written_disc=$18, party_depo=$19,
           expert_depo=$20, witness_depo=$21, mediation=$22, mediator=$23, judge=$24, dol=$25`,
        [
          c.id, c.caseNum || "", c.title, c.client || "", c.insured || "",
          c.plaintiff || "", c.claimNum || "", c.fileNum || "", c.claimSpec || "",
          c.type || "Civil Litigation", c.status || "Active", c.stage || "Pleadings",
          orNull(c.leadAttorney), orNull(c.secondAttorney), orNull(c.paralegal),
          orNull(c.trialDate), orNull(c.answerFiled), orNull(c.writtenDisc),
          orNull(c.partyDepo), orNull(c.expertDepo), orNull(c.witnessDepo),
          orNull(c.mediation), c.mediator || "", c.judge || "", orNull(c.dol),
        ]
      );
    }

    // Advance the cases serial sequence so new cases don't collide with seeded IDs
    const maxCaseId = Math.max(...CASES.map(c => c.id));
    await client.query(`SELECT setval('cases_id_seq', $1, true)`, [maxCaseId]);
    console.log(`Cases sequence advanced to ${maxCaseId}`);

    // Deadlines
    console.log(`Seeding ${DEADLINES.length} deadlines...`);
    for (const d of DEADLINES) {
      await client.query(
        `INSERT INTO deadlines (id, case_id, title, date, type, rule, assigned)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           case_id=$2, title=$3, date=$4, type=$5, rule=$6, assigned=$7`,
        [d.id, d.caseId, d.title, d.date, d.type || "Filing", d.rule || "", orNull(d.assigned)]
      );
    }

    // Advance deadlines sequence
    const maxDlId = Math.max(...DEADLINES.map(d => d.id));
    await client.query(`SELECT setval('deadlines_id_seq', $1, true)`, [maxDlId]);
    console.log(`Deadlines sequence advanced to ${maxDlId}`);

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Seed error:", err); process.exit(1); });
