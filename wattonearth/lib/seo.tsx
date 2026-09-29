import type { Metadata } from "next";
import { absoluteUrl, site } from "@/lib/site";

/** Builds per-page metadata with canonical URL and Open Graph defaults. */
export function pageMetadata({
  title,
  description,
  path,
  ogType = "website",
}: {
  title: string;
  description: string;
  path: string;
  ogType?: "website" | "article";
}): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${title} · ${site.name}`,
      description,
      url,
      siteName: site.name,
      locale: site.locale,
      type: ogType,
    },
    twitter: { card: "summary_large_image", title: `${title} · ${site.name}`, description },
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    url: site.url,
    logo: absoluteUrl("/icon.svg"),
    email: site.email,
    description: site.description,
    areaServed: { "@type": "Country", name: "India" },
    founder: { "@type": "Person", name: site.founder },
    knowsAbout: ["Energy audits", "Measurement and verification", "CCTS", "CBAM", "BRSR", "ECBC"],
  };
}

/** Renders a JSON-LD script tag. Escapes `<` to keep the payload inert. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
