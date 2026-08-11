# HBS BAS Simulation Trainer

A web-based HVAC/BAS simulation trainer for HBS Solutions' BTU division. Engineers
build an HVAC system on a canvas, wire it together, set up control sequences, press
play, and watch the building run — changing setpoints and injecting faults to see
the consequences appear in trends and self-explaining alarms.

This is a **training tool**, not an engineering-grade energy model. The physics are
*directionally correct and explainable*, not ASHRAE-certified.

> The reasoning engine — every alarm explaining *why* it fired, plus the
> "why is this **not** running?" interlock tracer — is the training value.
> The rest is scaffolding for it.

---

## Running it

```bash
npm install
npm run dev              # http://localhost:5173
npm run build            # type-check + production build
npm run build:standalone # one self-contained dist/index.html — open by double-clicking, no server
npm run typecheck
```

### Sharing without a terminal

`npm run build:standalone` emits a single self-contained `dist/index.html` with
everything inlined — hand it to someone and they open it by double-clicking or
host it as one static file, no install required. In that mode the simulation
runs on the main thread (`src/sim/localEngine.ts`) instead of a Web Worker,
since a hosted page's security policy may forbid spawning a Worker; the physics
are identical to the worker path because both share `src/sim/engineCore.ts`.

The app opens on a pre-wired demo building (one AHU, three VAV-with-reheat zones, a
two-chiller air-cooled plant, a condensing boiler, primary pumps, and an OAT sensor).
Press **▶ 100×** and watch a day go by.

---

## Design decisions (the three open questions)

1. **Physics depth — simple lumped-parameter.** Zones are RC thermal networks;
   equipment is algebraic (part-load curves, coil approach, fan cube-law). Fast,
   fully explainable, runs client-side at 1000×. Good for teaching cause/effect and
   fault ID; not for defensible savings numbers.
2. **Model numbers — curated catalog + freeform.** ~50 real units (Trane RTAC,
   Carrier 30XA, York YVAA, Daikin Rebel, AERCO Benchmark, BAC towers, Titus VAVs …)
   pre-fill plausible nameplate defaults, and a generic **Other** block plus free-text
   manufacturer/model entry cover anything the list doesn't. Every value stays editable.
3. **Multi-user with instructor console — phased.** v1 ships the full single-screen
   application including a local **Instructor** fault-injection console. The code is
   structured so a backend that pushes faults to remote trainee sessions and aggregates
   scoring slots in behind the existing store/worker boundary (see *Roadmap*).

---

## What's implemented

| Area | Status |
| --- | --- |
| Equipment library (14 categories, add/remove/configure) | ✅ |
| Real model-number catalog with editable nameplate | ✅ |
| Canvas + wiring, 3 media (air/water/electrical), animated flow | ✅ |
| Connection validation with plain-English errors | ✅ |
| Control sequences (DAT/OA/static/CHW/HW/CW reset, schedule, DCV, staging, optimal start) | ✅ |
| Simulation engine in a Web Worker, fixed 1-min timestep | ✅ |
| Clock + speed (pause/1×/10×/100×/1000×/jump day-week) | ✅ |
| Sine-wave weather (daily + seasonal); TMY3 hook left open | ✅ (sine) |
| Zone RC thermal model, per-equipment energy + cost | ✅ |
| Fault injection (stuck damper, drifted sensor, leaking valve, failed VFD, fouled coil, forgotten override, seized actuator) | ✅ |
| **Alarms with reasoning** (root-cause traces) | ✅ |
| **"Why is this not running?"** interlock tracer | ✅ |
| Multi-point trends, ranges, CSV export | ✅ |
| Energy dashboard + baseline-vs-modified comparison | ✅ |
| Save/load configuration as JSON (+ browser storage) | ✅ |

---

## Architecture

```
src/
  types/domain.ts        Domain model: equipment, ports, connections, sequences,
                         faults, sim state, alarms, worker message protocol.
  data/
    catalog.ts           ~50 curated real units with nameplate defaults.
    schema.ts            Per-category port templates + nameplate field schemas.
    sequences.ts         Default control-sequence bundles per category.
    factory.ts           Node/connection factories (fresh ids, defaults).
    validate.ts          Connection validation → plain-English reasons.
    seed.ts              The pre-wired demo building.
  sim/
    weather.ts           Two-harmonic sine weather + psychrometric enthalpy.
    world.ts             SimWorld runtime state + topology index from wiring.
    model.ts             The per-minute physics step (the heart).
    reasoning.ts         Alarm reasoning + why-not-running tracer.
    engine.worker.ts     Web Worker loop: ticks, batches trends, streams snapshots.
  state/store.ts         Zustand store; mirrors every edit into the worker.
  components/            Toolbar, Palette, Canvas, Inspector, SequenceEditor,
                         AlarmPanel, Trends, EnergyDashboard, InstructorPanel.
  App.tsx                Operator-workstation layout.
```

**Data flow.** The store owns the editable `SystemConfig`. Every edit is mirrored
into the Web Worker, which owns the physics truth and streams `SimSnapshot`s +
1-minute `TrendSample`s back. The worker is the single source of simulated state, so
the UI stays responsive at high speed multipliers and a config round-trips cleanly to
JSON.

**The reasoning engine** (`sim/reasoning.ts`) reads a finished snapshot and walks the
causal chain from symptom back to first cause — e.g. hot zone → VAV at max airflow →
AHU can't make SAT → CHW valve wide open → CHW supply too warm → CHW reset holding it
warm because the OAT sensor reads low → *"Check the OAT sensor."* The same read-only
logic powers the on-demand *why-not-running* interlock trace (schedule, call, safety,
min-off timer, lead/lag, fault).

---

## Design language

Operator-workstation, not a toy: HBS forest green / copper / warm cream, dark mode by
default, monospace numeric readouts, BAS graphics conventions (colored flow lines,
animated rotors on running equipment, live value badges on each device).

---

## Roadmap

- **Phase 2 backend (multi-user + instructor push).** A server behind the existing
  `store ↔ worker` seam: instructors arm faults against remote trainee sessions
  (`update-faults` already exists as a message), a shared scenario library replacing
  local-storage save/load, and scoring aggregation. The `Fault[]` list the instructor
  console builds today is exactly what a backend would broadcast.
- **TMY3 weather.** `sim/weather.ts#weatherAt` is the single swap point — replace the
  sine model with a table lookup; nothing else changes.
- **Scoring.** Time-to-diagnose and correct-root-cause tracking on top of the alarm
  registry.
- **Scenario save/load of the whole sim** (not just config) for reproducible drills.

---

## Simulation caveats

Lumped-parameter by design. Energy figures are directionally correct for comparing a
change against a baseline, not for utility-grade savings claims. Plant hydraulics are
represented by loop supply temperatures rather than a full flow network — enough to
teach reset, staging, and coil starvation, which is the point.
