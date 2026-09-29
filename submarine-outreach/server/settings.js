// Non-secret settings live in the database and are editable from the Settings page.
// Secrets (SMTP/IMAP passwords, API keys) come only from environment variables.
export const DEFAULT_SETTINGS = {
  company_name: 'Submarine Pens',
  sender_name: '',
  sender_title: 'US Partnerships',
  sender_phone: '',
  signature: '', // optional custom signature block; built from name/title/phone/website when empty
  sample_offer: 'a few sample pens by mail, no charge',
  brochure_mode: 'link', // link | attach — links avoid spam filters on first contact; attach per email in Review
  from_email: '',
  reply_to: '',
  physical_address: '',
  website: 'https://www.submarinepens.com',
  company_profile:
    'Submarine Pens is a Mumbai-based manufacturer of metal writing instruments, making pens since 1995 and serving ' +
    'corporate gifting since 2012. Range: metal ball and roller pens, crystal series, doctor-clip pens, fountain pens, ' +
    'mini pens, pen-drive pens, a coffee-aroma collection (Americano, Cappuccino, Mocha, Espresso, Latte, Macchiato) ' +
    'and space-themed designs. Offers custom logo imprint/engraving, gift packaging and factory-direct wholesale pricing ' +
    'with export experience to the US, UK, EU, Canada, Australia and Brazil.',
  send_mode: 'dry_run', // dry_run | live
  require_approval: 'true', // every email waits in the Review queue until a person approves it
  daily_cap: '20',
  min_gap_seconds: '90',
  business_hours_start: '9',
  business_hours_end: '16',
  weekdays_only: 'true',
  allow_large: 'false', // big businesses come later: excluded from enrollment until switched on
  sweep_running: 'false',
  sweep_phase_max: '2',
  sweep_daily_limit: '300',
  crawl_concurrency: '3',
};

export function makeSettings(db) {
  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setStmt = db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const get = (key) => {
    const row = getStmt.get(key);
    return row ? row.value : DEFAULT_SETTINGS[key] ?? null;
  };
  return {
    get,
    num: (key) => Number(get(key)),
    bool: (key) => get(key) === 'true',
    set: (key, value) => setStmt.run(key, value == null ? null : String(value)),
    all() {
      const out = { ...DEFAULT_SETTINGS };
      for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
      return out;
    },
  };
}

export function envConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
    dbFile: env.DB_FILE || 'data/outreach.db',
    portalPassword: env.PORTAL_PASSWORD || '',
    secret: env.APP_SECRET || '',
    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT || 587),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
    },
    imap: {
      host: env.IMAP_HOST || '',
      port: Number(env.IMAP_PORT || 993),
      user: env.IMAP_USER || env.SMTP_USER || '',
      pass: env.IMAP_PASS || env.SMTP_PASS || '',
      mailbox: env.IMAP_MAILBOX || 'INBOX',
    },
    googlePlacesKey: env.GOOGLE_PLACES_API_KEY || '',
    hunterKey: env.HUNTER_API_KEY || '',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  };
}

/** True when recipients can reach this address (not localhost / a private machine name). */
export function isPublicUrl(url) {
  return /^https?:\/\//i.test(url || '') && !/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|[^/]+\.local\b)/i.test(url);
}

// Connection details you can enter on the Settings page instead of in .env (handy when running the
// portal on your own computer). Stored in the local database; values set here override .env.
export const CONNECTION_FIELDS = {
  smtp_host: { path: ['smtp', 'host'] },
  smtp_port: { path: ['smtp', 'port'], number: true },
  smtp_user: { path: ['smtp', 'user'] },
  smtp_pass: { path: ['smtp', 'pass'], secret: true },
  imap_host: { path: ['imap', 'host'] },
  imap_port: { path: ['imap', 'port'], number: true },
  imap_user: { path: ['imap', 'user'] },
  imap_pass: { path: ['imap', 'pass'], secret: true },
  google_places_key: { path: ['googlePlacesKey'], secret: true },
  hunter_key: { path: ['hunterKey'], secret: true },
  anthropic_key: { path: ['anthropicKey'], secret: true },
  public_url: { path: ['publicUrl'] },
};

/** Re-apply saved connection details on top of the .env baseline, mutating `config` in place. */
export function applyConnections(config, settings) {
  config.envBase ??= structuredClone({ smtp: config.smtp, imap: config.imap, googlePlacesKey: config.googlePlacesKey, hunterKey: config.hunterKey, anthropicKey: config.anthropicKey, publicUrl: config.publicUrl });
  for (const [key, f] of Object.entries(CONNECTION_FIELDS)) {
    const saved = settings.get(`conn_${key}`);
    const base = f.path.reduce((o, k) => o?.[k], config.envBase);
    let value = saved != null && saved !== '' ? saved : base;
    if (f.number) value = Number(value) || base;
    if (key === 'public_url' && value) value = String(value).replace(/\/$/, '');
    const parent = f.path.slice(0, -1).reduce((o, k) => o[k], config);
    parent[f.path.at(-1)] = value;
  }
  // IMAP login defaults to the SMTP login (same mailbox) unless set separately.
  if (!settings.get('conn_imap_user') && !config.envBase.imap.user) config.imap.user = config.smtp.user;
  if (!settings.get('conn_imap_pass') && !config.envBase.imap.pass) config.imap.pass = config.smtp.pass;
  return config;
}

/** What the Settings page may show: plain values, and only whether each secret is set. */
export function describeConnections(config) {
  const out = {};
  for (const [key, f] of Object.entries(CONNECTION_FIELDS)) {
    const v = f.path.reduce((o, k) => o?.[k], config);
    out[key] = f.secret ? { set: Boolean(v) } : { value: key === 'public_url' && !isPublicUrl(v) ? '' : v ?? '' };
  }
  return out;
}
