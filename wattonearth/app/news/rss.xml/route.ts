import { getPublishedPosts } from "@/lib/news";
import { absoluteUrl, site } from "@/lib/site";

export const dynamic = "force-static";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** RSS 2.0 feed of published posts only (drafts never appear, in any environment). */
export function GET() {
  const posts = getPublishedPosts().slice(0, 50);
  const items = posts
    .map((p) => {
      const url = absoluteUrl(`/news/${p.slug}`);
      const description = `${p.summary}\n\nWhat this means: ${p.whatItMeans}\n\nSource: ${p.sourceName} — ${p.sourceUrl}`;
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(`${p.date}T06:00:00+05:30`).toUTCString()}</pubDate>
      <description>${esc(description)}</description>
${p.tags.map((t) => `      <category>${esc(t)}</category>`).join("\n")}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(site.name)} — News</title>
    <link>${absoluteUrl("/news")}</link>
    <atom:link href="${absoluteUrl("/news/rss.xml")}" rel="self" type="application/rss+xml" />
    <description>${esc("India energy & carbon news — CCTS, CBAM, BRSR, ECBC — with what it means for your sector.")}</description>
    <language>en-in</language>
${posts[0] ? `    <lastBuildDate>${new Date(`${posts[0].date}T06:00:00+05:30`).toUTCString()}</lastBuildDate>\n` : ""}${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
