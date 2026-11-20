// Small labeled form controls used throughout the inspector and instructor.
import type { ReactNode } from 'react'

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
      <span className="text-forest-300">{label}</span>
      <span className="flex items-center gap-1">{children}</span>
    </label>
  )
}

export function NumberField({
  value,
  onChange,
  step = 1,
  unit,
  width = 'w-16',
}: {
  value: number
  onChange: (v: number) => void
  step?: number
  unit?: string
  width?: string
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`readout ${width} rounded bg-panel-900 border border-forest-800 px-1.5 py-0.5 text-right text-cream-100 focus:border-copper-400 focus:outline-none`}
      />
      {unit && <span className="text-forest-300/70 text-[10px] w-10">{unit}</span>}
    </span>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-4 w-8 rounded-full transition-colors ${checked ? 'bg-forest-500' : 'bg-panel-600'}`}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-cream-100 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="rounded bg-panel-900 border border-forest-800 px-1.5 py-0.5 text-[11px] text-cream-100 focus:border-copper-400 focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-b border-forest-800 px-3 py-2">
      <div className="flex items-center justify-between pb-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-copper-300">{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}
