import { WEEK, PLAY_ROTATION, PROGRESSION } from '../data/program'
import { PROFILE, DAILY, bmi, LOSS_RATE_KG_PER_WEEK, weeksBetween } from '../data/profile'
import { Card, Pill } from './ui'
import DataPanel from './DataPanel'

export default function PlanPage() {
  const weeks = Math.round(weeksBetween(PROFILE.startDate, PROFILE.targetDate))
  const drop = PROFILE.startWeightKg - PROFILE.targetWeightKg

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">The Plan</h1>
        <p className="mt-1 text-sm text-slate-500">
          Read this once properly. After that, the Today tab is all you need.
        </p>
      </div>

      <Card title="What is your ideal weight?">
        <div className="space-y-3 text-sm leading-relaxed text-slate-400">
          <p>
            You are {PROFILE.heightCm} cm and {PROFILE.startWeightKg} kg, which puts you at a BMI of{' '}
            <span className="font-semibold text-warn">{bmi(PROFILE.startWeightKg).toFixed(1)}</span> —
            the overweight band, not by a lot. The healthy BMI range for your height runs from about
            62 kg to 83 kg, but the bottom of that range would look gaunt on a man who lifts.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { label: 'End of year', value: `${PROFILE.targetWeightKg} kg`, note: `−${drop} kg in ${weeks} weeks`, tone: 'accent' },
              { label: 'Stretch', value: `${PROFILE.stretchWeightKg} kg`, note: 'If the last month goes well', tone: 'default' },
              { label: 'Long-term ideal', value: `${PROFILE.idealWeightKg} kg`, note: `BMI ${bmi(PROFILE.idealWeightKg).toFixed(1)} — lean and strong`, tone: 'good' },
            ].map((t) => (
              <div key={t.label} className="rounded-lg bg-ink p-3">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{t.label}</div>
                <div
                  className={`mt-0.5 text-xl font-semibold ${
                    t.tone === 'accent' ? 'text-accent' : t.tone === 'good' ? 'text-good' : 'text-slate-100'
                  }`}
                >
                  {t.value}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-500">{t.note}</div>
              </div>
            ))}
          </div>
          <p>
            {PROFILE.targetWeightKg} kg by 31 December is {LOSS_RATE_KG_PER_WEEK} kg a week — about
            0.6% of your bodyweight. That rate is deliberate: faster than this and you lose muscle
            alongside fat, which is how people end up lighter and softer at the same time. Slower and
            you will not see enough change to stay interested.
          </p>
          <p className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-slate-300">
            You said no matter what it takes. Here is what it actually takes: hitting a boring number
            five days out of seven for eighteen weeks. Not intensity — repetition. The plan below is
            built so that a bad day costs you nothing as long as the next day happens.
          </p>
        </div>
      </Card>

      <Card title="Fixing the consistency problem">
        <div className="space-y-3 text-sm leading-relaxed text-slate-400">
          <p>
            Consistency does not fail because people lack willpower. It fails because the daily ask
            is vague. "Eat better and go to the gym" is not a task you can complete — so there is no
            moment where you get to be done.
          </p>
          <p>So the day has exactly five items, and they never change:</p>
          <ol className="space-y-1.5 pl-1">
            {['Weigh in', 'Hit 160 g protein', '8,000 steps', "Today's session", '7 hours in bed'].map((t, i) => (
              <li key={t} className="flex gap-3">
                <span className="font-semibold tabular-nums text-accent">{i + 1}</span>
                <span className="text-slate-300">{t}</span>
              </li>
            ))}
          </ol>
          <p>
            Three rules that make it survive contact with real life:{' '}
            <span className="text-slate-300">
              a missed session is never made up — you just do the next one on schedule
            </span>
            ; a bad food day ends at midnight and does not become a bad week; and if you genuinely
            cannot face the gym, you still do the other four and you still tick the day.
          </p>
        </div>
      </Card>

      <Card title="The week" sub="Four lifting days, one play day, one long easy day, one true rest day.">
        <div className="space-y-2">
          {WEEK.map((s) => (
            <div key={s.id} className="flex items-start gap-3 rounded-lg bg-ink p-3">
              <span className="w-10 shrink-0 text-xs font-semibold uppercase text-slate-500">
                {s.day.slice(0, 3)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-100">{s.title}</span>
                  <Pill tone={s.kind === 'lift' ? 'accent' : s.kind === 'recovery' ? 'good' : 'default'}>
                    {s.durationMin} min
                  </Pill>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-slate-500">{s.focus}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Everything is built around the Smith machine, the dumbbell rack, the cable stations and the
          Synergy rig. You do not need the free-standing barbell your gym is missing.
        </p>
      </Card>

      <Card title="Play day rotation" sub="Wednesday is the experiment slot — it rotates so it never gets stale.">
        <div className="space-y-2">
          {PLAY_ROTATION.map((p) => (
            <div key={p.week} className="rounded-lg bg-ink p-3">
              <div className="text-sm font-semibold text-accent">
                Week {p.week} · {p.name}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{p.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          This slot exists because you like to experiment, and because a plan with no fun in it gets
          abandoned in week five. Swap anything in here you like — it is the one session where the
          only requirement is that you finish it sweaty.
        </p>
      </Card>

      <Card title="How much to lift">
        <ol className="space-y-2">
          {PROGRESSION.rules.map((r, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-400">
              <span className="shrink-0 font-semibold tabular-nums text-accent">{i + 1}</span>
              <span>{r}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="What to eat" sub={`${DAILY.kcal} kcal · ${DAILY.proteinG} g protein · vegetarian, no eggs`}>
        <div className="space-y-3 text-sm leading-relaxed text-slate-400">
          <p>
            Your maintenance is roughly {DAILY.kcal + 600} kcal a day. Eating {DAILY.kcal} puts you
            about 600 under, which is the {LOSS_RATE_KG_PER_WEEK} kg a week. Protein at{' '}
            {DAILY.proteinG} g is the number that decides whether the weight you lose is fat or
            muscle — it is the one thing worth being strict about.
          </p>
          <p>
            The vegetarian trap is that protein does not show up by accident. Stack it first: pick
            four from curd, paneer, soya, whey, tofu, dal, besan, and you are at 160 g before you
            think about anything else. The Kitchen tab has twelve measured recipes and the techniques
            that make them work.
          </p>
        </div>
      </Card>

      <Card title="What to expect, month by month">
        <ul className="space-y-3 text-sm leading-relaxed text-slate-400">
          {[
            ['Weeks 1–2', 'Fast scale drop — 2–3 kg, mostly water and gut content. Do not get attached to it. Lifts feel awkward while you calibrate loads.'],
            ['Weeks 3–6', 'The real rate settles to about 0.6 kg/week. Lifts climb fast — this is where beginners make their biggest strength jumps. Clothes start fitting differently before the mirror shows anything.'],
            ['Weeks 7–12', 'The grind. Scale movement is slower and less linear. This is exactly where the tape measure and the photos matter, because the scale will lie to you for a fortnight at a time.'],
            ['Weeks 13–18', 'Around 85 kg the shape change becomes obvious to other people. Pull-ups become possible. Consider adding the interval session.'],
          ].map(([k, v]) => (
            <li key={k}>
              <span className="font-semibold text-slate-200">{k}</span> — {v}
            </li>
          ))}
        </ul>
      </Card>

      <DataPanel />
    </div>
  )
}
