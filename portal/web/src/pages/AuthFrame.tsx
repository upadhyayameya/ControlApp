// ---------------------------------------------------------------------------
// The frame every signed-out screen shares.
//
// This is the one place in the product that has to persuade rather than
// inform, so it gets the page's one real flourish: a full-height threshold
// figure built from the same instrument the app uses everywhere else. The
// design thesis stated once, at the door.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react'

/** Illustrative readings — the shape of a real portfolio, not anyone's data. */
const SAMPLE = [
  { label: 'Franklin Square', fill: 56, tone: 'bg-bad' },
  { label: 'Kalorama', fill: 69, tone: 'bg-good' },
  { label: 'Rockville Medical', fill: 38, tone: 'bg-bad' },
  { label: 'Wheaton DC', fill: 82, tone: 'bg-good' },
  { label: 'Dupont Grand', fill: 47, tone: 'bg-warn' },
]

export function AuthFrame({
  eyebrow,
  title,
  intro,
  children,
  footer,
  /**
   * The staff door is deliberately plainer than the client one: it is an
   * internal tool, and dressing it up as a product would only confuse a
   * customer who arrives at the wrong address.
   */
  variant = 'client',
}: {
  eyebrow: string
  title: string
  intro?: ReactNode
  children: ReactNode
  footer?: ReactNode
  variant?: 'client' | 'staff'
}): JSX.Element {
  if (variant === 'staff') {
    return (
      <div className="flex min-h-full items-center justify-center bg-raised px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-7 border-b border-line-strong pb-5">
            <p className="font-display text-base font-bold tracking-tight text-ink">
              HBS Solutions
            </p>
            <p className="eyebrow mt-0.5">Internal · staff console</p>
          </div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-1.5 font-display text-h2 text-ink">{title}</h1>
          {intro && <div className="mt-2 text-base text-ink-2">{intro}</div>}
          <div className="mt-6">{children}</div>
          {footer && (
            <div className="mt-6 border-t border-line pt-4 text-tiny text-ink-3">{footer}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      {/* The argument. Hidden on small screens, where the form is the job. */}
      <section className="relative hidden flex-col justify-between border-r border-line bg-surface p-10 lg:flex">
        <div>
          <p className="font-display text-base font-bold tracking-tight text-ink">HBS Solutions</p>
          <p className="eyebrow mt-0.5">Building energy performance</p>
        </div>

        <div className="max-w-md">
          <h2 className="font-display text-h1 leading-[1.1] text-ink">
            Every building is a mark against a line.
          </h2>
          <p className="mt-3 text-lead text-ink-2">
            BEPS comes down to one fact: there is a standard, and your building is above it or below
            it. This portal puts that line in front of you — with the trend, the deadline, and what
            missing it costs.
          </p>

          <div className="mt-8 space-y-3" aria-hidden>
            {SAMPLE.map((row, i) => (
              <div key={row.label} className="rise" style={{ animationDelay: `${140 + i * 70}ms` }}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-mono text-micro uppercase text-ink-3">{row.label}</span>
                </div>
                <div className="track h-1.5">
                  <div
                    className="absolute inset-y-0 bg-good/[0.16]"
                    style={{ left: '64%', right: 0 }}
                  />
                  <div className={`h-full ${row.tone}`} style={{ width: `${row.fill}%` }} />
                  <div className="tick" style={{ left: '64%' }} />
                </div>
              </div>
            ))}
            <p className="pt-1 font-mono text-micro uppercase text-ink-3">
              ▏the line is the standard
            </p>
          </div>
        </div>

        <p className="max-w-md text-tiny text-ink-3">
          Benchmarking, BEPS compliance and reporting for portfolios in the District and Montgomery
          County.
        </p>
      </section>

      {/* The form. */}
      <section className="flex flex-col justify-center bg-paper px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-1.5 font-display text-h2 text-ink">{title}</h1>
          {intro && <div className="mt-2 text-base text-ink-2">{intro}</div>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 border-t border-line pt-4 text-tiny text-ink-3">{footer}</div>}
        </div>
      </section>
    </div>
  )
}
