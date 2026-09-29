import { classifySize, parseEmployees } from './sourcing/sizing.js';
import { crawlForEmails, normalizeWebsite } from './sourcing/crawler.js';
import { hunterDomainSearch } from './sourcing/hunter.js';
import { isUsableEmail, rootDomain } from './sourcing/emails.js';
import { normalizeState } from './data/geo.js';
import { SEGMENT_BY_KEY } from './data/segments.js';
import { tx } from './db.js';

export function makeLeads(db, config) {
  const q = {
    byPlace: db.prepare('SELECT * FROM businesses WHERE place_id = ?'),
    byDomain: db.prepare('SELECT * FROM businesses WHERE domain = ? ORDER BY id LIMIT 1'),
    byId: db.prepare('SELECT * FROM businesses WHERE id = ?'),
    insert: db.prepare(`INSERT INTO businesses
      (place_id, name, segment, category, website, domain, phone, address, city, state, zip, rating_count, employees, size_tier, size_source, status, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    setSize: db.prepare('UPDATE businesses SET size_tier = ?, size_source = ? WHERE id = ?'),
    bumpLocations: db.prepare('UPDATE businesses SET locations_seen = locations_seen + 1 WHERE id = ?'),
    contactByEmail: db.prepare('SELECT * FROM contacts WHERE email = ?'),
    insertContact: db.prepare(`INSERT INTO contacts (business_id, email, name, title, source, confidence, mx_ok, status)
      VALUES (?,?,?,?,?,?,?,?)`),
    suppressed: db.prepare('SELECT 1 FROM suppressions WHERE value = ? OR value = ?'),
    suppress: db.prepare('INSERT OR IGNORE INTO suppressions(value, reason) VALUES(?, ?)'),
  };

  function reclassify(id) {
    const b = q.byId.get(id);
    if (!b || b.size_source === 'manual') return b;
    const { tier, source } = classifySize({ employees: b.employees, locationsSeen: b.locations_seen, ratingCount: b.rating_count });
    q.setSize.run(tier, source, id);
    return { ...b, size_tier: tier, size_source: source };
  }

  /** Insert a business, or merge it into an existing one sharing the same place or website (chain). */
  function upsertBusiness(input) {
    if (input.place_id) {
      const existing = q.byPlace.get(input.place_id);
      if (existing) return { business: existing, created: false };
    }
    const site = normalizeWebsite(input.website);
    const domain = site?.domain || null;
    if (domain) {
      const existing = q.byDomain.get(domain);
      if (existing) {
        if (input.place_id) q.bumpLocations.run(existing.id);
        return { business: reclassify(existing.id), created: false, chain: Boolean(input.place_id) };
      }
    }
    const employees = parseEmployees(input.employees);
    const { tier, source } = classifySize({ employees, ratingCount: input.rating_count });
    const state = normalizeState(input.state);
    const segment = SEGMENT_BY_KEY[input.segment] ? input.segment : null;
    const info = q.insert.run(
      input.place_id || null, input.name, segment, input.category || null, site?.origin || null, domain,
      input.phone || null, input.address || null, input.city || null, state, input.zip || null,
      input.rating_count ?? null, employees, tier, source, domain ? 'new' : 'no_website', input.source || 'manual',
    );
    return { business: q.byId.get(Number(info.lastInsertRowid)), created: true };
  }

  function isSuppressed(email) {
    const e = email.toLowerCase();
    return Boolean(q.suppressed.get(e, e.split('@')[1]));
  }

  function addContact(businessId, { email, name = null, title = null, source = 'manual', confidence = 60, mx_ok = null }) {
    const e = String(email || '').trim().toLowerCase();
    if (!isUsableEmail(e)) return { error: 'invalid email' };
    const existing = q.contactByEmail.get(e);
    if (existing) return { contact: existing, created: false };
    const status = isSuppressed(e) ? 'unsubscribed' : 'active';
    q.insertContact.run(businessId, e, name, title, source, confidence, mx_ok == null ? null : mx_ok ? 1 : 0, status);
    return { contact: q.contactByEmail.get(e), created: true };
  }

  function suppress(value, reason) {
    const v = value.trim().toLowerCase();
    tx(db, () => {
      q.suppress.run(v, reason);
      if (v.includes('@')) {
        db.prepare("UPDATE contacts SET status = 'unsubscribed' WHERE email = ? AND status = 'active'").run(v);
      } else {
        db.prepare("UPDATE contacts SET status = 'unsubscribed' WHERE email LIKE ? AND status = 'active'").run('%@' + v);
      }
      db.prepare(`UPDATE enrollments SET status = 'stopped' WHERE status = 'active'
        AND contact_id IN (SELECT id FROM contacts WHERE status != 'active')`).run();
    });
  }

  /** Crawl the business website (and Hunter, if configured) for contacts. */
  async function enrich(businessId, { fetchImpl } = {}) {
    const b = q.byId.get(businessId);
    if (!b) throw new Error('business not found');
    if (!b.website) {
      db.prepare("UPDATE businesses SET crawled_at = datetime('now'), status = 'no_website' WHERE id = ?").run(b.id);
      return { added: 0 };
    }
    let added = 0;
    let error = null;
    try {
      const res = await crawlForEmails(b.website, fetchImpl ? { fetchImpl } : {});
      if (res.summary) db.prepare('UPDATE businesses SET site_summary = ? WHERE id = ?').run(res.summary, b.id);
      for (const e of res.emails.slice(0, 5)) {
        if (addContact(b.id, { email: e.email, source: `website${e.page}`, confidence: e.confidence, mx_ok: e.mx_ok }).created) added++;
      }
    } catch (err) {
      error = err.message;
    }
    if (config.hunterKey && b.domain) {
      try {
        const h = await hunterDomainSearch(config.hunterKey, b.domain);
        if (h.employees && !b.employees) {
          db.prepare('UPDATE businesses SET employees = ? WHERE id = ?').run(h.employees, b.id);
        }
        for (const e of h.emails.slice(0, 5)) {
          if (addContact(b.id, { ...e, source: 'hunter', mx_ok: true }).created) added++;
        }
      } catch (err) {
        error = error ? `${error}; ${err.message}` : err.message;
      }
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE business_id = ?').get(b.id).n;
    const status = b.status === 'new' || b.status === 'no_email' || b.status === 'enriched' ? (count ? 'enriched' : 'no_email') : b.status;
    db.prepare("UPDATE businesses SET crawled_at = datetime('now'), crawl_error = ?, status = ? WHERE id = ?").run(error, status, b.id);
    reclassify(b.id);
    return { added, error };
  }

  /** Import rows from a CSV (e.g. a trade-show list, ASI/PPAI export, or a data vendor file). */
  function importRows(rows, defaults = {}) {
    let businesses = 0;
    let contacts = 0;
    let skipped = 0;
    tx(db, () => {
      for (const r of rows) {
        const name = r.company || r.company_name || r.business || r.business_name || r.name || r.organization;
        const email = r.email || r.email_address || r.contact_email;
        const website = r.website || r.domain || r.url || (email && !/@(gmail|yahoo|outlook|hotmail|aol|icloud)\./i.test(email) ? email.split('@')[1] : '');
        if (!name && !email) { skipped++; continue; }
        const { business, created } = upsertBusiness({
          name: name || rootDomain(website) || email,
          website,
          segment: r.segment || defaults.segment,
          category: r.category || r.industry || null,
          phone: r.phone || r.phone_number,
          address: r.address || r.street,
          city: r.city,
          state: r.state || r.region,
          zip: r.zip || r.postal_code || r.zipcode,
          employees: r.employees || r.employee_count || r.headcount || r.company_size,
          source: 'csv',
        });
        if (created) businesses++;
        if (email) {
          const res = addContact(business.id, {
            email,
            name: r.contact_name || r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || null,
            title: r.title || r.job_title || r.position || null,
            source: 'csv',
            confidence: 80,
          });
          if (res.created) contacts++;
          if (res.created && business.status !== 'enriched') {
            db.prepare("UPDATE businesses SET status = 'enriched' WHERE id = ? AND status IN ('new','no_email','no_website')").run(business.id);
          }
        }
      }
    });
    return { businesses, contacts, skipped };
  }

  return { upsertBusiness, addContact, isSuppressed, suppress, enrich, importRows, reclassify, get: (id) => q.byId.get(id) };
}
