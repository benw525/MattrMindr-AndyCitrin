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
        email       TEXT    NOT NULL,
        initials    TEXT    NOT NULL,
        phone       TEXT    NOT NULL DEFAULT '',
        cell        TEXT    NOT NULL DEFAULT '',
        avatar      TEXT    NOT NULL DEFAULT '#4C7AC9',
        pin_hash    TEXT    NOT NULL DEFAULT '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cases (
        id              SERIAL PRIMARY KEY,
        case_num        TEXT    NOT NULL DEFAULT '',
        title           TEXT    NOT NULL,
        client          TEXT    NOT NULL DEFAULT '',
        insured         TEXT    NOT NULL DEFAULT '',
        plaintiff       TEXT    NOT NULL DEFAULT '',
        claim_num       TEXT    NOT NULL DEFAULT '',
        file_num        TEXT    NOT NULL DEFAULT '',
        claim_spec      TEXT    NOT NULL DEFAULT '',
        type            TEXT    NOT NULL DEFAULT 'Civil Litigation',
        status          TEXT    NOT NULL DEFAULT 'Active',
        stage           TEXT    NOT NULL DEFAULT 'Pleadings',
        lead_attorney   INTEGER REFERENCES users(id),
        second_attorney INTEGER REFERENCES users(id),
        paralegal       INTEGER REFERENCES users(id),
        trial_date      DATE,
        answer_filed    DATE,
        written_disc    DATE,
        party_depo      DATE,
        expert_depo     DATE,
        witness_depo    DATE,
        mediation       DATE,
        mediator        TEXT    NOT NULL DEFAULT '',
        judge           TEXT    NOT NULL DEFAULT '',
        dol             DATE,
        custom_fields   JSONB   NOT NULL DEFAULT '[]',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        title           TEXT    NOT NULL,
        assigned        INTEGER REFERENCES users(id),
        due             DATE,
        priority        TEXT    NOT NULL DEFAULT 'Medium',
        auto_escalate   BOOLEAN NOT NULL DEFAULT true,
        status          TEXT    NOT NULL DEFAULT 'Not Started',
        notes           TEXT    NOT NULL DEFAULT '',
        recurring       BOOLEAN NOT NULL DEFAULT false,
        recurring_days  INTEGER,
        is_generated    BOOLEAN NOT NULL DEFAULT false,
        is_chained      BOOLEAN NOT NULL DEFAULT false,
        completed_at    DATE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS deadlines (
        id       SERIAL PRIMARY KEY,
        case_id  INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        title    TEXT    NOT NULL,
        date     DATE    NOT NULL,
        type     TEXT    NOT NULL DEFAULT 'Filing',
        rule     TEXT    NOT NULL DEFAULT '',
        assigned INTEGER REFERENCES users(id),
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
        author_name TEXT    NOT NULL,
        author_role TEXT    NOT NULL,
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
        added_by  TEXT    NOT NULL,
        added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS case_activity (
        id        SERIAL PRIMARY KEY,
        case_id   INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_id   INTEGER REFERENCES users(id),
        user_name TEXT    NOT NULL,
        user_role TEXT    NOT NULL,
        action    TEXT    NOT NULL,
        detail    TEXT    NOT NULL DEFAULT ''
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
