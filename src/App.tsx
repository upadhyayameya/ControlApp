// ---------------------------------------------------------------------------
// Application shell — the operator workstation layout: toolbar on top, palette
// on the left, live canvas in the center, inspector on the right, and a docked
// panel (alarms / trends / energy / instructor) across the bottom.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import { useStore } from './state/store'
import { Toolbar } from './components/Toolbar'
import { Palette } from './components/Palette'
import { Canvas } from './components/Canvas'
import { Inspector } from './components/Inspector'
import { AlarmPanel } from './components/AlarmPanel'
import { Trends } from './components/Trends'
import { EnergyDashboard } from './components/EnergyDashboard'
import { InstructorPanel } from './components/InstructorPanel'

const DOCK_TABS = [
  { id: 'alarms', label: 'Alarms' },
  { id: 'trends', label: 'Trends' },
  { id: 'energy', label: 'Energy' },
  { id: 'instructor', label: 'Instructor' },
] as const

export default function App() {
  const initEngine = useStore((s) => s.initEngine)
  const activePanel = useStore((s) => s.activePanel)
  const setPanel = useStore((s) => s.setPanel)
  const alarmCount = useStore((s) => s.snapshot?.alarms.length ?? 0)

  useEffect(() => {
    initEngine()
    document.documentElement.classList.add('dark')
  }, [initEngine])

  return (
    <div className="flex h-full flex-col bg-panel-900">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Canvas />
          </div>
          {/* Bottom dock */}
          <div className="flex h-[38%] min-h-[200px] flex-col border-t border-forest-800 bg-panel-900">
            <div className="flex items-center gap-0.5 border-b border-forest-800 bg-panel-800 px-2 py-1">
              {DOCK_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setPanel(t.id)}
                  className={`relative rounded px-3 py-1 text-[11px] font-medium transition-colors ${
                    activePanel === t.id ? 'bg-forest-600 text-cream-50' : 'text-forest-300 hover:bg-forest-700/50'
                  }`}
                >
                  {t.label}
                  {t.id === 'alarms' && alarmCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-alarm-critical px-1.5 text-[9px] text-cream-50">{alarmCount}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              {activePanel === 'alarms' && <AlarmPanel />}
              {activePanel === 'trends' && <Trends />}
              {activePanel === 'energy' && <EnergyDashboard />}
              {activePanel === 'instructor' && <InstructorPanel />}
            </div>
          </div>
        </div>
        {/* Right sidebar: inspector */}
        <div className="w-72 shrink-0 border-l border-forest-800 bg-panel-800">
          <Inspector />
        </div>
      </div>
    </div>
  )
}
