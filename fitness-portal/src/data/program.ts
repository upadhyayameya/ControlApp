export type Exercise = {
  id: string
  name: string
  sets: number
  reps: string
  /** Suggested week-1 load. Week 1 is calibration — adjust, then progress from there. */
  startLoad?: string
  /** Load step when you hit the top of the rep range on every set. */
  stepKg?: number
  note?: string
}

export type Session = {
  id: string
  day: string
  title: string
  kind: 'lift' | 'conditioning' | 'recovery'
  focus: string
  durationMin: number
  exercises: Exercise[]
}

/** Four lifting days, one play day, one long easy day, one true rest day.
 *  Everything is Smith-machine / dumbbell / cable based — no loose barbell needed. */
export const WEEK: Session[] = [
  {
    id: 'lower-a',
    day: 'Monday',
    title: 'Lower A — Squat',
    kind: 'lift',
    focus: 'Quads, the big daily-life strength lift',
    durationMin: 55,
    exercises: [
      { id: 'smith-squat', name: 'Smith Squat', sets: 4, reps: '6–8', startLoad: '40 kg on the bar', stepKg: 5, note: 'Feet slightly forward of the bar. Depth over load — thighs to parallel.' },
      { id: 'smith-rdl-light', name: 'Smith Romanian Deadlift', sets: 3, reps: '8–10', startLoad: '40 kg', stepKg: 5, note: 'Push hips back, bar grazes the thighs. Stop when your back wants to round.' },
      { id: 'db-lunge', name: 'Walking DB Lunge', sets: 3, reps: '10–12 each leg', startLoad: '2 × 10 kg', stepKg: 2 },
      { id: 'leg-curl', name: 'Leg Curl', sets: 3, reps: '12–15', startLoad: 'plate 4', stepKg: 5 },
      { id: 'calf-smith', name: 'Standing Calf Raise (Smith)', sets: 3, reps: '15–20', startLoad: '40 kg', stepKg: 5, note: 'Two-second pause at the bottom.' },
      { id: 'plank', name: 'Plank', sets: 3, reps: '45–60 s', note: 'Squeeze glutes. Do not let the hips sag.' },
    ],
  },
  {
    id: 'upper-a',
    day: 'Tuesday',
    title: 'Upper A — Push',
    kind: 'lift',
    focus: 'Chest, shoulders, triceps',
    durationMin: 55,
    exercises: [
      { id: 'smith-bench', name: 'Smith Bench Press', sets: 4, reps: '6–8', startLoad: '30 kg on the bar', stepKg: 2.5, note: 'Bench set so the bar lands mid-chest. Elbows ~45°, not flared.' },
      { id: 'smith-ohp', name: 'Smith Overhead Press', sets: 3, reps: '8–10', startLoad: '20 kg', stepKg: 2.5 },
      { id: 'incline-db', name: 'Incline DB Press', sets: 3, reps: '10–12', startLoad: '2 × 12 kg', stepKg: 2 },
      { id: 'lat-raise', name: 'Cable / DB Lateral Raise', sets: 3, reps: '15', startLoad: '2 × 6 kg', stepKg: 1, note: 'Light. This is the shoulder-width lift — never swing it.' },
      { id: 'pushdown', name: 'Cable Triceps Pushdown', sets: 3, reps: '12–15', startLoad: 'plate 5', stepKg: 5 },
      { id: 'cable-fly', name: 'Cable Chest Fly', sets: 2, reps: '15', startLoad: 'plate 3', stepKg: 5 },
    ],
  },
  {
    id: 'play',
    day: 'Wednesday',
    title: 'Play Day — Conditioning',
    kind: 'conditioning',
    focus: 'The fun slot. Rotates every week so it never gets stale.',
    durationMin: 40,
    exercises: [
      { id: 'rotation', name: 'Pick this week’s block (see rotation below)', sets: 1, reps: '30–35 min', note: 'The only rule: keep moving and finish sweaty. Log what you did in Notes.' },
    ],
  },
  {
    id: 'lower-b',
    day: 'Thursday',
    title: 'Lower B — Hinge',
    kind: 'lift',
    focus: 'Hamstrings, glutes, posterior chain',
    durationMin: 55,
    exercises: [
      { id: 'smith-rdl-heavy', name: 'Smith Romanian Deadlift (heavy)', sets: 4, reps: '6–8', startLoad: '50 kg', stepKg: 5 },
      { id: 'split-squat', name: 'Bulgarian Split Squat (DB)', sets: 3, reps: '8–10 each leg', startLoad: '2 × 8 kg', stepKg: 2, note: 'Back foot on a bench. Brutal at first — start lighter than you think.' },
      { id: 'leg-ext', name: 'Leg Extension', sets: 3, reps: '12–15', startLoad: 'plate 5', stepKg: 5 },
      { id: 'kb-swing', name: 'Kettlebell Swing', sets: 5, reps: '20', startLoad: '16 kg', stepKg: 4, note: 'Hip snap, not a squat. 30 s rest between sets. This is your fat-loss engine.' },
      { id: 'calf-seated', name: 'Seated / Standing Calf Raise', sets: 3, reps: '15–20', startLoad: 'plate 5', stepKg: 5 },
      { id: 'woodchop', name: 'Cable Woodchop', sets: 3, reps: '12 each side', startLoad: 'plate 3', stepKg: 5 },
    ],
  },
  {
    id: 'upper-b',
    day: 'Friday',
    title: 'Upper B — Pull',
    kind: 'lift',
    focus: 'Back, biceps, rear delts — the posture fixers',
    durationMin: 55,
    exercises: [
      { id: 'pullup', name: 'Pull-up (or TRX Row)', sets: 4, reps: 'AMRAP', note: 'At 94 kg you may get zero. Use TRX rows or assisted pulldowns; pull-ups arrive around 85 kg.' },
      { id: 'pulldown', name: 'Lat Pulldown', sets: 3, reps: '10–12', startLoad: '45 kg', stepKg: 5 },
      { id: 'low-row', name: 'Cable Low Row', sets: 3, reps: '10–12', startLoad: '45 kg', stepKg: 5 },
      { id: 'rear-delt', name: 'Chest-Supported DB Row / Rear Delt Fly', sets: 3, reps: '12–15', startLoad: '2 × 8 kg', stepKg: 2 },
      { id: 'curl', name: 'DB Curl', sets: 3, reps: '12', startLoad: '2 × 10 kg', stepKg: 2 },
      { id: 'face-pull', name: 'Cable Face Pull', sets: 3, reps: '15', startLoad: 'plate 3', stepKg: 5, note: 'The single best thing you can do for desk-job shoulders.' },
    ],
  },
  {
    id: 'zone2',
    day: 'Saturday',
    title: 'Long Zone 2',
    kind: 'conditioning',
    focus: 'Steady aerobic base — the treadmill answer',
    durationMin: 45,
    exercises: [
      { id: 'incline-walk', name: 'Treadmill Incline Walk', sets: 1, reps: '45 min', startLoad: '5.0–5.5 km/h @ 8–12% incline', note: 'Heart rate 120–140. You should be able to hold a conversation, barely. Swap for elliptical or recumbent bike if the knees complain.' },
    ],
  },
  {
    id: 'rest',
    day: 'Sunday',
    title: 'Rest + Prep',
    kind: 'recovery',
    focus: 'Walk, cook, weigh in, plan the week',
    durationMin: 60,
    exercises: [
      { id: 'walk', name: 'Easy walk outdoors', sets: 1, reps: '30–40 min' },
      { id: 'prep', name: 'Batch cook (see Kitchen tab)', sets: 1, reps: '~60 min', note: 'Two dals, one masala base, 1 kg curd hung. This is the single highest-leverage hour of your week.' },
    ],
  },
]

