import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Countdown } from "@/components/site/Countdown";
import { NewsCard } from "@/components/news/NewsCard";
import { NewsletterForm } from "@/components/forms/NewsletterForm";
import { ButtonLink, Container, Eyebrow, SectionHeading } from "@/components/ui/primitives";
import { pillars, services } from "@/data/services";
import { getVisiblePosts } from "@/lib/news";
import { nextConfirmedMilestone, trackerHref } from "@/lib/regulations";
import { pageMetadata } from "@/lib/seo";
import { site } from "@/lib/site";

// Re-evaluate the countdown target hourly so a passed milestone rolls over.
export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "Energy & carbon advisory for Indian buildings and industry",
  description: site.description,
  path: "/",
});

const steps = [
  {
    title: "Upload",
    body: "Share 12 months of electricity bills, fuel records and, if you have them, meter or BMS exports. No site visit needed to start.",
  },
  {
    title: "Analyse",
    body: "We benchmark your facility, find anomalies in the data and quantify where energy, money and emissions are going.",
  },
  {
    title: "Act",
    body: "You get a ranked list of measures with savings in ₹ and kWh, simple payback and the regulatory context that matters to you.",
  },
  {
    title: "Verify",
    body: "We track results against a normalised baseline every month, so savings are measured — and your emissions data is ready to report.",
  },
];

export default function HomePage() {
  const milestone = nextConfirmedMilestone("CCTS");
  const latest = getVisiblePosts().slice(0, 3);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <Container className="grid items-center gap-12 pb-20 pt-16 sm:pt-24 lg:grid-cols-[1.4fr_1fr] lg:pb-32 lg:pt-32">
          <div>
            <Eyebrow>Energy & carbon advisory · India</Eyebrow>
            <h1 className="mt-6 text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
              Measure.
              <br />
              Reduce.
              <br />
              <span className="text-accent">Verify.</span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted sm:text-xl">
              We help Indian hotels, commercial buildings and manufacturers cut energy costs and emissions — and get
              ready for{" "}
              <Link href={trackerHref("CCTS")} className="text-fg underline underline-offset-4">CCTS</Link>,{" "}
              <Link href={trackerHref("CBAM")} className="text-fg underline underline-offset-4">CBAM</Link>,{" "}
              <Link href={trackerHref("BRSR")} className="text-fg underline underline-offset-4">BRSR</Link> and{" "}
              <Link href={trackerHref("ECBC")} className="text-fg underline underline-offset-4">ECBC</Link>.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <ButtonLink href="/check">Run the free Energy &amp; Carbon Check</ButtonLink>
              <ButtonLink href="/services" variant="secondary">
                Explore services
              </ButtonLink>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end" aria-hidden="true">
            <Logo animated size={340} title="" className="max-w-[70vw] [&>svg]:h-auto [&>svg]:w-full" />
          </div>
        </Container>
      </section>

      {/* CCTS countdown */}
      <section aria-labelledby="ccts-heading" className="border-y border-line bg-bg-subtle">
        <Container className="flex flex-col gap-8 py-14 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <Eyebrow>Carbon Credit Trading Scheme</Eyebrow>
            <h2 id="ccts-heading" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              {milestone ? milestone.milestone : "Key CCTS dates are being confirmed"}
            </h2>
            <p className="mt-3 text-muted">
              {milestone ? (
                <>
                  {new Date(`${milestone.date}T00:00:00+05:30`).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "Asia/Kolkata",
                  })}{" "}
                  · Applies to: {milestone.appliesTo}.{" "}
                  <a href={milestone.officialSourceUrl} className="underline underline-offset-4" rel="noopener" target="_blank">
                    Official source
                  </a>
                </>
              ) : (
                <>We only show a countdown once a date is confirmed in an official notification.</>
              )}
            </p>
          </div>
          <div className="flex flex-col items-start gap-5">
            {milestone ? <Countdown date={milestone.date} /> : null}
            <Link href={trackerHref("CCTS")} className="text-sm font-medium underline underline-offset-4">
              See every milestone in the Regulation Tracker →
            </Link>
          </div>
        </Container>
      </section>

      {/* Pillars */}
      <section aria-labelledby="pillars-heading">
        <Container className="py-24 sm:py-32">
          <SectionHeading
            eyebrow="What we do"
            title={<span id="pillars-heading">Three steps from bills to verified results</span>}
            lead="Engineering-grade analysis, delivered remotely, priced so that the savings pay for the work."
          />
          <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
            {pillars.map((p) => (
              <div key={p.key} className="bg-bg p-8 sm:p-10">
                <h3 className="text-2xl font-semibold">{p.title}</h3>
                <p className="mt-4 leading-relaxed text-muted">{p.body}</p>
                <ul className="mt-6 space-y-2 text-sm">
                  {services
                    .filter((s) => s.pillar === p.key)
                    .map((s) => (
                      <li key={s.slug}>
                        <Link href={`/services/${s.slug}`} className="underline-offset-4 hover:underline">
                          {s.shortName} →
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-heading" className="bg-bg-subtle">
        <Container className="py-24 sm:py-32">
          <SectionHeading eyebrow="How it works" title={<span id="how-heading">Upload → Analyse → Act → Verify</span>} />
          <ol className="mt-16 grid gap-10 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <li key={s.title}>
                <span className="font-mono text-sm text-accent">0{i + 1}</span>
                <h3 className="mt-3 text-xl font-semibold">{s.title}</h3>
                <p className="mt-3 leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Check CTA */}
      <section aria-labelledby="check-heading">
        <Container className="py-24 sm:py-32">
          <div className="rounded-3xl bg-fg px-8 py-14 text-bg sm:px-14 sm:py-20">
            <p className="text-xs font-medium uppercase tracking-[0.2em] opacity-70">Free · 5 minutes · runs in your browser</p>
            <h2 id="check-heading" className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">
              How does your facility compare?
            </h2>
            <p className="mt-5 max-w-xl text-lg opacity-80">
              Enter 12 months of electricity use and get your EPI, a benchmark band, an estimated savings range in ₹,
              your Scope 1 &amp; 2 emissions and the regulations likely to apply to you.
            </p>
            <Link
              href="/check"
              className="mt-10 inline-flex rounded-full bg-bg px-6 py-3 text-sm font-medium text-fg transition-opacity hover:opacity-90"
            >
              Start the Energy &amp; Carbon Check
            </Link>
          </div>
        </Container>
      </section>

      {/* Latest news */}
      <section aria-labelledby="news-heading">
        <Container className="pb-24">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHeading eyebrow="News" title={<span id="news-heading">What changed this week</span>} />
            <Link href="/news" className="text-sm font-medium underline underline-offset-4">
              All news →
            </Link>
          </div>
          {latest.length > 0 ? (
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {latest.map((p) => (
                <NewsCard key={p.slug} post={p} />
              ))}
            </div>
          ) : (
            <p className="mt-10 text-muted">Our first briefings are on the way. Subscribe below to get them.</p>
          )}
        </Container>
      </section>

      {/* Newsletter */}
      <section aria-labelledby="newsletter-heading" className="border-t border-line">
        <Container className="grid gap-10 py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 id="newsletter-heading" className="text-3xl font-semibold tracking-tight">
              One email a week. Only what matters.
            </h2>
            <p className="mt-3 text-muted">
              A short briefing on Indian energy prices, carbon markets and compliance — with a line on what each item
              means for hotels, commercial buildings, manufacturers and exporters.
            </p>
          </div>
          <NewsletterForm context="home" />
        </Container>
      </section>
    </>
  );
}
