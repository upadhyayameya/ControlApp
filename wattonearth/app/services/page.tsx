import Link from "next/link";
import { Badge, ButtonLink, Container, SectionHeading } from "@/components/ui/primitives";
import { services } from "@/data/services";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Services",
  description:
    "Remote energy audits, monitoring & verification, CBAM emissions data packs, BRSR value-chain support and CCTS readiness for Indian facilities.",
  path: "/services",
});

export default function ServicesPage() {
  return (
    <Container className="py-20 sm:py-28">
      <SectionHeading
        as="h1"
        eyebrow="Services"
        title="Fixed scopes. Clear deliverables. Results you can verify."
        lead="Every engagement starts from your own data and ends with numbers you can act on — in kWh, ₹ and tCO₂e."
      />
      <ul className="mt-16 divide-y divide-line border-y border-line">
        {services.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/services/${s.slug}`}
              className="group grid gap-4 py-10 sm:grid-cols-[1fr_2fr_auto] sm:items-baseline sm:gap-10"
            >
              <h2 className="text-2xl font-semibold tracking-tight group-hover:text-accent">{s.name}</h2>
              <div>
                <p className="leading-relaxed text-muted">{s.tagline}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {s.relatedRegimes.map((r) => (
                    <Badge key={r}>{r}</Badge>
                  ))}
                </div>
              </div>
              <span className="text-sm font-medium" aria-hidden="true">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-16 flex flex-wrap items-center gap-4">
        <ButtonLink href="/check">Not sure where to start? Run the free Check</ButtonLink>
        <ButtonLink href="/contact" variant="secondary">
          Talk to us
        </ButtonLink>
      </div>
    </Container>
  );
}
