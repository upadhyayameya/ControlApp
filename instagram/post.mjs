#!/usr/bin/env node
// Instagram auto-poster: publishes the next due item(s) in instagram/queue/ via
// the official Instagram Graph API, then moves them to instagram/posted/.
// Queue format: see queue/README.md. Flags: --dry-run (validate only).
//
// Env: IG_USER_ID, IG_ACCESS_TOKEN (required unless --dry-run)
//      MEDIA_BASE_URL  public URL serving the instagram/ folder
//                      (default: raw.githubusercontent.com for $GITHUB_REPOSITORY@$GITHUB_REF_NAME)

import { renameSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { config, loadQueue, dueToday, isoDate, api, sleep, requireCreds, POSTED, VIDEO_EXT } from './lib.mjs';

const DRY = process.argv.includes('--dry-run');

function mediaBaseUrl() {
  if (process.env.MEDIA_BASE_URL) return process.env.MEDIA_BASE_URL.replace(/\/$/, '');
  const repo = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF_NAME;
  if (!repo || !ref) throw new Error('Set MEDIA_BASE_URL (public URL serving the instagram/ folder)');
  return `https://raw.githubusercontent.com/${repo}/${ref}/instagram`;
}

const mediaUrl = (rel) => `${mediaBaseUrl()}/${rel.split('/').map(encodeURIComponent).join('/')}`;

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
  const line = JSON.stringify({ name: item.name, kind: item.kind, pillar: item.pillar, postedAt: new Date().toISOString(), ...result });
  appendFileSync(join(POSTED, 'log.jsonl'), `${line}\n`);
}

async function main() {
  const { items, errors } = loadQueue();
  for (const e of errors) console.error(`✗ ${e}`);
  const due = dueToday(items);
  console.log(`Queue: ${items.length} item(s), ${due.length} due today (${isoDate()}), ${errors.length} problem(s).`);

  const batch = due.slice(0, config.postsPerRun ?? 1);
  if (!batch.length) {
    console.log('Nothing to post.');
    process.exit(errors.length && DRY ? 1 : 0);
  }

  if (DRY) {
    for (const item of batch) {
      console.log(`\n— Would post ${item.kind} [${item.pillar || 'no pillar'}]: ${item.name}`);
      for (const rel of item.media) console.log(`  media: ${process.env.MEDIA_BASE_URL || process.env.GITHUB_REPOSITORY ? mediaUrl(rel) : rel}`);
      console.log(`  caption (${item.caption.length} chars):\n${item.caption.replace(/^/gm, '    ')}`);
    }
    process.exit(errors.length ? 1 : 0);
  }

  requireCreds();
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
