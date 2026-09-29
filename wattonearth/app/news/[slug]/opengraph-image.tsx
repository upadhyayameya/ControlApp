import { getPost, getVisiblePosts, formatNewsDate } from "@/lib/news";
import { ogSize, renderOgImage } from "@/lib/og";

export const alt = "Watt on Earth news";
export const size = ogSize;
export const contentType = "image/png";

export function generateStaticParams() {
  return getVisiblePosts().map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = getPost(slug);
  return renderOgImage({
    eyebrow: post?.type === "roundup" ? "Weekly Roundup" : (post?.tags.slice(0, 3).join(" · ") ?? "News"),
    title: post?.title ?? "News",
    footer: post ? `${formatNewsDate(post.date)} · wattonearth.in/news` : undefined,
  });
}
