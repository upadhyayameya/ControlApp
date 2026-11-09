// Loads data/products.json + data/prices.csv + site.config.json and merges them.
// Re-reads automatically when any of those files change, so edits show up without a restart.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./csv.js";

export function createCatalog(root) {
  const files = {
    products: path.join(root, "data", "products.json"),
    prices: path.join(root, "data", "prices.csv"),
    config: path.join(root, "site.config.json"),
  };
  let cache = null;
  let cacheKey = "";

  async function mtimes() {
    const parts = await Promise.all(
      Object.values(files).map((f) => stat(f).then((s) => s.mtimeMs).catch(() => 0))
    );
    return parts.join(":");
  }

  async function build() {
    const config = JSON.parse(await readFile(files.config, "utf8"));
    let products = [];
    try { products = JSON.parse(await readFile(files.products, "utf8")); } catch {}
    let priceRows = [];
    try { priceRows = parseCsv(await readFile(files.prices, "utf8")); } catch {}

    const usd = new Map();
    for (const r of priceRows) {
      const n = Number(String(r.usd_price).replace(/[$,\s]/g, ""));
      if (r.usd_price && Number.isFinite(n) && n > 0) usd.set(r.variant_id, Math.round(n * 100));
    }

    const list = [];
    for (const p of products) {
      const variants = p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        options: v.options,
        image: v.image,
        price_cents: usd.get(v.id) ?? null,
        purchasable: v.available && usd.has(v.id),
        available: v.available,
      }));
      const priced = variants.filter((v) => v.price_cents != null);
      if (config.hide_unpriced_products && priced.length === 0) continue;
      const buyable = variants.filter((v) => v.purchasable);
      const prices = (buyable.length ? buyable : priced).map((v) => v.price_cents);
      list.push({
        id: p.id,
        name: p.name,
        category: p.category,
        summary: p.summary,
        description_html: p.description_html,
        images: p.images,
        options: p.options,
        variants,
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
