import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv, toCsv } from "../lib/csv.js";
import { createCatalog, productSummary } from "../lib/catalog.js";
import { suggestedPriceCents } from "../lib/pricing.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRICING = {
  inr_per_usd: 95, min_multiple_of_india_price: 3, export_cost_pct_of_mrp: 0.3, freight_per_unit_usd: 0.35,
  duty_pct: 0.154, duty_per_unit_usd: 0.008, clearance_pct: 0.05, fulfilment_per_unit_usd: 1.0,
  card_fee_pct: 0.029, card_fee_per_unit_usd: 0.15, target_margin: 0.5,
};

test("csv round-trips quotes, commas and newlines", () => {
  const rows = [{ a: 'Pen "Lion", gold', b: "line1\nline2", c: "" }];
  assert.deepEqual(parseCsv(toCsv(["a", "b", "c"], rows)), rows);
});

test("csv handles BOM and CRLF from Excel", () => {
  assert.deepEqual(parseCsv("﻿code,inr_mrp\r\n1,150\r\n"), [{ code: "1", inr_mrp: "150" }]);
});

test("pricing matches the planner spreadsheet", () => {
  // values verified against the LibreOffice-recalculated planner
  assert.equal(suggestedPriceCents(120, 3, PRICING), 1199);
  assert.equal(suggestedPriceCents(600, 1, PRICING), 1899);
  assert.equal(suggestedPriceCents(700, 1, PRICING), 2299);
  assert.equal(suggestedPriceCents(1299, 1, PRICING), 4199);
  assert.equal(suggestedPriceCents(150, 1, PRICING), 499); // cost-based beats the 3x floor for cheap items
  assert.equal(suggestedPriceCents("", 1, PRICING), null);
});

test("a change in India M.R.P. or exchange rate moves the price", () => {
  assert.ok(suggestedPriceCents(800, 1, PRICING) > suggestedPriceCents(600, 1, PRICING));
  assert.ok(suggestedPriceCents(600, 1, { ...PRICING, inr_per_usd: 80 }) > suggestedPriceCents(600, 1, PRICING));
});

async function fixture(csv) {
  const root = await mkdtemp(path.join(tmpdir(), "subpens-"));
  await mkdir(path.join(root, "data"));
  await writeFile(path.join(root, "data", "us-range.csv"), csv);
  await writeFile(path.join(root, "data", "catalogue-2026-27.json"), JSON.stringify({
    products: { A1: { image: "/img/products/A1.jpg", packaging: "Gift box", details: "Metal body; Medium nib" }, A2: { image: "/img/products/A2.jpg", new: true } },
    india_website_match: {},
  }));
  await writeFile(path.join(root, "data", "india-website.json"), "[]");
  await writeFile(path.join(root, "site.config.json"), JSON.stringify({ store_name: "T", pricing: PRICING }));
  return createCatalog(root);
}

const HDR = "code,include,product,colour,category,inr_mrp,pack_size,usd_price_override,notes\n";

test("rows with the same product name become one product with colour options", async () => {
  const cat = await fixture(HDR + "A1,yes,Lion Pen,Black,Fountain Pens,600,1,,\nA2,yes,Lion Pen,Gold,Fountain Pens,800,1,,\n");
  const { products, variantIndex } = await cat.get();
  assert.equal(products.length, 1);
  const p = products[0];
  assert.equal(p.id, "lion-pen");
  assert.deepEqual(p.options, ["Colour"]);
  assert.deepEqual(p.variants.map((v) => v.title), ["Black", "Gold"]);
  assert.equal(variantIndex.get("A1").variant.price_cents, 1899);
  assert.equal(p.min_price_cents, 1899);
  assert.equal(p.new, true);
  assert.match(p.description_html, /Metal body/);
  assert.equal(productSummary(p).variants.length, 2);
});

test("include=no hides a row; override wins; missing M.R.P. isn't buyable", async () => {
  const cat = await fixture(
    HDR + "A1,yes,Pen A,,Ball Pens,600,1,24.50,\nA2,no,Pen B,,Ball Pens,600,1,,\nA3,yes,Pen C,,Ball Pens,,1,,\n"
  );
  const { byId, variantIndex } = await cat.get();
  assert.equal(variantIndex.get("A1").variant.price_cents, 2450);
  assert.ok(!variantIndex.has("A2"));
  assert.equal(byId.get("pen-c").purchasable, false);
});

test("the real US range loads, every included item has a price and a photo", async () => {
  const { products, variantIndex } = await createCatalog(ROOT).get();
  assert.ok(products.length > 100);
  for (const { product, variant } of variantIndex.values()) {
    assert.ok(variant.price_cents > 0, `${product.name} ${variant.title} has no price`);
    assert.ok(variant.image, `${product.name} has no photo`);
  }
  const ids = products.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "product ids are unique");
  const range = parseCsv(await readFile(path.join(ROOT, "data", "us-range.csv"), "utf8"));
  assert.equal(new Set(range.map((r) => r.code)).size, range.length, "codes are unique in us-range.csv");
});
