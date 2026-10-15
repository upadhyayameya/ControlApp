import Link from "next/link";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { NewsCard } from "@/components/news/NewsCard";
import { NewsletterForm } from "@/components/forms/NewsletterForm";
import { Badge, Container } from "@/components/ui/primitives";
import { formatNewsDate, getPost, getVisiblePosts, newsHref, relatedPosts } from "@/lib/news";
import { JsonLd, pageMetadata } from "@/lib/seo";
import { absoluteUrl, site } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return getVisiblePosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/news/[slug]">) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return {};
  return {
    ...pageMetadata({ title: post.title, description: post.summary, path: `/news/${post.slug}`, ogType: "article" }),
    ...(post.status === "draft" ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function NewsPostPage({ params }: PageProps<"/news/[slug]">) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();
  const related = relatedPosts(post);
  const url = absoluteUrl(`/news/${post.slug}`);

  return (
    <Container className="py-20 sm:py-28">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: post.title,
          description: post.summary,
          datePublished: post.date,
          dateModified: post.date,
          url,
          mainEntityOfPage: url,
          image: `${url}/opengraph-image`,
          author: { "@type": "Organization", name: site.name, url: site.url },
          publisher: { "@type": "Organization", name: site.name, logo: { "@type": "ImageObject", url: absoluteUrl("/icon.svg") } },
          about: post.tags,
          isBasedOn: post.sourceUrl,
        }}
      />
      <article className="mx-auto max-w-3xl">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <Link href="/news" className="hover:text-fg">
            News
          </Link>
        </nav>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {post.type === "roundup" && <Badge tone="accent">Weekly Roundup</Badge>}
          {post.status === "draft" && <Badge tone="warn">Draft — not published</Badge>}
          <time dateTime={post.date} className="text-sm text-muted">
            {formatNewsDate(post.date)}
          </time>
        </div>
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">{post.title}</h1>

        <p className="mt-8 text-xl leading-relaxed text-muted">{post.summary}</p>

        <aside aria-labelledby="wim" className="mt-10 rounded-2xl border-l-4 border-accent bg-accent-soft px-6 py-5">
          <h2 id="wim" className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">
            What this means for you
          </h2>
          <p className="mt-2 text-lg leading-relaxed">{post.whatItMeans}</p>
          {post.sectors.length > 0 && (
            <p className="mt-3 text-sm text-muted">Most relevant for: {post.sectors.join(", ")}</p>
          )}
        </aside>

        {post.body.trim() && (
          <div className="prose-woe mt-10">
            <MDXRemote source={post.body} options={{ blockJS: true }} />
          </div>
        )}

        <p className="mt-10 border-t border-line pt-6 text-sm">
          Source:{" "}
          <a href={post.sourceUrl} target="_blank" rel="noopener" className="font-medium underline underline-offset-4">
            {post.sourceName} ↗
          </a>
          <span className="block mt-1 text-muted">
            We summarise and comment; read the full story at the original source.
          </span>
        </p>

        <div className="mt-6 flex flex-wrap gap-1.5">
          {post.tags.map((t) => (
            <Link key={t} href={newsHref({ tags: [t] })}>
              <Badge>{t}</Badge>
            </Link>
          ))}
        </div>
      </article>

      <section aria-labelledby="nl" className="mx-auto mt-16 max-w-3xl rounded-3xl border border-line p-8">
        <h2 id="nl" className="text-xl font-semibold">
          Get briefings like this every week
        </h2>
        <div className="mt-5">
          <NewsletterForm context={`post:${post.slug}`} compact />
        </div>
      </section>

      {related.length > 0 && (
        <section aria-labelledby="related" className="mt-20">
          <h2 id="related" className="text-2xl font-semibold tracking-tight">
            Related
          </h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {related.map((p) => (
              <NewsCard key={p.slug} post={p} />
            ))}
          </div>
        </section>
      )}
    </Container>
  );
}
