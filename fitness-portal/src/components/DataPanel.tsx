import { useState } from 'react'
import { useStore } from '../state/store'
import { photoStore, save } from '../lib/storage'
import { todayISO } from '../lib/date'
import { Card } from './ui'

type Backup = {
  format: 'fitness-portal-backup'
  version: 1
  exportedAt: string
  weights: unknown
  measurements: unknown
  tasks: unknown
  workouts: unknown
  notes: unknown
  photos: { id: string; date: string; caption: string }[]
  photoData: Record<string, string>
}

export default function DataPanel() {
  const state = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const exportAll = async (withPhotos: boolean) => {
    setBusy('export')
    setMsg(null)
    try {
      const photoData: Record<string, string> = {}
      if (withPhotos) {
        for (const p of state.photos) {
          const d = await photoStore.get(p.id).catch(() => undefined)
          if (d) photoData[p.id] = d
        }
      }
      const backup: Backup = {
        format: 'fitness-portal-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        weights: state.weights,
        measurements: state.measurements,
        tasks: state.tasks,
        workouts: state.workouts,
        notes: state.notes,
        photos: withPhotos ? state.photos : [],
        photoData,
      }
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fitness-portal-${todayISO()}${withPhotos ? '-with-photos' : ''}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMsg('Exported. Keep it somewhere that is backed up.')
    } catch {
      setMsg('Export failed.')
    } finally {
      setBusy(null)
    }
  }

  const importAll = async (file: File) => {
    setBusy('import')
    setMsg(null)
    try {
      const parsed = JSON.parse(await file.text()) as Partial<Backup>
      if (parsed.format !== 'fitness-portal-backup') {
        setMsg('That is not a portal backup file.')
        return
      }
      for (const [id, dataUrl] of Object.entries(parsed.photoData ?? {})) {
        await photoStore.put(id, dataUrl).catch(() => {})
      }
      // Written straight to storage, then reloaded — simpler and safer than
      // trying to merge two histories in memory.
      save('weights', parsed.weights ?? [])
      save('measurements', parsed.measurements ?? [])
      save('tasks', parsed.tasks ?? {})
      save('workouts', parsed.workouts ?? [])
      save('notes', parsed.notes ?? [])
      save('photos', parsed.photos ?? [])
      location.reload()
    } catch {
      setMsg('Could not read that file.')
    } finally {
      setBusy(null)
    }
  }

  const counts = [
    `${state.weights.length} weigh-ins`,
    `${state.measurements.length} measurements`,
    `${state.workouts.length} sessions`,
    `${state.notes.length} notes`,
    `${state.photos.length} photos`,
  ].join(' · ')

  return (
    <Card title="Your data" sub={counts}>
      <p className="mb-3 text-sm leading-relaxed text-slate-400">
        Everything lives in this browser and nowhere else. That means nobody can see it — and also
        that clearing site data or switching phones loses it. Export every few weeks.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn" disabled={busy !== null} onClick={() => void exportAll(false)}>
          Export logs
        </button>
        <button className="btn" disabled={busy !== null} onClick={() => void exportAll(true)}>
          Export with photos
        </button>
        <label className="btn cursor-pointer">
          {busy === 'import' ? 'Importing…' : 'Import backup'}
          <input
            type="file"
            accept="application/json"
            className="hidden"
            disabled={busy !== null}
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void importAll(f)
            }}
          />
        </label>
      </div>
      {msg && <p className="mt-2 text-xs text-slate-400">{msg}</p>}
      <p className="mt-2 text-[11px] leading-snug text-slate-600">
        Importing replaces what is currently in the browser — it does not merge.
      </p>
    </Card>
  )
}
