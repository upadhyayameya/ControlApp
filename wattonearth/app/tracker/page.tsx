import { Suspense } from "react";
import Link from "next/link";
import { TrackerView, type TrackerItem } from "@/components/tracker/TrackerView";
import { Container, SectionHeading } from "@/components/ui/primitives";
import { isPast, regimeInfo, regulations, todayIST } from "@/lib/regulations";
import { pageMetadata } from "@/lib/seo";
import { REGIMES } from "@/lib/types";

// Re-render daily so milestones grey out once their date passes.
export const revalidate = 86400;

export const metadata = pageMetadata({
  title: "Regulation Tracker",
  description:
    "Key dates for India's Carbon Credit Trading Scheme, the EU CBAM, SEBI's BRSR and the Energy Conservation Building Code — each linked to its official source.",
  path: "/tracker",
});

export default function TrackerPage() {
  const today = todayIST();
  const items: TrackerItem[] = regulations.map((m) => ({ ...m, past: isPast(m, today) }));

  return (
    <Container className="py-20 sm:py-28">
      <SectionHeading
        as="h1"
        eyebrow="Regulation Tracker"
        title="The dates that matter, from the official source."
        lead="Every milestone links to the notification or official page it comes from. Dates marked TBC are awaiting official confirmation — we never show a countdown for them."
      />

      <dl className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {REGIMES.map((r) => (
          <div key={r} className="border-t border-line pt-4">
            <dt className="font-semibold">
              <Link href={`/tracker?regime=${r}`} className="hover:text-accent">
                {r}
              </Link>
            </dt>
            <dd className="mt-1 text-sm text-muted">
              <span className="text-fg">{regimeInfo[r].name}.</span> {regimeInfo[r].short}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-14">
        <Suspense fallback={null}>
          <TrackerView items={items} />
        </Suspense>
      </div>

      <p className="mt-12 max-w-3xl text-sm text-muted">
        This tracker is a convenience summary, not legal advice. Always confirm obligations against the official notification
        (for Indian regulations, the Gazette of India at egazette.gov.in). Spotted something out of date?{" "}
        <Link href="/contact" className="underline underline-offset-4">
          Let us know
        </Link>
        .
      </p>
    </Container>
  );
}
