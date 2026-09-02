// ---------------------------------------------------------------------------
// Service promotion, earned rather than broadcast.
//
// Each card leads with the customer's own number — "9 points under the DC BEPS
// Cycle 1 standard" — and only then names the service. Nothing appears here
// that the building's data does not justify, and nothing appears that the
// customer's tier already includes. That restraint is what keeps this screen
// worth opening.
// ---------------------------------------------------------------------------

import type { PenaltyEstimate, Recommendation } from '@hbs/shared'
import { penaltyText } from '../lib/format'
import { EmptyState, ProvisionalNotice } from './primitives'

export function Recommendations({
  recommendations,
  buildingName,
  penalty,
}: {
  recommendations: Recommendation[]
  buildingName: string
  /**
   * The assessment's own estimate, passed through rather than re-derived from
   * `potentialValue`. A bare number loses the verified flag, and quoting an
   * unverified placeholder as a precise figure here while every other surface
   * shows a range is exactly the inconsistency that makes a customer stop
   * believing all of them.
   */
  penalty: PenaltyEstimate | null
}): JSX.Element {
  if (recommendations.length === 0) {
    return (
      <EmptyState
        title={`Nothing to recommend for ${buildingName} right now.`}
        detail="It is meeting its standard with margin and its data is current. We will flag something here if that changes."
      />
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-forest-800/70">
        These are suggested because of what {buildingName}&apos;s own numbers show — not because
        everyone gets them.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {recommendations.map(({ offering, reason, potentialValue }) => (
          <div key={offering.id} className="card card-pad flex flex-col">
            <div className="rounded-md bg-cream-100 px-3 py-2 text-sm text-forest-800">
              <span className="font-semibold">Why this: </span>
              {reason}
            </div>

            <h3 className="mt-3 text-base font-semibold text-forest-900">{offering.name}</h3>
            <p className="mt-1 flex-1 text-sm text-forest-800/80">{offering.summary}</p>

            {potentialValue !== null && potentialValue > 0 && (
              <p className="mt-3 text-sm text-forest-800">
                Against an estimated{' '}
                <strong className="tabular text-red-800">{penaltyText(penalty)}</strong> of penalty
                exposure.
              </p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <a
                className="btn-copper"
                href={`mailto:benchmarking@hbssolutions.example?subject=${encodeURIComponent(
                  `${offering.name} — ${buildingName}`,
                )}`}
              >
                {offering.ctaLabel}
              </a>
              {offering.learnMoreUrl && (
                <a
                  className="btn-secondary"
                  href={offering.learnMoreUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Learn more
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <ProvisionalNotice penalty={penalty} />
    </div>
  )
}
