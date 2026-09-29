import { existsSync } from 'node:fs';
import { envConfig } from './settings.js';
import { createApp } from './app.js';
import { runSweepStep } from './sourcing/sweep.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const config = envConfig();
const { app, db, settings, leads, outreach, inbox } = createApp(config);

const log = console;
const every = (ms, fn) => {
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (err) { log.warn(`[worker] ${err.message}`); } finally { busy = false; }
  }, ms).unref?.();
};

// Nationwide discovery: one Places search every few seconds while the sweep is switched on.
every(4000, async () => {
  if (!settings.bool('sweep_running') || !config.googlePlacesKey) return;
  const today = db.prepare("SELECT COUNT(*) AS n FROM sweep_jobs WHERE status IN ('done','failed') AND updated_at >= date('now')").get().n;
  if (today >= settings.num('sweep_daily_limit')) return;
  const didWork = await runSweepStep({ db, settings, leads, config, log });
  if (!didWork) settings.set('sweep_running', 'false');
});

// Contact enrichment: crawl new businesses' websites for public emails, smallest businesses first.
every(5000, async () => {
  const n = Math.max(1, Math.min(8, settings.num('crawl_concurrency') || 3));
  const batch = db.prepare(`SELECT b.id FROM businesses b WHERE b.crawled_at IS NULL AND b.website IS NOT NULL
    ORDER BY CASE b.size_tier WHEN 'small' THEN 0 WHEN 'mid' THEN 1 ELSE 2 END, b.id LIMIT ?`).all(n);
  await Promise.all(batch.map((b) => leads.enrich(b.id).catch((e) => log.warn(`[crawl] ${b.id}: ${e.message}`))));
});

// Sequenced sending with daily cap, spacing and recipient-local business hours.
every(20000, () => outreach.tick());

// Reply capture.
every(120000, () => inbox.poll());
setTimeout(() => inbox.poll().catch(() => {}), 3000);

app.listen(config.port, () => {
  log.info(`Submarine Outreach portal on http://localhost:${config.port}`);
  log.info(`Send mode: ${settings.get('send_mode')}${settings.get('send_mode') === 'dry_run' ? ' (emails are recorded, not sent — switch in Settings)' : ''}`);
  if (!config.portalPassword) log.info('PORTAL_PASSWORD not set: the portal has no login. Set it before exposing this server.');
});
