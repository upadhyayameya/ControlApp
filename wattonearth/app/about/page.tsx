import { ButtonLink, Container, SectionHeading } from "@/components/ui/primitives";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "About",
  description:
    "Watt on Earth is led by Ameya, a US-based lead energy engineer bringing audit, HVAC optimisation, BMS and energy-analytics experience to Indian facilities.",
  path: "/about",
});

const expertise = [
  {
    title: "Energy audits",
    body: "Walk-through to investment-grade audits across commercial and industrial facilities, with savings calculations that stand up to scrutiny.",
  },
  {
    title: "HVAC optimisation",
    body: "Chiller plants, air-side systems and controls sequences — usually the largest and most under-managed load in Indian commercial buildings.",
  },
  {
    title: "BAS / BMS",
    body: "Trend analysis, sequence reviews and fault detection in building automation systems — finding the savings hiding in schedules and setpoints.",
  },
  {
    title: "Commissioning",
    body: "Verifying that systems are installed and operate as designed, and retro-commissioning buildings that have drifted.",
  },
  {
    title: "Benchmarking & utility programmes",
    body: "Portfolio benchmarking and utility incentive programme delivery — the discipline of measuring many buildings consistently.",
  },
  {
    title: "Energy data analytics",
    body: "Interval-data analysis, regression baselines and measurement & verification — turning meter data into decisions.",
  },
];

export default function AboutPage() {
  return (
    <Container className="py-20 sm:py-28">
      <SectionHeading
        as="h1"
        eyebrow="About"
        title="US engineering discipline, applied to Indian facilities."
        lead="Watt on Earth exists because most Indian buildings and plants have the data to cut energy and emissions — bills, meters, BMS trends — but rarely the time or specialist eyes to use it."
      />

      <div className="mt-20 grid gap-16 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="text-2xl font-semibold">Ameya, founder</h2>
          <p className="mt-2 text-muted">Lead Energy Engineer, based in the United States</p>
        </div>
        <div className="space-y-6 text-lg leading-relaxed">
          <p>
            Ameya is a lead energy engineer in the US, working on energy audits, HVAC optimisation, building automation
            systems, commissioning, benchmarking, utility programmes and energy data analytics.
          </p>
          <p>
            Watt on Earth brings that practice to India — remotely, and priced for the Indian market. The work is
            data-first: we start from what your facility already records, use video walk-throughs instead of expensive
            site visits where we can, and focus on measures with clear paybacks.
          </p>
          <p>
            As India&apos;s carbon market, the EU&apos;s CBAM and BRSR value-chain disclosures raise the bar on energy
            and emissions data, the same measurement discipline that saves money also makes compliance simpler.
          </p>
        </div>
      </div>

      <section aria-labelledby="expertise" className="mt-24">
        <h2 id="expertise" className="text-3xl font-semibold tracking-tight">
          Experience we bring
        </h2>
        <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {expertise.map((e) => (
            <div key={e.title} className="bg-bg p-8">
              <h3 className="text-lg font-semibold">{e.title}</h3>
              <p className="mt-3 leading-relaxed text-muted">{e.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="principles" className="mt-24 grid gap-10 lg:grid-cols-3">
        <h2 id="principles" className="text-3xl font-semibold tracking-tight lg:col-span-3">
          How we work
        </h2>
        {[
          ["Numbers you can check", "Every figure we give you comes with its source and method. Estimates are labelled as estimates."],
          ["Independent advice", "We do not sell equipment. Recommendations are ranked by value to you, not by margin."],
          ["Official sources first", "Regulatory dates and obligations are linked to the official notification — never paraphrased from hearsay."],
        ].map(([t, b]) => (
          <div key={t} className="border-t border-line pt-6">
            <h3 className="text-lg font-semibold">{t}</h3>
            <p className="mt-3 leading-relaxed text-muted">{b}</p>
          </div>
        ))}
      </section>

      <div className="mt-24 flex flex-wrap gap-3">
        <ButtonLink href="/contact">Talk to Ameya</ButtonLink>
        <ButtonLink href="/services" variant="secondary">
          See services
        </ButtonLink>
      </div>
    </Container>
  );
}
