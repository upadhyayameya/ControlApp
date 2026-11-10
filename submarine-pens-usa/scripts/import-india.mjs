// Imports the catalog from the Indian Shopify store into data/products.json
// and adds any new variants to data/prices.csv (keeping USD prices you already entered).
//
//   npm run import                 # from https://www.submarinepens.com
//   npm run import -- --all        # include out-of-stock products too
//
// Settings (exclusions, source URL) live in site.config.json under "import".

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, toCsv } from "../lib/csv.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(path.join(ROOT, "site.config.json"), "utf8"));
const SOURCE = (config.import?.source_url || "https://www.submarinepens.com").replace(/\/$/, "");
const EXCLUDE = (config.import?.exclude_title_patterns || []).map((p) => new RegExp(p, "i"));
const includeAll = process.argv.includes("--all");

const PRICE_HEADER = ["variant_id", "sku", "product", "variant", "in_stock", "inr_price", "usd_price"];

async function fetchAll() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const res = await fetch(`${SOURCE}/products.json?limit=250&page=${page}`, {
      headers: { "User-Agent": "SubmarinePensUSA-catalog-import/1.0" },
    });
    if (!res.ok) throw new Error(`Fetching page ${page} failed: HTTP ${res.status}`);
    const { products } = await res.json();
    out.push(...products);
    if (products.length < 250) break;
  }
  return out;
}

const CATEGORY_RULES = [
  [/diary|gift set|gift box|corporate/i, "Gift Sets"],
  [/kids/i, "Kids"],
  [/fountain|calligraphy/i, "Fountain Pens"],
  [/roller/i, "Roller Pens"],
  [/ball/i, "Ball Pens"],
  [/\bink\b|refill|cartridge|converter/i, "Ink & Refills"],
  [/set|combo/i, "Gift Sets"],
];
function categorize(p) {
  const hay = `${p.title} ${p.product_type}`;
  for (const [re, cat] of CATEGORY_RULES) if (re.test(hay)) return cat;
  return "More";
}

// Keep simple formatting only; drop every attribute, style and script.
const KEEP = new Set(["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "h3", "table", "thead", "tbody", "tr", "th", "td", "hr"]);
const RENAME = { h1: "h3", h2: "h3", h4: "h3", h5: "h3", h6: "h3" };
function sanitize(html) {
  if (!html) return "";
  let s = html
    .replace(/<(script|style|iframe|object|svg)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?([a-zA-Z0-9]+)[^>]*>/g, (m, tag) => {
      const t = RENAME[tag.toLowerCase()] || tag.toLowerCase();
      if (!KEEP.has(t)) return t === "div" || t === "section" ? "\n" : "";
      return m.startsWith("</") ? `</${t}>` : t === "br" || t === "hr" ? `<${t}>` : `<${t}>`;
    })
    .replace(/<(p|h3|li|strong)>\s*(&nbsp;|\s)*<\/\1>/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return s;
}
const textOf = (html) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function summarize(html, max = 170) {
  const t = textOf(html);
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

// Serve images from the store's own domain (same files as cdn.shopify.com, same ?width= resizing).
const ownDomain = (src) =>
  src ? src.replace(/^https?:\/\/cdn\.shopify\.com\/s\/files\/\d+\/\d+\/\d+\/\d+\/files\//, `${SOURCE}/cdn/shop/files/`) : src;

function mapProduct(p) {
  const options = p.options.map((o) => o.name).filter((n) => n !== "Title");
  const images = p.images.map((im) => ({ id: im.id, src: ownDomain(im.src), alt: im.alt || p.title }));
  const imgById = new Map(images.map((im) => [im.id, im.src]));
  const description_html = sanitize(p.body_html);
  return {
    id: p.handle,
    name: p.title.trim(),
    category: categorize(p),
    summary: summarize(description_html),
    description_html,
    images: images.map(({ src, alt }) => ({ src, alt })),
    options,
    variants: p.variants.map((v) => ({
      id: String(v.id),
      sku: v.sku || "",
      title: v.title === "Default Title" ? "" : v.title,
      options: [v.option1, v.option2, v.option3].filter((o) => o != null && o !== "Default Title"),
      available: Boolean(v.available),
      inr_price: Number(v.price),
      image: v.featured_image ? ownDomain(v.featured_image.src) : imgById.get(v.image_id) || null,
    })),
    source_url: `${SOURCE}/products/${p.handle}`,
  };
}

const raw = await fetchAll();
const excluded = [];
const products = [];
for (const p of raw) {
  const inStock = p.variants.some((v) => v.available);
  if (!includeAll && !inStock) continue;
  if (EXCLUDE.some((re) => re.test(p.title))) { excluded.push(p.title.trim()); continue; }
  products.push(mapProduct(p));
}

// Merge into prices.csv: keep existing USD prices, add new variants, drop vanished ones.
const pricesPath = path.join(ROOT, "data", "prices.csv");
let existing = [];
try { existing = parseCsv(await readFile(pricesPath, "utf8")); } catch {}
const usdById = new Map(existing.map((r) => [r.variant_id, r.usd_price]));
const rows = products.flatMap((p) =>
  p.variants.map((v) => ({
    variant_id: v.id,
    sku: v.sku,
    product: p.name,
    variant: v.title,
    in_stock: v.available ? "yes" : "no",
    inr_price: v.inr_price,
    usd_price: usdById.get(v.id) ?? "",
  }))
);
const keptIds = new Set(rows.map((r) => r.variant_id));
const dropped = existing.filter((r) => !keptIds.has(r.variant_id) && r.usd_price);

await writeFile(path.join(ROOT, "data", "products.json"), JSON.stringify(products, null, 2) + "\n");
await writeFile(pricesPath, toCsv(PRICE_HEADER, rows));

const byCat = products.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
const reviewDesc = products.filter((p) => /₹|\bindia\b|\bINR\b|\bRs\.?\s?\d/i.test(textOf(p.description_html)));
console.log(`Imported ${products.length} products (${rows.length} variants) from ${SOURCE}`);
console.log("By category:", byCat);
console.log(`Priced in USD: ${rows.filter((r) => r.usd_price).length}/${rows.length} variants`);
if (excluded.length) console.log(`Excluded by site.config.json (${excluded.length}):`, excluded.join(" | "));
if (dropped.length) console.log(`Note: ${dropped.length} priced variants no longer on the Indian site were removed from prices.csv`);
if (reviewDesc.length)
  console.log("Descriptions mentioning ₹/India (review for US wording):", reviewDesc.map((p) => p.id).join(", "));
