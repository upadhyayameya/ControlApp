/**
 * Weekly news drafting.
 *
 *   npm run news:fetch               # fetch, draft with Claude, write MDX drafts
 *   npm run news:fetch -- --dry-run  # fetch + draft, print instead of writing
 *   npm run news:fetch -- --no-ai    # fetch only; write stub drafts to fill in by hand
 *   npm run news:fetch -- --fixture tests/fixtures/sample-feed.xml   # read a local feed (testing)
 *
 * 1. Pulls every enabled RSS feed in data/news-sources.json (a feed that is down
 *    is logged and skipped — the run continues).
 * 2. Keeps items from the last `lookbackDays` that match a keyword, and drops
 *    duplicates by normalised source URL (within this run and against posts
 *    already in content/news).
 * 3. Asks Claude for a short summary, "what it means", tags and sectors per item,
 *    plus one weekly roundup. Only the headline and feed snippet are sent — we
 *    never republish full articles.
 * 4. Writes every file with `status: draft`. Nothing is published automatically.
 *
 * Env: ANTHROPIC_API_KEY (required unless --no-ai), ANTHROPIC_MODEL (optional).
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import Parser from "rss-parser";
import Anthropic from "@anthropic-ai/sdk";
import { NEWS_DIR, getAllPostsIncludingDrafts, parsePost } from "@/lib/news";
import { NEWS_SECTORS, NEWS_TAGS, type NewsFrontmatter } from "@/lib/types";
import sourcesConfig from "@/data/news-sources.json";
import { site } from "@/lib/site";

const DEFAULT_MODEL = "claude-opus-5-5";
/** Models that accept server-side `fallbacks: "default"` on the Claude API. */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

const FEED_TIMEOUT_MS = 20_000;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const argv = process.argv.slice(2);
const FIXTURE = argv.includes("--fixture") ? argv[argv.indexOf("--fixture") + 1] : null;
const NO_AI = args.has("--no-ai");

interface SourceConfig {
  name: string;
  url: string;
  enabled: boolean;
}

export interface FeedItem {
  sourceName: string;
  title: string;
  url: string;
  date: string; // YYYY-MM-DD
  snippet: string;
}

/* ------------------------------------------------------------------ */
/* Helpers (exported for tests)                                        */
/* ------------------------------------------------------------------ */

/** Lower-cases host, strips tracking params, fragments and trailing slashes. */
export function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$|from$)/i.test(k)) u.searchParams.delete(k);
    }
    u.protocol = "https:";
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw.trim();
  }
}

export function matchesKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((k) => {
    // Short acronyms must match as whole words (avoid "BEE" in "been").
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return /^[A-Z]{2,5}$/.test(k)
      ? new RegExp(`\\b${escaped}\\b`).test(text)
      : new RegExp(escaped, "i").test(text);
  });
}

export function slugify(s: string, max = 60): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

