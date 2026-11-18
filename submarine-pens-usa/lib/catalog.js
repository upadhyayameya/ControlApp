// Builds the store catalog from:
//   data/us-range.csv            the US range (owner-editable): include, names, colours, M.R.P., pack size, USD override
//   data/catalogue-2026-27.json  catalogue facts per code (photo, packaging, details, page, NEW)
//   data/india-website.json      products from submarinepens.com (descriptions + extra photos for matched products)
//   site.config.json             pricing assumptions
// Re-reads automatically when any of those files change, so edits show up without a restart.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./csv.js";
import { suggestedPriceCents } from "./pricing.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const textOf = (html) =>
  String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
function summarize(html, max = 170) {
  const t = textOf(html);
  return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

const TYPE_LINE = {
  "Fountain Pens": "A Submarine fountain pen from the 2026–27 collection.",
  "Roller Pens": "A smooth-writing Submarine roller pen from the 2026–27 collection.",
  "Ball Pens": "A Submarine ball pen from the 2026–27 collection.",
  "Gift Sets": "A Submarine gift set from the 2026–27 collection.",
  "Ink & Refills": "Genuine Submarine ink and refills.",
};

function describe(name, category, rows, facts) {
  const f = facts[rows[0].code] || {};
  const colours = rows.map((r) => r.colour).filter(Boolean);
  const bits = [];
  bits.push(`<p>${esc(TYPE_LINE[category] || "From Submarine's 2026–27 collection.")}${
    colours.length > 1 ? ` Available in ${colours.length} finishes.` : ""
  }</p>`);
  const details = String(f.details || "")
    .split(";")
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => s.length > 2 && !/^[\d\s]+$/.test(s));
  const li = [...details];
  if (rows[0].pack_size > 1) li.push(`Pack of ${rows[0].pack_size} pens`);
  if (f.packaging) li.push(`Packaging: ${f.packaging}`);
  if (li.length) bits.push(`<ul>${li.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
  return bits.join("\n");
}

export function createCatalog(root) {
  const files = {
    range: path.join(root, "data", "us-range.csv"),
    facts: path.join(root, "data", "catalogue-2026-27.json"),
    web: path.join(root, "data", "india-website.json"),
    copy: path.join(root, "data", "product-copy.json"),
    config: path.join(root, "site.config.json"),
  };
  let cache = null;
  let cacheKey = "";

  async function mtimes() {
    const parts = await Promise.all(Object.values(files).map((f) => stat(f).then((s) => s.mtimeMs).catch(() => 0)));
    return parts.join(":");
  }

  async function build() {
    const config = JSON.parse(await readFile(files.config, "utf8"));
    const pricing = config.pricing || {};
    let range = [];
    try { range = parseCsv(await readFile(files.range, "utf8")); } catch {}
    let factsDoc = { products: {}, india_website_match: {} };
    try { factsDoc = JSON.parse(await readFile(files.facts, "utf8")); } catch {}
    let web = [];
    try { web = JSON.parse(await readFile(files.web, "utf8")); } catch {}
    const webById = new Map(web.map((p) => [p.id, p]));
    let copy = {};
    try { copy = JSON.parse(await readFile(files.copy, "utf8")); } catch {}
    const facts = factsDoc.products || {};

    // group included rows into products, keeping the CSV's order
    const groups = new Map();
    for (const r of range) {
      if (String(r.include).trim().toLowerCase() !== "yes" || !r.code || !r.product) continue;
      r.pack_size = Math.max(1, parseInt(r.pack_size, 10) || 1);
      if (!groups.has(r.product)) groups.set(r.product, []);
      groups.get(r.product).push(r);
    }

    const list = [];
    const usedIds = new Set();
    for (const [name, rows] of groups) {
      const category = rows[0].category || "Ball Pens";
      const variants = rows.map((r) => {
        const override = Number(String(r.usd_price_override || "").replace(/[$,\s]/g, ""));
        const price_cents =
          r.usd_price_override && Number.isFinite(override) && override > 0
            ? Math.round(override * 100)
            : suggestedPriceCents(r.inr_mrp, r.pack_size, pricing);
        const f = facts[r.code] || {};
        return {
          id: r.code,
          sku: r.code,
          title: r.colour || "",
          options: r.colour ? [r.colour] : [],
          image: f.image || null,
          price_cents,
          purchasable: price_cents != null,
          available: true,
          new: Boolean(f.new),
        };
      });
      const hasOptions = rows.length > 1 && rows.every((r) => r.colour);
      if (!hasOptions) variants.forEach((v) => { v.options = []; });
      const webId = (factsDoc.india_website_match || {})[name];
      const wp = webId ? webById.get(webId) : null;
      const description_html = copy[name] || wp?.description_html || describe(name, category, rows, facts);
      const images = [];
      for (const v of variants) if (v.image && !images.some((i) => i.src === v.image)) images.push({ src: v.image, alt: v.title ? `${name} – ${v.title}` : name });
      for (const im of wp?.images || []) if (images.length < 12) images.push({ src: im.src, alt: im.alt || name });
      let id = slug(name) || rows[0].code;
      if (usedIds.has(id)) id = `${id}-${slug(rows[0].code)}`;
      usedIds.add(id);
      const buyable = variants.filter((v) => v.purchasable);
      const prices = buyable.map((v) => v.price_cents);
      list.push({
        id,
        name,
        category,
        summary: summarize(description_html),
        description_html,
        images,
        options: hasOptions ? ["Colour"] : [],
        variants,
        new: variants.some((v) => v.new),
        min_price_cents: prices.length ? Math.min(...prices) : null,
        max_price_cents: prices.length ? Math.max(...prices) : null,
        purchasable: buyable.length > 0,
      });
    }

    const byId = new Map(list.map((p) => [p.id, p]));
    const variantIndex = new Map();
    for (const p of list) for (const v of p.variants) variantIndex.set(v.id, { product: p, variant: v });
    return { config, products: list, byId, variantIndex };
  }

  return {
    async get() {
      const key = await mtimes();
      if (!cache || key !== cacheKey) {
        cache = await build();
        cacheKey = key;
      }
      return cache;
    },
  };
}

// What the browser needs for listing pages and the cart (no long descriptions).
export function productSummary(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    summary: p.summary,
    image: p.images[0]?.src || null,
    image2: p.images[1]?.src || null,
    new: p.new,
    min_price_cents: p.min_price_cents,
    max_price_cents: p.max_price_cents,
    purchasable: p.purchasable,
    variants: p.variants.map((v) => ({
      id: v.id,
      title: v.title,
      image: v.image,
      price_cents: v.price_cents,
      purchasable: v.purchasable,
    })),
  };
}

// Public subset of site.config.json.
export function publicConfig(c) {
  return {
    store_name: c.store_name,
    legal_name: c.legal_name,
    tagline: c.tagline,
    india_site_url: c.india_site_url,
    support_email: c.support_email,
    support_phone: c.support_phone,
    support_hours: c.support_hours,
    business_address: c.business_address,
    shipping: c.shipping,
    returns: c.returns,
    legal: c.legal,
  };
}
