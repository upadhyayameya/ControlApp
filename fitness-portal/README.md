# Fitness Portal

A personal fitness portal — weight, daily tasks, training performance, measurements,
progress photos, notes, and a measured vegetarian recipe book. Runs entirely in the
browser; nothing is uploaded anywhere.

## Run it

```bash
cd fitness-portal
npm install
npm run dev          # http://localhost:5173
```

## Use it without a terminal

```bash
npm run build:standalone
```

This produces a single self-contained `dist/index.html`. Open it by double-clicking, or
put it on any static host and add it to your phone's home screen. All data is stored in
that browser — use **Plan → Your data → Export** before switching devices.

## Tabs

| Tab | What it does |
| --- | --- |
| **Today** | The five daily tasks, weigh-in, today's session, and whether you are on the line |
| **Train** | The week's sessions with set-by-set logging, last-session comparison, and volume history |
| **Kitchen** | Daily macro targets, a default day, twelve measured vegetarian recipes, and the techniques |
| **Weight** | Daily weight, 7-day trend, and the target line |
| **Sizes** | Neck, chest, waist, hips, thigh, arm — with change-since-baseline |
| **Photos** | Progress photos, downscaled and stored locally in IndexedDB |
| **Notes** | Free-text log for energy, sleep, niggles, experiments |
| **Plan** | The reasoning: target weight, the consistency system, the week, progression, expectations — plus data export |

## Stack

React 18 · TypeScript · Vite · Tailwind · Zustand · Recharts. No backend.

See `CLAUDE.md` for development conventions.

---

General fitness guidance, not medical advice. See a doctor before starting if anything
hurts or you have a known condition.
