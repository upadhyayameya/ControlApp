import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { photoStore, fileToDataUrl } from '../lib/storage'
import { todayISO, prettyDate } from '../lib/date'
import { Card, Empty } from './ui'

export default function PhotosPage() {
  const { photos, addPhoto, removePhoto } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [caption, setCaption] = useState('')

  const onPick = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDataUrl(file)
        const id = crypto.randomUUID()
        await photoStore.put(id, dataUrl)
        addPhoto({ id, date: todayISO(), caption })
      }
      setCaption('')
    } catch {
      setError('Could not save that image. Try a smaller one, or a different format.')
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    await photoStore.del(id).catch(() => {})
    removePhoto(id)
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Pictures</h1>
        <p className="mt-1 text-sm text-slate-500">
          Every two weeks: same spot, same light, same time of day, front and side. Photos stay on
          this device — nothing is uploaded anywhere.
        </p>
      </div>

      <Card title="Add photos">
        <input
          className="field mb-2"
          placeholder="Caption (optional) — e.g. week 4, morning, fasted"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
        <label className="btn-primary inline-block cursor-pointer">
          {busy ? 'Saving…' : 'Choose photos'}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              void onPick(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
        <p className="mt-2 text-[11px] leading-snug text-slate-600">
          Images are resized to 1200 px before saving, so a few hundred of them fit comfortably.
        </p>
      </Card>

      {photos.length === 0 ? (
        <Empty>
          No photos yet. Take the baseline set today — in twelve weeks it will be the most convincing
          evidence you have that this worked.
        </Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <PhotoTile key={p.id} id={p.id} date={p.date} caption={p.caption} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

function PhotoTile({
  id,
  date,
  caption,
  onDelete,
}: {
  id: string
  date: string
  caption: string
  onDelete: (id: string) => void
}) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    photoStore
      .get(id)
      .then((v) => alive && setSrc(v ?? null))
      .catch(() => alive && setSrc(null))
    return () => {
      alive = false
    }
  }, [id])

  return (
    <figure className="overflow-hidden rounded-xl border border-ink-line bg-ink-soft">
      <div className="aspect-[3/4] bg-ink">
        {src ? (
          <img src={src} alt={caption || `Progress photo, ${date}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-600">…</div>
        )}
      </div>
      <figcaption className="flex items-start justify-between gap-2 p-2">
        <span className="min-w-0">
          <span className="block text-xs text-slate-300">{prettyDate(date)}</span>
          {caption && <span className="block truncate text-[11px] text-slate-600">{caption}</span>}
        </span>
        <button className="shrink-0 text-[11px] text-slate-600 hover:text-bad" onClick={() => onDelete(id)}>
          delete
        </button>
      </figcaption>
    </figure>
  )
}
