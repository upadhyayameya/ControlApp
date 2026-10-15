import type { ReactNode } from 'react'

export function Card({
  title,
  sub,
  right,
  children,
  className = '',
}: {
  title?: string
  sub?: string
  right?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-100">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Stat({
  label,
  value,
  unit,
  tone = 'default',
  hint,
}: {
  label: string
  value: string | number
  unit?: string
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'accent'
  hint?: string
}) {
  const toneClass = {
    default: 'text-slate-100',
    good: 'text-good',
    warn: 'text-warn',
    bad: 'text-bad',
    accent: 'text-accent',
  }[tone]
  return (
    <div className="card">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-slate-500">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-ink-line px-4 py-8 text-center text-sm text-slate-500">
      {children}
    </div>
  )
}

export function Pill({ children, tone = 'default' }: { children: ReactNode; tone?: string }) {
  const map: Record<string, string> = {
    default: 'border-ink-line text-slate-400',
    accent: 'border-accent/50 bg-accent/10 text-accent',
    good: 'border-good/40 bg-good/10 text-good',
    warn: 'border-warn/40 bg-warn/10 text-warn',
  }
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${map[tone] ?? map.default}`}>
      {children}
    </span>
  )
}
