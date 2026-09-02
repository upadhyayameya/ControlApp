-- ---------------------------------------------------------------------------
-- HBS Client Portal schema (SQLite).
--
-- SQLite is the deliberate starting point, not the destination: it keeps the
-- portal runnable with zero setup while the hosting and database conversation
-- is still open. Everything goes through db/repo.ts, so moving to Postgres is
-- a change of driver and a few types, not a rewrite. Nothing here uses a
-- SQLite-only feature beyond `INTEGER PRIMARY KEY`.
--
-- Two conventions throughout:
--   * ids are text (uuid), so rows can be created client-side or merged across
--     databases without collisions.
--   * timestamps are ISO-8601 text in UTC, because comparing them lexically is
--     the same as comparing them chronologically.
-- ---------------------------------------------------------------------------

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  billing_email TEXT,
  tier          TEXT NOT NULL DEFAULT 'benchmarking'
                CHECK (tier IN ('benchmarking','compliance','managed')),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL
                  CHECK (role IN ('hbs_staff','customer_admin','customer_viewer')),
  -- scrypt: "scrypt$N$r$p$salt$hash", all base64. See services/auth.ts.
  password_hash   TEXT NOT NULL,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL,
  -- Staff have no organization; customers must have one.
  CHECK ((role = 'hbs_staff') = (organization_id IS NULL))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS espm_connections (
  id              TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  -- NULL means the shared HBS service-provider account.
  organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  espm_account_id INTEGER,
  username        TEXT NOT NULL,
  -- Never stored here. Resolved at call time from ESPM_PASSWORD (shared
  -- account) or a secret store keyed by connection id. See espm/resolve.ts.
  environment     TEXT NOT NULL DEFAULT 'test' CHECK (environment IN ('test','live')),
  active          INTEGER NOT NULL DEFAULT 1,
  last_pull_at    TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS buildings (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  espm_property_id      INTEGER UNIQUE,
  name                  TEXT NOT NULL,
  address_line1         TEXT,
  city                  TEXT,
  state                 TEXT,
  postal_code           TEXT,
  property_type         TEXT NOT NULL,
  gross_floor_area_sqft INTEGER NOT NULL DEFAULT 0,
  year_built            INTEGER,
  jurisdiction          TEXT NOT NULL DEFAULT 'none'
                        CHECK (jurisdiction IN ('dc','montgomery-md','none')),
  compliance_exempt     INTEGER NOT NULL DEFAULT 0,
  exemption_note        TEXT,
  last_synced_at        TEXT,
  created_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buildings_org ON buildings(organization_id);

CREATE TABLE IF NOT EXISTS metric_years (
  id                           TEXT PRIMARY KEY,
  building_id                  TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  year                         INTEGER NOT NULL,
  energy_star_score            REAL,
  site_eui                     REAL,
  source_eui                   REAL,
  weather_normalized_site_eui  REAL,
  total_ghg_emissions          REAL,
  ghg_intensity                REAL,
  water_use_intensity          REAL,
  total_site_energy_kbtu       REAL,
  source                       TEXT NOT NULL DEFAULT 'espm'
                               CHECK (source IN ('espm','portal-entry','estimated')),
  recorded_at                  TEXT NOT NULL,
  UNIQUE (building_id, year)
);

CREATE TABLE IF NOT EXISTS meters (
  id            TEXT PRIMARY KEY,
  building_id   TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  espm_meter_id INTEGER UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  unit          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_meters_building ON meters(building_id);

CREATE TABLE IF NOT EXISTS consumption_entries (
  id                   TEXT PRIMARY KEY,
  meter_id             TEXT NOT NULL REFERENCES meters(id) ON DELETE CASCADE,
  building_id          TEXT NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  start_date           TEXT NOT NULL,
  end_date             TEXT NOT NULL,
  quantity             REAL NOT NULL,
  unit                 TEXT NOT NULL,
  cost                 REAL,
  estimated            INTEGER NOT NULL DEFAULT 0,
  espm_consumption_id  INTEGER,
  sync_state           TEXT NOT NULL DEFAULT 'local'
                       CHECK (sync_state IN ('local','pending','synced','failed','remote')),
  sync_error           TEXT,
  entered_by_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  -- One reading per meter per billing period; a re-entry updates in place.
  UNIQUE (meter_id, start_date, end_date)
);
CREATE INDEX IF NOT EXISTS idx_consumption_meter ON consumption_entries(meter_id, start_date);
CREATE INDEX IF NOT EXISTS idx_consumption_sync ON consumption_entries(sync_state);

CREATE TABLE IF NOT EXISTS message_threads (
  id                 TEXT PRIMARY KEY,
  organization_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  building_id        TEXT REFERENCES buildings(id) ON DELETE SET NULL,
  subject            TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  -- JSON array of addresses copied on every portal reply.
  email_cc_addresses TEXT NOT NULL DEFAULT '[]',
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  last_message_at    TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_org ON message_threads(organization_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_email   TEXT,
  author_name    TEXT NOT NULL,
  body           TEXT NOT NULL,
  channel        TEXT NOT NULL DEFAULT 'portal' CHECK (channel IN ('portal','email')),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

-- Outbound email queue. Rows are written in the same transaction as the
-- message they notify, so a delivery failure can never lose the message
-- itself — the thread is the record, email is a copy of it.
CREATE TABLE IF NOT EXISTS email_outbox (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT REFERENCES message_threads(id) ON DELETE CASCADE,
  to_addresses TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','sent','failed')),
  error        TEXT,
  created_at   TEXT NOT NULL,
  sent_at      TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  building_id     TEXT REFERENCES buildings(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
  title           TEXT NOT NULL,
  detail          TEXT NOT NULL,
  -- Stable identity for a recurring condition, so re-running the monitor
  -- updates one alert instead of piling up duplicates.
  dedupe_key      TEXT NOT NULL UNIQUE,
  acknowledged_at TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  building_id     TEXT REFERENCES buildings(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL,
  period_label    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','ready','failed')),
  file_path       TEXT,
  generated_at    TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id              TEXT PRIMARY KEY,
  connection_id   TEXT NOT NULL REFERENCES espm_connections(id) ON DELETE CASCADE,
  direction       TEXT NOT NULL CHECK (direction IN ('pull','push')),
  scope           TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  items_processed INTEGER NOT NULL DEFAULT 0,
  items_failed    INTEGER NOT NULL DEFAULT 0,
  message         TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
