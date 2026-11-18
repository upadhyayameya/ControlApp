// Equipment palette — click to drop a device onto the canvas. Picks a sensible
// starting model; everything is editable in the inspector afterward.
import { useStore } from '../state/store'
import type { EquipmentCategory } from '../types/domain'
import { CATEGORY_LABELS } from '../data/schema'
import { CATEGORY_ICON } from './glyphs'

const GROUPS: { title: string; items: EquipmentCategory[] }[] = [
  { title: 'Plant', items: ['chiller', 'boiler', 'coolingTower', 'hx', 'pump'] },
  { title: 'Air Handling', items: ['ahu', 'rtu', 'fcu', 'wshp'] },
  { title: 'Terminal & Zone', items: ['vav', 'zone'] },
  { title: 'Instrumentation', items: ['sensor', 'vfd', 'other'] },
]

export function Palette() {
  const addNode = useStore((s) => s.addNode)

  const drop = (cat: EquipmentCategory) => {
    const x = 200 + Math.round(Math.random() * 300)
    const y = 120 + Math.round(Math.random() * 300)
    addNode(cat, { position: { x, y } })
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-panel-800 border-r border-forest-800 w-44 shrink-0">
      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-forest-300 border-b border-forest-800">
        Equipment
      </div>
      {GROUPS.map((g) => (
        <div key={g.title} className="px-2 py-2">
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wider text-forest-300/70">{g.title}</div>
          <div className="flex flex-col gap-1">
            {g.items.map((cat) => (
              <button
                key={cat}
                onClick={() => drop(cat)}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-cream-100 hover:bg-forest-700/60 transition-colors"
                title={`Add ${CATEGORY_LABELS[cat]}`}
              >
                <span>{CATEGORY_ICON[cat]}</span>
                <span className="truncate">{CATEGORY_LABELS[cat]}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
