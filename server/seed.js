const fs   = require("fs");
const path = require("path");
const vm   = require("vm");
const pool = require("./db");

const firmDataSrc = fs.readFileSync(
  path.join(__dirname, "../lextrack/src/firmData.js"), "utf8"
).replace(/export const /g, "var ");

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(firmDataSrc, sandbox);
const { USERS, CASES } = sandbox;

const orNull = (val) => (val && String(val).trim() && String(val) !== "0") ? val : null;

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log(`Seeding ${USERS.length} users...`);
    const bcrypt = require("bcryptjs");
    const defaultHash = await bcrypt.hash("1234", 10);
    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (id, name, role, roles, email, initials, phone, cell, avatar, password_hash, offices)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           name=$2, role=$3, roles=$4, email=$5, initials=$6, phone=$7, cell=$8, avatar=$9, offices=$11`,
        [u.id, u.name, u.role, [u.role], u.email, u.initials, u.phone || "", u.cell || "", u.avatar || "#4C7AC9", defaultHash, ["Mobile"]]
      );
    }
    console.log(`${USERS.length} users seeded.`);

    console.log(`Seeding ${CASES.length} cases...`);
    for (const c of CASES) {
      await client.query(
        `INSERT INTO cases
          (id, case_num, title, defendant_name, prosecutor, county, court, court_division,
           case_type, type, status, stage,
           assigned_attorney, second_attorney, trial_coordinator, investigator, social_worker,
           arrest_date, arraignment_date, next_court_date, trial_date, sentencing_date, disposition_date,
           judge)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (id) DO UPDATE SET
           case_num=$2, title=$3, defendant_name=$4, prosecutor=$5, county=$6, court=$7, court_division=$8,
           case_type=$9, type=$10, status=$11, stage=$12,
           assigned_attorney=$13, second_attorney=$14, trial_coordinator=$15, investigator=$16, social_worker=$17,
           arrest_date=$18, arraignment_date=$19, next_court_date=$20, trial_date=$21, sentencing_date=$22, disposition_date=$23,
           judge=$24`,
        [
          c.id, c.caseNum || "", c.title, c.defendantName || "", c.prosecutor || "",
          c.county || "", c.court || "", c.courtDivision || "",
          c.caseType || "Felony", c.type || "Felony", c.status || "Active", c.stage || "Arraignment",
          orNull(c.assignedAttorney), orNull(c.secondAttorney), orNull(c.trialCoordinator),
          orNull(c.investigator), orNull(c.socialWorker),
          orNull(c.arrestDate), orNull(c.arraignmentDate), orNull(c.nextCourtDate),
          orNull(c.trialDate), orNull(c.sentencingDate), orNull(c.dispositionDate),
          c.judge || "",
        ]
      );
    }

    if (CASES.length > 0) {
      const maxCaseId = Math.max(...CASES.map(c => c.id));
      await client.query(`SELECT setval('cases_id_seq', $1, true)`, [maxCaseId]);
      console.log(`Cases sequence advanced to ${maxCaseId}`);
    }

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
