import Link from "next/link";
import { NewsCard } from "@/components/news/NewsCard";
import { NewsletterForm } from "@/components/forms/NewsletterForm";
import { Container, SectionHeading } from "@/components/ui/primitives";
import { filterPosts, getVisiblePosts, newsHref, parseNewsQuery, showDrafts, type NewsQuery } from "@/lib/news";
import { pageMetadata } from "@/lib/seo";
import { NEWS_SECTORS, NEWS_TAGS } from "@/lib/types";

export const metadata = pageMetadata({
  title: "News",
  description:
    "A weekly briefing on India's energy and carbon landscape — CCTS, CBAM, BRSR, ECBC, energy prices and efficiency — with what each item means for your sector.",
  path: "/news",
});

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-fg hover:text-fg"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function NewsPage({ searchParams }: PageProps<"/news">) {
  const query: NewsQuery = parseNewsQuery(await searchParams);
  const all = getVisiblePosts();
  const { items, total, page, totalPages } = filterPosts(all, query);
  const filtering = query.tags.length > 0 || query.sectors.length > 0 || query.q !== "";
  const featured = !filtering && page === 1 ? all.find((p) => p.type === "roundup") : undefined;
  const list = featured ? items.filter((p) => p.slug !== featured.slug) : items;

  return (
    <Container className="py-20 sm:py-28">
      <SectionHeading
        as="h1"
        eyebrow="News"
        title="What changed, and what it means for you."
        lead="Short summaries of the week's energy and carbon news in India, with our take for hotels, commercial buildings, manufacturers and exporters. We link to every original source."
      />
      {showDrafts() && (
        <p className="mt-6 inline-block rounded-lg bg-warn-bg px-3 py-1.5 text-xs text-warn-fg">
          Drafts are visible because this is a development or preview build.
        </p>
      )}

      {/* Filters */}
      <section aria-label="Filter news" className="mt-12 space-y-5 border-y border-line py-6">
        <form action="/news" method="get" role="search" className="flex max-w-lg gap-2">
          <label htmlFor="news-q" className="sr-only">
            Search news
          </label>
          <input
            id="news-q"
            name="q"
            type="search"
            defaultValue={query.q}
            placeholder="Search news"
            className="min-w-0 flex-1 rounded-full border border-line bg-bg px-5 py-2.5 text-base focus:border-fg focus:outline-none"
          />
          {query.tags.length > 0 && <input type="hidden" name="tag" value={query.tags.join(",")} />}
          {query.sectors.length > 0 && <input type="hidden" name="sector" value={query.sectors.join(",")} />}
          <button type="submit" className="rounded-full bg-fg px-5 py-2.5 text-sm font-medium text-bg">
            Search
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-xs uppercase tracking-[0.15em] text-muted">Topic</span>
          {NEWS_TAGS.map((t) => (
            <Chip key={t} active={query.tags.includes(t)} href={newsHref({ ...query, tags: toggle(query.tags, t), page: 1 })}>
              {t}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-2 text-xs uppercase tracking-[0.15em] text-muted">Sector</span>
          {NEWS_SECTORS.map((s) => (
            <Chip key={s} active={query.sectors.includes(s)} href={newsHref({ ...query, sectors: toggle(query.sectors, s), page: 1 })}>
              {s}
            </Chip>
          ))}
          {filtering && (
            <Link href="/news" className="ml-2 text-sm underline underline-offset-4">
              Clear all
            </Link>
          )}
        </div>
      </section>

      <p className="mt-6 text-sm text-muted" aria-live="polite">
        {total} {total === 1 ? "item" : "items"}
        {filtering ? (total === 1 ? " matches your filters" : " match your filters") : ""}
      </p>

      {featured && (
        <div className="mt-6">
          <NewsCard post={featured} />
        </div>
      )}

      {list.length > 0 ? (
        <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {list.map((p) => (
            <NewsCard key={p.slug} post={p} />
          ))}
        </div>
      ) : (
        !featured && (
          <p className="mt-10 text-muted">
            {all.length === 0
              ? "Our first briefings are on the way. Subscribe below and we'll send them to you."
              : "Nothing matches those filters yet."}
          </p>
        )
      )}

      {totalPages > 1 && (
        <nav aria-label="Pagination" className="mt-12 flex items-center justify-between border-t border-line pt-6 text-sm">
          {page > 1 ? (
            <Link href={newsHref({ ...query, page: page - 1 })} className="underline underline-offset-4">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={newsHref({ ...query, page: page + 1 })} className="underline underline-offset-4">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <section aria-labelledby="nl" className="mt-20 grid gap-8 rounded-3xl border border-line p-8 sm:p-10 lg:grid-cols-2 lg:items-center">
        <div>
          <h2 id="nl" className="text-2xl font-semibold tracking-tight">
            Get the weekly roundup by email
          </h2>
          <p className="mt-2 text-muted">
            Or follow via <a href="/news/rss.xml" className="underline underline-offset-4">RSS</a>.
          </p>
        </div>
        <NewsletterForm context="news-list" />
      </section>
    </Container>
  );
}
