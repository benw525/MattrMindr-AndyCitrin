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

    console.log("Clearing old data...");
    const childTables = [
      "case_negotiations", "case_damages", "case_liens", "case_medical_treatments",
      "case_insurance_policies", "case_activity", "case_notes", "case_documents",
      "case_filings", "case_correspondence", "case_links", "case_parties",
      "case_insurance", "case_experts", "case_misc_contacts", "time_entries",
      "case_probation_violations", "linked_cases", "sms_configs", "sms_scheduled",
      "sms_messages", "chat_channels", "contact_case_links", "sms_watch_numbers",
      "case_transcripts", "deadlines", "tasks",
    ];
    for (const t of childTables) {
      try { await client.query(`DELETE FROM ${t}`); } catch (_) {}
    }
    await client.query("DELETE FROM contacts WHERE deleted_at IS NULL");
    await client.query("DELETE FROM cases");
    console.log("Old data cleared.");

    console.log(`Seeding ${USERS.length} users...`);
    const bcrypt = require("bcryptjs");
    const defaultHash = await bcrypt.hash("1234", 10);
    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (id, name, role, roles, email, initials, phone, cell, avatar, password_hash, offices)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           name=$2, role=$3, roles=$4, email=$5, initials=$6, phone=$7, cell=$8, avatar=$9, offices=$11`,
        [u.id, u.name, u.role, [u.role], u.email, u.initials, u.phone || "", u.cell || "", u.avatar || "#4C7AC9", defaultHash, ["Main"]]
      );
    }
    console.log(`${USERS.length} users seeded.`);

    console.log(`Seeding ${CASES.length} cases...`);
    for (const c of CASES) {
      await client.query(
        `INSERT INTO cases
          (id, case_num, title, client_name, county, court,
           case_type, type, status, stage, state_jurisdiction,
           lead_attorney, second_attorney, case_manager, investigator, paralegal,
           accident_date, next_court_date, trial_date, mediation_date, disposition_date,
           judge, incident_location, injury_type, incident_description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         ON CONFLICT (id) DO UPDATE SET
           case_num=$2, title=$3, client_name=$4, county=$5, court=$6,
           case_type=$7, type=$8, status=$9, stage=$10, state_jurisdiction=$11,
           lead_attorney=$12, second_attorney=$13, case_manager=$14, investigator=$15, paralegal=$16,
           accident_date=$17, next_court_date=$18, trial_date=$19, mediation_date=$20, disposition_date=$21,
           judge=$22, incident_location=$23, injury_type=$24, incident_description=$25`,
        [
          c.id, c.caseNum || "", c.title, c.clientName || "", 
          c.county || "", c.court || "",
          c.caseType || "Auto Accident", c.type || "Auto Accident", c.status || "Active", c.stage || "Intake",
          c.stateJurisdiction || "",
          orNull(c.leadAttorney), orNull(c.secondAttorney), orNull(c.caseManager),
          orNull(c.investigator), orNull(c.paralegal),
          orNull(c.accidentDate), orNull(c.nextCourtDate),
          orNull(c.trialDate), orNull(c.mediationDate), orNull(c.dispositionDate),
          c.judge || "",
          c.incidentLocation || "", c.injuryType || "", c.incidentDescription || "",
        ]
      );
    }

    if (CASES.length > 0) {
      const maxCaseId = Math.max(...CASES.map(c => c.id));
      await client.query(`SELECT setval('cases_id_seq', $1, true)`, [maxCaseId]);
      console.log(`Cases sequence advanced to ${maxCaseId}`);
    }

    const CONTACTS = [
      { name: "State Farm Insurance", category: "Insurance Company", phone: "(800) 782-8332", email: "claims@statefarm.com", company: "State Farm", address: "One State Farm Plaza, Bloomington, IL 61710", county: "" },
      { name: "Allstate Insurance", category: "Insurance Company", phone: "(800) 255-7828", email: "claims@allstate.com", company: "Allstate", address: "2775 Sanders Rd, Northbrook, IL 60062", county: "" },
      { name: "GEICO", category: "Insurance Company", phone: "(800) 841-3000", email: "claims@geico.com", company: "GEICO", address: "5260 Western Ave, Chevy Chase, MD 20815", county: "" },
      { name: "Progressive Insurance", category: "Insurance Company", phone: "(800) 776-4737", email: "claims@progressive.com", company: "Progressive", address: "6300 Wilson Mills Rd, Mayfield Village, OH 44143", county: "" },
      { name: "Liberty Mutual", category: "Insurance Company", phone: "(800) 290-8711", email: "claims@libertymutual.com", company: "Liberty Mutual", address: "175 Berkeley St, Boston, MA 02116", county: "" },
      { name: "USAA", category: "Insurance Company", phone: "(800) 531-8722", email: "claims@usaa.com", company: "USAA", address: "9800 Fredericksburg Rd, San Antonio, TX 78288", county: "" },
      { name: "Nationwide Insurance", category: "Insurance Company", phone: "(877) 669-6877", email: "claims@nationwide.com", company: "Nationwide", address: "One Nationwide Plaza, Columbus, OH 43215", county: "" },
      { name: "Farmers Insurance", category: "Insurance Company", phone: "(888) 327-6335", email: "claims@farmers.com", company: "Farmers", address: "6301 Owensmouth Ave, Woodland Hills, CA 91367", county: "" },
      { name: "Travelers Insurance", category: "Insurance Company", phone: "(800) 252-4633", email: "claims@travelers.com", company: "Travelers", address: "485 Lexington Ave, New York, NY 10017", county: "" },
      { name: "Hartford Insurance", category: "Insurance Company", phone: "(860) 547-5000", email: "claims@thehartford.com", company: "The Hartford", address: "One Hartford Plaza, Hartford, CT 06155", county: "" },

      { name: "Karen Whitfield", category: "Insurance Adjuster", phone: "(555) 201-3001", email: "kwhitfield@statefarm.com", company: "State Farm", address: "", county: "" },
      { name: "Michael Brooks", category: "Insurance Adjuster", phone: "(555) 201-3002", email: "mbrooks@allstate.com", company: "Allstate", address: "", county: "" },
      { name: "Deborah Price", category: "Insurance Adjuster", phone: "(555) 201-3003", email: "dprice@geico.com", company: "GEICO", address: "", county: "" },
      { name: "Jason Caldwell", category: "Insurance Adjuster", phone: "(555) 201-3004", email: "jcaldwell@progressive.com", company: "Progressive", address: "", county: "" },
      { name: "Susan Martinez", category: "Insurance Adjuster", phone: "(555) 201-3005", email: "smartinez@libertymutual.com", company: "Liberty Mutual", address: "", county: "" },

      { name: "Dr. James Patterson", category: "Medical Provider", phone: "(555) 301-4001", email: "jpatterson@metroortho.com", firm: "Metro Orthopedic Associates", address: "1200 Medical Center Dr, Suite 300", county: "" },
      { name: "Dr. Emily Chang", category: "Medical Provider", phone: "(555) 301-4002", email: "echang@neurologypartners.com", firm: "Neurology Partners", address: "850 Brain Health Blvd, Suite 200", county: "" },
      { name: "Dr. Richard Gomez", category: "Medical Provider", phone: "(555) 301-4003", email: "rgomez@painmgmt.com", firm: "Advanced Pain Management", address: "2100 Wellness Way, Suite 150", county: "" },
      { name: "Dr. Sarah Williams", category: "Medical Provider", phone: "(555) 301-4004", email: "swilliams@spinecenter.com", firm: "Regional Spine Center", address: "3500 Spine Care Ave, Suite 400", county: "" },
      { name: "Dr. Michael Torres", category: "Medical Provider", phone: "(555) 301-4005", email: "mtorres@sportsmed.com", firm: "Sports Medicine & Rehab", address: "900 Athletic Blvd, Suite 100", county: "" },
      { name: "Metro Physical Therapy", category: "Treatment Provider", phone: "(555) 301-4010", email: "info@metropt.com", firm: "Metro Physical Therapy", address: "1500 Rehab Center Rd", county: "" },
      { name: "Lakeside Chiropractic", category: "Treatment Provider", phone: "(555) 301-4011", email: "info@lakesidechiro.com", firm: "Lakeside Chiropractic", address: "700 Wellness Dr", county: "" },
      { name: "Premier Imaging Center", category: "Medical Provider", phone: "(555) 301-4012", email: "scheduling@premierimaging.com", firm: "Premier Imaging Center", address: "2200 Diagnostic Way", county: "" },

      { name: "Thompson & Associates", category: "Defense Attorney", phone: "(555) 501-5001", email: "info@thompsondefense.com", firm: "Thompson & Associates", address: "500 Corporate Tower, Suite 1200", county: "" },
      { name: "Baker, Harris & Moore LLP", category: "Defense Attorney", phone: "(555) 501-5002", email: "info@bakerharris.com", firm: "Baker, Harris & Moore LLP", address: "200 Financial Center, Suite 800", county: "" },
      { name: "Garrett & Sterling", category: "Defense Attorney", phone: "(555) 501-5003", email: "info@garrettsterling.com", firm: "Garrett & Sterling", address: "1100 Commerce Plaza, Suite 600", county: "" },
      { name: "Richardson Law Group", category: "Defense Attorney", phone: "(555) 501-5004", email: "info@richardsonlaw.com", firm: "Richardson Law Group", address: "350 Justice Ave, Suite 900", county: "" },
      { name: "Crawford & Daniels PC", category: "Defense Attorney", phone: "(555) 501-5005", email: "info@crawforddaniels.com", firm: "Crawford & Daniels PC", address: "750 Legal Center Dr, Suite 400", county: "" },

      { name: "Hon. Catherine Brooks", category: "Judge", phone: "(555) 601-6001", email: "chambers.brooks@court.gov", address: "100 Courthouse Square, Courtroom 3A", county: "" },
      { name: "Hon. Richard Yamamoto", category: "Judge", phone: "(555) 601-6002", email: "chambers.yamamoto@court.gov", address: "100 Courthouse Square, Courtroom 5B", county: "" },
      { name: "Hon. Margaret O'Connor", category: "Judge", phone: "(555) 601-6003", email: "chambers.oconnor@court.gov", address: "100 Courthouse Square, Courtroom 2A", county: "" },
      { name: "Hon. David Morales", category: "Judge", phone: "(555) 601-6004", email: "chambers.morales@court.gov", address: "100 Courthouse Square, Courtroom 7C", county: "" },
      { name: "Hon. Patricia Simmons", category: "Judge", phone: "(555) 601-6005", email: "chambers.simmons@court.gov", address: "100 Courthouse Square, Courtroom 4A", county: "" },

      { name: "Medicare Recovery Services", category: "Lienholder", phone: "(800) 999-1118", email: "recovery@medicare.gov", company: "CMS/Medicare", address: "7500 Security Blvd, Baltimore, MD 21244", county: "" },
      { name: "Medicaid Recovery Unit", category: "Lienholder", phone: "(800) 555-0199", email: "recovery@medicaid.gov", company: "Medicaid", address: "", county: "" },
      { name: "Blue Cross Blue Shield Subrogation", category: "Lienholder", phone: "(800) 555-0200", email: "subrogation@bcbs.com", company: "Blue Cross Blue Shield", address: "", county: "" },

      { name: "Dr. Robert Kline", category: "Expert", phone: "(555) 701-7001", email: "rkline@forensicengineering.com", firm: "Forensic Engineering Associates", address: "800 Expert Way, Suite 300", county: "" },
      { name: "Dr. Linda Vasquez", category: "Expert", phone: "(555) 701-7002", email: "lvasquez@lifeplanners.com", firm: "National Life Care Planners", address: "1200 Planning Dr, Suite 200", county: "" },
      { name: "Dr. Thomas Hartwell", category: "Expert", phone: "(555) 701-7003", email: "thartwell@econexperts.com", firm: "Economic Loss Consultants", address: "600 Analysis Blvd, Suite 100", county: "" },
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
        "case_parties", "case_experts", "case_misc_contacts",
        "case_insurance_policies", "case_medical_treatments", "case_liens", "case_damages", "case_negotiations",
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
