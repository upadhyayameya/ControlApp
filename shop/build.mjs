#!/usr/bin/env node
// Builds the Instagram storefront from products.json:
//   shop/dist/index.html       mobile-first shop page for your Instagram bio link
//   shop/dist/images/...       product images, copied
//   shop/dist/meta-catalog.csv product feed for Meta Commerce Manager (Instagram Shopping tags)
//
//   node shop/build.mjs            # fails if REPLACE placeholders remain
//   node shop/build.mjs --preview  # builds anyway, for a look

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PREVIEW = process.argv.includes('--preview');
const { store, products } = JSON.parse(readFileSync(join(ROOT, 'products.json'), 'utf8'));

// ---- validation ----
const problems = [];
const raw = JSON.stringify({ store, products });
if (raw.includes('REPLACE')) problems.push('products.json still contains REPLACE placeholders');
const ids = new Set();
for (const p of products) {
  if (ids.has(p.id)) problems.push(`duplicate product id ${p.id}`);
  ids.add(p.id);
  if (!(p.price > 0)) problems.push(`${p.id}: price must be > 0`);
  if (!/^https:\/\//.test(p.buyUrl || '')) problems.push(`${p.id}: buyUrl must be an https checkout link (e.g. a Stripe Payment Link)`);
  if (p.image && !existsSync(join(ROOT, p.image))) problems.push(`${p.id}: image ${p.image} not found (a placeholder will show)`);
}
for (const msg of problems) console.error(`${PREVIEW ? '!' : '✗'} ${msg}`);
if (problems.length && !PREVIEW) {
  console.error('\nFix these, or run with --preview to build anyway.');
  process.exit(1);
}

// ---- helpers ----
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: store.currency || 'USD' }).format(n);
const hasImg = (p) => p && existsSync(join(ROOT, p));
const visible = products.filter((p) => p.available !== false);
const categories = [...new Set(visible.map((p) => p.category).filter(Boolean))];
const ordered = [...visible.filter((p) => p.featured), ...visible.filter((p) => !p.featured)];

const placeholder = `<div class="ph" aria-hidden="true"><svg viewBox="0 0 120 24" width="96"><path d="M4 14h96l14-4-14-4H4z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4 6v8" stroke="currentColor" stroke-width="1.5"/></svg></div>`;

