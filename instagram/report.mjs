#!/usr/bin/env node
// Daily Instagram report:
//   - traction per post (reach, views, likes, comments, saves, shares, engagement rate)
//   - follower trend and performance by content pillar
//   - unanswered DMs (written to --dm-out only, never committed: it's private)
//   - the content calendar for the next 4 weeks
// Writes instagram/REPORT.md and instagram/insights/{latest.json,history.jsonl}.
//
//   IG_USER_ID=... IG_ACCESS_TOKEN=... node instagram/report.mjs [--dm-out path] [--no-dms]

import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config, api, apiList, readLog, isoDate, requireCreds } from './lib.mjs';
import { planMarkdown } from './plan.mjs';

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : null;
};
const INSIGHTS = join(ROOT, 'insights');
const METRICS = ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions'];

async function mediaInsights(id) {
  const parse = (data) => Object.fromEntries((data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0]));
  try {
    return parse((await api('GET', `${id}/insights`, { metric: METRICS.join(',') })).data);
  } catch {
    // Some metrics are unsupported for some media types/ages: fetch one at a time.
    const out = {};
    for (const m of METRICS) {
      try {
        Object.assign(out, parse((await api('GET', `${id}/insights`, { metric: m })).data));
      } catch {
        /* metric unavailable for this media */
      }
    }
    return out;
  }
}

async function collectPosts() {
  const log = new Map(readLog().map((l) => [l.mediaId, l]));
  const media = await apiList('me/media', {
    fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count',
    limit: '50',
  }, config.reportPosts ?? 30);
  const posts = [];
  for (const m of media) {
    const ins = await mediaInsights(m.id);
    const likes = ins.likes ?? m.like_count ?? 0;
    const comments = ins.comments ?? m.comments_count ?? 0;
    const interactions = ins.total_interactions ?? likes + comments + (ins.saved || 0) + (ins.shares || 0);
    posts.push({
      id: m.id,
      date: m.timestamp?.slice(0, 10),
      type: m.media_product_type === 'REELS' ? 'reel' : m.media_type?.toLowerCase().replace('_album', ''),
      caption: (m.caption || '').split('\n')[0].slice(0, 60),
      permalink: m.permalink,
      pillar: log.get(m.id)?.pillar || null,
      reach: ins.reach ?? null,
      views: ins.views ?? null,
      likes,
      comments,
      saved: ins.saved ?? null,
      shares: ins.shares ?? null,
      interactions,
      engagementRate: ins.reach ? interactions / ins.reach : null,
    });
  }
  return posts;
}

/** Conversations whose most recent message came from the other person. */
async function unansweredDms() {
  const me = process.env.IG_USER_ID;
  let convs;
  try {
    convs = await apiList('me/conversations', {
      platform: 'instagram',
      fields: 'id,updated_time,messages.limit(1){id,from,message,created_time}',
    }, 50);
  } catch {
    // Fallback: list conversations, then look up each one's latest message.
    convs = await apiList('me/conversations', { platform: 'instagram', fields: 'id,updated_time' }, 50);
    for (const c of convs) {
      const { messages } = await api('GET', c.id, { fields: 'messages' });
      const latest = messages?.data?.[0];
      if (latest) c.messages = { data: [await api('GET', latest.id, { fields: 'id,from,message,created_time' })] };
    }
  }
  const now = Date.now();
  return convs
    .map((c) => c.messages?.data?.[0])
    .filter((m) => m && m.from && m.from.id !== me)
    .map((m) => ({
      username: m.from.username || m.from.id,
      at: m.created_time,
      hoursWaiting: Math.round((now - Date.parse(m.created_time)) / 36e5),
      preview: (m.message || '[attachment]').replace(/\s+/g, ' ').slice(0, 80),
    }))
    .sort((a, b) => b.hoursWaiting - a.hoursWaiting);
}

