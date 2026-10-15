// Shared formatting. Every number a customer reads is rendered here, so units
// and rounding stay consistent across the dashboard, the building page and the
// report.
import type { ComplianceStatus, PenaltyEstimate } from '@hbs/shared'

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return `$${Math.round(value).toLocaleString('en-US')}`
}

/** Compact form for headline tiles: $1.4M rather than $1,452,465. */
export function usdCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`
  return `$${Math.round(value)}`
}

export function num(value: number | null | undefined, places = 1): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

export function int(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Math.round(value).toLocaleString('en-US')
}

export function statusLabel(status: ComplianceStatus | undefined): string {
  switch (status) {
    case 'compliant':
      return 'Meeting standard'
    case 'at-risk':
      return 'At risk'
    case 'non-compliant':
      return 'Below standard'
    case 'exempt':
      return 'Not covered'
    case 'insufficient-data':
      return 'Data needed'
    default:
      return 'Unknown'
  }
}

/** Tailwind classes per status. Kept beside the label so they cannot drift. */
export function statusClasses(status: ComplianceStatus | undefined): string {
  switch (status) {
    case 'compliant':
      return 'bg-forest-100 text-forest-700 border-forest-200'
    case 'at-risk':
      return 'bg-copper-100 text-copper-600 border-copper-300'
    case 'non-compliant':
      return 'bg-red-50 text-red-800 border-red-200'
    default:
      return 'bg-cream-100 text-forest-800/70 border-cream-300'
  }
}

/**
 * How a penalty should be written. An unverified estimate is always shown as a
 * range, never as a single figure — a lone number reads as a quote.
 */
export function penaltyText(penalty: PenaltyEstimate | null | undefined): string {
  if (!penalty) return '—'
  return penalty.verified ? usd(penalty.amount) : `${usd(penalty.low)}–${usd(penalty.high)}`
}

export function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function relativeDays(isoDate: string): string {
  const days = Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.now()) / 86_400_000)
  if (days < 0) return `${Math.abs(days)} days ago`
  if (days === 0) return 'today'
  if (days < 45) return `in ${days} days`
  if (days < 400) return `in ${Math.round(days / 30)} months`
  return `in ${(days / 365).toFixed(1)} years`
}
