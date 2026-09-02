// ---------------------------------------------------------------------------
// Service promotion, earned rather than broadcast.
//
// Each card leads with the customer's own number and only then names the
// service. Nothing appears that the building's data does not justify, and
// nothing appears that their plan already includes. That restraint is the only
// reason this screen is worth opening.
// ---------------------------------------------------------------------------

import type { PenaltyEstimate, Recommendation } from '@hbs/shared'
import { penaltyText } from '../lib/format'
import { Empty, ProvisionalNotice } from './primitives'

export function Recommendations({
  recommendations,
  buildingName,
  penalty,
}: {
  recommendations: Recommendation[]
  buildingName: string
  /**
   * The assessment's own estimate, passed through rather than re-derived from
   * `potentialValue`: a bare number loses the verified flag, and quoting an
   * unverified placeholder as a precise figure here while every other surface
   * shows a range is what makes a customer stop believing all of them.
   */
  penalty: PenaltyEstimate | null
}): JSX.Element {
  if (recommendations.length === 0) {
    return (
      <Empty
        title={`Nothing to recommend for ${buildingName}.`}
        detail="It is meeting its standard with margin and its data is current. We will flag something here if that changes."
      />
    )
  }

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-base text-ink-2">
        Suggested because of what {buildingName}&rsquo;s own numbers show — not because everyone
        gets them.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {recommendations.map(({ offering, reason, potentialValue }) => (
          <article key={offering.id} className="panel flex flex-col">
            <p className="border-b border-line bg-raised/60 px-4 py-2.5 text-base text-ink">
              <span className="eyebrow mr-2">Why this</span>
              {reason}
            </p>
            <div className="flex flex-1 flex-col p-4">
              <h3 className="font-display text-h3 text-ink">{offering.name}</h3>
              <p className="mt-1.5 flex-1 text-base text-ink-2">{offering.summary}</p>

              {potentialValue !== null && potentialValue > 0 && (
                <p className="mt-3 border-t border-line pt-3 text-base text-ink-2">
                  Against an estimated{' '}
                  <strong className="measure font-semibold text-bad">{penaltyText(penalty)}</strong>{' '}
                  of exposure.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  className="btn-primary"
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
          </article>
        ))}
      </div>

      <ProvisionalNotice penalty={penalty} />
    </div>
  )
}
