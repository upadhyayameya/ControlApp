import { useState } from 'react'
import { useStore } from '../state/store'
import { prettyDate } from '../lib/date'
import { Card, Empty } from './ui'

const PROMPTS = [
  'What did today actually feel like?',
  'Which lift moved this week?',
  'What nearly made you skip — and what got you there anyway?',
  'Something you want to try next week',
]

export default function NotesPage() {
  const { notes, addNote, removeNote } = useStore()
  const [text, setText] = useState('')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Notes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Energy, sleep, niggles, what you tried, what you want to try. The pattern in here is
          usually the reason a week went well or badly.
        </p>
      </div>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const t = text.trim()
            if (t) {
              addNote(t)
              setText('')
            }
          }}
        >
          <textarea
            className="field min-h-[110px] resize-y"
            placeholder={PROMPTS[Math.floor(Math.random() * PROMPTS.length)]}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn-primary mt-2" type="submit" disabled={!text.trim()}>
            Save note
          </button>
        </form>
      </Card>

      {notes.length === 0 ? (
        <Empty>No notes yet.</Empty>
      ) : (
        <div className="space-y-3">
          {notes.map((n) => (
            <article key={n.id} className="card">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs text-slate-500">{prettyDate(n.date)}</span>
                <button className="text-[11px] text-slate-600 hover:text-bad" onClick={() => removeNote(n.id)}>
                  delete
                </button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{n.text}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
