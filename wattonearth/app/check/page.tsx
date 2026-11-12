import { CheckTool } from "@/components/check/CheckTool";
import { Badge, Container, SectionHeading } from "@/components/ui/primitives";
import { allAssumptions } from "@/data/assumptions";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Free Energy & Carbon Check",
  description:
    "Benchmark your building's EPI or your plant's specific energy consumption, estimate savings in ₹, calculate Scope 1 & 2 emissions and see which of CCTS, CBAM, BRSR and ECBC apply. Free, runs in your browser.",
  path: "/check",
});

export default function CheckPage() {
  const assumptions = allAssumptions();
  return (
    <>
      <Container className="pb-10 pt-16 sm:pt-24">
        <SectionHeading
          as="h1"
          eyebrow="Free · about 5 minutes"
          title="Energy & Carbon Check"
          lead="Twelve months of electricity bills are enough to see how your facility compares, what it could save and where your emissions stand. Everything runs in your browser."
        />
      </Container>
      <Container className="pb-16">
        <CheckTool />
      </Container>

      <Container>
        <details className="rounded-2xl border border-line p-6">
          <summary className="cursor-pointer font-medium">Methodology &amp; assumptions</summary>
          <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted">
            <p>
              <strong className="text-fg">EPI</strong> = annual site electricity (grid + diesel-generator output + self-consumed
              solar) ÷ built-up area. For plants, <strong className="text-fg">SEC</strong> = site electricity ÷ annual
              production. Bands are adjusted by climate zone for buildings.
            </p>
            <p>
              <strong className="text-fg">Savings</strong>: if you are above the “good” threshold, the high case closes the full
              gap and the low case a share of it; well-performing sites get a small fine-tuning range. ₹ values use your own
              effective tariff where bills are provided.
            </p>
            <p>
              <strong className="text-fg">Emissions</strong>: Scope 2 is location-based (grid kWh × grid emission factor).
              Scope 1 covers diesel, LPG and PNG entered. Unusual months are flagged with a robust (median-based) outlier test and
              a check of each month&apos;s effective ₹/kWh.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <caption className="sr-only">Assumptions used by the Check</caption>
                <thead className="text-fg">
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 pr-3 font-medium">Assumption</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Value</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Source</th>
                    <th scope="col" className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assumptions.map((a) => (
                    <tr key={a.key} className="border-b border-line align-top">
                      <td className="py-2 pr-3 text-fg">{a.label}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {a.value} {a.unit}
                      </td>
                      <td className="py-2 pr-3">
                        <a href={a.sourceUrl} target="_blank" rel="noopener" className="underline underline-offset-2">
                          {a.source}
                        </a>
                      </td>
                      <td className="py-2">
                        {a.verified ? <Badge tone="good">Verified {a.lastChecked}</Badge> : <Badge>Provisional</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      </Container>
    </>
  );
}
