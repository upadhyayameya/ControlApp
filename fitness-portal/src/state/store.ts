import { create } from 'zustand'
import { load, save } from '../lib/storage'
import { todayISO } from '../lib/date'

export type WeightEntry = { date: string; kg: number }

export type Measurement = {
  date: string
  neck?: number
  chest?: number
  waist?: number
  hips?: number
  thigh?: number
  arm?: number
}

export const MEASUREMENT_FIELDS: {
  key: keyof Omit<Measurement, 'date'>
  label: string
  hint: string
}[] = [
  { key: 'neck', label: 'Neck', hint: 'Just below the Adam’s apple' },
  { key: 'chest', label: 'Chest', hint: 'Across the nipple line, arms relaxed' },
  { key: 'waist', label: 'Waist', hint: 'At the navel, do NOT suck in. The number that matters most.' },
  { key: 'hips', label: 'Hips', hint: 'Widest point of the glutes' },
  { key: 'thigh', label: 'Thigh', hint: 'Mid-point of the right thigh' },
  { key: 'arm', label: 'Arm', hint: 'Right bicep, flexed' },
]

/** date -> ids of the tasks completed that day */
export type TaskLog = Record<string, string[]>

export type SetEntry = { exerciseId: string; setIndex: number; kg: number | null; reps: number | null }
export type WorkoutLog = { date: string; sessionId: string; sets: SetEntry[]; done: boolean }

export type Note = { id: string; date: string; text: string }
export type Photo = { id: string; date: string; caption: string }

type State = {
  weights: WeightEntry[]
  measurements: Measurement[]
  tasks: TaskLog
  workouts: WorkoutLog[]
  notes: Note[]
  photos: Photo[]

  logWeight: (date: string, kg: number) => void
  removeWeight: (date: string) => void
  logMeasurement: (m: Measurement) => void
  removeMeasurement: (date: string) => void
  toggleTask: (date: string, taskId: string) => void
  setSet: (date: string, sessionId: string, entry: SetEntry) => void
  finishWorkout: (date: string, sessionId: string) => void
  addNote: (text: string) => void
  removeNote: (id: string) => void
  addPhoto: (photo: Photo) => void
  removePhoto: (id: string) => void
}

/** Ticking a task as a side effect of doing the thing. Logging a weigh-in IS the
 *  weigh-in task; there is no reason to make him tick it twice. */
function withTask(tasks: TaskLog, date: string, taskId: string): TaskLog {
  const done = tasks[date] ?? []
  if (done.includes(taskId)) return tasks
  return { ...tasks, [date]: [...done, taskId] }
}

/** Every mutation writes through to localStorage immediately. There is no save button
 *  and no unsaved state to lose — the whole point is that logging costs nothing. */
function persist<T>(key: string, value: T): T {
  save(key, value)
  return value
}

export const useStore = create<State>((set) => ({
  weights: load<WeightEntry[]>('weights', []),
  measurements: load<Measurement[]>('measurements', []),
  tasks: load<TaskLog>('tasks', {}),
  workouts: load<WorkoutLog[]>('workouts', []),
  notes: load<Note[]>('notes', []),
  photos: load<Photo[]>('photos', []),

  logWeight: (date, kg) =>
    set((s) => {
      const rest = s.weights.filter((w) => w.date !== date)
      const next = [...rest, { date, kg }].sort((a, b) => a.date.localeCompare(b.date))
      return {
        weights: persist('weights', next),
        tasks: persist('tasks', withTask(s.tasks, date, 'weigh')),
      }
    }),

  removeWeight: (date) =>
    set((s) => ({ weights: persist('weights', s.weights.filter((w) => w.date !== date)) })),

  logMeasurement: (m) =>
    set((s) => {
      const rest = s.measurements.filter((x) => x.date !== m.date)
      const next = [...rest, m].sort((a, b) => a.date.localeCompare(b.date))
      return { measurements: persist('measurements', next) }
    }),

  removeMeasurement: (date) =>
    set((s) => ({
      measurements: persist('measurements', s.measurements.filter((m) => m.date !== date)),
    })),

  toggleTask: (date, taskId) =>
    set((s) => {
      const done = s.tasks[date] ?? []
      const next = {
        ...s.tasks,
        [date]: done.includes(taskId) ? done.filter((t) => t !== taskId) : [...done, taskId],
      }
      return { tasks: persist('tasks', next) }
    }),

  setSet: (date, sessionId, entry) =>
    set((s) => {
      const existing = s.workouts.find((w) => w.date === date && w.sessionId === sessionId)
      const workout: WorkoutLog = existing ?? { date, sessionId, sets: [], done: false }
      const sets = workout.sets.filter(
        (x) => !(x.exerciseId === entry.exerciseId && x.setIndex === entry.setIndex),
      )
      const others = s.workouts.filter((w) => !(w.date === date && w.sessionId === sessionId))
      return { workouts: persist('workouts', [...others, { ...workout, sets: [...sets, entry] }]) }
    }),

  finishWorkout: (date, sessionId) =>
    set((s) => {
      const existing = s.workouts.find((w) => w.date === date && w.sessionId === sessionId)
      const workout: WorkoutLog = existing ?? { date, sessionId, sets: [], done: false }
      const others = s.workouts.filter((w) => !(w.date === date && w.sessionId === sessionId))
      const done = !workout.done
      return {
        workouts: persist('workouts', [...others, { ...workout, done }]),
        tasks: done ? persist('tasks', withTask(s.tasks, date, 'move')) : s.tasks,
      }
    }),

  addNote: (text) =>
    set((s) => {
      const note: Note = { id: crypto.randomUUID(), date: todayISO(), text }
      return { notes: persist('notes', [note, ...s.notes]) }
    }),

  removeNote: (id) => set((s) => ({ notes: persist('notes', s.notes.filter((n) => n.id !== id)) })),

  addPhoto: (photo) =>
    set((s) => ({
      photos: persist('photos', [photo, ...s.photos].sort((a, b) => b.date.localeCompare(a.date))),
    })),

  removePhoto: (id) =>
    set((s) => ({ photos: persist('photos', s.photos.filter((p) => p.id !== id)) })),
}))
