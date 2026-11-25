// ---------------------------------------------------------------------------
// The threshold instrument — the product's signature element.
//
// BEPS reduces to one fact: there is a line, and a building sits above or
// below it. The awkward part is that the two metrics run in opposite
// directions — an ENERGY STAR score is a floor you must climb to, a site EUI
// is a ceiling you must stay under. Drawing them as two different charts would
// make a mixed portfolio unreadable.
//
// So the track is normalised: the standard always sits at the same position,
// and the bar always grows rightward toward it. Further right is always
// better, whichever metric is being measured. Once a customer learns to read
// one building they can read all of them.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react'
import type { ComplianceAssessment, ComplianceStatus } from '@hbs/shared'
import { metricLabel, metricUnit } from '@hbs/shared'
import { num } from '../lib/format'

/** Where the standard sits along the track, leaving room to overshoot. */
const TARGET_AT = 64

export function statusTone(status: ComplianceStatus | undefined): {
  bar: string
  text: string
  chip: string
  label: string
} {
  switch (status) {
    case 'compliant':
      return { bar: 'bg-good', text: 'text-good', chip: 'chip-good', label: 'Meeting standard' }
    case 'at-risk':
      return { bar: 'bg-warn', text: 'text-warn', chip: 'chip-warn', label: 'At risk' }
    case 'non-compliant':
      return { bar: 'bg-bad', text: 'text-bad', chip: 'chip-bad', label: 'Below standard' }
    case 'exempt':
      return { bar: 'bg-inert', text: 'text-ink-3', chip: 'chip-inert', label: 'Not covered' }
    default:
      return { bar: 'bg-inert', text: 'text-ink-3', chip: 'chip-inert', label: 'Data needed' }
  }
}

/**
 * Bar length as a percentage of the track, oriented so the standard always
 * lands at TARGET_AT and fuller always means better.
 */
export function trackFill(assessment: ComplianceAssessment): number {
  const { currentValue, targetValue, metric } = assessment
  if (currentValue === null || targetValue === null || targetValue === 0 || currentValue === 0) {
    return 0
  }
  const ratio =
    metric === 'energy-star-score'
      ? currentValue / targetValue // a floor: at target ⇒ 1
      : targetValue / currentValue // a ceiling: inverted so at target ⇒ 1 too
  // Clamped so a badly failing building still shows a readable sliver rather
  // than an empty track that looks like missing data.
  return Math.max(2.5, Math.min(100, ratio * TARGET_AT))
}

/** Grows to its reading once on mount, then holds still. */
function useGrow(to: number): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(to))
    return () => cancelAnimationFrame(frame)
  }, [to])
  return width
}

export function ThresholdTrack({
  assessment,
  height = 'h-2',
  showTargetLabel = false,
}: {
  assessment: ComplianceAssessment
  height?: string
  showTargetLabel?: boolean
}): JSX.Element {
  const fill = trackFill(assessment)
  const width = useGrow(fill)
  const tone = statusTone(assessment.status)
  const hasReading = assessment.currentValue !== null && assessment.targetValue !== null

  return (
    <div className="w-full">
      <div className={`track ${height}`}>
        {/* The compliant side of the line, tinted so the goal reads as a
            region rather than a single pixel. */}
        <div
          className="absolute inset-y-0 bg-good/[0.16]"
          style={{ left: `${TARGET_AT}%`, right: 0 }}
          aria-hidden
        />
        {hasReading && (
          <div
            className={`h-full ${tone.bar} transition-[width] duration-700 ease-instrument`}
            style={{ width: `${width}%` }}
          />
        )}
        <div className="tick" style={{ left: `${TARGET_AT}%` }} aria-hidden />
      </div>

      {showTargetLabel && assessment.targetValue !== null && (
        <div className="relative mt-1 h-4">
          <span
            className="absolute -translate-x-1/2 font-mono text-micro uppercase text-ink-3"
            style={{ left: `${TARGET_AT}%` }}
          >
            standard {num(assessment.targetValue)}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * The full instrument: the reading, the standard, the distance between them,
 * and what that distance costs. This is the first thing on a building page and
 * it is meant to answer the whole question before anything is scrolled.
 */
export function ThresholdBand({
  assessment,
}: {
  assessment: ComplianceAssessment
}): JSX.Element {
  const tone = statusTone(assessment.status)
  const hasReading = assessment.currentValue !== null && assessment.targetValue !== null
  const higherIsBetter = assessment.metric === 'energy-star-score'

  return (
    <section className="panel panel-pad rise">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{assessment.cycleLabel}</p>
          <h2 className="mt-1 text-h2 text-ink">{tone.label}</h2>
        </div>
        <span className={tone.chip}>{metricLabel(assessment.metric)}</span>
      </header>

      {hasReading ? (
        <>
          <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="eyebrow">Current</p>
              <p className={`figure mt-1 ${tone.text}`}>{num(assessment.currentValue)}</p>
              <p className="mt-0.5 font-mono text-tiny text-ink-3">
                {metricUnit(assessment.metric)}
              </p>
            </div>
            <div className="pb-1">
              <p className="eyebrow">Standard</p>
              <p className="measure mt-1 text-h2 text-ink-2">{num(assessment.targetValue)}</p>
            </div>
            <div className="pb-1">
              <p className="eyebrow">Due</p>
              <p className="measure mt-1 text-h3 text-ink-2">{assessment.complianceDate}</p>
            </div>
          </div>

          <div className="mt-5">
            <ThresholdTrack assessment={assessment} height="h-3" showTargetLabel />
          </div>

          <p className="mt-4 text-body text-ink-2">
            <GapSentence assessment={assessment} />{' '}
            <span className="text-ink-3">
              {higherIsBetter ? 'Higher is better.' : 'Lower is better.'}
            </span>
          </p>
        </>
      ) : (
        <p className="mt-5 text-body text-ink-2">
          {assessment.notes[0] ?? 'Not enough data to place this building against a standard yet.'}
        </p>
      )}
    </section>
  )
}

function GapSentence({ assessment }: { assessment: ComplianceAssessment }): JSX.Element | null {
  const { gap, metric } = assessment
  if (gap === null) return null
  const magnitude = num(Math.abs(gap))
  const unit = metricUnit(metric)

  return gap > 0 ? (
    <span className="text-ink">
      Short of the standard by{' '}
      <strong className="measure font-semibold text-bad">
        {magnitude} {unit}
      </strong>
      .
    </span>
  ) : (
    <span className="text-ink">
      Clearing the standard by{' '}
      <strong className="measure font-semibold text-good">
        {magnitude} {unit}
      </strong>
      .
    </span>
  )
}
