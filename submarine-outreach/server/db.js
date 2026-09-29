import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY,
  place_id TEXT UNIQUE,
  name TEXT NOT NULL,
  segment TEXT,
  category TEXT,
  website TEXT,
  domain TEXT,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  rating_count INTEGER,
  locations_seen INTEGER NOT NULL DEFAULT 1,
  employees INTEGER,
  size_tier TEXT NOT NULL DEFAULT 'small',
  size_source TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT,
  crawled_at TEXT,
  crawl_error TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biz_domain ON businesses(domain);
CREATE INDEX IF NOT EXISTS idx_biz_state ON businesses(state);
CREATE INDEX IF NOT EXISTS idx_biz_tier ON businesses(size_tier, segment);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  title TEXT,
  source TEXT,
  confidence INTEGER NOT NULL DEFAULT 50,
  mx_ok INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contact_biz ON contacts(business_id);

CREATE TABLE IF NOT EXISTS suppressions (
  value TEXT PRIMARY KEY COLLATE NOCASE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaign_steps (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  delay_days INTEGER NOT NULL DEFAULT 0,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE(campaign_id, step_no)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 0,
  next_send_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'active',
  thread_id INTEGER,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(campaign_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_enroll_due ON enrollments(status, next_send_at);

CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  classification TEXT,
  unread INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER REFERENCES threads(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  message_id TEXT UNIQUE,
  in_reply_to TEXT,
  from_addr TEXT,
  to_addr TEXT,
  subject TEXT,
  body TEXT,
  status TEXT NOT NULL,
  error TEXT,
  campaign_id INTEGER,
  step_no INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(direction, created_at);

CREATE TABLE IF NOT EXISTS sweep_jobs (
  id INTEGER PRIMARY KEY,
  segment TEXT NOT NULL,
  query TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  results INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TEXT,
  UNIQUE(query, city, state)
);
CREATE INDEX IF NOT EXISTS idx_sweep_pending ON sweep_jobs(status, priority);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; rolls back on throw. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
