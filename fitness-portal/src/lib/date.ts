export function todayISO(): string {
  return toISO(new Date())
}

export function toISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function prettyDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function dayName(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' })
}

export function daysBetween(aISO: string, bISO: string): number {
  const ms = new Date(bISO).getTime() - new Date(aISO).getTime()
  return Math.round(ms / 86400000)
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** Which week of the program you are in (1-based), for the play-day rotation and deloads. */
export function programWeek(startISO: string, iso: string): number {
  return Math.floor(daysBetween(startISO, iso) / 7) + 1
}