const card = (p) => `
  <article class="card" id="${esc(p.id)}" data-cat="${esc(p.category || '')}">
    <div class="img">${hasImg(p.image) ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : placeholder}${p.featured ? '<span class="badge">Featured</span>' : ''}</div>
    <div class="body">
      <h2>${esc(p.name)}</h2>
      <p class="desc">${esc(p.description)}</p>
      <div class="row">
        <span class="price">${money(p.price || 0)}</span>
        <a class="buy" href="${esc(p.buyUrl)}" data-buy rel="noopener">Buy now</a>
      </div>
    </div>
  </article>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(store.name)} | Shop</title>
<meta name="description" content="${esc(store.name)}: ${esc(store.tagline)}. Shop our pens.">
<meta property="og:title" content="${esc(store.name)}">
<meta property="og:description" content="${esc(store.tagline)}">
${hasImg(store.logo) ? `<meta property="og:image" content="${esc(store.logo)}">` : ''}
<style>
  :root { --bg:#fafaf8; --fg:#111; --muted:#666; --line:#e4e4e0; --card:#fff; --accent:#111; --accent-fg:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d0e10; --fg:#f2f2f0; --muted:#9a9a96; --line:#26282c; --card:#16181b; --accent:#f2f2f0; --accent-fg:#111; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { text-align:center; padding:32px 16px 16px; }
  .logo { width:96px; height:96px; border-radius:50%; object-fit:cover; background:#fff; border:1px solid var(--line); }
  .wordmark { font-size:28px; letter-spacing:.35em; font-weight:600; margin:12px 0 0; padding-left:.35em; }
  .tagline { letter-spacing:.3em; text-transform:uppercase; font-size:11px; color:var(--muted); margin:4px 0 0; }
  .ig { display:inline-block; margin-top:12px; color:var(--muted); font-size:14px; text-decoration:none; }
  .ig:hover { color:var(--fg); }
  nav { display:flex; gap:8px; justify-content:center; flex-wrap:wrap; padding:8px 16px 4px; }
  nav button { font:inherit; font-size:14px; border:1px solid var(--line); background:transparent; color:var(--fg); padding:6px 14px; border-radius:999px; cursor:pointer; }
  nav button[aria-pressed="true"] { background:var(--accent); color:var(--accent-fg); border-color:var(--accent); }
  main { max-width:960px; margin:0 auto; padding:16px; display:grid; gap:16px; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; overflow:hidden; display:flex; flex-direction:column; scroll-margin-top:16px; }
  .card:target { outline:2px solid var(--accent); }
  .img { position:relative; aspect-ratio:4/5; background:#f0f0ec; }
  .img img { width:100%; height:100%; object-fit:cover; display:block; }
  .ph { width:100%; height:100%; display:grid; place-items:center; color:#bbb; }
  .badge { position:absolute; top:10px; left:10px; background:var(--accent); color:var(--accent-fg); font-size:12px; padding:2px 10px; border-radius:999px; }
  .body { padding:14px 16px 16px; display:flex; flex-direction:column; flex:1; }
  h2 { font-size:17px; margin:0 0 4px; }
  .desc { color:var(--muted); font-size:14px; margin:0 0 14px; flex:1; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .price { font-weight:600; font-size:17px; }
  .buy { background:var(--accent); color:var(--accent-fg); text-decoration:none; padding:10px 18px; border-radius:10px; font-weight:600; font-size:15px; }
  .buy:active { transform:scale(.98); }
  footer { text-align:center; color:var(--muted); font-size:13px; padding:24px 16px 40px; }
  footer a { color:inherit; }
  .preview { background:#ffe8a3; color:#5a4300; text-align:center; font-size:13px; padding:6px 16px; }
</style>
</head>
<body>
${problems.length ? `<div class="preview">Preview: ${problems.length} setup item(s) left. Run <code>node shop/build.mjs</code> to see them.</div>` : ''}
<header>
  ${hasImg(store.logo) ? `<img class="logo" src="${esc(store.logo)}" alt="${esc(store.name)} logo">` : ''}
  <p class="wordmark">SUBMARINE</p>
  <p class="tagline">${esc(store.tagline)}</p>
  <a class="ig" href="https://instagram.com/${esc(store.instagram)}">@${esc(store.instagram)} on Instagram</a>
</header>
${categories.length > 1 ? `<nav aria-label="Categories"><button aria-pressed="true" data-filter="">All</button>${categories.map((c) => `<button aria-pressed="false" data-filter="${esc(c)}">${esc(c)}</button>`).join('')}</nav>` : ''}
<main>${ordered.map(card).join('')}
</main>
<footer>
  <p>${esc(store.shipsNote)}</p>
  <p>${esc(store.location)} · <a href="mailto:${esc(store.contactEmail)}">${esc(store.contactEmail)}</a></p>
  <p>Secure checkout by Stripe.</p>
</footer>
<script>
  // Category filter
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const f = b.dataset.filter;
    document.querySelectorAll('.card').forEach((c) => { c.hidden = !!f && c.dataset.cat !== f; });
  }));
  // Carry ?utm_* tags from the bio link through to checkout so sales show up as "from Instagram".
  const params = new URLSearchParams(location.search);
  if (!params.has('utm_source') && /instagram/i.test(document.referrer + navigator.userAgent)) params.set('utm_source', 'instagram');
  const utm = [...params].filter(([k]) => k.startsWith('utm_'));
  if (utm.length) document.querySelectorAll('[data-buy]').forEach((a) => {
    try { const u = new URL(a.href); utm.forEach(([k, v]) => u.searchParams.set(k, v)); a.href = u; } catch (e) {}
  });
</script>
</body>
</html>
`;

// ---- Meta Commerce Manager catalog feed ----
const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const base = (store.siteUrl || '').replace(/\/$/, '');
const header = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'product_type'];
const rows = products.map((p) => [
  p.id,
  p.name,
  p.description,
  p.available === false ? 'out of stock' : 'in stock',
  'new',
  `${Number(p.price || 0).toFixed(2)} ${store.currency || 'USD'}`,
  `${base}/#${p.id}`,
  p.image ? `${base}/${p.image}` : '',
  store.name,
  p.category || '',
]);
const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'meta-catalog.csv'), `${csv}\n`);
if (existsSync(join(ROOT, 'images'))) cpSync(join(ROOT, 'images'), join(DIST, 'images'), { recursive: true });
console.log(`Built shop/dist/: ${ordered.length} product(s) on the page, ${products.length} in meta-catalog.csv${problems.length ? ` (preview, ${problems.length} issue(s))` : ''}.`);
