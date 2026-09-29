import { resolveMx } from 'node:dns/promises';
import { extractEmails, scoreEmail, rootDomain } from './emails.js';
import { parseRobots } from './robots.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; SubmarineOutreachBot/1.0; B2B contact discovery)';
const MAX_BYTES = 1_500_000;
const CONTACT_LINK = /(contact|about|team|staff|people|wholesale|corporate|trade|b2b|gift|locations?|store-info|visit)/i;
const FALLBACK_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/wholesale'];

const ENTITIES = { amp: '&', nbsp: ' ', quot: '"', apos: "'", '#39': "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', ndash: '-', mdash: '-', hellip: '...' };
const decodeEntities = (s) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e.toLowerCase()] ?? (/^#\d+$/.test(e) ? String.fromCharCode(Number(e.slice(1))) : m));

/** Title, meta description and a readable text excerpt — what the business says about itself. */
export function summarizePage(html, maxText = 1200) {
  const pick = (re) => decodeEntities((re.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim());
  const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    pick(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
    pick(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) ||
    pick(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|iframe|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|p|div|li|h[1-6]|section|article|tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 25 && !/cookie|javascript|©|all rights reserved|privacy policy/i.test(l))
    .join('\n')
    .slice(0, maxText);
  return { title, description, text };
}

export function normalizeWebsite(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const parsed = new URL(u);
    return { origin: parsed.origin, domain: rootDomain(parsed.hostname) };
  } catch {
    return null;
  }
}

async function fetchText(url, fetchImpl, timeoutMs = 10000) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { ok: false, status: res.status, url: res.url || url, text: '' };
  const type = res.headers.get('content-type') || '';
  if (type && !/text|html|xml/i.test(type)) return { ok: false, status: res.status, url: res.url || url, text: '' };
  const reader = res.body?.getReader();
  if (!reader) return { ok: true, url: res.url || url, text: await res.text() };
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    chunks.push(value);
    if (size > MAX_BYTES) { await reader.cancel(); break; }
  }
  return { ok: true, url: res.url || url, text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
}

function contactLinks(html, origin) {
  const links = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const [, href, label] = m;
    if (!CONTACT_LINK.test(href) && !CONTACT_LINK.test(label.replace(/<[^>]+>/g, ''))) continue;
    try {
      const u = new URL(href, origin);
      if (u.origin === origin && !/\.(pdf|jpe?g|png|zip)$/i.test(u.pathname)) links.add(u.pathname + u.search);
    } catch { /* ignore */ }
  }
  return [...links];
}

export async function hasMx(domain, resolver = resolveMx) {
  try {
    const records = await resolver(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

/**
 * Visit a business website (home + a few contact/about pages), honouring robots.txt,
 * and return ranked public email addresses.
 */
export async function crawlForEmails(website, { fetchImpl = fetch, maxPages = 5, mxResolver } = {}) {
  const site = normalizeWebsite(website);
  if (!site) throw new Error('invalid website');
  let allowed = () => true;
  try {
    const robots = await fetchText(site.origin + '/robots.txt', fetchImpl, 6000);
    if (robots.ok && robots.text) allowed = parseRobots(robots.text);
  } catch { /* no robots.txt → allowed */ }

  const visited = new Set();
  const queue = ['/'];
  const emails = new Map();
  let origin = site.origin;
  let pagesFetched = 0;
  const summaryParts = [];

  while (queue.length && pagesFetched < maxPages) {
    const path = queue.shift();
    if (visited.has(path) || !allowed(path)) continue;
    visited.add(path);
    let page;
    try {
      page = await fetchText(origin + path, fetchImpl);
    } catch (err) {
      if (pagesFetched === 0 && path === '/') throw new Error(`site unreachable: ${err.cause?.code || err.message}`);
      continue;
    }
    if (!page.ok) continue;
    pagesFetched++;
    if (path === '/') {
      try { origin = new URL(page.url).origin; } catch { /* keep */ }
    }
    if (path === '/' || (summaryParts.length < 2 && /about|story|who-we-are|our-/i.test(path))) {
      const sm = summarizePage(page.text, path === '/' ? 1200 : 900);
      if (path === '/') summaryParts.push([sm.title && `Site title: ${sm.title}`, sm.description && `Description: ${sm.description}`, sm.text && `Homepage text:\n${sm.text}`].filter(Boolean).join('\n'));
      else if (sm.text) summaryParts.push(`About page (${path}):\n${sm.text}`);
    }
    for (const e of extractEmails(page.text)) {
      if (!emails.has(e)) emails.set(e, { email: e, page: path });
    }
    if (path === '/') {
      const links = contactLinks(page.text, origin);
      queue.push(...(links.length ? links : FALLBACK_PATHS));
    }
  }

  const domainMx = new Map();
  const results = [];
  for (const { email, page } of emails.values()) {
    const domain = email.split('@')[1];
    if (!domainMx.has(domain)) domainMx.set(domain, await hasMx(domain, mxResolver));
    results.push({ email, page, confidence: scoreEmail(email, site.domain), mx_ok: domainMx.get(domain) });
  }
  results.sort((a, b) => b.confidence - a.confidence);
  return { domain: site.domain, pagesFetched, emails: results.filter((r) => r.mx_ok), summary: summaryParts.join('\n\n').slice(0, 3000) };
}
