import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { DAILY_TASKS, WEEK, PLAY_ROTATION } from '../data/program'
import { PROFILE, DAILY, bmi, bmiBand, ageOn, targetWeightOn } from '../data/profile'
import { todayISO, prettyDate, dayName, programWeek, daysBetween } from '../lib/date'
import { currentStreak, trendPerWeek } from '../lib/calc'
import { Card, Stat, Pill } from './ui'

export default function Today({ go }: { go: (tab: string) => void }) {
  const today = todayISO()
  const { weights, tasks, toggleTask, logWeight } = useStore()
  const [draft, setDraft] = useState('')

  const done = tasks[today] ?? []
  const latest = weights.length ? weights[weights.length - 1] : null
  const current = latest?.kg ?? PROFILE.startWeightKg
  const bmiValue = bmi(current)
  const band = bmiBand(bmiValue)
  const week = programWeek(PROFILE.startDate, today)
  const session = WEEK.find((s) => s.day === dayName(today)) ?? WEEK[WEEK.length - 1]
  const play = PLAY_ROTATION[(week - 1) % PLAY_ROTATION.length]

  const streak = useMemo(() => {
    const complete = new Set(
      Object.entries(tasks)
        .filter(([, ids]) => DAILY_TASKS.every((t) => ids.includes(t.id)))
        .map(([date]) => date),
    )
    return currentStreak(complete, today)
  }, [tasks, today])

  const rate = trendPerWeek(weights)
  const onTarget = targetWeightOn(today)
  const drift = current - onTarget
  const daysLeft = Math.max(0, daysBetween(today, PROFILE.targetDate))
  const loggedToday = weights.some((w) => w.date === today)

  return (
    <div className="space-y-4">
      <header>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-slate-100">{prettyDate(today)}</h1>
          <Pill tone="accent">Week {week}</Pill>
          {week % 5 === 0 && <Pill tone="warn">Deload week</Pill>}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {daysLeft} days to {PROFILE.targetDate}. Target {PROFILE.targetWeightKg} kg.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Weight" value={current.toFixed(1)} unit="kg" tone="accent" />
        <Stat
          label="BMI"
          value={bmiValue.toFixed(1)}
          tone={band.tone}
          hint={band.label}
        />
        <Stat
          label="Trend"
          value={rate === null ? '—' : (rate > 0 ? '+' : '') + rate.toFixed(2)}
          unit={rate === null ? '' : 'kg/wk'}
          tone={rate === null ? 'default' : rate < -0.15 ? 'good' : rate > 0.15 ? 'bad' : 'warn'}
          hint={rate === null ? 'Log 4+ days' : 'Aim for −0.6'}
        />
        <Stat
          label="Streak"
          value={streak}
          unit={streak === 1 ? 'day' : 'days'}
          tone={streak >= 3 ? 'good' : 'default'}
          hint="All 5 tasks done"
        />
      </div>

      {!loggedToday && (
        <Card title="Weigh in" sub="First thing, after the bathroom, before food.">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const kg = Number(draft)
              if (Number.isFinite(kg) && kg > 20 && kg < 300) {
                logWeight(today, kg)
                setDraft('')
              }
            }}
          >
            <input
              className="field"
              type="number"
              step="0.1"
              inputMode="decimal"
              placeholder={`${current.toFixed(1)} kg`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button className="btn-primary shrink-0" type="submit">
              Log
            </button>
          </form>
        </Card>
      )}

      <Card
        title="Today's five"
        sub="Do these and the plan works. Miss the gym, still do the other four."
        right={
          <span className="text-xs tabular-nums text-slate-500">
            {done.length}/{DAILY_TASKS.length}
          </span>
        }
      >
        <ul className="space-y-1">
          {DAILY_TASKS.map((t) => {
            const isDone = done.includes(t.id)
            return (
              <li key={t.id}>
                <button
                  className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-ink"
                  onClick={() => toggleTask(today, t.id)}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                      isDone ? 'border-good bg-good text-ink' : 'border-ink-line text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span>
                    <span
                      className={`block text-sm font-medium ${
                        isDone ? 'text-slate-500 line-through' : 'text-slate-100'
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className="block text-xs leading-snug text-slate-500">{t.detail}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card
        title={session.title}
        sub={session.focus}
        right={
          <button className="btn" onClick={() => go('train')}>
            Open
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <Pill>{session.durationMin} min</Pill>
          <Pill tone={session.kind === 'lift' ? 'accent' : 'default'}>{session.kind}</Pill>
        </div>
        {session.id === 'play' ? (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
            <div className="text-sm font-semibold text-accent">
              Week {week} · {play.name}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{play.detail}</p>
          </div>
        ) : (
          <ol className="space-y-1 text-sm text-slate-400">
            {session.exercises.map((e) => (
              <li key={e.id} className="flex justify-between gap-3">
                <span>{e.name}</span>
                <span className="shrink-0 tabular-nums text-slate-600">
                  {e.sets} × {e.reps}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card title="Eat today" sub={`${DAILY.kcal} kcal · ${DAILY.proteinG} g protein`}>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { k: 'Protein', v: `${DAILY.proteinG} g` },
              { k: 'Carbs', v: `${DAILY.carbG} g` },
              { k: 'Fat', v: `${DAILY.fatG} g` },
            ].map((m) => (
              <div key={m.k} className="rounded-lg bg-ink px-2 py-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{m.k}</div>
                <div className="text-sm font-semibold tabular-nums text-slate-200">{m.v}</div>
              </div>
            ))}
          </div>
          <button className="btn mt-3 w-full" onClick={() => go('kitchen')}>
            Open the kitchen
          </button>
        </Card>

        <Card title="Are you on track?" sub={`The line says ${onTarget.toFixed(1)} kg today`}>
          <p
            className={`text-sm leading-relaxed ${
              drift <= 0.3 ? 'text-good' : drift <= 1.5 ? 'text-warn' : 'text-bad'
            }`}
          >
            {drift <= 0.3
              ? `You are ${Math.abs(drift).toFixed(1)} kg ahead of schedule. Keep doing exactly this.`
              : drift <= 1.5
                ? `You are ${drift.toFixed(1)} kg behind the line. One tightened week fixes this — check the oil and the roti count.`
                : `You are ${drift.toFixed(1)} kg behind. Do not change the training. Weigh your food for seven days straight and the number will move.`}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Age {ageOn(new Date())} · {PROFILE.heightCm} cm · started at {PROFILE.startWeightKg} kg
          </p>
        </Card>
      </div>
    </div>
  )
}
