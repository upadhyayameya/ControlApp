#!/usr/bin/env node
// Instagram auto-poster: publishes the next item(s) in instagram/queue/ via the
// official Instagram Graph API, then moves them to instagram/posted/.
//
// Queue item formats (processed in filename order):
//   queue/2026-11-10-lorient.jpg  + queue/2026-11-10-lorient.txt   -> single photo
//   queue/2026-11-12-valentin.mp4 + queue/2026-11-12-valentin.txt  -> Reel
//   queue/2026-11-14-brest/  (folder: 2-10 .jpg/.mp4 + caption.txt) -> carousel
//
// An item whose name starts with a date (YYYY-MM-DD) is not posted before that date.
// Names starting with "_" are ignored (use for drafts).
//
// Env:
//   IG_USER_ID, IG_ACCESS_TOKEN  required unless --dry-run
//   MEDIA_BASE_URL               public URL that serves the instagram/ folder
//                                (default: raw.githubusercontent.com for $GITHUB_REPOSITORY@$GITHUB_REF_NAME)
//
// Flags: --dry-run  validate and print what would be posted; no API calls, no file moves.

import { readFileSync, readdirSync, statSync, existsSync, renameSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const QUEUE = join(ROOT, 'queue');
const POSTED = join(ROOT, 'posted');
const DRY = process.argv.includes('--dry-run');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const IMAGE_EXT = new Set(['.jpg', '.jpeg']);
const VIDEO_EXT = new Set(['.mp4', '.mov']);
const CAPTION_LIMIT = 2200;
const HASHTAG_LIMIT = 30;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dueDate(name) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(name);
  return m ? m[1] : null;
}

function buildCaption(text) {
  let caption = text.trim();
  const present = new Set((caption.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()));
  const extra = (config.defaultHashtags || []).filter((t) => !present.has(t.toLowerCase()));
  const room = HASHTAG_LIMIT - present.size;
  const add = extra.slice(0, Math.max(0, room));
  if (add.length) caption += `\n\n${add.join(' ')}`;
  return caption;
}

/** Collect queue items, sorted by name. Each: { name, kind, media: [relPath], caption, paths: [abs] } */
function loadQueue() {
  if (!existsSync(QUEUE)) return { items: [], errors: [] };
  const entries = readdirSync(QUEUE).filter((n) => !n.startsWith('.') && !n.startsWith('_') && n !== 'README.md').sort();
  const items = [];
  const errors = [];
  for (const name of entries) {
    const abs = join(QUEUE, name);
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
    const ext = extname(name).toLowerCase();
    if (ext === '.txt') continue; // picked up alongside its media file
    if (ext === '.png' || ext === '.webp' || ext === '.heic') {
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
    item.caption = buildCaption(item.caption);
    if (item.caption.length > CAPTION_LIMIT) errors.push(`${item.name}: caption is ${item.caption.length} chars (max ${CAPTION_LIMIT})`);
    item.due = dueDate(item.name);
  }
  return { items, errors };
}

function mediaBaseUrl() {
  if (process.env.MEDIA_BASE_URL) return process.env.MEDIA_BASE_URL.replace(/\/$/, '');
  const repo = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF_NAME;
  if (!repo || !ref) throw new Error('Set MEDIA_BASE_URL (public URL serving the instagram/ folder)');
  return `https://raw.githubusercontent.com/${repo}/${ref}/instagram`;
}

const mediaUrl = (rel) => `${mediaBaseUrl()}/${rel.split('/').map(encodeURIComponent).join('/')}`;

async function api(method, path, params) {
  const url = new URL(`${config.graphHost}/${config.apiVersion}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN });
  let res;
  if (method === 'GET') {
    for (const [k, v] of body) url.searchParams.set(k, v);
    res = await fetch(url);
  } else {
    res = await fetch(url, { method, body });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error ? `${json.error.message} (code ${json.error.code})` : `HTTP ${res.status}`;
    throw new Error(`${method} ${path}: ${msg}`);
  }
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(containerId) {
  for (let i = 0; i < 60; i++) {
    const { status_code, status } = await api('GET', containerId, { fields: 'status_code,status' });
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`Container ${containerId} ${status_code}: ${status || ''}`);
    await sleep(5000);
  }
  throw new Error(`Container ${containerId} not ready after 5 minutes`);
}

function childParams(rel, carousel) {
  const isVideo = VIDEO_EXT.has(extname(rel).toLowerCase());
  const p = isVideo ? { media_type: carousel ? 'VIDEO' : 'REELS', video_url: mediaUrl(rel) } : { image_url: mediaUrl(rel) };
  if (carousel) p.is_carousel_item = 'true';
  return p;
}

async function publish(item) {
  const user = process.env.IG_USER_ID;
  let creationId;
  if (item.kind === 'CAROUSEL') {
    const children = [];
    for (const rel of item.media) {
      const { id } = await api('POST', `${user}/media`, childParams(rel, true));
      await waitReady(id);
      children.push(id);
    }
    ({ id: creationId } = await api('POST', `${user}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: item.caption }));
  } else {
    ({ id: creationId } = await api('POST', `${user}/media`, { ...childParams(item.media[0], false), caption: item.caption }));
  }
  await waitReady(creationId);
  const { id: mediaId } = await api('POST', `${user}/media_publish`, { creation_id: creationId });
  const { permalink } = await api('GET', mediaId, { fields: 'permalink' }).catch(() => ({}));
  return { mediaId, permalink };
}

function archive(item, result) {
  mkdirSync(POSTED, { recursive: true });
  for (const p of item.paths) renameSync(p, join(POSTED, basename(p)));
  const line = JSON.stringify({ name: item.name, kind: item.kind, postedAt: new Date().toISOString(), ...result });
  appendFileSync(join(POSTED, 'log.jsonl'), `${line}\n`);
}

async function main() {
  const { items, errors } = loadQueue();
  for (const e of errors) console.error(`✗ ${e}`);
  const due = items.filter((i) => !i.due || i.due <= today());
  console.log(`Queue: ${items.length} item(s), ${due.length} due today (${today()}), ${errors.length} problem(s).`);

  const batch = due.slice(0, config.postsPerRun ?? 1);
  if (!batch.length) {
    console.log('Nothing to post.');
    process.exit(errors.length && DRY ? 1 : 0);
  }

  if (DRY) {
    for (const item of batch) {
      console.log(`\n— Would post ${item.kind}: ${item.name}`);
      for (const rel of item.media) console.log(`  media: ${process.env.MEDIA_BASE_URL || process.env.GITHUB_REPOSITORY ? mediaUrl(rel) : rel}`);
      console.log(`  caption (${item.caption.length} chars):\n${item.caption.replace(/^/gm, '    ')}`);
    }
    process.exit(errors.length ? 1 : 0);
  }

  if (!process.env.IG_USER_ID || !process.env.IG_ACCESS_TOKEN) {
    console.error('IG_USER_ID and IG_ACCESS_TOKEN must be set (add them as GitHub Actions secrets).');
    process.exit(1);
  }

  let failed = false;
  for (const item of batch) {
    try {
      const result = await publish(item);
      archive(item, result);
      console.log(`✓ Posted ${item.name} ${result.permalink || result.mediaId}`);
    } catch (err) {
      failed = true;
      console.error(`✗ Failed to post ${item.name}: ${err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
