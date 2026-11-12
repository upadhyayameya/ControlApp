import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupe, matchesKeywords, normaliseUrl, slugify, type FeedItem } from "../scripts/fetch-news";
import { filterPosts, parseNewsQuery, parsePost, newsHref } from "@/lib/news";
import { isPast, nextConfirmedMilestone, regulations } from "@/lib/regulations";
import type { NewsPost } from "@/lib/types";

test("URL normalisation removes tracking and trailing slashes", () => {
  assert.equal(
    normaliseUrl("http://www.Example.com/a/b/?utm_source=x&id=2#frag"),
    normaliseUrl("https://example.com/a/b?id=2"),
  );
});

test("dedupe by source URL, including existing posts", () => {
  const item = (url: string): FeedItem => ({ sourceName: "S", title: "t", url, date: "2026-09-28", snippet: "" });
  const out = dedupe(
    [item("https://a.com/x"), item("https://a.com/x/?utm_medium=rss"), item("https://a.com/y"), item("https://a.com/z")],
    new Set([normaliseUrl("https://a.com/z")]),
  );
  assert.deepEqual(out.map((o) => o.url), ["https://a.com/x", "https://a.com/y"]);
});

test("keyword matching: acronyms are whole words", () => {
  assert.ok(matchesKeywords("New BEE guidelines", ["BEE"]));
  assert.ok(!matchesKeywords("It has been a week", ["BEE"]));
  assert.ok(matchesKeywords("India's carbon credit market", ["carbon credit"]));
  assert.ok(matchesKeywords("EU CBAM rules", ["CBAM"]));
});

test("slugify", () => {
  assert.equal(slugify("CCTS: What's new — in ₹ terms?"), "ccts-what-s-new-in-terms");
});

test("frontmatter validation rejects unknown tags", () => {
  const bad = `---\ntitle: x\ndate: 2026-09-01\nsummary: s\nwhatItMeans: w\ntags: [Nope]\nsectors: []\nsourceName: s\nsourceUrl: https://x\nstatus: draft\ntype: news\n---\n`;
  assert.throws(() => parsePost("bad", bad), /unknown tag/);
});

test("news query parsing, href building and filtering", () => {
  const q = parseNewsQuery({ tag: "CBAM,Bogus", sector: ["Hotels"], q: " steel ", page: "2" });
  assert.deepEqual(q.tags, ["CBAM"]);
  assert.deepEqual(q.sectors, ["Hotels"]);
  assert.equal(q.q, "steel");
  assert.equal(newsHref({ ...q, page: 1 }), "/news?tag=CBAM&sector=Hotels&q=steel");
  const post = (slug: string, tags: NewsPost["tags"], sectors: NewsPost["sectors"]): NewsPost => ({
    slug, title: slug, date: "2026-09-01", summary: "", whatItMeans: "", tags, sectors,
    sourceName: "", sourceUrl: "", status: "published", type: "news", body: "",
  });
  const posts = [post("a", ["CBAM"], ["Exporters"]), post("b", ["CCTS"], ["Hotels"]), post("c steel", ["CBAM"], ["Hotels"])];
  assert.deepEqual(filterPosts(posts, { tags: ["CBAM"], sectors: [], q: "", page: 1 }).items.map((p) => p.slug), ["a", "c steel"]);
  assert.deepEqual(filterPosts(posts, { tags: ["CBAM"], sectors: ["Hotels"], q: "", page: 1 }).items.map((p) => p.slug), ["c steel"]);
  assert.deepEqual(filterPosts(posts, { tags: [], sectors: [], q: "steel", page: 1 }).items.map((p) => p.slug), ["c steel"]);
});

test("countdown reads only confirmed, upcoming milestones", () => {
  // Seed data is all TBC → no countdown.
  assert.equal(nextConfirmedMilestone("CCTS", "2026-01-01"), null);
  const m = { ...regulations[0], dateStatus: "confirmed" as const, date: "2026-05-01" };
  assert.equal(isPast(m, "2026-06-01"), true);
  assert.equal(isPast({ ...m, dateStatus: "tbc" }, "2026-06-01"), false);
});
