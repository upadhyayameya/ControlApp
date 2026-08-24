import { addDays } from './date'

/** A 7-day moving average. Daily bodyweight swings 1–2 kg on water alone; the
 *  trend line is the only number worth reacting to. */
export function movingAverage(points: { date: string; kg: number }[], window = 7) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((p, i) => {
    const slice = sorted.slice(Math.max(0, i - window + 1), i + 1)
    const avg = slice.reduce((s, x) => s + x.kg, 0) / slice.length
    return { ...p, trend: Number(avg.toFixed(2)) }
  })
}

/** Least-squares slope in kg/week over the last `days` of data. */
export function trendPerWeek(points: { date: string; kg: number }[], days = 21): number | null {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length < 4) return null
  const cutoff = new Date(sorted[sorted.length - 1].date).getTime() - days * 86400000
  const recent = sorted.filter((p) => new Date(p.date).getTime() >= cutoff)
  if (recent.length < 4) return null

  const t0 = new Date(recent[0].date).getTime()
  const xs = recent.map((p) => (new Date(p.date).getTime() - t0) / 86400000)
  const ys = recent.map((p) => p.kg)
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    den += (xs[i] - mx) ** 2
  }
  if (den === 0) return null
  return Number(((num / den) * 7).toFixed(2))
}

/** Streak of consecutive days (ending today or yesterday) where every task was done.
 *  Today not being complete does not break the streak — the day is not over yet. */
export function currentStreak(completeDates: Set<string>, todayISO: string): number {
  let streak = 0
  let cursor = completeDates.has(todayISO) ? todayISO : addDays(todayISO, -1)
  while (completeDates.has(cursor)) {
    streak++
    cursor = addDays(cursor, -1)
  }
  return streak
}
