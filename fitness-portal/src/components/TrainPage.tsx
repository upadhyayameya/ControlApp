import { useMemo, useState } from 'react'
import { useStore, type SetEntry } from '../state/store'
import { WEEK, PLAY_ROTATION, PROGRESSION, TREADMILL_ANSWER, type Session } from '../data/program'
import { PROFILE } from '../data/profile'
import { todayISO, prettyDate, dayName, programWeek } from '../lib/date'
import { Card, Pill, Empty } from './ui'

export default function TrainPage() {
  const today = todayISO()
  const week = programWeek(PROFILE.startDate, today)
  const suggested = WEEK.find((s) => s.day === dayName(today)) ?? WEEK[0]
  const [sessionId, setSessionId] = useState(suggested.id)
  const [date, setDate] = useState(today)
  const session = WEEK.find((s) => s.id === sessionId) ?? WEEK[0]
  const play = PLAY_ROTATION[(week - 1) % PLAY_ROTATION.length]

  const { workouts, setSet, finishWorkout } = useStore()
  const log = workouts.find((w) => w.date === date && w.sessionId === session.id)

  /** Last time you did this session, so you know what to beat. */
  const previous = useMemo(
    () =>
      workouts
        .filter((w) => w.sessionId === session.id && w.date < date && w.sets.length > 0)
        .sort((a, b) => b.date.localeCompare(a.date))[0],
    [workouts, session.id, date],
  )

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Train</h1>
        <p className="mt-1 text-sm text-slate-500">
          Log the weight and reps as you go. Next session, beat one number — that is the whole game.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap gap-2">
          {WEEK.map((s) => (
            <button
              key={s.id}
              onClick={() => setSessionId(s.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                s.id === session.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-ink-line text-slate-400 hover:text-slate-200'
              }`}
            >
              {s.day.slice(0, 3)} · {s.title.split(' — ')[0]}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className="field basis-40"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
          />
          <Pill tone="accent">Week {week}</Pill>
          {week % 5 === 0 && <Pill tone="warn">Deload — same weight, half the sets</Pill>}
        </div>
      </Card>

      <Card title={session.title} sub={session.focus} right={<Pill>{session.durationMin} min</Pill>}>
        {session.id === 'play' && (
          <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <div className="text-sm font-semibold text-accent">
              Week {week} rotation · {play.name}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{play.detail}</p>
            <p className="mt-2 text-[11px] text-slate-600">
              Next up: {PLAY_ROTATION[week % PLAY_ROTATION.length].name}
            </p>
          </div>
        )}

        <div className="space-y-5">
          {session.exercises.map((ex) => (
            <ExerciseBlock
              key={ex.id}
              exercise={ex}
              date={date}
              sessionId={session.id}
              current={log?.sets ?? []}
              previous={previous?.sets ?? []}
              previousDate={previous?.date}
              onChange={(entry) => setSet(date, session.id, entry)}
            />
          ))}
        </div>

        <button
          className={`mt-5 w-full rounded-lg px-4 py-3 text-sm font-semibold transition ${
            log?.done ? 'bg-good text-ink' : 'bg-accent text-white hover:bg-accent-dim'
          }`}
          onClick={() => finishWorkout(date, session.id)}
        >
          {log?.done ? '✓ Session logged' : 'Mark session done'}
        </button>
      </Card>

      <Card title={PROGRESSION.title}>
        <ol className="space-y-2">
          {PROGRESSION.rules.map((r, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-400">
              <span className="shrink-0 font-semibold tabular-nums text-accent">{i + 1}</span>
              <span>{r}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title={TREADMILL_ANSWER.question} sub={TREADMILL_ANSWER.verdict}>
        <ul className="space-y-2">
          {TREADMILL_ANSWER.why.map((w, i) => (
            <li key={i} className="text-sm leading-relaxed text-slate-400">
              — {w}
            </li>
          ))}
        </ul>
        <div className="mt-3 rounded-lg bg-ink p-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Do this</div>
          <p className="mt-1 text-sm text-slate-200">{TREADMILL_ANSWER.prescription}</p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">{TREADMILL_ANSWER.upgrade}</p>
        </div>
      </Card>

      <SessionHistory sessionId={session.id} sessionTitle={session.title} />
    </div>
  )
}

function ExerciseBlock({
  exercise,
  current,
  previous,
  previousDate,
  onChange,
}: {
  exercise: Session['exercises'][number]
  date: string
  sessionId: string
  current: SetEntry[]
  previous: SetEntry[]
  previousDate?: string
  onChange: (e: SetEntry) => void
}) {
  const prev = previous.filter((s) => s.exerciseId === exercise.id)
  const best = prev.reduce<number | null>((m, s) => (s.kg !== null && (m === null || s.kg > m) ? s.kg : m), null)

  return (
    <div className="rounded-lg border border-ink-line bg-ink/50 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100">{exercise.name}</h3>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {exercise.sets} × {exercise.reps}
        </span>
      </div>
      {exercise.startLoad && (
        <p className="mt-0.5 text-[11px] text-slate-600">
          Start at {exercise.startLoad}
          {exercise.stepKg ? ` · +${exercise.stepKg} kg when you top the range` : ''}
        </p>
      )}
      {exercise.note && <p className="mt-1 text-[11px] leading-snug text-slate-500">{exercise.note}</p>}
      {best !== null && previousDate && (
        <p className="mt-1 text-[11px] text-accent">
          Last time ({prettyDate(previousDate)}): best {best} kg — beat it.
        </p>
      )}

      <div className="mt-2 space-y-1.5">
        {Array.from({ length: exercise.sets }, (_, i) => {
          const entry = current.find((s) => s.exerciseId === exercise.id && s.setIndex === i)
          const prior = prev.find((s) => s.setIndex === i)
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-xs tabular-nums text-slate-600">{i + 1}</span>
              <input
                className="field flex-1 py-1.5 text-sm"
                type="number"
                step="0.5"
                inputMode="decimal"
                placeholder={prior?.kg != null ? `${prior.kg} kg` : 'kg'}
                value={entry?.kg ?? ''}
                onChange={(e) =>
                  onChange({
                    exerciseId: exercise.id,
                    setIndex: i,
                    kg: e.target.value === '' ? null : Number(e.target.value),
                    reps: entry?.reps ?? null,
                  })
                }
              />
              <span className="text-xs text-slate-600">×</span>
              <input
                className="field flex-1 py-1.5 text-sm"
                type="number"
                inputMode="numeric"
                placeholder={prior?.reps != null ? `${prior.reps} reps` : 'reps'}
                value={entry?.reps ?? ''}
                onChange={(e) =>
                  onChange({
                    exerciseId: exercise.id,
                    setIndex: i,
                    kg: entry?.kg ?? null,
                    reps: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SessionHistory({ sessionId, sessionTitle }: { sessionId: string; sessionTitle: string }) {
  const workouts = useStore((s) => s.workouts)
  const history = workouts
    .filter((w) => w.sessionId === sessionId && w.sets.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)

  return (
    <Card title="Performance" sub={`Your last sessions of ${sessionTitle}`}>
      {history.length === 0 ? (
        <Empty>Nothing logged for this session yet.</Empty>
      ) : (
        <ul className="divide-y divide-ink-line">
          {history.map((w) => {
            const volume = w.sets.reduce((sum, s) => sum + (s.kg ?? 0) * (s.reps ?? 0), 0)
            return (
              <li key={w.date} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-400">
                  {prettyDate(w.date)} {w.done && <span className="text-good">✓</span>}
                </span>
                <span className="tabular-nums text-slate-300">
                  {Math.round(volume).toLocaleString()} kg total volume
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Total volume is weight × reps across every set. It should creep up week over week. If it
        stalls for three sessions running, you need more sleep or more food, not more effort.
      </p>
    </Card>
  )
}
