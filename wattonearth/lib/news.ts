import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  NEWS_SECTORS,
  NEWS_TAGS,
  type NewsFrontmatter,
  type NewsPost,
  type NewsSector,
  type NewsTag,
} from "@/lib/types";

export const NEWS_DIR = path.join(process.cwd(), "content", "news");
export const PAGE_SIZE = 9;

/**
 * Drafts are visible in `next dev` only. `SHOW_DRAFTS=true` can opt a
 * (preview) deployment in for reviewing the weekly news PR — never set it on production.
 */
export function showDrafts(): boolean {
  return process.env.NODE_ENV === "development" || process.env.SHOW_DRAFTS === "true";
}

function toISODate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? "");
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}

/** Parses and validates one post. Throws with a helpful message on bad frontmatter. */
export function parsePost(slug: string, source: string): NewsPost {
  const { data, content } = matter(source);
  const where = `content/news/${slug}.mdx`;
  const fm: NewsFrontmatter = {
    title: String(data.title ?? ""),
    date: toISODate(data.date),
    summary: String(data.summary ?? "").trim(),
    whatItMeans: String(data.whatItMeans ?? "").trim(),
    tags: asArray(data.tags) as NewsTag[],
    sectors: asArray(data.sectors) as NewsSector[],
    sourceName: String(data.sourceName ?? ""),
    sourceUrl: String(data.sourceUrl ?? ""),
    status: data.status === "published" ? "published" : "draft",
    type: data.type === "roundup" ? "roundup" : "news",
  };
  if (!fm.title) throw new Error(`${where}: missing title`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) throw new Error(`${where}: date must be YYYY-MM-DD`);
  for (const t of fm.tags) {
    if (!NEWS_TAGS.includes(t)) throw new Error(`${where}: unknown tag "${t}" (allowed: ${NEWS_TAGS.join(", ")})`);
  }
  for (const s of fm.sectors) {
    if (!NEWS_SECTORS.includes(s)) throw new Error(`${where}: unknown sector "${s}" (allowed: ${NEWS_SECTORS.join(", ")})`);
  }
  if (data.status !== "draft" && data.status !== "published") {
    throw new Error(`${where}: status must be "draft" or "published"`);
  }
  return { ...fm, slug, body: content };
}

let cache: NewsPost[] | null = null;

/** Every post on disk, newest first, including drafts. */
export function getAllPostsIncludingDrafts(): NewsPost[] {
  if (cache && process.env.NODE_ENV === "production") return cache;
  if (!fs.existsSync(NEWS_DIR)) return [];
  const posts = fs
    .readdirSync(NEWS_DIR)
    .filter((f) => f.endsWith(".mdx") && !f.startsWith("_"))
    .map((f) => parsePost(f.replace(/\.mdx$/, ""), fs.readFileSync(path.join(NEWS_DIR, f), "utf8")))
    .sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
  cache = posts;
  return posts;
}

/** Posts visible in the current environment (published only in production). */
export function getVisiblePosts(): NewsPost[] {
  const all = getAllPostsIncludingDrafts();
  return showDrafts() ? all : all.filter((p) => p.status === "published");
}

/** Published posts only — for RSS and sitemap, regardless of environment. */
export function getPublishedPosts(): NewsPost[] {
  return getAllPostsIncludingDrafts().filter((p) => p.status === "published");
}

export function getPost(slug: string): NewsPost | undefined {
  return getVisiblePosts().find((p) => p.slug === slug);
}

export interface NewsQuery {
  tags: NewsTag[];
  sectors: NewsSector[];
  q: string;
  page: number;
}

function pickAll<T extends string>(value: string | string[] | undefined, allowed: readonly T[]): T[] {
  const list = (Array.isArray(value) ? value : value ? value.split(",") : []).map((v) => v.trim());
  return allowed.filter((a) => list.includes(a));
}

export function parseNewsQuery(sp: Record<string, string | string[] | undefined>): NewsQuery {
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page);
  return {
    tags: pickAll(sp.tag, NEWS_TAGS),
    sectors: pickAll(sp.sector, NEWS_SECTORS),
    q: String((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "").trim().slice(0, 100),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
  };
}

/** Builds a /news URL for a query, omitting defaults. */
export function newsHref(query: Partial<NewsQuery>): string {
  const params = new URLSearchParams();
  if (query.tags?.length) params.set("tag", query.tags.join(","));
  if (query.sectors?.length) params.set("sector", query.sectors.join(","));
  if (query.q) params.set("q", query.q);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const s = params.toString();
  return s ? `/news?${s}` : "/news";
}

/** Filters (tags: any-of, sectors: any-of, text search) and paginates. */
export function filterPosts(posts: NewsPost[], query: NewsQuery) {
  const needle = query.q.toLowerCase();
  const filtered = posts.filter((p) => {
    if (query.tags.length && !p.tags.some((t) => query.tags.includes(t))) return false;
    if (query.sectors.length && !p.sectors.some((s) => query.sectors.includes(s))) return false;
    if (needle) {
      const hay = `${p.title} ${p.summary} ${p.whatItMeans} ${p.sourceName} ${p.tags.join(" ")}`.toLowerCase();
      if (!needle.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(query.page, totalPages);
  return {
    total: filtered.length,
    page,
    totalPages,
    items: filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

/** Posts sharing the most tags/sectors with `post`. */
export function relatedPosts(post: NewsPost, limit = 3): NewsPost[] {
  return getVisiblePosts()
    .filter((p) => p.slug !== post.slug)
    .map((p) => ({
      p,
      score:
        p.tags.filter((t) => post.tags.includes(t)).length * 2 +
        p.sectors.filter((s) => post.sectors.includes(s)).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.p.date.localeCompare(a.p.date))
    .slice(0, limit)
    .map((x) => x.p);
}

export function formatNewsDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