/** Wednesday rotates on a 4-week cycle so the fun slot never repeats too soon. */
export const PLAY_ROTATION = [
  {
    week: 1,
    name: 'Kettlebell Complex',
    detail: '5 rounds, 90 s rest between: 10 swings · 8 goblet squats · 5 clean & press each arm · 8 single-arm rows each arm. Start with a 16 kg bell.',
  },
  {
    week: 2,
    name: 'Heavy Bag',
    detail: '8 × 2 min rounds, 60 s rest. Jab-cross-hook combos. Wrap your hands. Fantastic conditioning and it does not feel like cardio.',
  },
  {
    week: 3,
    name: 'Rope & Slam Circuit',
    detail: '5 rounds: 30 s battle rope waves · 10 slam balls · 20 m farmer carry (2 × 24 kg hex DBs) · 60 s rest.',
  },
  {
    week: 4,
    name: 'TRX & Carry Medley',
    detail: '4 rounds: 10 TRX rows · 10 TRX push-ups · 8 med-ball rotational throws each side · 40 m suitcase carry each arm · 90 s rest.',
  },
]

export const PROGRESSION = {
  title: 'How much to lift — the only rule you need',
  rules: [
    'Week 1 is calibration. Use the suggested start loads. If the last rep of a set was easy, it was too light — write down what actually felt right.',
    'Double progression: when you hit the TOP of the rep range on every set, add weight next session (+5 kg lower body, +2.5 kg upper body, +2 kg per dumbbell).',
    'Leave 2 reps in the tank on every set except the last. That is RPE 8. Grinding to failure every set is why people quit in week 3.',
    'Miss the BOTTOM of the rep range two sessions running? Drop the load 10% and build back. This is normal, not failure.',
    'Every 5th week is a deload: same weights, half the sets. Do not skip it — it is what lets you keep going in month 4.',
  ],
}

export const TREADMILL_ANSWER = {
  question: 'Should I do treadmill?',
  verdict: 'Yes — but walk on an incline. Do not run yet.',
  why: [
    'At 94 kg, running puts roughly three times the joint load through your knees and ankles that walking does, for a similar calorie burn.',
    'Incline walking burns 400–500 kcal/hour and costs you almost nothing in recovery — so it does not eat into your lifting.',
    'Running is a skill that punishes excess bodyweight. Let the weight come off first, then running becomes fun instead of a grind.',
  ],
  prescription: '5.0–5.5 km/h at 8–12% incline, 35–45 min, heart rate 120–140. Saturdays, plus any day you have spare energy.',
  upgrade: 'Once you are under 88 kg and eight weeks in, add one interval session: 8 × (30 s hard / 90 s easy). Keep the long incline walk as well.',
}

/** The consistency fix. Four things, every single day, under five minutes to log. */
export const DAILY_TASKS = [
  { id: 'weigh', label: 'Weigh in', detail: 'First thing, after the bathroom, before food or water. Same conditions every day.' },
  { id: 'protein', label: 'Hit 160 g protein', detail: 'The one nutrition number that matters. Everything else is negotiable.' },
  { id: 'steps', label: '8,000 steps', detail: 'Separate from training. This is the quiet half of your calorie burn.' },
  { id: 'move', label: "Today's session", detail: 'Whatever the calendar says — lift, play day, Zone 2, or the Sunday walk.' },
  { id: 'sleep', label: '7 hours in bed', detail: 'Short sleep raises hunger hormones and kills lifting performance. It is training.' },
]
