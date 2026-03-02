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
        deleted_at  TIMESTAMPTZ,
        pinned_cases JSONB NOT NULL DEFAULT '[]',
        preferences JSONB NOT NULL DEFAULT '{}'
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
        case_id     INTEGER REFERENCES cases(id) ON DELETE CASCADE,
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
      CREATE TABLE IF NOT EXISTS case_transcripts (
        id                SERIAL PRIMARY KEY,
        case_id           INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        filename          TEXT    NOT NULL,
        content_type      TEXT    NOT NULL DEFAULT '',
        audio_data        BYTEA,
        file_size         INTEGER NOT NULL DEFAULT 0,
        transcript        JSONB   NOT NULL DEFAULT '[]',
        status            TEXT    NOT NULL DEFAULT 'processing',
        error_message     TEXT,
        duration_seconds  REAL,
        uploaded_by       INTEGER REFERENCES users(id),
        uploaded_by_name  TEXT    NOT NULL DEFAULT '',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      CREATE TABLE IF NOT EXISTS contact_phones (
        id          SERIAL PRIMARY KEY,
        contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        label       TEXT    NOT NULL DEFAULT 'Cell',
        number      TEXT    NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_case_links (
        id          SERIAL PRIMARY KEY,
        contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(contact_id, case_id)
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
        target_agents TEXT[] NOT NULL DEFAULT '{all}',
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'ai_training' AND column_name = 'target_agents'
        ) THEN
          ALTER TABLE ai_training ADD COLUMN target_agents TEXT[] NOT NULL DEFAULT '{all}';
        END IF;
      END $$;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS calendar_feeds (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        url         TEXT    NOT NULL,
        active      BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS probation BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => {});
    await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS probation_data JSONB NOT NULL DEFAULT '{}'`).catch(() => {});

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_probation_violations (
        id                      SERIAL PRIMARY KEY,
        case_id                 INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        violation_date          DATE,
        violation_type          TEXT NOT NULL DEFAULT 'Technical',
        description             TEXT NOT NULL DEFAULT '',
        source                  TEXT NOT NULL DEFAULT '',
        related_charges         TEXT NOT NULL DEFAULT '',
        preliminary_hearing_date DATE,
        reconvening_date        DATE,
        custom_dates            JSONB NOT NULL DEFAULT '[]',
        hearing_type            TEXT NOT NULL DEFAULT '',
        attorney                INTEGER REFERENCES users(id),
        judge                   TEXT NOT NULL DEFAULT '',
        outcome                 TEXT NOT NULL DEFAULT 'Pending',
        jail_time_imposed       TEXT NOT NULL DEFAULT '',
        jail_credit             TEXT NOT NULL DEFAULT '',
        remaining_probation     TEXT NOT NULL DEFAULT '',
        sentence_imposed        TEXT NOT NULL DEFAULT '',
        notes                   TEXT NOT NULL DEFAULT '',
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS linked_cases (
        id                  SERIAL PRIMARY KEY,
        case_id             INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        is_pd_case          BOOLEAN NOT NULL DEFAULT false,
        linked_case_id      INTEGER REFERENCES cases(id) ON DELETE SET NULL,
        external_case_number TEXT NOT NULL DEFAULT '',
        external_case_style  TEXT NOT NULL DEFAULT '',
        external_court       TEXT NOT NULL DEFAULT '',
        external_county      TEXT NOT NULL DEFAULT 'Mobile',
        external_charges     TEXT NOT NULL DEFAULT '',
        external_attorney    TEXT NOT NULL DEFAULT '',
        external_status      TEXT NOT NULL DEFAULT '',
        external_notes       TEXT NOT NULL DEFAULT '',
        relationship         TEXT NOT NULL DEFAULT '',
        added_by             TEXT NOT NULL DEFAULT '',
        added_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TABLE case_probation_violations ALTER COLUMN attorney DROP DEFAULT;
        ALTER TABLE case_probation_violations ALTER COLUMN attorney TYPE TEXT USING CASE WHEN attorney IS NOT NULL THEN attorney::TEXT ELSE NULL END;
        ALTER TABLE case_probation_violations ALTER COLUMN attorney SET DEFAULT '';
      EXCEPTION WHEN others THEN NULL;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TABLE case_notes ALTER COLUMN case_id DROP NOT NULL;
      EXCEPTION WHEN others THEN NULL;
      END $$;
    `);

    await client.query(`ALTER TABLE cases ADD COLUMN IF NOT EXISTS custody_tracking JSONB NOT NULL DEFAULT '{}'`);

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sms_configs (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        phone_numbers   TEXT[]  NOT NULL DEFAULT '{}',
        contact_name    TEXT    NOT NULL DEFAULT '',
        contact_type    TEXT    NOT NULL DEFAULT 'client',
        notify_hearings    BOOLEAN NOT NULL DEFAULT true,
        notify_deadlines   BOOLEAN NOT NULL DEFAULT false,
        notify_court_dates BOOLEAN NOT NULL DEFAULT true,
        notify_meetings    BOOLEAN NOT NULL DEFAULT false,
        reminder_days   INT[]   NOT NULL DEFAULT '{1,7}',
        custom_message  TEXT    NOT NULL DEFAULT '',
        enabled         BOOLEAN NOT NULL DEFAULT true,
        created_by      INTEGER REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sms_scheduled (
        id              SERIAL PRIMARY KEY,
        sms_config_id   INTEGER REFERENCES sms_configs(id) ON DELETE CASCADE,
        case_id         INTEGER REFERENCES cases(id) ON DELETE CASCADE,
        event_type      TEXT    NOT NULL DEFAULT 'hearing',
        event_title     TEXT    NOT NULL DEFAULT '',
        event_date      DATE,
        send_at         TIMESTAMPTZ,
        phone_number    TEXT    NOT NULL DEFAULT '',
        message_body    TEXT    NOT NULL DEFAULT '',
        status          TEXT    NOT NULL DEFAULT 'pending',
        twilio_sid      TEXT    NOT NULL DEFAULT '',
        error           TEXT    NOT NULL DEFAULT '',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at         TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sms_messages (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER REFERENCES cases(id) ON DELETE SET NULL,
        direction       TEXT    NOT NULL DEFAULT 'outbound',
        phone_number    TEXT    NOT NULL DEFAULT '',
        body            TEXT    NOT NULL DEFAULT '',
        twilio_sid      TEXT    NOT NULL DEFAULT '',
        status          TEXT    NOT NULL DEFAULT 'sent',
        contact_name    TEXT    NOT NULL DEFAULT '',
        sent_by         INTEGER REFERENCES users(id),
        sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sms_watch_numbers (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        phone_number    TEXT    NOT NULL,
        contact_name    TEXT    NOT NULL DEFAULT '',
        added_by        INTEGER REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(case_id, phone_number)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_channels (
        id          SERIAL PRIMARY KEY,
        type        TEXT    NOT NULL,
        name        TEXT,
        case_id     INTEGER REFERENCES cases(id),
        created_by  INTEGER REFERENCES users(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_channel_members (
        id          SERIAL PRIMARY KEY,
        channel_id  INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(channel_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id              SERIAL PRIMARY KEY,
        channel_id      INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
        sender_id       INTEGER NOT NULL REFERENCES users(id),
        body            TEXT    NOT NULL,
        mentions        INTEGER[] NOT NULL DEFAULT '{}',
        attachment_name TEXT,
        attachment_url  TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_groups (
        id          SERIAL PRIMARY KEY,
        channel_id  INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        avatar      TEXT    NOT NULL DEFAULT '#4C7AC9',
        created_by  INTEGER NOT NULL REFERENCES users(id),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_typing (
        id          SERIAL PRIMARY KEY,
        channel_id  INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
        user_id     INTEGER NOT NULL REFERENCES users(id),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(channel_id, user_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_sessions (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL,
        trial_date DATE,
        court TEXT,
        judge TEXT,
        status TEXT DEFAULT 'preparing',
        jury_size INTEGER DEFAULT 12,
        notes TEXT DEFAULT '',
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(case_id)
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_witnesses (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'defense',
        contact_info TEXT DEFAULT '',
        expected_testimony TEXT DEFAULT '',
        impeachment_notes TEXT DEFAULT '',
        call_order INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_exhibits (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        exhibit_number TEXT DEFAULT '',
        description TEXT NOT NULL,
        type TEXT DEFAULT 'defense',
        status TEXT DEFAULT 'pending',
        linked_document_id INTEGER,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_jurors (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        seat_number INTEGER,
        name TEXT NOT NULL,
        notes TEXT DEFAULT '',
        strike_type TEXT DEFAULT 'none',
        is_selected BOOLEAN DEFAULT false,
        demographics TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_motions (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        type TEXT DEFAULT 'defense',
        status TEXT DEFAULT 'pending',
        ruling_summary TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_outlines (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        type TEXT DEFAULT 'opening',
        title TEXT NOT NULL,
        content TEXT DEFAULT '',
        linked_witness_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_jury_instructions (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        instruction_text TEXT NOT NULL,
        status TEXT DEFAULT 'requested',
        objection_notes TEXT DEFAULT '',
        source TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_timeline_events (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        event_date DATE,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_pinned_docs (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        case_document_id INTEGER,
        label TEXT DEFAULT '',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_log_entries (
        id SERIAL PRIMARY KEY,
        trial_session_id INTEGER NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
        trial_day INTEGER DEFAULT 1,
        entry_time TIMESTAMP DEFAULT NOW(),
        category TEXT DEFAULT 'note',
        content TEXT NOT NULL,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`ALTER TABLE trial_timeline_events ADD COLUMN IF NOT EXISTS file_data BYTEA`);
    await client.query(`ALTER TABLE trial_timeline_events ADD COLUMN IF NOT EXISTS file_name TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE trial_timeline_events ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT ''`);
    await client.query(`ALTER TABLE trial_timeline_events ADD COLUMN IF NOT EXISTS file_size INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE trial_timeline_events ADD COLUMN IF NOT EXISTS association TEXT DEFAULT 'general'`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trial_witness_documents (
        id SERIAL PRIMARY KEY,
        trial_witness_id INTEGER NOT NULL REFERENCES trial_witnesses(id) ON DELETE CASCADE,
        case_document_id INTEGER,
        transcript_id INTEGER,
        label TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`ALTER TABLE trial_pinned_docs ADD COLUMN IF NOT EXISTS transcript_id INTEGER`);

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
