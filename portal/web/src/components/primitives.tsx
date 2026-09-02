// Small shared pieces used across every page.
import type { ReactNode } from 'react'
import type { ComplianceStatus, PenaltyEstimate } from '@hbs/shared'
import { statusClasses, statusLabel } from '../lib/format'

export function StatusBadge({ status }: { status: ComplianceStatus | undefined }): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClasses(
        status,
      )}`}
    >
      {statusLabel(status)}
    </span>
  )
}

export function Tile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'warning' | 'danger'
}): JSX.Element {
  const toneClass =
    tone === 'danger'
      ? 'text-red-800'
      : tone === 'warning'
        ? 'text-copper-600'
        : 'text-forest-800'
  return (
    <div className="card card-pad">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular ${toneClass}`}>{value}</div>
      {sub !== undefined && <div className="mt-1 text-xs text-forest-800/60">{sub}</div>}
    </div>
  )
}

/**
 * The caveat that must accompany any figure resting on an unverified constant.
 *
 * This is load-bearing, not decoration: the BEPS targets and penalty rates
 * shipped today are placeholders, and a dollar figure shown without this
 * banner would read to a customer as a bill.
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
    <div
      className={`rounded-md border-l-4 border-copper-400 bg-copper-100/50 px-3 py-2 text-xs text-forest-800 ${className}`}
    >
      <strong className="font-semibold">Provisional figures.</strong> The performance standards and
      penalty rates behind this estimate are placeholders pending verification against the published
      rule. Treat it as an order of magnitude, not a quotation.
      {penalty?.citationUrl && (
        <>
          {' '}
          <a
            className="underline decoration-copper-400 underline-offset-2"
            href={penalty.citationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Published rule
          </a>
        </>
      )}
    </div>
  )
}

export function EmptyState({ title, detail }: { title: string; detail?: string }): JSX.Element {
  return (
    <div className="card card-pad text-center">
      <p className="font-medium text-forest-800">{title}</p>
      {detail && <p className="mt-1 text-sm text-forest-800/60">{detail}</p>}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-forest-800/60">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-forest-300 border-t-forest-600" />
      {label}
    </div>
  )
}

export function ErrorNote({ message }: { message: string }): JSX.Element {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </div>
  )
}

export function SectionHeading({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-forest-700">{title}</h2>
      {action}
    </div>
  )
}
