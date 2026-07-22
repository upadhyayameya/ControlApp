// ---------------------------------------------------------------------------
// Top toolbar: the simulation clock (date, day-of-week, time), speed controls
// (pause / real / 10x / 100x / 1000x / jump), and system persistence.
// ---------------------------------------------------------------------------

import { useRef } from 'react'
import { useStore } from '../state/store'
import type { SpeedMultiplier, SystemConfig } from '../types/domain'

const SPEEDS: { value: SpeedMultiplier; label: string }[] = [
  { value: 0, label: '❚❚' },
  { value: 1, label: '1×' },
  { value: 10, label: '10×' },
  { value: 100, label: '100×' },
  { value: 1000, label: '1000×' },
]

export function Toolbar() {
  const snapshot = useStore((s) => s.snapshot)
  const speed = useStore((s) => s.speed)
  const setSpeed = useStore((s) => s.setSpeed)
  const jump = useStore((s) => s.jump)
  const resetSim = useStore((s) => s.resetSim)
  const newSystem = useStore((s) => s.newSystem)
  const saveLocal = useStore((s) => s.saveLocal)
  const loadLocal = useStore((s) => s.loadLocal)
  const exportJSON = useStore((s) => s.exportJSON)
  const loadConfig = useStore((s) => s.loadConfig)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const configName = useStore((s) => s.config.name)
  const fileRef = useRef<HTMLInputElement>(null)

  const clock = snapshot?.clock
  const oat = snapshot?.weather.oatF

  const doExport = () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${configName.replace(/\s+/g, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const cfg = JSON.parse(String(reader.result)) as SystemConfig
        loadConfig(cfg)
      } catch {
        alert('That file is not a valid system configuration.')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="flex items-center gap-3 border-b border-forest-800 bg-panel-900 px-3 py-1.5 text-cream-100">
      <div className="flex items-center gap-2">
        <span className="text-copper-400 text-base font-bold">HBS</span>
        <span className="text-[11px] text-forest-300 hidden sm:inline">BAS Simulation Trainer</span>
      </div>

      {/* Clock */}
      <div className="readout ml-2 flex items-center gap-2 rounded bg-panel-800 px-3 py-1 border border-forest-800">
        <span className="text-copper-300 font-semibold">{clock?.dateLabel ?? '—'}</span>
        <span className="text-lg font-bold tracking-tight">
          {clock ? `${pad(clock.hour)}:${pad(clock.minuteOfHour)}` : '--:--'}
        </span>
        <span className="text-[10px] text-forest-300">Day {clock ? clock.dayIndex + 1 : 0}</span>
      </div>

      {/* Weather */}
      <div className="readout hidden md:flex items-center gap-1 text-[11px] text-forest-300">
        <span>OAT</span>
        <span className="text-cream-100 font-semibold">{oat !== undefined ? `${oat.toFixed(0)}°F` : '—'}</span>
      </div>

      {/* Speed */}
      <div className="flex items-center gap-0.5 rounded bg-panel-800 p-0.5 border border-forest-800">
        {SPEEDS.map((s) => (
          <button
            key={s.value}
            onClick={() => setSpeed(s.value)}
            className={`readout rounded px-2 py-1 text-[11px] transition-colors ${
              speed === s.value ? 'bg-forest-500 text-cream-50' : 'text-forest-300 hover:bg-forest-700/50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <ToolButton onClick={() => jump(1440)} title="Advance one day">+1d</ToolButton>
        <ToolButton onClick={() => jump(10080)} title="Advance one week">+1w</ToolButton>
        <ToolButton onClick={resetSim} title="Reset simulation to day 1">↺</ToolButton>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ToolButton onClick={newSystem} title="Load the demo system">Demo</ToolButton>
        <ToolButton onClick={saveLocal} title="Save to browser storage">Save</ToolButton>
        <ToolButton onClick={() => { if (!loadLocal()) alert('No saved system found in this browser.') }} title="Load from browser storage">Load</ToolButton>
        <ToolButton onClick={doExport} title="Export configuration as JSON">↧ JSON</ToolButton>
        <ToolButton onClick={() => fileRef.current?.click()} title="Import configuration JSON">↥ JSON</ToolButton>
        <ToolButton onClick={toggleTheme} title="Toggle light/dark">◐</ToolButton>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
        />
      </div>
    </div>
  )
}

function ToolButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="readout rounded bg-panel-800 border border-forest-800 px-2 py-1 text-[11px] text-forest-300 hover:bg-forest-700/50 hover:text-cream-100 transition-colors"
    >
      {children}
    </button>
  )
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