const fmt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const pct = (r) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(1)}%`);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function followerTrend(history, today) {
  const at = (daysAgo) => {
    const target = isoDate(new Date(Date.parse(`${today}T12:00:00Z`) - daysAgo * 86400000));
    return [...history].reverse().find((h) => h.date <= target);
  };
  const cur = history.at(-1)?.followers;
  const d7 = at(7);
  const d30 = at(30);
  const delta = (h) => (h && cur !== undefined ? `${cur - h.followers >= 0 ? '+' : ''}${cur - h.followers}` : 'n/a');
  return { cur, d7: delta(d7), d30: delta(d30) };
}

async function main() {
  requireCreds();
  const today = isoDate();
  mkdirSync(INSIGHTS, { recursive: true });

  const account = await api('GET', 'me', { fields: 'user_id,username,followers_count,follows_count,media_count' });
  const histFile = join(INSIGHTS, 'history.jsonl');
  const history = existsSync(histFile) ? readFileSync(histFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (history.at(-1)?.date !== today) {
    const snap = { date: today, followers: account.followers_count, following: account.follows_count, posts: account.media_count };
    appendFileSync(histFile, `${JSON.stringify(snap)}\n`);
    history.push(snap);
  }
  const trend = followerTrend(history, today);

  const posts = await collectPosts();
  writeFileSync(join(INSIGHTS, 'latest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), account, posts }, null, 2)}\n`);

  let dms = null;
  if (!process.argv.includes('--no-dms')) {
    try {
      dms = await unansweredDms();
    } catch (err) {
      console.error(`DM check failed (does the token have instagram_business_manage_messages?): ${err.message}`);
    }
  }

  // ---- REPORT.md ----
  const rates = posts.map((p) => p.engagementRate).filter((r) => r !== null);
  const medianRate = rates.length ? [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)] : null;
  const L = [];
  L.push(`# Instagram report: @${account.username}`);
  L.push(`_Updated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC by the daily workflow._\n`);
  L.push('## Account');
  L.push(`| Followers | 7-day change | 30-day change | Posts | Unanswered DMs |`);
  L.push(`|---|---|---|---|---|`);
  L.push(`| ${fmt(trend.cur)} | ${trend.d7} | ${trend.d30} | ${fmt(account.media_count)} | ${dms === null ? 'n/a' : dms.length ? `**${dms.length}** (see the "Unanswered Instagram DMs" issue)` : '0 ✅'} |\n`);

  L.push('## Traction per post');
  if (!posts.length) L.push('_No posts yet._\n');
  else {
    L.push(`Engagement rate = interactions ÷ reach. Median across these posts: **${pct(medianRate)}**. 🔥 = at least 1.5× median, 🧊 = under half of it.\n`);
    L.push('| Date | Post | Pillar | Reach | Views | Likes | Comments | Saves | Shares | Eng. rate |');
    L.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const p of posts) {
      const tag = medianRate && p.engagementRate !== null ? (p.engagementRate >= 1.5 * medianRate ? ' 🔥' : p.engagementRate < 0.5 * medianRate ? ' 🧊' : '') : '';
      const title = (p.caption || p.type).replace(/\|/g, '/');
      L.push(`| ${p.date} | [${title}](${p.permalink}) · ${p.type} | ${config.pillars?.[p.pillar]?.label || '—'} | ${fmt(p.reach)} | ${fmt(p.views)} | ${fmt(p.likes)} | ${fmt(p.comments)} | ${fmt(p.saved)} | ${fmt(p.shares)} | ${pct(p.engagementRate)}${tag} |`);
    }
    L.push('');
  }

  if (config.pillars) {
    L.push('## What is working: by content pillar');
    L.push('| Pillar | Posts | Avg reach | Avg eng. rate | Avg saves | Target share |');
    L.push('|---|---|---|---|---|---|');
    for (const [key, p] of Object.entries(config.pillars)) {
      const ps = posts.filter((x) => x.pillar === key);
      const r = avg(ps.map((x) => x.reach).filter((x) => x !== null));
      L.push(`| ${p.label} | ${ps.length} | ${fmt(r === null ? null : Math.round(r))} | ${pct(avg(ps.map((x) => x.engagementRate).filter((x) => x !== null)))} | ${fmt(avg(ps.map((x) => x.saved || 0)))} | ${p.share}% |`);
    }
    L.push('\nPosts not published by the auto-poster have no pillar. Review this table weekly (see STRATEGY.md, "Weekly loop").\n');
  }

  L.push('## Content calendar');
  L.push(planMarkdown(4));
  writeFileSync(join(ROOT, 'REPORT.md'), `${L.join('\n')}\n`);
  console.log(`Wrote REPORT.md: ${posts.length} posts, ${dms === null ? 'DMs not checked' : `${dms.length} unanswered DM(s)`}.`);

  // ---- Unanswered DMs (private: written outside the repo) ----
  const dmOut = arg('--dm-out');
  if (dms) {
    const md = dms.length
      ? [
          `**${dms.length} conversation(s) where the last message is from the customer.** Reply in the Instagram app.`,
          `Over 24h means a slow reply, and Meta's API can no longer send automated replies to that person.\n`,
          '| From | Waiting | Last message |',
          '|---|---|---|',
          ...dms.map((d) => `| @${d.username} | ${d.hoursWaiting}h${d.hoursWaiting >= 24 ? ' ⚠️' : ''} | ${d.preview.replace(/\|/g, '/')} |`),
        ].join('\n')
      : '';
    if (dmOut) writeFileSync(dmOut, md);
    else console.log(md || 'All DMs answered ✅');
  }
}

main().catch((err) => {
  console.error(`✗ Report failed: ${err.message}`);
  process.exit(1);
});
