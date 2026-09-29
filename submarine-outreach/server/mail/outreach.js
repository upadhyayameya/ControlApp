import { SEGMENT_BY_KEY } from '../data/segments.js';
import { stateTimezone } from '../data/geo.js';
import { inBusinessHours, mergeVars, renderTemplate } from './render.js';

const TIER_ORDER = "CASE b.size_tier WHEN 'small' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END";

export function makeOutreach({ db, settings, sender, log = console }) {
  function sentToday() {
    return db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'out' AND status IN ('sent','dry_run')
      AND campaign_id IS NOT NULL AND created_at >= datetime('now', '-1 day')`).get().n;
  }

  function lastSendAt() {
    const row = db.prepare("SELECT MAX(created_at) AS t FROM messages WHERE direction = 'out' AND campaign_id IS NOT NULL").get();
    return row?.t ? new Date(row.t.replace(' ', 'T') + 'Z') : null;
  }

  /** Render a campaign step for one contact (used for previews and sending). */
  function renderStep(step, contact, business) {
    const vars = mergeVars({ contact, business, segment: SEGMENT_BY_KEY[business?.segment], settings: settings.all() });
    return { subject: renderTemplate(step.subject, vars), body: renderTemplate(step.body, vars) };
  }

  /**
   * Enroll contacts matching a filter. Smallest businesses first; large ones only when allowed.
   * Returns how many were enrolled.
   */
  function enroll(campaignId, { segment, state, tier, businessIds, limit = 500 } = {}) {
    const where = ["c.status = 'active'", "b.status NOT IN ('not_interested','customer','do_not_contact')"];
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

  /** Send at most one due email, respecting daily cap, spacing and recipient business hours. */
  async function tick(now = new Date()) {
    const s = settings.all();
    if (sentToday() >= Number(s.daily_cap)) return { sent: false, reason: 'daily cap reached' };
    const last = lastSendAt();
    if (last && now - last < Number(s.min_gap_seconds) * 1000) return { sent: false, reason: 'spacing' };

    const due = db.prepare(`
      SELECT e.*, c.email, b.state, b.size_tier FROM enrollments e
      JOIN campaigns k ON k.id = e.campaign_id AND k.status = 'active'
      JOIN contacts c ON c.id = e.contact_id
      JOIN businesses b ON b.id = c.business_id
      WHERE e.status = 'active' AND e.next_send_at <= datetime('now')
      ORDER BY ${TIER_ORDER}, e.next_send_at LIMIT 50`).all();
    const hours = { start: Number(s.business_hours_start), end: Number(s.business_hours_end), weekdaysOnly: s.weekdays_only === 'true' };
    const pick = due.find((e) => inBusinessHours(now, stateTimezone(e.state), hours));
    if (!pick) return { sent: false, reason: due.length ? 'outside recipient business hours' : 'nothing due' };

    const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(pick.contact_id);
    const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(contact.business_id);
    const steps = db.prepare('SELECT * FROM campaign_steps WHERE campaign_id = ? ORDER BY step_no').all(pick.campaign_id);
    const step = steps[pick.current_step];
    if (!step || contact.status !== 'active') {
      db.prepare("UPDATE enrollments SET status = ? WHERE id = ?").run(step ? 'stopped' : 'completed', pick.id);
      return { sent: false, reason: 'enrollment closed' };
    }

    let { subject, body } = renderStep(step, contact, business);
    let inReplyTo = null;
    let references = [];
    if (pick.thread_id) {
      const prior = db.prepare("SELECT message_id, subject FROM messages WHERE thread_id = ? ORDER BY id").all(pick.thread_id);
      references = prior.map((m) => m.message_id).filter(Boolean);
      inReplyTo = references.at(-1) || null;
      if (step.subject.trim() === '' || /^re:/i.test(step.subject)) subject = `Re: ${prior[0]?.subject?.replace(/^re:\s*/i, '') || subject}`;
    }

    try {
      const res = await sender.send({ contact, subject, body, threadId: pick.thread_id, campaignId: pick.campaign_id, stepNo: step.step_no, inReplyTo, references });
      const next = steps[pick.current_step + 1];
      if (next) {
        db.prepare(`UPDATE enrollments SET current_step = current_step + 1, thread_id = ?, last_error = NULL,
          next_send_at = datetime('now', ?) WHERE id = ?`).run(res.threadId, `+${Number(next.delay_days) || 3} days`, pick.id);
      } else {
        db.prepare("UPDATE enrollments SET current_step = current_step + 1, thread_id = ?, status = 'completed', last_error = NULL WHERE id = ?")
          .run(res.threadId, pick.id);
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

  return { enroll, tick, renderStep, sentToday };
}
