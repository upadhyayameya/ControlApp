import { SEGMENT_BY_KEY } from '../data/segments.js';
import { stateTimezone } from '../data/geo.js';
import { inBusinessHours, mergeVars, renderTemplate } from './render.js';

const TIER_ORDER = "CASE b.size_tier WHEN 'small' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END";

export function makeOutreach({ db, settings, sender, catalog, ai = null, log = console }) {
  function sentToday() {
    return db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'out' AND status IN ('sent','dry_run')
      AND campaign_id IS NOT NULL AND created_at >= datetime('now', '-1 day')`).get().n;
  }

  function lastSendAt() {
    const row = db.prepare("SELECT MAX(created_at) AS t FROM messages WHERE direction = 'out' AND campaign_id IS NOT NULL").get();
    return row?.t ? new Date(row.t.replace(' ', 'T') + 'Z') : null;
  }

  /** Render a campaign step for one contact (used for previews, and for drafts when AI is off). */
  function renderStep(step, contact, business, products = catalog.productsFor(business?.segment)) {
    const brochure = catalog.brochureFor(products);
    const url = brochure ? catalog.brochureUrl(brochure) : null;
    const vars = mergeVars({
      contact, business, segment: SEGMENT_BY_KEY[business?.segment], settings: settings.all(),
      products: catalog.productLines(products), brochureUrl: url || '',
    });
    // The line holding {{brochure_link}}: kept with a link, reworded when the PDF will be attached, dropped with no brochure.
    const linkLine = /^[^\n]*\{\{\s*brochure_link[^}]*\}\}[^\n]*$/gim;
    let template = step.body;
    if (!url) template = template.replace(linkLine, brochure ? "I've attached our catalog so you can see the full range." : '');
    const body = renderTemplate(template, vars);
    return { subject: renderTemplate(step.subject, vars), body: body.replace(/\n{3,}/g, '\n\n') };
  }

  /**
   * Enroll contacts matching a filter. Smallest businesses first; large ones only when allowed.
   * Returns how many were enrolled.
   */
  function enroll(campaignId, { segment, state, tier, businessIds, limit = 500 } = {}) {
    const where = ["c.status = 'active'", "b.status NOT IN ('not_interested','not_a_fit','customer','do_not_contact')"];
    const params = [];
    if (!settings.bool('allow_large')) where.push("b.size_tier != 'large'");
    if (segment) { where.push('b.segment = ?'); params.push(segment); }
    if (state) { where.push('b.state = ?'); params.push(state); }
    if (tier) { where.push('b.size_tier = ?'); params.push(tier); }
    if (businessIds?.length) { where.push(`b.id IN (${businessIds.map(() => '?').join(',')})`); params.push(...businessIds.map(Number)); }
    // One contact per business per campaign: the highest-confidence address.
    const rows = db.prepare(`
      SELECT c.id FROM contacts c JOIN businesses b ON b.id = c.business_id
      WHERE ${where.join(' AND ')}
        AND c.id = (SELECT c2.id FROM contacts c2 WHERE c2.business_id = b.id AND c2.status = 'active' ORDER BY c2.confidence DESC, c2.id LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.contact_id = c.id AND e.campaign_id = ?)
        AND NOT EXISTS (SELECT 1 FROM enrollments e2 JOIN contacts c3 ON c3.id = e2.contact_id
                        WHERE c3.business_id = b.id AND e2.status = 'active')
      ORDER BY ${TIER_ORDER}, b.id
      LIMIT ?`).all(...params, campaignId, limit);
    const ins = db.prepare('INSERT OR IGNORE INTO enrollments(campaign_id, contact_id) VALUES (?, ?)');
    db.exec('BEGIN');
    try {
      for (const r of rows) ins.run(campaignId, r.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return rows.length;
  }

  const loadEnrollment = (id) => db.prepare('SELECT * FROM enrollments WHERE id = ?').get(id);

  /** Subject/threading context for the enrollment's current step. */
  function threadContext(enr, step, fallbackSubject) {
    if (!enr.thread_id) return { subject: fallbackSubject, inReplyTo: null, references: [], history: [] };
    const prior = db.prepare('SELECT message_id, subject, body, direction FROM messages WHERE thread_id = ? ORDER BY id').all(enr.thread_id);
    const references = prior.map((m) => m.message_id).filter(Boolean);
    const first = prior[0]?.subject?.replace(/^re:\s*/i, '') || fallbackSubject;
    return { subject: `Re: ${first}`, inReplyTo: references.at(-1) || null, references, history: prior };
  }

  /**
   * Write the email for one enrollment's current step. With AI, it is written individually from the
   * business's own website; without AI, the campaign template is filled in. Either way a person can
   * edit it in the Review queue before it goes anywhere.
   */
  async function draftFor(enrollmentId, hint = '') {
    const enr = loadEnrollment(enrollmentId);
    if (!enr || enr.status !== 'active') throw new Error('enrollment is not active');
    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(enr.contact_id);
    const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(contact.business_id);
    const step = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? AND step_no = ?').get(enr.campaign_id, enr.current_step);
    if (!step) {
      db.prepare("UPDATE enrollments SET status = 'completed', draft_state = NULL WHERE id = ?").run(enr.id);
      throw new Error('no more steps');
    }
    const suggested = catalog.productsFor(business.segment);
    const templated = renderStep(step, contact, business, suggested);
    const ctx = threadContext(enr, step, templated.subject);
    let subject = templated.subject;
    let body = templated.body;
    let chosen = suggested;
    let note = ai?.enabled() ? null : 'Filled-in template — add an ANTHROPIC_API_KEY to have each email written individually';
    if (ai?.enabled()) {
      try {
        const all = catalog.listProducts({ activeOnly: true });
        const d = await ai.draftPersonal({
          business, contact, step, stepIndex: enr.current_step, history: ctx.history,
          hint: hint || enr.draft_hint || '', catalog: all, brochure: catalog.brochureFor(suggested),
        });
        if (d.body) {
          subject = d.subject || subject;
          body = d.body;
          if (d.product_ids.length) chosen = all.filter((p) => d.product_ids.includes(p.id));
        }
        db.prepare('UPDATE businesses SET fit_score = ?, fit_reason = ? WHERE id = ?').run(d.fit, d.fit_reason, business.id);
      } catch (err) {
        note = `AI draft failed, showing the template instead: ${err.message}`;
      }
    }
    // Attach PDFs when you prefer attachments, or when there's no link recipients could open.
    const mainBrochure = catalog.brochureFor(chosen);
    const attach = settings.get('brochure_mode') === 'attach'
      ? [...new Set(chosen.map((p) => p.brochure?.id).filter(Boolean))].slice(0, 2)
      : mainBrochure && !catalog.brochureUrl(mainBrochure) ? [mainBrochure.id] : [];
    if (enr.thread_id) subject = ctx.subject; // follow-ups stay in the same thread
    const state = settings.bool('require_approval') ? 'ready' : 'approved';
    db.prepare(`UPDATE enrollments SET draft_subject = ?, draft_body = ?, draft_state = ?, draft_note = ?, draft_hint = ?,
      draft_products = ?, draft_attachments = ? WHERE id = ?`)
      .run(subject, body, state, note, hint || enr.draft_hint || null, JSON.stringify(chosen.map((p) => p.id)), JSON.stringify(attach), enr.id);
    return loadEnrollment(enr.id);
  }

  /** Background: prepare drafts for emails due within the next day, smallest businesses first. */
  async function prepareDrafts(limit = 3) {
    const rows = db.prepare(`
      SELECT e.id FROM enrollments e
      JOIN campaigns k ON k.id = e.campaign_id AND k.status = 'active'
      JOIN contacts c ON c.id = e.contact_id JOIN businesses b ON b.id = c.business_id
      WHERE e.status = 'active' AND e.draft_state IS NULL AND e.next_send_at <= datetime('now', '+1 day')
      ORDER BY ${TIER_ORDER}, e.next_send_at LIMIT ?`).all(limit);
    let made = 0;
    for (const r of rows) {
      db.prepare("UPDATE enrollments SET draft_state = 'drafting' WHERE id = ?").run(r.id);
      try {
        await draftFor(r.id);
        made++;
      } catch (err) {
        db.prepare("UPDATE enrollments SET draft_state = NULL, last_error = ? WHERE id = ? AND draft_state = 'drafting'").run(err.message, r.id);
        log.warn?.(`[drafts] ${r.id}: ${err.message}`);
      }
    }
    return made;
  }

  function approve(enrollmentId, { subject, body, attachments } = {}) {
    const enr = loadEnrollment(enrollmentId);
    if (!enr || enr.status !== 'active') throw new Error('enrollment is not active');
    const finalSubject = String(subject ?? enr.draft_subject ?? '').trim();
    const finalBody = String(body ?? enr.draft_body ?? '').trim();
    if (!finalSubject || !finalBody) throw new Error('subject and body are required');
    if (/\{\{[^}]*\}\}/.test(finalSubject + finalBody)) throw new Error('the email still contains a {{placeholder}}');
    const att = attachments === undefined ? enr.draft_attachments : JSON.stringify((attachments || []).map(Number).filter(Boolean));
    db.prepare("UPDATE enrollments SET draft_subject = ?, draft_body = ?, draft_attachments = ?, draft_state = 'approved', last_error = NULL WHERE id = ?")
      .run(finalSubject, finalBody, att, enr.id);
    return loadEnrollment(enr.id);
  }

  function skip(enrollmentId, { notAFit = false } = {}) {
    const enr = loadEnrollment(enrollmentId);
    if (!enr) throw new Error('not found');
    db.prepare("UPDATE enrollments SET status = 'stopped', draft_state = NULL WHERE id = ?").run(enr.id);
    if (notAFit) {
      db.prepare("UPDATE businesses SET status = 'not_a_fit' WHERE id = (SELECT business_id FROM contacts WHERE id = ?)").run(enr.contact_id);
    }
  }

  /** Send at most one approved, due email, respecting daily cap, spacing and recipient business hours. */
  async function tick(now = new Date()) {
    const s = settings.all();
    if (sentToday() >= Number(s.daily_cap)) return { sent: false, reason: 'daily cap reached' };
    const last = lastSendAt();
    if (last && now - last < Number(s.min_gap_seconds) * 1000) return { sent: false, reason: 'spacing' };
    // A person doesn't send on a metronome: after each send we wait the minimum gap plus a random extra.
    const after = Number(s.next_send_after || 0);
    if (after && now.getTime() < after) return { sent: false, reason: 'spacing' };

    const due = db.prepare(`
      SELECT e.*, c.email, b.state, b.size_tier FROM enrollments e
      JOIN campaigns k ON k.id = e.campaign_id AND k.status = 'active'
      JOIN contacts c ON c.id = e.contact_id
      JOIN businesses b ON b.id = c.business_id
      WHERE e.status = 'active' AND e.draft_state = 'approved' AND e.next_send_at <= datetime('now')
      ORDER BY ${TIER_ORDER}, e.next_send_at LIMIT 50`).all();
    const hours = { start: Number(s.business_hours_start), end: Number(s.business_hours_end), weekdaysOnly: s.weekdays_only === 'true' };
    const pick = due.find((e) => inBusinessHours(now, stateTimezone(e.state), hours));
    if (!pick) return { sent: false, reason: due.length ? 'outside recipient business hours' : 'nothing approved and due' };

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(pick.contact_id);
    const steps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_no').all(pick.campaign_id);
    const step = steps[pick.current_step];
    if (!step || contact.status !== 'active') {
      db.prepare('UPDATE enrollments SET status = ?, draft_state = NULL WHERE id = ?').run(step ? 'stopped' : 'completed', pick.id);
      return { sent: false, reason: 'enrollment closed' };
    }
    const ctx = threadContext(pick, step, pick.draft_subject);
    const subject = pick.thread_id ? ctx.subject : pick.draft_subject;

    try {
      const attachments = catalog.getBrochures(JSON.parse(pick.draft_attachments || '[]'))
        .map((b) => ({ filename: b.filename, content: Buffer.from(b.data), contentType: b.mime }));
      const res = await sender.send({
        contact, subject, body: pick.draft_body, threadId: pick.thread_id, campaignId: pick.campaign_id,
        stepNo: step.step_no, inReplyTo: ctx.inReplyTo, references: ctx.references, attachments,
      });
      const gap = Number(s.min_gap_seconds) * 1000;
      settings.set('next_send_after', now.getTime() + gap + Math.round(Math.random() * gap * 1.5));
      const next = steps[pick.current_step + 1];
      if (next) {
        db.prepare(`UPDATE enrollments SET current_step = current_step + 1, thread_id = ?, last_error = NULL,
          draft_state = NULL, draft_subject = NULL, draft_body = NULL, draft_note = NULL, draft_hint = NULL,
          draft_products = NULL, draft_attachments = NULL,
          next_send_at = datetime('now', ?) WHERE id = ?`).run(res.threadId, `+${Number(next.delay_days) || 3} days`, pick.id);
      } else {
        db.prepare(`UPDATE enrollments SET current_step = current_step + 1, thread_id = ?, status = 'completed',
          draft_state = NULL, last_error = NULL WHERE id = ?`).run(res.threadId, pick.id);
      }
      log.info?.(`[outreach] ${res.status} → ${contact.email} (campaign ${pick.campaign_id}, step ${step.step_no})`);
      return { sent: true, status: res.status, to: contact.email };
    } catch (err) {
      db.prepare("UPDATE enrollments SET last_error = ?, next_send_at = datetime('now', '+1 hour') WHERE id = ?").run(err.message, pick.id);
      if (/not configured/.test(err.message)) db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = ?").run(pick.campaign_id);
      if (/suppression|contact is/.test(err.message)) db.prepare("UPDATE enrollments SET status = 'stopped' WHERE id = ?").run(pick.id);
      log.warn?.(`[outreach] failed → ${contact.email}: ${err.message}`);
      return { sent: false, reason: err.message };
    }
  }

  return { enroll, tick, renderStep, sentToday, draftFor, prepareDrafts, approve, skip };
}
