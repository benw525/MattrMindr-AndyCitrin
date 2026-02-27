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

const BYTEA_COLUMNS = {
  case_documents: ["file_data"],
  case_filings: ["file_data"],
  doc_templates: ["file_data"],
};

async function importTableData(client, tableName, rows) {
  if (!rows || rows.length === 0) return;
  const byteaCols = BYTEA_COLUMNS[tableName] || [];

  const sampleRow = { ...rows[0] };
  const cols = Object.keys(sampleRow).filter(
    (k) => !k.startsWith("__base64__")
  );

  const idCol = cols.includes("id") ? "id" : null;

  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    const values = cols.map((col) => {
      let val = row[col];
      if (row[`__base64__${col}`] && typeof val === "string") {
        val = Buffer.from(val, "base64");
      } else if (val !== null && typeof val === "object" && !Buffer.isBuffer(val) && !(val instanceof Date)) {
        if (Array.isArray(val) && (val.length === 0 || typeof val[0] !== "object")) {
          // primitive array → pass as-is for PostgreSQL array columns (TEXT[], etc.)
        } else {
          val = JSON.stringify(val);
        }
      }
      return val;
    });

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const colList = cols.map((c) => `"${c}"`).join(", ");

    try {
      if (idCol) {
        await client.query(
          `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
          values
        );
      } else {
        await client.query(
          `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})`,
          values
        );
      }
      inserted++;
    } catch (err) {
      if (err.code === "23505") continue;
      if (err.code === "23503") { skipped++; continue; }
      throw err;
    }
  }

  if (idCol) {
    const ids = rows.map((r) => r.id).filter((id) => typeof id === "number");
    if (ids.length > 0) {
      const maxId = Math.max(...ids);
      const seqName = `${tableName}_id_seq`;
      try {
        await client.query(`SELECT setval('${seqName}', GREATEST($1, (SELECT COALESCE(max(id),0) FROM ${tableName})), true)`, [maxId]);
      } catch (_) {}
    }
  }
  const skipMsg = skipped > 0 ? ` (${skipped} skipped — missing references)` : "";
  console.log(`  ${tableName}: ${inserted} rows imported${skipMsg}`);
}

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
           lead_attorney, second_attorney, trial_coordinator, investigator, social_worker,
           arrest_date, arraignment_date, next_court_date, trial_date, sentencing_date, disposition_date,
           judge, death_penalty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (id) DO UPDATE SET
           case_num=$2, title=$3, defendant_name=$4, prosecutor=$5, county=$6, court=$7, court_division=$8,
           case_type=$9, type=$10, status=$11, stage=$12,
           lead_attorney=$13, second_attorney=$14, trial_coordinator=$15, investigator=$16, social_worker=$17,
           arrest_date=$18, arraignment_date=$19, next_court_date=$20, trial_date=$21, sentencing_date=$22, disposition_date=$23,
           judge=$24, death_penalty=$25`,
        [
          c.id, c.caseNum || "", c.title, c.defendantName || "", c.prosecutor || "",
          c.county || "", c.court || "", c.courtDivision || "",
          c.caseType || "Felony", c.type || "Felony", c.status || "Active", c.stage || "Arraignment",
          orNull(c.assignedAttorney), orNull(c.secondAttorney), orNull(c.trialCoordinator),
          orNull(c.investigator), orNull(c.socialWorker),
          orNull(c.arrestDate), orNull(c.arraignmentDate), orNull(c.nextCourtDate),
          orNull(c.trialDate), orNull(c.sentencingDate), orNull(c.dispositionDate),
          c.judge || "",
          !!c.deathPenalty,
        ]
      );
    }

    if (CASES.length > 0) {
      const maxCaseId = Math.max(...CASES.map(c => c.id));
      await client.query(`SELECT setval('cases_id_seq', $1, true)`, [maxCaseId]);
      console.log(`Cases sequence advanced to ${maxCaseId}`);
    }

    const CONTACTS = [
      { name: "Amanda Price", category: "Prosecutor", phone: "(251) 574-8401", email: "aprice@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Andrew Collins", category: "Prosecutor", phone: "(251) 574-8402", email: "acollins@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Brian Lawson", category: "Prosecutor", phone: "(251) 574-8403", email: "blawson@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Catherine Webb", category: "Prosecutor", phone: "(251) 574-8404", email: "cwebb@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Daniel Marsh", category: "Prosecutor", phone: "(251) 574-8405", email: "dmarsh@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "David Harper", category: "Prosecutor", phone: "(251) 574-8406", email: "dharper@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "James Wright", category: "Prosecutor", phone: "(251) 574-8407", email: "jwright@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Jessica Banks", category: "Prosecutor", phone: "(251) 574-8408", email: "jbanks@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Kevin Reynolds", category: "Prosecutor", phone: "(251) 574-8409", email: "kreynolds@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Lisa Carmichael", category: "Prosecutor", phone: "(251) 574-8410", email: "lcarmichael@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Marcus Reed", category: "Prosecutor", phone: "(251) 574-8411", email: "mreed@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Michael Chen", category: "Prosecutor", phone: "(251) 574-8412", email: "mchen@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Michelle Torres", category: "Prosecutor", phone: "(251) 574-8413", email: "mtorres@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Nicole Garrett", category: "Prosecutor", phone: "(251) 574-8414", email: "ngarrett@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Patricia Nolan", category: "Prosecutor", phone: "(251) 574-8415", email: "pnolan@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Rachel Foster", category: "Prosecutor", phone: "(251) 574-8416", email: "rfoster@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Robert Tillman", category: "Prosecutor", phone: "(251) 574-8417", email: "rtillman@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Sarah Johnson", category: "Prosecutor", phone: "(251) 574-8418", email: "sjohnson@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Stephanie Moore", category: "Prosecutor", phone: "(251) 574-8419", email: "smoore@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Thomas Blackwell", category: "Prosecutor", phone: "(251) 574-8420", email: "tblackwell@mobileda.gov", firm: "Mobile County District Attorney's Office", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Ben H. Brooks", category: "Judge", phone: "(251) 574-8701", email: "chambers.brooks@alacourt.gov", address: "205 Government St, Courtroom 7A, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Brandy V. Hambright", category: "Judge", phone: "(251) 574-8702", email: "chambers.hambright@alacourt.gov", address: "205 Government St, Courtroom 3B, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Charles A. Graddick Jr.", category: "Judge", phone: "(251) 574-8703", email: "chambers.graddick@alacourt.gov", address: "205 Government St, Courtroom 5A, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Deborah B. Alley", category: "Judge", phone: "(251) 574-8704", email: "chambers.alley@alacourt.gov", address: "205 Government St, Courtroom 2C, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Gaines McCorquodale", category: "Judge", phone: "(251) 574-8705", email: "chambers.mccorquodale@alacourt.gov", address: "205 Government St, Courtroom 6A, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. George M. Callahan", category: "Judge", phone: "(251) 574-8706", email: "chambers.callahan@alacourt.gov", address: "205 Government St, Courtroom 4B, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. J. Ryan deGraffenried", category: "Judge", phone: "(251) 574-8707", email: "chambers.degraffenried@alacourt.gov", address: "205 Government St, Courtroom 8A, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. James T. Patterson", category: "Judge", phone: "(251) 574-8708", email: "chambers.patterson@alacourt.gov", address: "205 Government St, Courtroom 1A, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Jennifer Wright", category: "Judge", phone: "(251) 574-8709", email: "chambers.wright@alacourt.gov", address: "205 Government St, Courtroom 3C, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. John H. Lockett", category: "Judge", phone: "(251) 574-8710", email: "chambers.lockett@alacourt.gov", address: "205 Government St, Courtroom 5B, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Joseph H. Johnston", category: "Judge", phone: "(251) 574-8711", email: "chambers.johnston@alacourt.gov", address: "205 Government St, Courtroom 2A, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Karlos R. Finley", category: "Judge", phone: "(251) 574-8712", email: "chambers.finley@alacourt.gov", address: "205 Government St, Courtroom 7B, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Kristin S. Wade", category: "Judge", phone: "(251) 574-8713", email: "chambers.wade@alacourt.gov", address: "205 Government St, Courtroom 4A, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Michael A. Youngpeter", category: "Judge", phone: "(251) 574-8714", email: "chambers.youngpeter@alacourt.gov", address: "205 Government St, Courtroom 6B, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Richard W. Vollmer III", category: "Judge", phone: "(251) 574-8715", email: "chambers.vollmer@alacourt.gov", address: "205 Government St, Courtroom 1B, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Rick W. Graddick", category: "Judge", phone: "(251) 574-8716", email: "chambers.rgraddick@alacourt.gov", address: "205 Government St, Courtroom 8B, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Sarah B. Stewart", category: "Judge", phone: "(251) 574-8717", email: "chambers.stewart@alacourt.gov", address: "205 Government St, Courtroom 3A, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Shawn K. Alves", category: "Judge", phone: "(251) 574-8718", email: "chambers.alves@alacourt.gov", address: "205 Government St, Courtroom 5C, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Sheila O. Anderson", category: "Judge", phone: "(251) 574-8719", email: "chambers.anderson@alacourt.gov", address: "205 Government St, Courtroom 2B, Mobile, AL 36602", county: "Mobile" },
      { name: "Hon. Wesley M. Pipes", category: "Judge", phone: "(251) 574-8720", email: "chambers.pipes@alacourt.gov", address: "205 Government St, Courtroom 4C, Mobile, AL 36602", county: "Mobile" },
      { name: "Mobile County Circuit Court", category: "Court", phone: "(251) 574-8400", email: "circuitclerk@mobilecountyal.gov", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Mobile County District Court", category: "Court", phone: "(251) 574-8500", email: "districtclerk@mobilecountyal.gov", address: "205 Government St, Mobile, AL 36602", county: "Mobile" },
      { name: "Mobile County Juvenile Court", category: "Court", phone: "(251) 574-8600", email: "juvenileclerk@mobilecountyal.gov", address: "1011 Schillinger Rd S, Mobile, AL 36695", county: "Mobile" },
      { name: "Mobile County Metro Jail", category: "Court", phone: "(251) 574-2351", email: "metrojail@mobileso.com", address: "450 St. Emanuel St, Mobile, AL 36603", county: "Mobile" },
      { name: "Mobile County Jail — West", category: "Court", phone: "(251) 574-8950", email: "westjail@mobileso.com", address: "840 Schillinger Rd S, Mobile, AL 36695", county: "Mobile" },
      { name: "Mobile County Community Corrections", category: "Court", phone: "(251) 574-8900", email: "commcorrections@mobilecountyal.gov", address: "151 Government St, Suite 400, Mobile, AL 36602", county: "Mobile" },
      { name: "Mobile County Strickland Youth Center", category: "Court", phone: "(251) 574-8650", email: "stricklandyouth@mobilecountyal.gov", address: "1011 Schillinger Rd S, Mobile, AL 36695", county: "Mobile" },
    ];

    console.log(`Seeding ${CONTACTS.length} contacts...`);
    for (const ct of CONTACTS) {
      const existing = await client.query(`SELECT id FROM contacts WHERE name = $1 AND category = $2 AND deleted_at IS NULL`, [ct.name, ct.category]);
      if (existing.rows.length === 0) {
        await client.query(
          `INSERT INTO contacts (name, category, phone, email, fax, address, firm, company, county)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ct.name, ct.category, ct.phone || "", ct.email || "", ct.fax || "", ct.address || "", ct.firm || "", ct.company || "", ct.county || ""]
        );
      }
    }
    console.log(`${CONTACTS.length} contacts seeded.`);

    const seedDataPath = path.join(__dirname, "seed-data.json");
    if (fs.existsSync(seedDataPath)) {
      console.log("Importing additional table data from seed-data.json...");
      const seedData = JSON.parse(fs.readFileSync(seedDataPath, "utf8"));
      const importOrder = [
        "cases",
        "tasks", "deadlines", "case_notes", "case_activity",
        "case_links", "case_correspondence",
        "case_parties", "case_experts", "case_misc_contacts", "case_insurance",
        "contact_notes", "contact_staff", "time_entries",
        "case_documents", "case_filings", "doc_templates", "ai_training",
      ];
      for (const tableName of importOrder) {
        if (seedData[tableName]) {
          await importTableData(client, tableName, seedData[tableName]);
        }
      }
      console.log("Additional data import complete.");
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
