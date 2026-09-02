import { useState } from 'react'
import type { Alert } from '@hbs/shared'
import { api } from '../api/client'
import { dateLabel } from '../lib/format'
import { Empty } from './primitives'

/** Severity is encoded in the leading rule, so urgency reads before the words do. */
const SEVERITY: Record<Alert['severity'], { rule: string; chip: string; label: string }> = {
  critical: { rule: 'border-l-bad', chip: 'chip-bad', label: 'Critical' },
  warning: { rule: 'border-l-warn', chip: 'chip-warn', label: 'Warning' },
  info: { rule: 'border-l-line-strong', chip: 'chip-inert', label: 'Note' },
}

export function AlertList({ alerts }: { alerts: Alert[] }): JSX.Element {
  // Tracked locally so a dismissal feels immediate; the authoritative state
  // comes back on the next load either way.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const open = alerts.filter((a) => a.acknowledgedAt === null && !dismissed.has(a.id))

  if (open.length === 0) return <Empty title="Nothing needs your attention." />

  async function dismiss(id: string): Promise<void> {
    setDismissed((prev) => new Set(prev).add(id))
    await api.acknowledgeAlert(id).catch(() => {
      // Put it back rather than showing it as handled when it is not.
      setDismissed((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    })
  }

  return (
    <ul className="space-y-2">
      {open.map((alert) => {
        const tone = SEVERITY[alert.severity]
        return (
          <li key={alert.id} className={`panel border-l-2 ${tone.rule} p-3`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={tone.chip}>{tone.label}</span>
                  <span className="font-mono text-micro text-ink-3">{dateLabel(alert.createdAt)}</span>
                </div>
                <p className="mt-1.5 text-base font-medium text-ink">{alert.title}</p>
                <p className="mt-1 text-base text-ink-2">{alert.detail}</p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm shrink-0"
                onClick={() => void dismiss(alert.id)}
              >
                Dismiss
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