export function dedupe(items: FeedItem[], existingUrls: Set<string>): FeedItem[] {
  const seen = new Set(existingUrls);
  const out: FeedItem[] = [];
  for (const it of items) {
    const key = normaliseUrl(it.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/** YYYY-MM-DD for "now" in IST. */
function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/* 1–2. Fetch and filter                                               */
/* ------------------------------------------------------------------ */

async function fetchFeeds(): Promise<{ items: FeedItem[]; failures: string[] }> {
  const parser = new Parser();
  const cutoff = Date.now() - sourcesConfig.lookbackDays * 86_400_000;
  const items: FeedItem[] = [];
  const failures: string[] = [];

  // fetch + a hard timeout: a stalled connection must never hang the weekly job.
  const load = async (s: SourceConfig) => {
    const res = await fetch(s.url, {
      headers: {
        "User-Agent": "WattOnEarthNewsBot/1.0 (+https://wattonearth.in)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { s, feed: await parser.parseString(await res.text()) };
  };

  const sources: SourceConfig[] = FIXTURE
    ? [{ name: "Fixture", url: FIXTURE, enabled: true }]
    : (sourcesConfig.sources as SourceConfig[]).filter((s) => s.enabled);
  const results = await Promise.allSettled(
    sources.map((s) =>
      FIXTURE ? parser.parseString(fs.readFileSync(s.url, "utf8")).then((feed) => ({ s, feed })) : load(s),
    ),
  );

  results.forEach((r, i) => {
    const source = sources[i];
    if (r.status === "rejected") {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      failures.push(`${source.name}: ${msg}`);
      console.warn(`⚠  ${source.name} feed failed — skipped (${msg})`);
      return;
    }
    let kept = 0;
    for (const entry of r.value.feed.items ?? []) {
      const when = Date.parse(entry.isoDate ?? entry.pubDate ?? "");
      if (!entry.link || !entry.title || !Number.isFinite(when) || when < cutoff) continue;
      const snippet = stripHtml(entry.contentSnippet ?? entry.summary ?? entry.content ?? "").slice(0, 600);
      if (!matchesKeywords(`${entry.title} ${snippet}`, sourcesConfig.keywords)) continue;
      items.push({
        sourceName: source.name,
        title: entry.title.trim(),
        url: normaliseUrl(entry.link),
        date: new Date(when).toISOString().slice(0, 10),
        snippet,
      });
      kept++;
    }
    console.log(`✓  ${source.name}: ${kept} matching item(s)`);
  });

  return { items, failures };
}

/* ------------------------------------------------------------------ */
/* 3. Draft with Claude                                                */
/* ------------------------------------------------------------------ */

interface DraftedItem {
  index: number;
  include: boolean;
  title: string;
  summary: string;
  whatItMeans: string;
  tags: string[];
  sectors: string[];
}

interface DraftResponse {
  items: DraftedItem[];
  roundup: { title: string; summary: string; whatItMeans: string; tags: string[]; sectors: string[]; intro: string };
}

const SYSTEM_PROMPT = `You write draft news briefs for Watt on Earth, an energy and carbon advisory serving Indian commercial buildings, hotels, manufacturers and exporters. Drafts are reviewed by an engineer before anything is published.

For each item you receive a headline, source and the feed's own snippet. Work only from that text:
- Do not add facts, numbers, dates or quotes that are not in the snippet. If the snippet is thin, say less.
- Never reproduce the article. Write in your own words; at most a few words quoted.
- summary: 3–5 plain sentences, neutral, Indian English, ₹ and lakh/crore where relevant.
- whatItMeans: 1–2 sentences addressed to the most affected sector (hotels, commercial buildings, manufacturers or exporters) — practical, not alarmist. If the implication is uncertain, say what to watch for.
- title: a clear, factual headline in your own words (no clickbait, max ~90 characters).
- tags: only from ${NEWS_TAGS.join(", ")}. sectors: only from ${NEWS_SECTORS.join(", ")}.
- include: false if the item is not genuinely relevant to Indian facilities' energy, carbon or compliance (e.g. a keyword matched by accident).

Also write one weekly roundup across the included items: a title like "Weekly Roundup: <main theme>", a 3–5 sentence summary of the week, a 1–2 sentence whatItMeans, tags, sectors, and a one-paragraph intro.`;

const stringArray = (values: readonly string[]) => ({ type: "array", items: { type: "string", enum: [...values] } });

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "roundup"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "include", "title", "summary", "whatItMeans", "tags", "sectors"],
        properties: {
          index: { type: "integer" },
          include: { type: "boolean" },
          title: { type: "string" },
          summary: { type: "string" },
          whatItMeans: { type: "string" },
          tags: stringArray(NEWS_TAGS),
          sectors: stringArray(NEWS_SECTORS),
        },
      },
    },
    roundup: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "whatItMeans", "tags", "sectors", "intro"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        whatItMeans: { type: "string" },
        tags: stringArray(NEWS_TAGS),
        sectors: stringArray(NEWS_SECTORS),
        intro: { type: "string" },
      },
    },
  },
};

