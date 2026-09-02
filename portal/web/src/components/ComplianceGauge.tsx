// ---------------------------------------------------------------------------
// "Where do I stand against BEPS?" — the answer, in one glance.
//
// The hard part is that the two metrics run in opposite directions: an ENERGY
// STAR score is a target you must reach from below, a site EUI is a ceiling
// you must stay under. Rather than draw two different charts, the bar is
// always oriented so that *fuller is better* and the target sits at a fixed
// position on the track. A customer with a mixed portfolio then reads every
// building the same way.
// ---------------------------------------------------------------------------

import type { ComplianceAssessment } from '@hbs/shared'
import { metricLabel, metricUnit } from '@hbs/shared'
import { num, penaltyText, relativeDays, statusLabel } from '../lib/format'
import { ProvisionalNotice, StatusBadge } from './primitives'

/** Where the target sits along the track. Leaves room to overshoot on the right. */
const TARGET_POSITION_PCT = 70

export function ComplianceGauge({
  assessment,
}: {
  assessment: ComplianceAssessment
}): JSX.Element {
  const { currentValue, targetValue, status } = assessment
  const higherIsBetter = assessment.metric === 'energy-star-score'

  const fillPct = trackFill(assessment)
  const barColor =
    status === 'compliant'
      ? 'bg-forest-500'
      : status === 'at-risk'
        ? 'bg-copper-400'
        : 'bg-red-600'

  return (
    <div className="card card-pad">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="label">{assessment.cycleLabel}</div>
          <h3 className="mt-0.5 text-lg font-semibold text-forest-900">
            {statusLabel(status)}
          </h3>
          <p className="text-sm text-forest-800/70">
            Compliance date {assessment.complianceDate} ({relativeDays(assessment.complianceDate)})
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {currentValue !== null && targetValue !== null ? (
        <>
          <div className="mt-5">
            <div className="mb-1.5 flex items-baseline justify-between text-sm">
              <span className="font-medium text-forest-800">{metricLabel(assessment.metric)}</span>
              <span className="tabular text-forest-800/70">
                {higherIsBetter ? 'higher is better' : 'lower is better'}
              </span>
            </div>

            {/* The track. The target marker is at a fixed position; the bar
                length encodes how close the building is to it. */}
            <div className="relative h-8 overflow-hidden rounded-md bg-cream-100">
              <div
                className={`h-full transition-all duration-500 ${barColor}`}
                style={{ width: `${fillPct}%` }}
              />
              <div
                className="absolute inset-y-0 border-l-2 border-dashed border-forest-800"
                style={{ left: `${TARGET_POSITION_PCT}%` }}
                aria-hidden
              />
              <div
                className="absolute -top-0.5 translate-x-1 text-[10px] font-semibold text-forest-800"
                style={{ left: `${TARGET_POSITION_PCT}%` }}
              >
                target
              </div>
            </div>

            <div className="mt-2 flex items-baseline justify-between">
              <div>
                <span className="tabular text-2xl font-semibold text-forest-900">
                  {num(currentValue)}
                </span>
                <span className="ml-1 text-sm text-forest-800/60">
                  {metricUnit(assessment.metric)}
                </span>
              </div>
              <div className="text-right text-sm text-forest-800/70">
                target{' '}
                <span className="tabular font-semibold text-forest-900">{num(targetValue)}</span>
              </div>
            </div>
          </div>

          <GapSentence assessment={assessment} />
        </>
      ) : (
        <p className="mt-4 text-sm text-forest-800/70">
          {assessment.notes[0] ?? 'Not enough data to assess this building yet.'}
        </p>
      )}

      {assessment.estimatedPenalty && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <div className="label text-red-800/80">Estimated penalty exposure</div>
          <div className="tabular mt-0.5 text-xl font-semibold text-red-800">
            {penaltyText(assessment.estimatedPenalty)}
          </div>
          <p className="mt-1 text-xs text-red-800/80">{assessment.estimatedPenalty.basis}</p>
        </div>
      )}

      <ProvisionalNotice penalty={assessment.estimatedPenalty} className="mt-3" />

      {assessment.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-forest-800/60">
          {assessment.notes.map((note) => (
            <li key={note}>· {note}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The plain-English version of the bar, which is what people actually read. */
function GapSentence({ assessment }: { assessment: ComplianceAssessment }): JSX.Element | null {
  const { gap, metric } = assessment
  if (gap === null) return null
  const unit = metricUnit(metric)
  const magnitude = num(Math.abs(gap))

  if (gap > 0) {
    return (
      <p className="mt-3 text-sm text-red-800">
        Short of the standard by <strong className="tabular">{magnitude}</strong> {unit}.
      </p>
    )
  }
  return (
    <p className="mt-3 text-sm text-forest-700">
      Clearing the standard by <strong className="tabular">{magnitude}</strong> {unit}.
    </p>
  )
}

/**
 * Bar length as a percentage of the track.
 *
 * Normalised so the target always lands at TARGET_POSITION_PCT regardless of
 * which direction the metric runs, and clamped so a wildly non-compliant
 * building still shows a visible sliver rather than an empty track.
 */
function trackFill(assessment: ComplianceAssessment): number {
  const { currentValue, targetValue, metric } = assessment
  if (currentValue === null || targetValue === null || targetValue === 0) return 0

  const ratio =
    metric === 'energy-star-score'
      ? currentValue / targetValue // higher is better: 1.0 means exactly at target
      : targetValue / currentValue // lower is better: invert so 1.0 still means at target

  return Math.max(3, Math.min(100, ratio * TARGET_POSITION_PCT))
}
