// ---------------------------------------------------------------------------
// Alarm banner. Every active alarm shows its title, the full plain-English
// reasoning that explains *why* it fired, the evidence chain, and the suggested
// check. Clicking an alarm selects the offending equipment on the canvas.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useStore } from '../state/store'

const SEV_STYLE: Record<string, string> = {
  critical: 'border-alarm-critical text-alarm-critical',
  warning: 'border-alarm-warning text-alarm-warning',
  info: 'border-alarm-info text-alarm-info',
}

export function AlarmPanel() {
  const alarms = useStore((s) => s.snapshot?.alarms ?? [])
  const select = useStore((s) => s.select)
  const minute = useStore((s) => s.snapshot?.clock.minute ?? 0)
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="flex h-full flex-col bg-panel-900">
      <div className="flex items-center justify-between border-b border-forest-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-forest-300">Alarms</span>
        <span className={`readout rounded px-1.5 text-[11px] ${alarms.length ? 'bg-alarm-critical/20 text-alarm-critical' : 'bg-forest-700/40 text-forest-300'}`}>
          {alarms.length} active
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {alarms.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-forest-300">No active alarms. Inject a fault or change a setpoint to see the reasoning engine at work.</div>
        )}
        {alarms.map((a) => {
          const open = expanded === a.id
          return (
            <div key={a.id} className={`border-l-2 border-b border-forest-800/60 ${SEV_STYLE[a.severity]}`}>
              <button
                className="w-full px-3 py-2 text-left"
                onClick={() => {
                  setExpanded(open ? null : a.id)
                  select(a.nodeId)
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-semibold text-cream-100">{a.title}</span>
                  <span className="readout shrink-0 text-[9px] text-forest-300">{ago(minute, a.raisedAtMin)}</span>
                </div>
                <div className={`text-[11px] leading-snug text-cream-100/90 ${open ? '' : 'line-clamp-2'}`}>{a.reasoning}</div>
              </button>
              {open && (
                <div className="px-3 pb-2.5">
                  {a.evidence.length > 0 && (
                    <div className="mb-2 rounded bg-panel-800 p-2">
                      <div className="text-[9px] uppercase tracking-wider text-forest-300 pb-1">Evidence</div>
                      <ul className="readout flex flex-col gap-0.5 text-[10.5px] text-cream-100/90">
                        {a.evidence.map((e, i) => (
                          <li key={i}>• {e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="rounded bg-copper-500/10 border border-copper-500/30 p-2 text-[10.5px] text-copper-300">
                    <span className="font-semibold">Check: </span>
                    {a.suggestedCheck}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ago(now: number, raised: number): string {
  const d = Math.max(0, now - raised)
  if (d < 60) return `${d}m`
  if (d < 1440) return `${Math.floor(d / 60)}h${d % 60}m`
  return `${Math.floor(d / 1440)}d`
}
