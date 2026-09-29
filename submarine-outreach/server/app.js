import express from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb, tx } from './db.js';
import { makeSettings, DEFAULT_SETTINGS } from './settings.js';
import { makeLeads } from './leads.js';
import { makeSender } from './mail/sender.js';
import { makeOutreach } from './mail/outreach.js';
import { makeInbox } from './mail/inbox.js';
import { makeAi } from './ai.js';
import { makeCatalog } from './catalog.js';
import { verifyUnsubscribeToken } from './mail/render.js';
import { parseCsv, toCsv } from './sourcing/csv.js';
import { searchPlaces } from './sourcing/places.js';
import { seedSweep, sweepStatus } from './sourcing/sweep.js';
import { SEGMENTS, SEGMENT_BY_KEY } from './data/segments.js';
import { STATES, normalizeState } from './data/geo.js';
import { STARTER_STEPS } from './templates.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const EDITABLE_SETTINGS = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'sweep_running');

export function createApp(config, { log = console, transportFactory } = {}) {
  const db = openDb(config.dbFile);
  const settings = makeSettings(db);
  if (!config.secret) {
    // Persist a random secret so unsubscribe links and sessions survive restarts.
    let s = settings.get('app_secret');
    if (!s) { s = randomBytes(32).toString('hex'); settings.set('app_secret', s); }
    config.secret = s;
  }
  const leads = makeLeads(db, config);
  const sender = makeSender({ db, settings, config, leads, ...(transportFactory ? { transportFactory } : {}) });
  const ai = makeAi({ config, settings });
  const catalog = makeCatalog(db, config);
  const outreach = makeOutreach({ db, settings, sender, catalog, ai, log });
  const inbox = makeInbox({
    db, settings, config, leads, log,
    onReply: (threadId) => {
      if (!ai.enabled()) return;
      const m = db.prepare("SELECT body FROM messages WHERE thread_id = ? AND direction = 'in' ORDER BY id DESC LIMIT 1").get(threadId);
      if (m) ai.classify(m.body).then((c) => {
        db.prepare('UPDATE threads SET classification = ? WHERE id = ?').run(c, threadId);
        if (c === 'interested') {
          db.prepare("UPDATE businesses SET status = 'interested' WHERE id = (SELECT business_id FROM threads WHERE id = ?)").run(threadId);
        }
      }).catch((e) => log.warn?.(`[ai] classify failed: ${e.message}`));
    },
  });
  seedSweep(db);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: false }));

  // ---------- Unsubscribe (public, no login) ----------
  const page = (title, body) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:60px auto;padding:0 16px;color:#1c2833">${body}</body>`;
  app.get('/u/:token', (req, res) => {
    const id = verifyUnsubscribeToken(req.params.token, config.secret);
    if (!id) return res.status(400).send(page('Invalid link', '<h2>This unsubscribe link is invalid.</h2><p>Reply "unsubscribe" to any email and we will remove you.</p>'));
    res.send(page('Unsubscribe', `<h2>Unsubscribe from ${escapeHtml(settings.get('company_name'))} emails?</h2>
      <form method="post"><button style="font-size:16px;padding:10px 18px">Yes, unsubscribe me</button></form>`));
  });
  app.post('/u/:token', (req, res) => {
    const id = verifyUnsubscribeToken(req.params.token, config.secret);
    const c = id && db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
    if (!c) return res.status(400).send(page('Invalid link', '<h2>This unsubscribe link is invalid.</h2>'));
    leads.suppress(c.email, 'unsubscribe link');
    db.prepare("UPDATE threads SET status = 'closed', classification = 'unsubscribe' WHERE contact_id = ?").run(c.id);
    res.send(page('Unsubscribed', `<h2>You're unsubscribed.</h2><p>${escapeHtml(c.email)} will not receive further emails from us.</p>`));
  });

  // ---------- Brochures (public, so recipients can open the link in an email) ----------
  app.get('/b/:token', (req, res) => {
    const b = catalog.getBrochureByToken(req.params.token);
    if (!b) return res.status(404).send(page('Not found', '<h2>This brochure is no longer available.</h2>'));
    res.setHeader('Content-Type', b.mime);
    res.setHeader('Content-Disposition', `inline; filename="${b.filename.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(b.data));
  });

  // ---------- Auth ----------
  const sessionValue = () => createHmac('sha256', config.secret).update(`session:${config.portalPassword}`).digest('hex');
  const cookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=').map(decodeURIComponent)));
  const authed = (req) => {
    if (!config.portalPassword) return true;
    const v = cookie(req).sid || '';
    const exp = sessionValue();
    return v.length === exp.length && timingSafeEqual(Buffer.from(v), Buffer.from(exp));
  };
  app.post('/api/login', (req, res) => {
    const given = Buffer.from(String(req.body?.password || ''));
    const want = Buffer.from(config.portalPassword);
    if (!config.portalPassword || (given.length === want.length && timingSafeEqual(given, want))) {
      res.setHeader('Set-Cookie', `sid=${sessionValue()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${config.publicUrl.startsWith('https') ? '; Secure' : ''}`);
      return res.json({ ok: true });
    }
    res.status(401).json({ error: 'Wrong password' });
  });
  app.get('/api/me', (req, res) => res.json({ authed: authed(req), passwordRequired: Boolean(config.portalPassword) }));
  app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'login required' })));

  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
    log.warn?.(`[api] ${req.method} ${req.path}: ${err.message}`);
    res.status(err.status || 400).json({ error: err.message });
  });

  // ---------- Meta / dashboard ----------
  app.get('/api/meta', (req, res) => res.json({
    segments: SEGMENTS.map(({ key, label, phase, pitch }) => ({ key, label, phase, pitch })),
    states: STATES.map(({ code, name }) => ({ code, name })),
    integrations: {
      places: Boolean(config.googlePlacesKey), hunter: Boolean(config.hunterKey), ai: ai.enabled(),
      smtp: sender.smtpConfigured(), imap: Boolean(config.imap.host && config.imap.user && config.imap.pass),
    },
    sendMode: settings.get('send_mode'),
    senderName: settings.get('sender_name'),
    requireApproval: settings.bool('require_approval'),
    reviewCount: db.prepare("SELECT COUNT(*) AS n FROM enrollments WHERE status = 'active' AND draft_state = 'ready'").get().n,
  }));

  app.get('/api/stats', (req, res) => {
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const tiers = db.prepare(`SELECT size_tier AS tier, COUNT(*) AS businesses,
      SUM(EXISTS(SELECT 1 FROM contacts c WHERE c.business_id = b.id AND c.status = 'active')) AS with_email
      FROM businesses b GROUP BY size_tier`).all();
    const statuses = db.prepare('SELECT status, COUNT(*) AS n FROM businesses GROUP BY status').all();
    const byState = db.prepare(`SELECT state, COUNT(*) AS n FROM businesses WHERE state IS NOT NULL GROUP BY state ORDER BY n DESC`).all();
    const bySegment = db.prepare('SELECT segment, COUNT(*) AS n FROM businesses GROUP BY segment ORDER BY n DESC').all();
    res.json({
      businesses: one('SELECT COUNT(*) AS n FROM businesses').n,
      contacts: one("SELECT COUNT(*) AS n FROM contacts WHERE status = 'active'").n,
      pendingCrawl: one("SELECT COUNT(*) AS n FROM businesses WHERE crawled_at IS NULL AND website IS NOT NULL").n,
      sentToday: outreach.sentToday(),
      dailyCap: settings.num('daily_cap'),
      sentTotal: one("SELECT COUNT(*) AS n FROM messages WHERE direction = 'out' AND status IN ('sent','dry_run')").n,
      replies: one("SELECT COUNT(DISTINCT thread_id) AS n FROM messages WHERE direction = 'in'").n,
      needsReply: one("SELECT COUNT(*) AS n FROM threads WHERE status = 'needs_reply'").n,
      activeEnrollments: one("SELECT COUNT(*) AS n FROM enrollments WHERE status = 'active'").n,
      toReview: one("SELECT COUNT(*) AS n FROM enrollments WHERE status = 'active' AND draft_state = 'ready'").n,
      suppressed: one('SELECT COUNT(*) AS n FROM suppressions').n,
      tiers, statuses, byState, bySegment,
      sweep: { running: settings.bool('sweep_running'), ...sweepStatus(db) },
      imap: { lastPoll: settings.get('imap_last_poll'), lastError: settings.get('imap_last_error') },
    });
  });

  // ---------- Leads ----------
  function leadFilter(qs) {
    const where = [];
    const params = [];
    if (qs.q) { where.push('(b.name LIKE ? OR b.domain LIKE ? OR b.city LIKE ? OR EXISTS (SELECT 1 FROM contacts c WHERE c.business_id = b.id AND c.email LIKE ?))'); const like = `%${qs.q}%`; params.push(like, like, like, like); }
    if (qs.state) { where.push('b.state = ?'); params.push(qs.state); }
    if (qs.tier) { where.push('b.size_tier = ?'); params.push(qs.tier); }
    if (qs.segment) { where.push('b.segment = ?'); params.push(qs.segment); }
    if (qs.status) { where.push('b.status = ?'); params.push(qs.status); }
    if (qs.has_email === '1') where.push("EXISTS (SELECT 1 FROM contacts c WHERE c.business_id = b.id AND c.status = 'active')");
    if (qs.has_email === '0') where.push("NOT EXISTS (SELECT 1 FROM contacts c WHERE c.business_id = b.id AND c.status = 'active')");
    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }
  const LEAD_COLS = `b.*, (SELECT c.email FROM contacts c WHERE c.business_id = b.id AND c.status = 'active' ORDER BY c.confidence DESC LIMIT 1) AS best_email,
    (SELECT COUNT(*) FROM contacts c WHERE c.business_id = b.id) AS contact_count`;
  const ORDER = "ORDER BY CASE b.size_tier WHEN 'small' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END, b.id DESC";

  app.get('/api/leads', (req, res) => {
    const { sql, params } = leadFilter(req.query);
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM businesses b ${sql}`).get(...params).n;
    const rows = db.prepare(`SELECT ${LEAD_COLS} FROM businesses b ${sql} ${ORDER} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    res.json({ total, rows });
  });

  app.get('/api/leads/export.csv', (req, res) => {
    const { sql, params } = leadFilter(req.query);
    const rows = db.prepare(`SELECT b.name, b.segment, b.size_tier, b.employees, b.city, b.state, b.phone, b.website, b.status,
      c.email, c.name AS contact_name, c.title, c.confidence, c.status AS email_status
      FROM businesses b LEFT JOIN contacts c ON c.business_id = b.id ${sql} ${ORDER}`).all(...params);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="submarine-leads.csv"');
    res.send(toCsv(rows, ['name', 'segment', 'size_tier', 'employees', 'city', 'state', 'phone', 'website', 'status', 'email', 'contact_name', 'title', 'confidence', 'email_status']));
  });

  app.get('/api/leads/:id', (req, res) => {
    const b = leads.get(Number(req.params.id));
    if (!b) return res.status(404).json({ error: 'not found' });
    res.json({
      business: b,
      contacts: db.prepare('SELECT * FROM contacts WHERE business_id = ? ORDER BY confidence DESC').all(b.id),
      threads: db.prepare('SELECT * FROM threads WHERE business_id = ? ORDER BY last_message_at DESC').all(b.id),
      enrollments: db.prepare(`SELECT e.*, k.name AS campaign FROM enrollments e JOIN campaigns k ON k.id = e.campaign_id
        JOIN contacts c ON c.id = e.contact_id WHERE c.business_id = ?`).all(b.id),
    });
  });

  app.patch('/api/leads/:id', wrap((req, res) => {
    const id = Number(req.params.id);
    const b = leads.get(id);
    if (!b) throw Object.assign(new Error('not found'), { status: 404 });
    const { status, notes, size_tier, employees, segment, name } = req.body;
    if (status) db.prepare('UPDATE businesses SET status = ? WHERE id = ?').run(status, id);
    if (notes !== undefined) db.prepare('UPDATE businesses SET notes = ? WHERE id = ?').run(notes, id);
    if (name) db.prepare('UPDATE businesses SET name = ? WHERE id = ?').run(name, id);
    if (segment !== undefined) db.prepare('UPDATE businesses SET segment = ? WHERE id = ?').run(SEGMENT_BY_KEY[segment] ? segment : null, id);
    if (size_tier) db.prepare("UPDATE businesses SET size_tier = ?, size_source = 'manual' WHERE id = ?").run(size_tier, id);
    if (employees !== undefined) {
      db.prepare('UPDATE businesses SET employees = ? WHERE id = ?').run(employees === '' ? null : Number(employees), id);
      if (!size_tier) leads.reclassify(id);
    }
    if (status === 'do_not_contact' && b.domain) leads.suppress(b.domain, 'marked do not contact');
    res.json(leads.get(id));
  }));

  app.post('/api/leads', wrap((req, res) => {
    const { business, created } = leads.upsertBusiness({ ...req.body, source: 'manual' });
    if (req.body.email) leads.addContact(business.id, { email: req.body.email, name: req.body.contact_name, title: req.body.title, confidence: 80 });
    res.json({ business: leads.get(business.id), created });
  }));

  app.post('/api/leads/:id/contacts', wrap((req, res) => {
    const r = leads.addContact(Number(req.params.id), { ...req.body, source: 'manual', confidence: 85 });
    if (r.error) throw new Error(r.error);
    db.prepare("UPDATE businesses SET status = 'enriched' WHERE id = ? AND status IN ('new','no_email','no_website')").run(Number(req.params.id));
    res.json(r.contact);
  }));

  app.delete('/api/contacts/:id', wrap((req, res) => {
    db.prepare('DELETE FROM contacts WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  }));

  app.post('/api/leads/:id/enrich', wrap(async (req, res) => {
    res.json(await leads.enrich(Number(req.params.id)));
  }));

  app.post('/api/leads/bulk', wrap(async (req, res) => {
    const ids = (req.body.ids || []).map(Number).filter(Boolean);
    const { action } = req.body;
    if (action === 'enrich') {
      db.prepare(`UPDATE businesses SET crawled_at = NULL WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
      return res.json({ queued: ids.length });
    }
    if (action === 'status') {
      const st = db.prepare('UPDATE businesses SET status = ? WHERE id = ?');
      tx(db, () => ids.forEach((id) => st.run(req.body.status, id)));
      return res.json({ updated: ids.length });
    }
    if (action === 'delete') {
      const del = db.prepare('DELETE FROM businesses WHERE id = ?');
      tx(db, () => ids.forEach((id) => del.run(id)));
      return res.json({ deleted: ids.length });
    }
    if (action === 'enroll') {
      return res.json({ enrolled: outreach.enroll(Number(req.body.campaign_id), { businessIds: ids }) });
    }
    throw new Error('unknown action');
  }));

  // ---------- Discovery ----------
  app.post('/api/discover/search', wrap(async (req, res) => {
    const { query, city, state, segment } = req.body;
    if (!query) throw new Error('query required');
    const where = [city, normalizeState(state) || state].filter(Boolean).join(', ');
    const places = await searchPlaces(config.googlePlacesKey, where ? `${query} in ${where}` : query);
    let created = 0;
    for (const p of places) if (leads.upsertBusiness({ ...p, segment, source: 'google_places' }).created) created++;
    res.json({ found: places.length, created });
  }));

  app.post('/api/discover/websites', wrap((req, res) => {
    const lines = String(req.body.websites || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    let created = 0;
    for (const w of lines) {
      const name = w.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      if (leads.upsertBusiness({ name, website: w, segment: req.body.segment, state: req.body.state, source: 'manual' }).created) created++;
    }
    res.json({ created, total: lines.length });
  }));

  app.post('/api/import/csv', wrap((req, res) => {
    const rows = parseCsv(String(req.body.csv || ''));
    if (!rows.length) throw new Error('No rows found — include a header line.');
    res.json(leads.importRows(rows, { segment: req.body.segment }));
  }));

  app.get('/api/sweep', (req, res) => res.json({ running: settings.bool('sweep_running'), phaseMax: settings.num('sweep_phase_max'), ...sweepStatus(db) }));
  app.post('/api/sweep', wrap((req, res) => {
    const { running, phaseMax, retryFailed, reset } = req.body;
    if (running === true && !config.googlePlacesKey) throw new Error('Set GOOGLE_PLACES_API_KEY to run the nationwide sweep.');
    if (running !== undefined) settings.set('sweep_running', running ? 'true' : 'false');
    if (phaseMax) settings.set('sweep_phase_max', Number(phaseMax));
    if (retryFailed) db.prepare("UPDATE sweep_jobs SET status = 'pending' WHERE status = 'failed'").run();
    if (reset) db.prepare("UPDATE sweep_jobs SET status = 'pending', results = 0, error = NULL").run();
    res.json({ running: settings.bool('sweep_running'), phaseMax: settings.num('sweep_phase_max'), ...sweepStatus(db) });
  }));

  // ---------- Campaigns ----------
  const loadCampaign = (id) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
    if (!c) throw Object.assign(new Error('campaign not found'), { status: 404 });
    c.steps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_no').all(id);
    c.stats = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM enrollments WHERE campaign_id = ? GROUP BY status').all(id).map((r) => [r.status, r.n]));
    c.sent = db.prepare("SELECT COUNT(*) AS n FROM messages WHERE campaign_id = ? AND status IN ('sent','dry_run')").get(id).n;
    return c;
  };
  const saveSteps = (id, steps) => {
    if (!Array.isArray(steps) || !steps.length) throw new Error('at least one step required');
    tx(db, () => {
      db.prepare('DELETE FROM campaign_steps WHERE campaign_id = ?').run(id);
      const ins = db.prepare('INSERT INTO campaign_steps(campaign_id, step_no, delay_days, subject, body) VALUES (?,?,?,?,?)');
      steps.forEach((s, i) => ins.run(id, i, i === 0 ? 0 : Math.max(1, Number(s.delay_days) || 3), String(s.subject || ''), String(s.body || '')));
    });
  };

  app.get('/api/campaigns', (req, res) => {
    res.json(db.prepare('SELECT id FROM campaigns ORDER BY id DESC').all().map((r) => loadCampaign(r.id)));
  });
  app.get('/api/campaigns/:id', wrap((req, res) => res.json(loadCampaign(Number(req.params.id)))));
  app.post('/api/campaigns', wrap((req, res) => {
    const id = Number(db.prepare('INSERT INTO campaigns(name) VALUES (?)').run(req.body.name || 'New campaign').lastInsertRowid);
    saveSteps(id, req.body.steps?.length ? req.body.steps : STARTER_STEPS);
    res.json(loadCampaign(id));
  }));
  app.put('/api/campaigns/:id', wrap((req, res) => {
    const id = Number(req.params.id);
    loadCampaign(id);
    if (req.body.name) db.prepare('UPDATE campaigns SET name = ? WHERE id = ?').run(req.body.name, id);
    if (req.body.steps) saveSteps(id, req.body.steps);
    if (req.body.status) {
      if (!['draft', 'active', 'paused'].includes(req.body.status)) throw new Error('bad status');
      if (req.body.status === 'active' && settings.get('send_mode') === 'live') {
        const r = sender.liveReadiness();
        if (!r.ready) throw new Error(`Cannot go live yet: ${r.missing.join(', ')}`);
      }
      db.prepare('UPDATE campaigns SET status = ? WHERE id = ?').run(req.body.status, id);
    }
    res.json(loadCampaign(id));
  }));
  app.delete('/api/campaigns/:id', wrap((req, res) => {
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  }));
  app.post('/api/campaigns/:id/enroll', wrap((req, res) => {
    const { segment, state, tier, limit } = req.body;
    res.json({ enrolled: outreach.enroll(Number(req.params.id), { segment, state, tier, limit: Math.min(Number(limit) || 200, 5000) }) });
  }));
  app.get('/api/campaigns/:id/enrollments', wrap((req, res) => {
    res.json(db.prepare(`SELECT e.*, c.email, b.name AS business, b.id AS business_id, b.state, b.size_tier FROM enrollments e
      JOIN contacts c ON c.id = e.contact_id JOIN businesses b ON b.id = c.business_id
      WHERE e.campaign_id = ? ORDER BY e.status, e.next_send_at LIMIT 500`).all(Number(req.params.id)));
  }));
  app.post('/api/campaigns/:id/preview', wrap((req, res) => {
    const contact = req.body.contact_id
      ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(req.body.contact_id))
      : db.prepare(`SELECT c.* FROM contacts c JOIN businesses b ON b.id = c.business_id WHERE c.status = 'active'
          ORDER BY CASE b.size_tier WHEN 'small' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END, c.confidence DESC LIMIT 1`).get();
    const business = contact ? leads.get(contact.business_id) : { name: 'Example Gift Co', city: 'Austin', state: 'TX', segment: 'gift_shop' };
    const steps = req.body.steps || loadCampaign(Number(req.params.id)).steps;
    res.json({ to: contact?.email || 'buyer@example-gift.co', steps: steps.map((s) => outreach.renderStep(s, contact || { name: 'Jamie Rivera' }, business)) });
  }));

  // ---------- Catalog: pen options and brochures ----------
  app.get('/api/catalog', (req, res) => res.json({ products: catalog.listProducts(), brochures: catalog.listBrochures() }));
  app.post('/api/products', wrap((req, res) => res.json({ id: catalog.saveProduct(req.body) })));
  app.delete('/api/products/:id', wrap((req, res) => { catalog.deleteProduct(req.params.id); res.json({ ok: true }); }));
  app.post('/api/brochures', wrap((req, res) => res.json(catalog.addBrochure(req.body))));
  app.delete('/api/brochures/:id', wrap((req, res) => { catalog.deleteBrochure(req.params.id); res.json({ ok: true }); }));

  // ---------- Review queue: every email is checked by a person before it is sent ----------
  app.get('/api/review', (req, res) => {
    res.json(db.prepare(`SELECT e.id, e.campaign_id, e.current_step, e.next_send_at, e.draft_subject, e.draft_body, e.draft_note, e.draft_hint,
        e.draft_products, e.draft_attachments,
        e.thread_id, k.name AS campaign, c.email, c.name AS contact_name, c.title AS contact_title, c.source AS contact_source,
        b.id AS business_id, b.name AS business, b.website, b.city, b.state, b.size_tier, b.segment, b.employees,
        b.site_summary, b.fit_score, b.fit_reason, b.phone
      FROM enrollments e JOIN campaigns k ON k.id = e.campaign_id JOIN contacts c ON c.id = e.contact_id
      JOIN businesses b ON b.id = c.business_id
      WHERE e.status = 'active' AND e.draft_state = 'ready'
      ORDER BY CASE b.size_tier WHEN 'small' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END, COALESCE(b.fit_score, 3) DESC, e.next_send_at
      LIMIT 100`).all().map((r) => ({
      ...r, draft_products: JSON.parse(r.draft_products || '[]'), draft_attachments: JSON.parse(r.draft_attachments || '[]'),
    })));
  });
  app.post('/api/review/:id/approve', wrap((req, res) => res.json(outreach.approve(Number(req.params.id), req.body))));
  app.post('/api/review/:id/regenerate', wrap(async (req, res) => res.json(await outreach.draftFor(Number(req.params.id), String(req.body.hint || '')))));
  app.post('/api/review/:id/skip', wrap((req, res) => {
    outreach.skip(Number(req.params.id), { notAFit: Boolean(req.body.not_a_fit) });
    res.json({ ok: true });
  }));
  app.post('/api/review/prepare', wrap(async (req, res) => res.json({ drafted: await outreach.prepareDrafts(10) })));

  // ---------- AI ----------
  app.post('/api/ai/sequence', wrap(async (req, res) => res.json({ steps: await ai.draftSequence(req.body) })));
  app.post('/api/ai/reply', wrap(async (req, res) => {
    const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(Number(req.body.thread_id));
    if (!thread) throw new Error('thread not found');
    const messages = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id').all(thread.id);
    const body = await ai.draftReply({
      thread, messages,
      business: thread.business_id && leads.get(thread.business_id),
      contact: thread.contact_id && db.prepare('SELECT * FROM contacts WHERE id = ?').get(thread.contact_id),
      instructions: req.body.instructions,
    });
    res.json({ body });
  }));

  // ---------- Inbox ----------
  app.get('/api/threads', (req, res) => {
    const where = [];
    const params = [];
    if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
    if (req.query.classification) { where.push('t.classification = ?'); params.push(req.query.classification); }
    if (req.query.has_reply === '1') where.push("EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.direction = 'in')");
    res.json(db.prepare(`SELECT t.*, c.email, c.name AS contact_name, b.name AS business, b.state, b.size_tier,
      (SELECT body FROM messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS snippet,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count
      FROM threads t LEFT JOIN contacts c ON c.id = t.contact_id LEFT JOIN businesses b ON b.id = t.business_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.unread DESC, t.last_message_at DESC LIMIT 300`).all(...params)
      .map((t) => ({ ...t, snippet: (t.snippet || '').slice(0, 160) })));
  });
  app.get('/api/threads/:id', wrap((req, res) => {
    const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(Number(req.params.id));
    if (!t) throw Object.assign(new Error('not found'), { status: 404 });
    db.prepare('UPDATE threads SET unread = 0 WHERE id = ?').run(t.id);
    res.json({
      thread: t,
      contact: t.contact_id ? db.prepare('SELECT * FROM contacts WHERE id = ?').get(t.contact_id) : null,
      business: t.business_id ? leads.get(t.business_id) : null,
      messages: db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY id').all(t.id),
    });
  }));
  app.patch('/api/threads/:id', wrap((req, res) => {
    const id = Number(req.params.id);
    if (req.body.status) db.prepare('UPDATE threads SET status = ? WHERE id = ?').run(req.body.status, id);
    if (req.body.classification) db.prepare('UPDATE threads SET classification = ? WHERE id = ?').run(req.body.classification, id);
    res.json(db.prepare('SELECT * FROM threads WHERE id = ?').get(id));
  }));
  app.post('/api/threads/:id/reply', wrap(async (req, res) => {
    const t = db.prepare('SELECT * FROM threads WHERE id = ?').get(Number(req.params.id));
    if (!t) throw new Error('thread not found');
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(t.contact_id);
    const prior = db.prepare('SELECT message_id, subject FROM messages WHERE thread_id = ? ORDER BY id').all(t.id);
    const references = prior.map((m) => m.message_id).filter(Boolean);
    const base = (prior[0]?.subject || t.subject || '').replace(/^re:\s*/i, '');
    if (!contact) throw new Error('thread has no contact');
    const attachments = catalog.getBrochures(req.body.attachments || [])
      .map((b) => ({ filename: b.filename, content: Buffer.from(b.data), contentType: b.mime }));
    const r = await sender.send({ contact, subject: req.body.subject || `Re: ${base}`, body: String(req.body.body || ''), threadId: t.id, inReplyTo: references.at(-1), references, attachments });
    res.json(r);
  }));
  app.post('/api/compose', wrap(async (req, res) => {
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(Number(req.body.contact_id));
    if (!contact) throw new Error('contact not found');
    res.json(await sender.send({ contact, subject: String(req.body.subject || ''), body: String(req.body.body || '') }));
  }));
  app.post('/api/inbox/poll', wrap(async (req, res) => res.json(await inbox.poll())));

  app.get('/api/outbox', (req, res) => {
    res.json(db.prepare(`SELECT m.id, m.thread_id, m.to_addr, m.subject, m.status, m.error, m.created_at, m.step_no, k.name AS campaign
      FROM messages m LEFT JOIN campaigns k ON k.id = m.campaign_id WHERE m.direction = 'out' ORDER BY m.id DESC LIMIT 300`).all());
  });

  // ---------- Suppressions & settings ----------
  app.get('/api/suppressions', (req, res) => res.json(db.prepare('SELECT * FROM suppressions ORDER BY created_at DESC LIMIT 1000').all()));
  app.post('/api/suppressions', wrap((req, res) => {
    for (const v of String(req.body.values || '').split(/[\s,;]+/).filter(Boolean)) leads.suppress(v, req.body.reason || 'manual');
    res.json({ ok: true });
  }));
  app.delete('/api/suppressions/:value', wrap((req, res) => {
    db.prepare('DELETE FROM suppressions WHERE value = ?').run(req.params.value);
    res.json({ ok: true });
  }));

  app.get('/api/settings', (req, res) => {
    const all = settings.all();
    res.json({
      settings: Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, all[k]])),
      live: sender.liveReadiness(),
      env: {
        PUBLIC_URL: config.publicUrl, SMTP_HOST: config.smtp.host || null, SMTP_USER: config.smtp.user || null,
        IMAP_HOST: config.imap.host || null, IMAP_USER: config.imap.user || null, ANTHROPIC_MODEL: config.anthropicModel,
        PORTAL_PASSWORD: Boolean(config.portalPassword),
      },
    });
  });
  app.put('/api/settings', wrap((req, res) => {
    for (const [k, v] of Object.entries(req.body || {})) if (EDITABLE_SETTINGS.includes(k)) settings.set(k, v);
    if (settings.get('send_mode') === 'live') {
      const r = sender.liveReadiness();
      if (!r.ready) {
        settings.set('send_mode', 'dry_run');
        throw new Error(`Saved, but kept Dry-run mode. To send live, first set: ${r.missing.join(', ')}`);
      }
    }
    res.json({ ok: true });
  }));
  app.post('/api/settings/test-smtp', wrap(async (req, res) => {
    if (!sender.smtpConfigured()) throw new Error('SMTP env vars not set');
    await sender.verify();
    res.json({ ok: true });
  }));

  app.use(express.static(PUBLIC_DIR));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));

  return { app, db, settings, leads, sender, outreach, inbox, ai, catalog };
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
