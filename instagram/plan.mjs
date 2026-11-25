#!/usr/bin/env node
// Content calendar: shows what will post on each day for the next N weeks
// (dated items on their date, backlog items filling the configured post days),
// flags empty post days, and compares the planned pillar mix to the strategy.
//
//   node instagram/plan.mjs            # 4 weeks
//   node instagram/plan.mjs --weeks 8

import { pathToFileURL } from 'node:url';
import { config, loadQueue, isoDate, dayName } from './lib.mjs';

export function buildPlan(weeks = 4, start = isoDate()) {
  const { items, errors } = loadQueue();
  const backlog = items.filter((i) => !i.due);
  const overdue = items.filter((i) => i.due && i.due < start);
  const days = [];
  const perRun = config.postsPerRun ?? 1;
  const d0 = new Date(`${start}T12:00:00Z`);
  for (let n = 0; n < weeks * 7; n++) {
    const iso = isoDate(new Date(d0.getTime() + n * 86400000));
    const isPostDay = !config.postDays?.length || config.postDays.includes(dayName(iso));
    let posts = items.filter((i) => i.due === iso);
    if (n === 0) posts = [...overdue, ...posts];
    if (!posts.length && isPostDay) posts = backlog.splice(0, perRun).map((i) => ({ ...i, fromBacklog: true }));
    days.push({ iso, day: dayName(iso), isPostDay, posts: posts.slice(0, Math.max(perRun, posts.length)) });
  }
  const gaps = days.filter((d) => d.isPostDay && !d.posts.length);
  const planned = days.flatMap((d) => d.posts);
  const mix = {};
  for (const p of planned) mix[p.pillar || 'none'] = (mix[p.pillar || 'none'] || 0) + 1;
  return { days, gaps, planned, mix, leftoverBacklog: backlog.length, errors };
}

export function planMarkdown(weeks = 4) {
  const { days, gaps, planned, mix, leftoverBacklog, errors } = buildPlan(weeks);
  const pillars = config.pillars || {};
  const out = [];
  out.push(`### Next ${weeks} weeks`);
  out.push(`Post days: ${config.postDays?.join(', ') || 'every day'} · ${planned.length} post(s) planned · ${gaps.length} empty post day(s)${leftoverBacklog ? ` · ${leftoverBacklog} backlog item(s) beyond this window` : ''}\n`);
  out.push('| Date | Day | Post | Pillar |');
  out.push('|---|---|---|---|');
  for (const d of days) {
    if (!d.posts.length && !d.isPostDay) continue;
    if (!d.posts.length) {
      out.push(`| ${d.iso} | ${d.day} | ⚠️ **nothing planned** | |`);
      continue;
    }
    for (const p of d.posts) {
      const label = pillars[p.pillar]?.label || p.pillar || '—';
      out.push(`| ${d.iso} | ${d.day} | ${p.kind.toLowerCase()} · \`${p.name}\`${p.fromBacklog ? ' (backlog)' : ''} | ${label} |`);
    }
  }
  if (Object.keys(pillars).length) {
    out.push('\n**Pillar mix: planned vs. strategy target**\n');
    out.push('| Pillar | Planned | Target |');
    out.push('|---|---|---|');
    for (const [key, p] of Object.entries(pillars)) {
      const n = mix[key] || 0;
      const pct = planned.length ? Math.round((100 * n) / planned.length) : 0;
      const flag = planned.length && Math.abs(pct - p.share) >= 15 ? ' ⚠️' : '';
      out.push(`| ${p.label} | ${n} (${pct}%) | ${p.share}%${flag} |`);
    }
  }
  if (errors.length) out.push(`\n**Queue problems**\n${errors.map((e) => `- ${e}`).join('\n')}`);
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--weeks');
  console.log(planMarkdown(i > 0 ? Number(process.argv[i + 1]) : 4));
}
