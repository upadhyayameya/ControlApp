// Shared pieces, in the threshold design language.
import type { ReactNode } from 'react'
import type { ComplianceStatus, Jurisdiction, PenaltyEstimate } from '@hbs/shared'
import { statusTone } from './Threshold'

/**
 * A building with no assessment is usually one we lack data for — but a
 * building outside DC and Montgomery County has no assessment because no
 * standard applies to it, which is a different thing entirely. Labelling that
 * "data needed" sends someone hunting for bills that are not missing.
 */
export function StatusChip({
  status,
  jurisdiction,
}: {
  status: ComplianceStatus | undefined
  jurisdiction?: Jurisdiction
}): JSX.Element {
  if (status === undefined && jurisdiction === 'none') {
    return <span className="chip-inert">Not covered</span>
  }
  const tone = statusTone(status)
  return <span className={tone.chip}>{tone.label}</span>
}

/**
 * A reading. Not a card — a labelled figure on the page's own surface, with a
 * hairline rule above it in the ruler idiom. Lifting each of these into a
 * bordered box would flatten the hierarchy of a page that already has one.
 */
export function Reading({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad'
}): JSX.Element {
  const toneClass =
    tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : tone === 'good' ? 'text-good' : 'text-ink'
  return (
    <div className="rule">
      <p className="eyebrow">{label}</p>
      <p className={`font-display text-h1 tab mt-1.5 ${toneClass}`}>{value}</p>
      {sub !== undefined && <p className="mt-1 text-tiny text-ink-3">{sub}</p>}
    </div>
  )
}

/**
 * The caveat that must accompany any figure resting on an unverified constant.
 *
 * Load-bearing, not decoration: the BEPS targets and penalty rates shipped
 * today are placeholders, and a dollar figure shown without this reads to a
 * customer as a bill.
 */
export function ProvisionalNotice({
  penalty,
  className = '',
}: {
  penalty?: PenaltyEstimate | null
  className?: string
}): JSX.Element | null {
  if (penalty?.verified) return null
  return (
    <aside
      className={`border-l-2 border-warn bg-warn-soft/50 px-3 py-2.5 text-tiny text-ink-2 ${className}`}
    >
      <strong className="font-semibold text-ink">Provisional figures.</strong> The performance
      standards and penalty rates behind this estimate are placeholders pending verification
      against the published rule. Treat them as an order of magnitude, not a quotation.
      {penalty?.citationUrl && (
        <>
          {' '}
          <a
            className="underline decoration-warn underline-offset-2 hover:text-ink"
            href={penalty.citationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Published rule
          </a>
        </>
      )}
    </aside>
  )
}

export function Empty({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }): JSX.Element {
  return (
    <div className="panel panel-pad">
      <p className="font-display text-h3 text-ink">{title}</p>
      {detail && <p className="mt-1.5 max-w-prose text-base text-ink-2">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 py-10 font-mono text-micro uppercase text-ink-3">
      <span className="h-2.5 w-2.5 animate-spin border border-line-strong border-t-ink" />
      {label}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }): JSX.Element {
  return (
    <div
      role="alert"
      className="border-l-2 border-bad bg-bad-soft/60 px-3 py-2.5 text-base text-ink"
    >
      {message}
    </div>
  )
}

export function Notice({ message }: { message: string }): JSX.Element {
  return (
    <div className="border-l-2 border-good bg-good-soft/60 px-3 py-2.5 text-base text-ink">
      {message}
    </div>
  )
}

export function SectionHead({
  title,
  action,
  detail,
}: {
  title: string
  action?: ReactNode
  detail?: string
}): JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-h3 text-ink">{title}</h2>
        {detail && <p className="mt-0.5 text-tiny text-ink-3">{detail}</p>}
      </div>
      {action}
    </div>
  )
}

/** Page title block, used identically on every screen so the measure holds. */
export function PageHead({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string
  title: string
  detail?: ReactNode
  action?: ReactNode
}): JSX.Element {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-h1 text-ink">{title}</h1>
        {detail !== undefined && <div className="mt-1.5 text-base text-ink-2">{detail}</div>}
      </div>
      {action}
    </header>
  )
}
