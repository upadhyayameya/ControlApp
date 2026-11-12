import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink, Card, Container, Eyebrow } from "@/components/ui/primitives";
import { getService, services } from "@/data/services";
import { regimeInfo, trackerHref } from "@/lib/regulations";
import { pageMetadata } from "@/lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return services.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: PageProps<"/services/[slug]">) {
  const { slug } = await params;
  const s = getService(slug);
  if (!s) return {};
  return pageMetadata({ title: s.name, description: s.tagline, path: `/services/${s.slug}` });
}

const pricingText = {
  fixed: "Fixed fee, confirmed in writing before we start.",
  subscription: "Monthly subscription, sized to the number of meters and sites.",
  project: "Project fee, quoted after a short scoping call.",
};

export default async function ServicePage({ params }: PageProps<"/services/[slug]">) {
  const { slug } = await params;
  const s = getService(slug);
  if (!s) notFound();
  const others = services.filter((o) => o.slug !== s.slug).slice(0, 3);

  return (
    <Container className="py-20 sm:py-28">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/services" className="hover:text-fg">
          Services
        </Link>{" "}
        / <span aria-current="page">{s.shortName}</span>
      </nav>
      <div className="mt-8 max-w-3xl">
        <Eyebrow>{s.pillar}</Eyebrow>
        <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">{s.name}</h1>
        <p className="mt-6 text-xl leading-relaxed text-muted">{s.tagline}</p>
      </div>

      <div className="mt-16 grid gap-12 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-14">
          <section aria-labelledby="who">
            <h2 id="who" className="text-2xl font-semibold">Who it&apos;s for</h2>
            <ul className="mt-6 space-y-3">
              {s.whoFor.map((w) => (
                <li key={w} className="flex gap-3 leading-relaxed">
                  <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {w}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="deliverables">
            <h2 id="deliverables" className="text-2xl font-semibold">What you get</h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {s.deliverables.map((d) => (
                <li key={d} className="rounded-xl border border-line p-5 leading-relaxed">
                  {d}
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="process">
            <h2 id="process" className="text-2xl font-semibold">How it works</h2>
            <ol className="mt-6 space-y-5">
              {s.howItWorks.map((h, i) => (
                <li key={h} className="flex gap-5">
                  <span className="font-mono text-sm text-accent">0{i + 1}</span>
                  <span className="leading-relaxed">{h}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <h2 className="text-sm font-medium uppercase tracking-[0.15em] text-muted">Pricing</h2>
            <p className="mt-3 text-lg font-medium">{s.priceLabel ?? pricingText[s.pricingModel]}</p>
            <ButtonLink href={`/contact?service=${s.slug}`} className="mt-6 w-full">
              Request a proposal
            </ButtonLink>
            <ButtonLink href="/check" variant="secondary" className="mt-3 w-full">
              Try the free Check first
            </ButtonLink>
          </Card>
          <Card>
            <h2 className="text-sm font-medium uppercase tracking-[0.15em] text-muted">Related regulation</h2>
            <ul className="mt-4 space-y-4">
              {s.relatedRegimes.map((r) => (
                <li key={r}>
                  <Link href={trackerHref(r)} className="font-medium underline underline-offset-4">
                    {r} — {regimeInfo[r].name}
                  </Link>
                  <p className="mt-1 text-sm text-muted">{regimeInfo[r].short}</p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      <section aria-labelledby="other" className="mt-24 border-t border-line pt-12">
        <h2 id="other" className="text-xl font-semibold">Other services</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          {others.map((o) => (
            <li key={o.slug}>
              <Link href={`/services/${o.slug}`} className="block rounded-xl border border-line p-5 hover:border-fg">
                <span className="font-medium">{o.shortName}</span>
                <span className="mt-2 block text-sm text-muted line-clamp-2">{o.tagline}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </Container>
  );
}
