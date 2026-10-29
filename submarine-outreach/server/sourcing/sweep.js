import { STATES } from '../data/geo.js';
import { SEGMENTS } from '../data/segments.js';
import { searchPlaces } from './places.js';

/**
 * Build the nationwide job queue. Ordering (lower priority value runs first):
 *   phase (resellers → SMB end-buyers → large-org segments)
 *   → city rank (every state's biggest city before any state's 2nd city)
 *   → segment/query order → state.
 * This spreads coverage across the whole country early instead of exhausting one state.
 */
export function planSweep(segments = SEGMENTS, states = STATES) {
  const jobs = [];
  segments.forEach((seg, segIdx) => {
    seg.queries.forEach((query, qIdx) => {
      states.forEach((st, stIdx) => {
        st.cities.forEach((city, cityIdx) => {
          const priority = seg.phase * 10_000_000 + cityIdx * 100_000 + (segIdx * 10 + qIdx) * 100 + stIdx;
          jobs.push({ segment: seg.key, query, city, state: st.code, priority });
        });
      });
    });
  });
  return jobs;
}

export function seedSweep(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO sweep_jobs(segment, query, city, state, priority) VALUES (?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    for (const j of planSweep()) ins.run(j.segment, j.query, j.city, j.state, j.priority);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function sweepStatus(db) {
  const rows = db.prepare(`SELECT s.segment, s.status, COUNT(*) AS n, SUM(results) AS found
    FROM sweep_jobs s GROUP BY s.segment, s.status`).all();
  const bySegment = {};
  for (const seg of SEGMENTS) bySegment[seg.key] = { key: seg.key, label: seg.label, phase: seg.phase, pending: 0, done: 0, failed: 0, found: 0 };
  for (const r of rows) {
    const s = bySegment[r.segment];
    if (!s) continue;
    if (r.status === 'done') s.done += r.n;
    else if (r.status === 'failed') s.failed += r.n;
    else s.pending += r.n;
    s.found += r.found || 0;
  }
  const today = db.prepare("SELECT COUNT(*) AS n FROM sweep_jobs WHERE status IN ('done','failed') AND updated_at >= date('now')").get().n;
  const next = db.prepare("SELECT * FROM sweep_jobs WHERE status = 'pending' ORDER BY priority LIMIT 5").all();
  return { segments: Object.values(bySegment), today, next };
}

/** Process one pending job. Returns false when there is nothing to do. */
export async function runSweepStep({ db, settings, leads, config, log = console }) {
  const phaseMax = settings.num('sweep_phase_max') || 3;
  const job = db.prepare(`SELECT j.* FROM sweep_jobs j WHERE j.status = 'pending' AND
      (j.priority / 10000000) <= ? ORDER BY j.priority LIMIT 1`).get(phaseMax);
  if (!job) return false;
  db.prepare("UPDATE sweep_jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?").run(job.id);
  try {
    const places = await searchPlaces(config.googlePlacesKey, `${job.query} in ${job.city}, ${job.state}`);
    let created = 0;
    for (const p of places) {
      const res = leads.upsertBusiness({ ...p, segment: job.segment, source: 'google_places' });
      if (res.created) created++;
    }
    db.prepare("UPDATE sweep_jobs SET status = 'done', results = ?, error = NULL, updated_at = datetime('now') WHERE id = ?").run(created, job.id);
    log.info?.(`[sweep] ${job.query} / ${job.city}, ${job.state}: ${places.length} places, ${created} new`);
  } catch (err) {
    db.prepare("UPDATE sweep_jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?").run(err.message, job.id);
    log.warn?.(`[sweep] failed ${job.query} / ${job.city}: ${err.message}`);
    if (/API key|PERMISSION|403|401/i.test(err.message)) settings.set('sweep_running', 'false');
  }
  return true;
}
