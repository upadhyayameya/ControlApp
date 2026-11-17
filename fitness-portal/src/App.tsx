import { useState } from 'react'
import Today from './components/Today'
import WeightPage from './components/WeightPage'
import MeasurementsPage from './components/MeasurementsPage'
import TrainPage from './components/TrainPage'
import KitchenPage from './components/KitchenPage'
import PhotosPage from './components/PhotosPage'
import NotesPage from './components/NotesPage'
import PlanPage from './components/PlanPage'
import { PROFILE } from './data/profile'

const TABS = [
  { id: 'today', label: 'Today', icon: '◎' },
  { id: 'train', label: 'Train', icon: '⬛' },
  { id: 'kitchen', label: 'Kitchen', icon: '◍' },
  { id: 'weight', label: 'Weight', icon: '◔' },
  { id: 'sizes', label: 'Sizes', icon: '⊟' },
  { id: 'photos', label: 'Photos', icon: '▣' },
  { id: 'notes', label: 'Notes', icon: '✎' },
  { id: 'plan', label: 'Plan', icon: '★' },
] as const

export default function App() {
  const [tab, setTab] = useState<string>('today')

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col">
      <header className="sticky top-0 z-10 border-b border-ink-line bg-ink/95 backdrop-blur">
        <div className="flex items-baseline justify-between px-4 py-3">
          <span className="text-sm font-semibold tracking-tight text-slate-100">
            <span className="text-accent">▲</span> {PROFILE.name.split(' ')[0]}’s Portal
          </span>
          <span className="text-[11px] text-slate-600">
            {PROFILE.startWeightKg} → {PROFILE.targetWeightKg} kg
          </span>
        </div>
        <nav className="-mx-px flex gap-1 overflow-x-auto px-3 pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                t.id === tab ? 'bg-accent text-white' : 'text-slate-500 hover:bg-ink-soft hover:text-slate-200'
              }`}
            >
              <span className="mr-1.5 opacity-70">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 px-4 py-5">
        {tab === 'today' && <Today go={setTab} />}
        {tab === 'train' && <TrainPage />}
        {tab === 'kitchen' && <KitchenPage />}
        {tab === 'weight' && <WeightPage />}
        {tab === 'sizes' && <MeasurementsPage />}
        {tab === 'photos' && <PhotosPage />}
        {tab === 'notes' && <NotesPage />}
        {tab === 'plan' && <PlanPage />}
      </main>

      <footer className="border-t border-ink-line px-4 py-4 text-[11px] leading-relaxed text-slate-600">
        Everything you log stays in this browser — no account, no server, nothing uploaded. Clearing
        site data wipes it, so export before you switch devices. General fitness guidance, not
        medical advice; see a doctor before starting if anything hurts or you have a known condition.
      </footer>
    </div>
  )
}
