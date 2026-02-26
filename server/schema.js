const pool = require("./db");

async function createSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          INTEGER PRIMARY KEY,
        name        TEXT    NOT NULL,
        role        TEXT    NOT NULL,
        roles       TEXT[]  NOT NULL DEFAULT '{}',
        email       TEXT    NOT NULL DEFAULT '',
        initials    TEXT    NOT NULL DEFAULT '',
        phone       TEXT    NOT NULL DEFAULT '',
        cell        TEXT    NOT NULL DEFAULT '',
        ext         TEXT    NOT NULL DEFAULT '',
        avatar      TEXT    NOT NULL DEFAULT '#4C7AC9',
        offices     TEXT[]  NOT NULL DEFAULT '{}',
        pin_hash    TEXT    NOT NULL DEFAULT '',
        password_hash TEXT  NOT NULL DEFAULT '',
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        temp_password TEXT  NOT NULL DEFAULT '',
        password_reset_token TEXT NOT NULL DEFAULT '',
        password_reset_expires TIMESTAMPTZ,
        deleted_at  TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cases (
        id              SERIAL PRIMARY KEY,
        case_num        TEXT    NOT NULL DEFAULT '',
        title           TEXT    NOT NULL,
        defendant_name  TEXT    NOT NULL DEFAULT '',
        prosecutor      TEXT    NOT NULL DEFAULT '',
        county          TEXT    NOT NULL DEFAULT '',
        court           TEXT    NOT NULL DEFAULT '',
        court_division  TEXT    NOT NULL DEFAULT '',
        charge_description TEXT NOT NULL DEFAULT '',
        charge_statute  TEXT    NOT NULL DEFAULT '',
        charge_class    TEXT    NOT NULL DEFAULT '',
        case_type       TEXT    NOT NULL DEFAULT 'Felony',
        type            TEXT    NOT NULL DEFAULT 'Felony',
        status          TEXT    NOT NULL DEFAULT 'Active',
        stage           TEXT    NOT NULL DEFAULT 'Arraignment',
        custody_status  TEXT    NOT NULL DEFAULT '',
        bond_amount     TEXT    NOT NULL DEFAULT '',
        bond_conditions TEXT    NOT NULL DEFAULT '',
        jail_location   TEXT    NOT NULL DEFAULT '',
        disposition_type TEXT   NOT NULL DEFAULT '',
        lead_attorney INTEGER REFERENCES users(id),
        second_attorney   INTEGER REFERENCES users(id),
        trial_coordinator  INTEGER REFERENCES users(id),
        investigator      INTEGER REFERENCES users(id),
        social_worker     INTEGER REFERENCES users(id),
        offices         TEXT[]  NOT NULL DEFAULT '{}',
        arrest_date     DATE,
        arraignment_date DATE,
        next_court_date DATE,
        trial_date      DATE,
        sentencing_date DATE,
        disposition_date DATE,
        judge           TEXT    NOT NULL DEFAULT '',
        charges         JSONB   NOT NULL DEFAULT '[]',
        custom_fields   JSONB   NOT NULL DEFAULT '[]',
        custom_dates    JSONB   NOT NULL DEFAULT '[]',
        hidden_fields   JSONB   NOT NULL DEFAULT '[]',
        confidential    BOOLEAN NOT NULL DEFAULT FALSE,
        death_penalty   BOOLEAN NOT NULL DEFAULT FALSE,
        custom_team     JSONB   NOT NULL DEFAULT '[]',
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        title           TEXT    NOT NULL,
        assigned        INTEGER REFERENCES users(id),
        assigned_role   VARCHAR(50),
        due             DATE,
        priority        TEXT    NOT NULL DEFAULT 'Medium',
        auto_escalate   BOOLEAN NOT NULL DEFAULT true,
        status          TEXT    NOT NULL DEFAULT 'Not Started',
        notes           TEXT    NOT NULL DEFAULT '',
        recurring       BOOLEAN NOT NULL DEFAULT false,
        recurring_days  INTEGER,
        escalate_medium_days INTEGER NOT NULL DEFAULT 30,
        escalate_high_days   INTEGER NOT NULL DEFAULT 14,
        escalate_urgent_days INTEGER NOT NULL DEFAULT 7,
        is_generated    BOOLEAN NOT NULL DEFAULT false,
        is_chained      BOOLEAN NOT NULL DEFAULT false,
        completed_at    DATE,
        time_logged     VARCHAR(50),
        completed_by    INTEGER REFERENCES users(id),
        time_log_user   INTEGER REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS deadlines (
        id         SERIAL PRIMARY KEY,
        case_id    INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        title      TEXT    NOT NULL,
        date       DATE    NOT NULL,
        type       TEXT    NOT NULL DEFAULT 'Filing',
        rule       TEXT    NOT NULL DEFAULT '',
        assigned   INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_notes (
        id          SERIAL PRIMARY KEY,
        case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        type        TEXT    NOT NULL DEFAULT 'General',
        body        TEXT    NOT NULL,
        author_id   INTEGER REFERENCES users(id),
        author_name TEXT    NOT NULL DEFAULT '',
        author_role TEXT    NOT NULL DEFAULT '',
        time_logged VARCHAR(50),
        time_log_user INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_links (
        id        SERIAL PRIMARY KEY,
        case_id   INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        path      TEXT    NOT NULL,
        label     TEXT    NOT NULL,
        category  TEXT    NOT NULL DEFAULT 'General',
        added_by  TEXT    NOT NULL DEFAULT '',
        added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_documents (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        filename        TEXT    NOT NULL,
        content_type    TEXT    NOT NULL DEFAULT '',
        file_data       BYTEA,
        extracted_text  TEXT    NOT NULL DEFAULT '',
        summary         TEXT,
        doc_type        TEXT    NOT NULL DEFAULT 'Other',
        uploaded_by     INTEGER REFERENCES users(id),
        uploaded_by_name TEXT   NOT NULL DEFAULT '',
        file_size       INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_filings (
        id                SERIAL PRIMARY KEY,
        case_id           INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        filename          TEXT    NOT NULL,
        original_filename TEXT    NOT NULL DEFAULT '',
        content_type      TEXT    NOT NULL DEFAULT 'application/pdf',
        file_data         BYTEA,
        extracted_text    TEXT    NOT NULL DEFAULT '',
        file_size         INTEGER NOT NULL DEFAULT 0,
        filed_by          TEXT    NOT NULL DEFAULT '',
        filing_date       DATE,
        summary           TEXT,
        doc_type          TEXT    NOT NULL DEFAULT '',
        source            TEXT    NOT NULL DEFAULT 'upload',
        source_email_from TEXT    NOT NULL DEFAULT '',
        uploaded_by       INTEGER REFERENCES users(id),
        uploaded_by_name  TEXT    NOT NULL DEFAULT '',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_activity (
        id        SERIAL PRIMARY KEY,
        case_id   INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_id   INTEGER REFERENCES users(id),
        user_name TEXT    NOT NULL DEFAULT '',
        user_role TEXT    NOT NULL DEFAULT '',
        action    TEXT    NOT NULL,
        detail    TEXT    NOT NULL DEFAULT ''
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_correspondence (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        from_email      TEXT    NOT NULL DEFAULT '',
        from_name       TEXT    NOT NULL DEFAULT '',
        to_emails       TEXT    NOT NULL DEFAULT '',
        cc_emails       TEXT    NOT NULL DEFAULT '',
        subject         TEXT    NOT NULL DEFAULT '',
        body_text       TEXT    NOT NULL DEFAULT '',
        body_html       TEXT    NOT NULL DEFAULT '',
        attachments     JSONB   NOT NULL DEFAULT '[]',
        received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS doc_templates (
        id              SERIAL PRIMARY KEY,
        name            TEXT    NOT NULL,
        tags            TEXT[]  NOT NULL DEFAULT '{}',
        created_by      INTEGER NOT NULL REFERENCES users(id),
        created_by_name TEXT    NOT NULL DEFAULT '',
        placeholders    JSONB   NOT NULL DEFAULT '[]',
        docx_data       BYTEA   NOT NULL,
        visibility      TEXT    NOT NULL DEFAULT 'global',
        category        TEXT    NOT NULL DEFAULT 'General',
        sub_type        TEXT    NOT NULL DEFAULT '',
        use_system_header    BOOLEAN DEFAULT true,
        use_system_signature BOOLEAN DEFAULT true,
        use_system_cos       BOOLEAN DEFAULT true,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id         SERIAL PRIMARY KEY,
        name       TEXT    NOT NULL,
        category   TEXT    NOT NULL CHECK (category = ANY(ARRAY['Client','Prosecutor','Judge','Court','Witness','Expert','Family Member','Social Worker','Treatment Provider','Adjuster','Miscellaneous'])),
        phone      TEXT    NOT NULL DEFAULT '',
        email      TEXT    NOT NULL DEFAULT '',
        fax        TEXT    NOT NULL DEFAULT '',
        address    TEXT    NOT NULL DEFAULT '',
        firm       TEXT    NOT NULL DEFAULT '',
        company    TEXT    NOT NULL DEFAULT '',
        county     TEXT    NOT NULL DEFAULT '',
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_staff (
        id          SERIAL PRIMARY KEY,
        contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        staff_type  TEXT    NOT NULL DEFAULT 'Other',
        data        JSONB   NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_notes (
        id          SERIAL PRIMARY KEY,
        contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        type        TEXT    NOT NULL DEFAULT 'General',
        body        TEXT    NOT NULL,
        author_id   INTEGER REFERENCES users(id),
        author_name TEXT    NOT NULL DEFAULT '',
        author_role TEXT    NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_parties (
        id          SERIAL PRIMARY KEY,
        case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        party_type  TEXT    NOT NULL DEFAULT 'Defendant',
        entity_kind TEXT    NOT NULL DEFAULT 'individual',
        data        JSONB   NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_experts (
        id          SERIAL PRIMARY KEY,
        case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        expert_type TEXT    NOT NULL DEFAULT 'Treating Physician',
        data        JSONB   NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_misc_contacts (
        id          SERIAL PRIMARY KEY,
        case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        contact_type TEXT   NOT NULL DEFAULT 'Other',
        data        JSONB   NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS time_entries (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        case_id    INTEGER REFERENCES cases(id) ON DELETE SET NULL,
        case_title VARCHAR(255),
        file_num   VARCHAR(100),
        date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        detail     TEXT    NOT NULL DEFAULT '',
        time       VARCHAR(50),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_training (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        scope       VARCHAR(20) NOT NULL DEFAULT 'personal' CHECK (scope IN ('personal', 'office')),
        category    VARCHAR(50) NOT NULL DEFAULT 'General',
        title       VARCHAR(200) NOT NULL,
        content     TEXT NOT NULL,
        source_type VARCHAR(20) NOT NULL DEFAULT 'text' CHECK (source_type IN ('text', 'document')),
        filename    VARCHAR(255),
        active      BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query("COMMIT");
    console.log("Schema created successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

createSchema()
  .then(() => process.exit(0))
  .catch((err) => { console.error("Schema error:", err); process.exit(1); });
