import { useState } from 'react'
import type { Alert } from '@hbs/shared'
import { api } from '../api/client'
import { dateLabel } from '../lib/format'
import { EmptyState } from './primitives'

const SEVERITY_STYLES: Record<Alert['severity'], string> = {
  critical: 'border-l-red-600 bg-red-50/60',
  warning: 'border-l-copper-400 bg-copper-100/40',
  info: 'border-l-forest-300 bg-cream-50',
}

export function AlertList({ alerts }: { alerts: Alert[] }): JSX.Element {
  // Acknowledged ids are tracked locally so a click feels immediate; the
  // authoritative state comes back on the next load either way.
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())

  const open = alerts.filter((a) => a.acknowledgedAt === null && !acknowledged.has(a.id))

  if (open.length === 0) {
    return <EmptyState title="Nothing needs your attention." />
  }

  async function acknowledge(id: string): Promise<void> {
    setAcknowledged((prev) => new Set(prev).add(id))
    await api.acknowledgeAlert(id).catch(() => {
      // Put it back if the server refused, rather than showing it as handled.
      setAcknowledged((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    })
  }

  return (
    <ul className="space-y-2">
      {open.map((alert) => (
        <li
          key={alert.id}
          className={`rounded-md border border-cream-200 border-l-4 p-3 ${SEVERITY_STYLES[alert.severity]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-forest-900">{alert.title}</p>
              <p className="mt-0.5 text-sm text-forest-800/80">{alert.detail}</p>
              <p className="mt-1 text-xs text-forest-800/50">{dateLabel(alert.createdAt)}</p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs text-forest-700 hover:underline"
              onClick={() => void acknowledge(alert.id)}
            >
              Dismiss
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
