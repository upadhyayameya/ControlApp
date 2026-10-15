// Everything downstream (calorie target, macros, weight trajectory) derives from
// these numbers. Change them here and the whole portal re-derives.

export const PROFILE = {
  name: 'Ameya Upadhyay',
  sex: 'male' as const,
  birthDate: '1995-09-12',
  heightCm: 183, // 6 ft
  startWeightKg: 94,
  startDate: '2026-08-24',
  targetDate: '2026-12-31',
  targetWeightKg: 84, // realistic end-of-year
  stretchWeightKg: 82,
  idealWeightKg: 80, // long-term, BMI 23.9 at a lifting bodyweight
  diet: 'vegetarian (no egg)' as const,
}

export function ageOn(date: Date, birthDate = PROFILE.birthDate): number {
  const b = new Date(birthDate)
  let age = date.getFullYear() - b.getFullYear()
  const m = date.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && date.getDate() < b.getDate())) age--
  return age
}

export function bmi(weightKg: number, heightCm = PROFILE.heightCm): number {
  const m = heightCm / 100
  return weightKg / (m * m)
}

export function bmiBand(value: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (value < 18.5) return { label: 'Underweight', tone: 'warn' }
  if (value < 25) return { label: 'Healthy', tone: 'good' }
  if (value < 30) return { label: 'Overweight', tone: 'warn' }
  return { label: 'Obese', tone: 'bad' }
}

/** Mifflin-St Jeor. The most reliable BMR estimate for non-athletes. */
export function bmr(weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + 5
}

/** 1.45 = desk job + 5 training days/week. Deliberately conservative: it is far
 *  better to under-estimate burn and lose weight than the reverse. */
export const ACTIVITY_FACTOR = 1.45

export function tdee(weightKg: number, heightCm = PROFILE.heightCm, age = 30): number {
  return bmr(weightKg, heightCm, age) * ACTIVITY_FACTOR
}

/** Daily intake target. Hard floor of 1800 kcal — below that a vegetarian
 *  cannot hit the protein number and adherence collapses. */
export const DAILY = {
  kcal: 2200,
  proteinG: 160,
  carbG: 230,
  fatG: 70,
  waterMl: 3500,
  steps: 8000,
  cookingOilTsp: 3,
}

/** 0.6 kg/week — 0.64% of bodyweight. Fast enough to see, slow enough to keep muscle. */
export const LOSS_RATE_KG_PER_WEEK = 0.6

export function weeksBetween(fromISO: string, toISO: string): number {
  const ms = new Date(toISO).getTime() - new Date(fromISO).getTime()
  return ms / (1000 * 60 * 60 * 24 * 7)
}

/** The line you are supposed to be on, for any date. Drawn on the weight chart. */
export function targetWeightOn(dateISO: string): number {
  const total = weeksBetween(PROFILE.startDate, PROFILE.targetDate)
  const elapsed = weeksBetween(PROFILE.startDate, dateISO)
  const clamped = Math.max(0, Math.min(elapsed, total))
  const drop = PROFILE.startWeightKg - PROFILE.targetWeightKg
  return PROFILE.startWeightKg - (drop * clamped) / total
}
