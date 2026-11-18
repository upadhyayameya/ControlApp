// ---------------------------------------------------------------------------
// "Four points short" → what that actually takes.
//
// The compliance band above this says the building is below standard and by
// how much, in the units the regulation uses. Nobody can act on that. This
// says how much energy has to come out, what it is worth a year against what
// the shortfall costs, and whether the building is on course to get there
// without doing anything — which is a real possibility and worth knowing
// before spending money.
//
// Every figure here is derived from the building's own data: the published
// standard, what ESPM computed, and rates fitted from its own bills. Where a
// figure rests on an approximation, the approximation is printed next to it
// rather than in a footnote, because this is the panel someone will quote.
// ---------------------------------------------------------------------------

import type { GapAnalysis, PenaltyEstimate } from '@hbs/shared'
import { int, num, usd, usdCompact } from '../lib/format'
import { SectionHead } from './primitives'

function plural(n: number, one: string, many: string): string {
  return `${int(n)} ${Math.abs(n) === 1 ? one : many}`
}

export function GapToStandard({
  gap,
  penalty,
  metricLabel,
}: {
  gap: GapAnalysis
  penalty: PenaltyEstimate | null
  /** "points" or "kBtu/ft²", for the trajectory sentence. */
  metricLabel: string
}): JSX.Element | null {
  const { reduction, trajectory } = gap

  // Nothing to say when the building is meeting its standard and no trend is
  // worth reporting. An empty panel is worse than no panel.
  if (!reduction && !trajectory) return null

  return (
    <section className="panel panel-pad">
      <SectionHead
        title="What closing the gap takes"
        detail="sized from this building's own data"
      />

      <Deadline gap={gap} />

      {reduction && (
        <div className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <div className="rule">
            <p className="eyebrow">Energy to remove</p>
            <p className="font-display text-h1 tab mt-1.5 text-ink">
              {num(reduction.reductionPct * 100, 1)}%
            </p>
            <p className="mt-1 text-tiny text-ink-3">
              {reduction.reductionKbtu !== null
                ? `about ${int(reduction.reductionKbtu)} kBtu a year`
                : 'annual energy not known, so this is a rate not a quantity'}
            </p>
            <p className="mt-2 text-base text-ink-2">
              {num(reduction.fromValue, 1)} → {num(reduction.toValue, 1)} {reduction.unit}
            </p>
          </div>

          <div className="rule">
            <p className="eyebrow">Worth each year</p>
            <p className="font-display text-h1 tab mt-1.5 text-ink">
              {gap.annualSavingUsd !== null ? usdCompact(gap.annualSavingUsd) : '—'}
            </p>
            <p className="mt-1 text-tiny text-ink-3">
              {gap.savingBasis ?? 'no rate could be fitted from this building’s bills'}
            </p>
            {penalty && gap.annualSavingUsd !== null && gap.annualSavingUsd > 0 && (
              <p className="mt-2 max-w-prose text-base text-ink-2">
                The exposure for not closing it is {usd(penalty.low)}–{usd(penalty.high)}: about{' '}
                {plural(Math.round(penalty.amount / gap.annualSavingUsd), 'year', 'years')} of that
                saving.{' '}
                {penalty.amount / gap.annualSavingUsd >= 8 ? (
                  <span className="text-ink">
                    The case for acting here is the standard, not the utility bill — energy savings
                    alone would take decades to justify the work.
                  </span>
                ) : (
                  <span className="text-ink">
                    The energy saving alone goes a long way towards justifying the work, before the
                    standard is considered at all.
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {trajectory && (
        <div className="mt-5 rule">
          <p className="eyebrow">On current trajectory</p>
          <p className="mt-1.5 max-w-prose text-base text-ink-2">
            {trajectory.improving ? (
              <>
                Moving {num(Math.abs(trajectory.perYear), 1)} {metricLabel} a year in the right
                direction across {trajectory.firstYear}–{trajectory.lastYear}.{' '}
                {trajectory.arrivesInTime ? (
                  <span className="text-ink">
                    At this rate the building reaches the standard before the deadline without
                    further work — worth confirming before committing capital.
                  </span>
                ) : (
                  <span className="text-ink">
                    At this rate it reaches {num(trajectory.projectedAtDeadline, 1)} by the
                    deadline, still short. The trend alone does not close this.
                  </span>
                )}
              </>
            ) : (
              <>
                Moving {num(Math.abs(trajectory.perYear), 1)} {metricLabel} a year the{' '}
                <span className="text-ink">wrong</span> way across {trajectory.firstYear}–
                {trajectory.lastYear}, reaching {num(trajectory.projectedAtDeadline, 1)} by the
                deadline. The gap is widening, so a measure has to cover the drift as well as the
                shortfall.
              </>
            )}
          </p>
        </div>
      )}

      {gap.notes.length > 0 && (
        <ul className="mt-5 space-y-1.5 border-t border-line pt-3 text-tiny text-ink-3">
          {gap.notes.map((n) => (
            <li key={n} className="max-w-prose">
              {n}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Time left, in the terms that change behaviour.
 *
 * Under three months the number of days is the point; past that, a date is
 * enough and a day count reads as false urgency.
 */
function Deadline({ gap }: { gap: GapAnalysis }): JSX.Element {
  if (gap.deadlinePassed) {
    return (
      <p className="border-l-2 border-bad bg-bad-soft/40 px-3 py-2 text-base text-ink">
        The compliance date passed {plural(Math.abs(gap.daysToDeadline), 'day', 'days')} ago.
      </p>
    )
  }
  if (gap.daysToDeadline <= 90) {
    return (
      <p className="border-l-2 border-warn bg-warn-soft/40 px-3 py-2 text-base text-ink">
        <strong className="font-semibold">
          {plural(gap.daysToDeadline, 'day', 'days')} to the compliance date.
        </strong>{' '}
        Too little time for anything structural; what is left is operational — schedules, setpoints
        and making sure the benchmarking data is complete and correct.
      </p>
    )
  }
  const years = gap.daysToDeadline / 365
  return (
    <p className="text-base text-ink-2">
      {years >= 1
        ? `${num(years, 1)} years to the compliance date`
        : plural(gap.daysToDeadline, 'day', 'days') + ' to the compliance date'}
      {' — '}
      enough time to plan capital work around a normal replacement cycle rather than paying a
      premium for it.
    </p>
  )
}