async function draftWithClaude(items: FeedItem[]): Promise<DraftResponse> {
  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const useFallback = FALLBACK_MODELS.has(model);
  const userContent = items
    .map(
      (it, i) =>
        `<item index="${i}">\n<source>${it.sourceName}</source>\n<date>${it.date}</date>\n<headline>${it.title}</headline>\n<snippet>${it.snippet || "(no snippet)"}</snippet>\n</item>`,
    )
    .join("\n\n");

  console.log(`…  Drafting ${items.length} item(s) with ${model}`);
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    output_config: { effort: "medium", format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    // Server-side refusal fallback, on models that support it.
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    messages: [{ role: "user", content: `This week's items:\n\n${userContent}` }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error(`Claude declined the request (${message.stop_details?.category ?? "no category"}).`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("Claude's response was cut off (max_tokens). Reduce maxItems in data/news-sources.json.");
  }
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text) as DraftResponse;
}

/** Offline mode: stubs to be written by hand. */
function stubDrafts(items: FeedItem[]): DraftResponse {
  return {
    items: items.map((it, index) => ({
      index,
      include: true,
      title: it.title,
      summary: `TODO — write a 3–5 line summary in our own words. Feed snippet: ${it.snippet}`,
      whatItMeans: "TODO — 1–2 lines on what this means for the most affected sector.",
      tags: [],
      sectors: [],
    })),
    roundup: {
      title: "Weekly Roundup",
      summary: "TODO — summarise the week.",
      whatItMeans: "TODO — the key takeaway.",
      tags: [],
      sectors: [],
      intro: "TODO",
    },
  };
}

/* ------------------------------------------------------------------ */
/* 4. Write drafts                                                     */
/* ------------------------------------------------------------------ */

function uniquePath(base: string): string {
  let file = path.join(NEWS_DIR, `${base}.mdx`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(NEWS_DIR, `${base}-${n}.mdx`);
  return file;
}

function toMdx(fm: NewsFrontmatter, body: string): string {
  return matter.stringify(body.trim() ? `\n${body.trim()}\n` : "", fm as unknown as Record<string, unknown>);
}

function writeDraft(fm: NewsFrontmatter, body: string, base: string): string | null {
  const content = toMdx(fm, body);
  const file = uniquePath(base);
  parsePost(path.basename(file, ".mdx"), content); // validates tags/sectors/date — throws on bad output
  if (DRY_RUN) {
    console.log(`\n--- ${path.relative(process.cwd(), file)} ---\n${content}`);
    return null;
  }
  fs.writeFileSync(file, content);
  return file;
}

async function main() {
  const { items: fetched, failures } = await fetchFeeds();
  const existing = new Set(getAllPostsIncludingDrafts().map((p) => normaliseUrl(p.sourceUrl)));
  const items = dedupe(fetched, existing)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, sourcesConfig.maxItems);

  console.log(`\n${fetched.length} matching item(s), ${items.length} new after de-duplication.`);
  if (failures.length) console.log(`${failures.length} feed(s) failed: ${failures.join("; ")}`);
  if (items.length === 0) {
    console.log("Nothing new to draft this week.");
    return;
  }

  if (!NO_AI && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error("ANTHROPIC_API_KEY is not set. Set it, or run with --no-ai to write stub drafts.");
    process.exitCode = 1;
    return;
  }

  const drafted = NO_AI ? stubDrafts(items) : await draftWithClaude(items);
  const today = todayIST();
  const written: string[] = [];
  const included: { item: FeedItem; draft: DraftedItem; slug: string }[] = [];

  for (const d of drafted.items) {
    const item = items[d.index];
    if (!item || !d.include) continue;
    const base = `${item.date}-${slugify(d.title || item.title)}`;
    const fm: NewsFrontmatter = {
      title: d.title,
      date: item.date,
      summary: d.summary,
      whatItMeans: d.whatItMeans,
      tags: d.tags as NewsFrontmatter["tags"],
      sectors: d.sectors as NewsFrontmatter["sectors"],
      sourceName: item.sourceName,
      sourceUrl: item.url,
      status: "draft",
      type: "news",
    };
    const file = writeDraft(fm, "", base);
    if (file) written.push(file);
    included.push({ item, draft: d, slug: path.basename(file ?? base, ".mdx") });
  }

  if (included.length > 0) {
    const r = drafted.roundup;
    const body = [
      r.intro,
      "",
      "## This week",
      "",
      ...included.map(
        ({ item, draft, slug }) =>
          `- **[${draft.title}](/news/${slug})** — ${draft.whatItMeans} _([${item.sourceName}](${item.url}))_`,
      ),
    ].join("\n");
    const fm: NewsFrontmatter = {
      title: r.title,
      date: today,
      summary: r.summary,
      whatItMeans: r.whatItMeans,
      tags: r.tags as NewsFrontmatter["tags"],
      sectors: r.sectors as NewsFrontmatter["sectors"],
      sourceName: "Watt on Earth weekly roundup",
      sourceUrl: `${site.url}/news`,
      status: "draft",
      type: "roundup",
    };
    const file = writeDraft(fm, body, `${today}-weekly-roundup`);
    if (file) written.push(file);
  }

  console.log(`\n${DRY_RUN ? "Would write" : "Wrote"} ${included.length + (included.length ? 1 : 0)} draft(s).`);
  for (const f of written) console.log(`   ${path.relative(process.cwd(), f)}`);

  // Summary for the GitHub Action PR body.
  if (process.env.GITHUB_STEP_SUMMARY || process.env.NEWS_SUMMARY_FILE) {
    const summary = [
      `Drafted ${included.length} item(s) and ${included.length ? "1 roundup" : "no roundup"} — all \`status: draft\`.`,
      "",
      ...included.map(({ item, draft }) => `- ${draft.title} — [${item.sourceName}](${item.url})`),
      failures.length ? `\nFeeds that failed this run: ${failures.join("; ")}` : "",
    ].join("\n");
    const target = process.env.NEWS_SUMMARY_FILE ?? process.env.GITHUB_STEP_SUMMARY!;
    fs.appendFileSync(target, `${summary}\n`);
  }
}

// Run only when executed directly (tests import the helpers).
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("scripts", "fetch-news.ts"))) {
  main().catch((err) => {
    if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${err.status}: ${err.message}`);
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exitCode = 1;
  });
}
