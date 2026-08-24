import { useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { useStore } from '../state/store'
import { PROFILE, targetWeightOn, bmi } from '../data/profile'
import { todayISO, prettyDate } from '../lib/date'
import { movingAverage, trendPerWeek } from '../lib/calc'
import { Card, Empty, Stat } from './ui'

export default function WeightPage() {
  const { weights, logWeight, removeWeight } = useStore()
  const [date, setDate] = useState(todayISO())
  const [kg, setKg] = useState('')

  const series = movingAverage(weights).map((p) => ({
    ...p,
    target: Number(targetWeightOn(p.date).toFixed(1)),
    label: prettyDate(p.date),
  }))

  const first = weights[0]?.kg ?? PROFILE.startWeightKg
  const last = weights[weights.length - 1]?.kg ?? PROFILE.startWeightKg
  const lost = first - last
  const rate = trendPerWeek(weights)
  const toGo = last - PROFILE.targetWeightKg

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-100">Weight</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Current" value={last.toFixed(1)} unit="kg" tone="accent" />
        <Stat
          label="Lost so far"
          value={lost >= 0 ? lost.toFixed(1) : `+${Math.abs(lost).toFixed(1)}`}
          unit="kg"
          tone={lost > 0 ? 'good' : 'default'}
        />
        <Stat label="To target" value={toGo.toFixed(1)} unit="kg" hint={`${PROFILE.targetWeightKg} kg by 31 Dec`} />
        <Stat label="BMI" value={bmi(last).toFixed(1)} hint="Healthy is under 25" />
      </div>

      <Card title="Log a weigh-in" sub="Same time, same conditions, every day.">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const value = Number(kg)
            if (Number.isFinite(value) && value > 20 && value < 300) {
              logWeight(date, value)
              setKg('')
            }
          }}
        >
          <input
            className="field flex-1 basis-40"
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            className="field flex-1 basis-32"
            type="number"
            step="0.1"
            inputMode="decimal"
            placeholder="kg"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
          />
          <button className="btn-primary" type="submit">
            Save
          </button>
        </form>
      </Card>

      <Card
        title="Trend"
        sub={
          rate === null
            ? 'Four days of data and the trend line appears.'
            : `Moving ${rate > 0 ? '+' : ''}${rate.toFixed(2)} kg/week. The plan wants −0.6.`
        }
      >
        {series.length < 2 ? (
          <Empty>Log a few days and the chart fills in.</Empty>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#232c38" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis
                  domain={['dataMin - 1', 'dataMax + 1']}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: '#161b22',
                    border: '1px solid #232c38',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#94a3b8' }}
                />
                <ReferenceLine
                  y={PROFILE.targetWeightKg}
                  stroke="#22c55e"
                  strokeDasharray="4 4"
                  label={{ value: 'target', fill: '#22c55e', fontSize: 10, position: 'insideBottomRight' }}
                />
                <Line type="monotone" dataKey="kg" name="Daily" stroke="#475569" dot={false} strokeWidth={1} />
                <Line type="monotone" dataKey="trend" name="7-day trend" stroke="#f97316" dot={false} strokeWidth={2.5} />
                <Line type="monotone" dataKey="target" name="Plan" stroke="#3b82f6" dot={false} strokeWidth={1} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          The grey line is what the scale says — it swings 1–2 kg on water, salt and sleep alone.
          The orange line is the 7-day average and the only one worth reacting to. Blue is the plan.
        </p>
      </Card>

      <Card title="History" right={<span className="text-xs text-slate-500">{weights.length} entries</span>}>
        {weights.length === 0 ? (
          <Empty>Nothing logged yet.</Empty>
        ) : (
          <ul className="divide-y divide-ink-line">
            {[...weights].reverse().map((w) => (
              <li key={w.date} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-400">{prettyDate(w.date)}</span>
                <span className="flex items-center gap-3">
                  <span className="tabular-nums text-slate-100">{w.kg.toFixed(1)} kg</span>
                  <button
                    className="text-xs text-slate-600 hover:text-bad"
                    onClick={() => removeWeight(w.date)}
                    aria-label={`Delete entry for ${w.date}`}
                  >
                    delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
