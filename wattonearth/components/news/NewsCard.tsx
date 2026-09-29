import Link from "next/link";
import { Badge } from "@/components/ui/primitives";
import { formatNewsDate } from "@/lib/news";
import type { NewsPost } from "@/lib/types";

export function NewsCard({ post }: { post: NewsPost }) {
  const roundup = post.type === "roundup";
  return (
    <article
      className={`group relative flex h-full flex-col rounded-2xl border p-6 transition-colors hover:border-fg ${
        roundup ? "border-accent/50 bg-accent-soft" : "border-line bg-bg-elevated"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {roundup && <Badge tone="accent">Weekly Roundup</Badge>}
        {post.status === "draft" && <Badge tone="warn">Draft</Badge>}
        <time dateTime={post.date} className="text-xs text-muted">
          {formatNewsDate(post.date)}
        </time>
      </div>
      <h3 className="mt-4 text-lg font-semibold leading-snug">
        <Link href={`/news/${post.slug}`} className="after:absolute after:inset-0">
          {post.title}
        </Link>
      </h3>
      <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted">{post.summary}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
        {post.tags.map((t) => (
          <Badge key={t}>{t}</Badge>
        ))}
      </div>
    </article>
  );
}
