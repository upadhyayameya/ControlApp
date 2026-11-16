// Shared helpers for the Instagram tools: config, queue parsing, Graph API client.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const QUEUE = join(ROOT, 'queue');
export const POSTED = join(ROOT, 'posted');
export const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

export const IMAGE_EXT = new Set(['.jpg', '.jpeg']);
export const VIDEO_EXT = new Set(['.mp4', '.mov']);
const CAPTION_LIMIT = 2200;
const HASHTAG_LIMIT = 30;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);
export const dayName = (iso) => DAY_NAMES[new Date(`${iso}T12:00:00Z`).getUTCDay()];

/**
 * Parse a queue name: "2026-11-12_spotlight_blue-rollerball.jpg"
 *   -> { due: '2026-11-12', pillar: 'spotlight', slug: 'blue-rollerball' }
 * Date and pillar are both optional.
 */
export function parseName(name) {
  let rest = basename(name, extname(name));
  let due = null;
  const m = /^(\d{4}-\d{2}-\d{2})[_-]?/.exec(rest);
  if (m) {
    due = m[1];
    rest = rest.slice(m[0].length);
  }
  let pillar = null;
  const p = /^([a-z0-9-]+)_/i.exec(rest);
  if (p && (config.pillars || {})[p[1].toLowerCase()]) {
    pillar = p[1].toLowerCase();
    rest = rest.slice(p[0].length);
  }
  return { due, pillar, slug: rest };
}

function buildCaption(text) {
  let caption = text.trim();
  const present = new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
  const extra = (config.defaultHashtags || []).filter((t) => !present.has(t.toLowerCase()));
  const add = extra.slice(0, Math.max(0, HASHTAG_LIMIT - present.size));
  if (add.length) caption += `\n\n${add.join(' ')}`;
  return caption;
}

/** Collect queue items, sorted by name. Returns { items, errors }. */
export function loadQueue() {
  if (!existsSync(QUEUE)) return { items: [], errors: [] };
  const entries = readdirSync(QUEUE)
    .filter((n) => !n.startsWith('.') && !n.startsWith('_') && n !== 'README.md')
    .sort();
  const items = [];
  const errors = [];
  for (const name of entries) {
    const abs = join(QUEUE, name);
    const ext = extname(name).toLowerCase();
    if (statSync(abs).isDirectory()) {
      const files = readdirSync(abs).filter((f) => !f.startsWith('.')).sort();
      const media = files.filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()) || VIDEO_EXT.has(extname(f).toLowerCase()));
      const capFile = join(abs, 'caption.txt');
      const before = errors.length;
      if (media.length < 2 || media.length > 10) errors.push(`${name}/: carousel needs 2-10 .jpg/.mp4 files (found ${media.length})`);
      if (!existsSync(capFile)) errors.push(`${name}/: missing caption.txt`);
      if (errors.length > before) continue;
      items.push({ name, kind: 'CAROUSEL', media: media.map((f) => `queue/${name}/${f}`), caption: readFileSync(capFile, 'utf8'), paths: [abs] });
      continue;
    }
    if (ext === '.txt') continue; // read alongside its media file
    if (['.png', '.webp', '.heic', '.gif'].includes(ext)) {
      errors.push(`${name}: Instagram's API only accepts JPEG images — convert it to .jpg`);
      continue;
    }
    if (!IMAGE_EXT.has(ext) && !VIDEO_EXT.has(ext)) continue;
    const capFile = join(QUEUE, `${basename(name, extname(name))}.txt`);
    if (!existsSync(capFile)) {
      errors.push(`${name}: missing caption file ${basename(capFile)}`);
      continue;
    }
    items.push({
      name,
      kind: VIDEO_EXT.has(ext) ? 'REELS' : 'IMAGE',
      media: [`queue/${name}`],
      caption: readFileSync(capFile, 'utf8'),
      paths: [abs, capFile],
    });
  }
  for (const item of items) {
    Object.assign(item, parseName(item.name));
    item.caption = buildCaption(item.caption);
    if (item.caption.length > CAPTION_LIMIT) errors.push(`${item.name}: caption is ${item.caption.length} chars (max ${CAPTION_LIMIT})`);
    if (!item.pillar && config.pillars) {
      errors.push(`${item.name}: no content pillar in the name (use e.g. 2026-11-12_${Object.keys(config.pillars)[0]}_name.jpg)`);
    }
  }
  return { items, errors };
}

/**
 * Which items post today. Dated items post on/after their date. Undated items
 * ("backlog") fill in only on the configured postDays.
 */
export function dueToday(items, today = isoDate()) {
  const dated = items.filter((i) => i.due && i.due <= today);
  const postDay = !config.postDays?.length || config.postDays.includes(dayName(today));
  const datedToday = dated.length > 0;
  const backlog = postDay && !datedToday ? items.filter((i) => !i.due) : [];
  return [...dated, ...backlog];
}

/** Read posted/log.jsonl. */
export function readLog() {
  const f = join(POSTED, 'log.jsonl');
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

/** Minimal Instagram Graph API client. GET params go in the query; POST params in a form body. */
export async function api(method, path, params = {}) {
  const url = new URL(path.startsWith('http') ? path : `${config.graphHost}/${config.apiVersion}/${path}`);
  const all = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  let res;
  if (method === 'GET') {
    for (const [k, v] of all) url.searchParams.set(k, v);
    res = await fetch(url);
  } else {
    res = await fetch(url, { method, body: all });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error ? `${json.error.message} (code ${json.error.code})` : `HTTP ${res.status}`;
    const err = new Error(`${method} ${url.pathname}: ${msg}`);
    err.code = json.error?.code;
    throw err;
  }
  return json;
}

/** Follow `paging.next` up to `max` items. */
export async function apiList(path, params, max = 100) {
  const out = [];
  let page = await api('GET', path, params);
  while (true) {
    out.push(...(page.data || []));
    if (out.length >= max || !page.paging?.next) break;
    page = await api('GET', page.paging.next, {});
  }
  return out.slice(0, max);
}

export function requireCreds() {
  if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
    console.error('IG_USER_ID and IG_ACCESS_TOKEN must be set (GitHub Actions secrets, or env vars locally).');
    process.exit(1);
  }
}
