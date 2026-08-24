# Fitness Portal — working notes for Claude Code

A personal fitness portal for Ameya. Everything is local to the browser: no backend,
no account, no analytics, nothing leaves the device. Treat that as a hard constraint —
do not add a server, a database, or any third-party call without being asked.

## Commands

```bash
cd fitness-portal
npm install
npm run dev              # http://localhost:5173
npm run typecheck        # tsc -b --noEmit
npm run build            # typecheck + production build — run before every commit
npm run build:standalone # one self-contained dist/index.html, no server needed
```

`npm run build` runs the type-checker, so a green build means the types are green.
There is no test suite; verify changes by running the app.

## Layout

```
src/
  data/       Content, not code. profile.ts, program.ts, recipes.ts
  lib/        storage.ts (localStorage + IndexedDB), date.ts, calc.ts
  state/      store.ts — one zustand store, writes through to localStorage on every mutation
  components/ One file per tab, plus ui.tsx primitives and DataPanel.tsx
```

## The important idea

`src/data/profile.ts` is the single source of truth for the body maths. Bodyweight
target, calorie target, macros and the plan line on the weight chart all derive from
the constants at the top of that file. Change a number there and the whole portal
re-derives. Do not hardcode a calorie or weight figure anywhere else.

Similarly, `src/data/program.ts` and `src/data/recipes.ts` are pure content — adding a
recipe or swapping an exercise should never require touching a component.

## Conventions

- Tailwind only, dark theme. Shared classes (`.card`, `.field`, `.btn`, `.btn-primary`,
  `.label`) live in `src/index.css`; prefer them over re-styling from scratch.
- Mobile first. This gets used one-handed in a gym — tap targets stay generous and the
  nav scrolls horizontally rather than wrapping.
- No save buttons. Every mutation persists immediately. Logging must never feel like work.
- Numeric inputs: `inputMode="decimal"` or `"numeric"` so phones show the right keypad.
- Photos go to IndexedDB (`photoStore`), never localStorage — they blow the ~5 MB quota.
  They are downscaled to 1200 px on the way in.

## Data model

Store keys under the `fitness-portal:` localStorage prefix: `weights`, `measurements`,
`tasks`, `workouts`, `notes`, `photos`. Photo blobs live in the `fitness-portal-photos`
IndexedDB database. `DataPanel.tsx` exports and imports all of it as one JSON file —
if you add a new store key, add it there too or backups will silently lose data.

## Things worth knowing before changing behaviour

- Logging a weigh-in auto-ticks the `weigh` daily task; marking a session done auto-ticks
  `move`. Deliberate — doing the thing should not require also ticking the thing.
- The streak counts days where *all five* daily tasks were done, and today not being
  finished does not break it (the day is not over).
- Weight uses a 7-day moving average as the headline trend. Daily scale readings swing
  1–2 kg on water alone; never surface a single day's change as if it means something.
- Dates are stored as local `YYYY-MM-DD` strings via `lib/date.ts`. Do not reach for
  `toISOString().slice(0,10)` — it is UTC and will be a day off for half the day.

## Content changes

The program, recipes and body targets encode specific reasoning (a 600 kcal deficit,
1.7 g/kg protein, 0.6 kg/week, incline walking over running at this bodyweight). If you
change one of those numbers, update the explanation that sits next to it in `PlanPage.tsx`
or `KitchenPage.tsx` — the explanations are the point, not decoration.
