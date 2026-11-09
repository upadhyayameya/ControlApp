import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCsv, toCsv } from "../lib/csv.js";
import { createCatalog, productSummary } from "../lib/catalog.js";

test("csv round-trips quotes, commas and newlines", () => {
  const rows = [{ a: 'Pen "Lion", gold', b: "line1\nline2", c: "" }];
  assert.deepEqual(parseCsv(toCsv(["a", "b", "c"], rows)), rows);
});

test("csv handles BOM and CRLF from Excel", () => {
  assert.deepEqual(parseCsv("﻿variant_id,usd_price\r\n1,9.99\r\n"), [{ variant_id: "1", usd_price: "9.99" }]);
});

async function fixture({ prices, config = {} }) {
  const root = await mkdtemp(path.join(tmpdir(), "subpens-"));
  await mkdir(path.join(root, "data"));
  const products = [
    {
      id: "lion-pen",
      name: "Lion Pen",
      category: "Fountain Pens",
      summary: "s",
      description_html: "<p>d</p>",
      images: [{ src: "https://example.com/a.png", alt: "" }],
      options: ["Color"],
      variants: [
        { id: "1", sku: "A", title: "Black", options: ["Black"], available: true, image: null },
        { id: "2", sku: "B", title: "Gold", options: ["Gold"], available: true, image: null },
        { id: "3", sku: "C", title: "Red", options: ["Red"], available: false, image: null },
      ],
    },
    {
      id: "unpriced",
      name: "Unpriced",
      category: "Ball Pens",
      summary: "",
      description_html: "",
      images: [],
      options: [],
      variants: [{ id: "9", sku: "", title: "", options: [], available: true, image: null }],
    },
  ];
  await writeFile(path.join(root, "data", "products.json"), JSON.stringify(products));
  await writeFile(path.join(root, "data", "prices.csv"), prices);
  await writeFile(path.join(root, "site.config.json"), JSON.stringify({ store_name: "T", ...config }));
  return createCatalog(root);
}

test("merges USD prices; unpriced or out-of-stock variants are not purchasable", async () => {
  const cat = await fixture({ prices: "variant_id,usd_price\n1,24.99\n2,$30\n3,10\n" });
  const { byId, variantIndex } = await cat.get();
  const p = byId.get("lion-pen");
  assert.equal(variantIndex.get("1").variant.price_cents, 2499);
  assert.equal(variantIndex.get("2").variant.price_cents, 3000);
  assert.equal(variantIndex.get("3").variant.purchasable, false); // priced but sold out
  assert.equal(p.min_price_cents, 2499);
  assert.equal(p.max_price_cents, 3000);
  assert.equal(p.purchasable, true);
  assert.equal(byId.get("unpriced").purchasable, false);
  assert.equal(byId.get("unpriced").min_price_cents, null);
  assert.equal(productSummary(p).variants.length, 3);
});

test("ignores invalid prices", async () => {
  const cat = await fixture({ prices: "variant_id,usd_price\n1,abc\n2,-5\n" });
  const { variantIndex } = await cat.get();
  assert.equal(variantIndex.get("1").variant.price_cents, null);
  assert.equal(variantIndex.get("2").variant.price_cents, null);
});

test("hide_unpriced_products hides products with no USD price", async () => {
  const cat = await fixture({ prices: "variant_id,usd_price\n1,5\n", config: { hide_unpriced_products: true } });
  const { byId } = await cat.get();
  assert.ok(byId.has("lion-pen"));
  assert.ok(!byId.has("unpriced"));
});
