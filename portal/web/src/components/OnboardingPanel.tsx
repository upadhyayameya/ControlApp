// ---------------------------------------------------------------------------
// The onboarding checklist.
//
// Numbered, because these steps genuinely are a sequence — you cannot confirm
// jurisdictions before you have buildings, and you cannot have buildings
// before a connection. Numbering that encodes nothing would be decoration;
// here it encodes a real dependency order.
//
// Every step's state is computed server-side from actual data, so this cannot
// claim something is done when it is not.
// ---------------------------------------------------------------------------

import { Link } from 'react-router-dom'
import type { OnboardingState } from '@hbs/shared'

export function OnboardingPanel({ onboarding }: { onboarding: OnboardingState }): JSX.Element {
  const total = onboarding.steps.length
  return (
    <section className="panel panel-pad">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Getting set up</p>
          <h2 className="mt-1 font-display text-h3 text-ink">
            {onboarding.completedCount} of {total} done
          </h2>
        </div>
        <div className="track h-1 w-40">
          <div
            className="h-full bg-ink transition-[width] duration-700 ease-instrument"
            style={{ width: `${(onboarding.completedCount / total) * 100}%` }}
          />
        </div>
      </header>

      <ol className="mt-4 divide-y divide-line border-t border-line">
        {onboarding.steps.map((step, i) => (
          <li key={step.id} className="flex items-start gap-3 py-3">
            <span
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm font-mono text-micro ${
                step.done ? 'bg-good text-white' : 'border border-line-strong text-ink-3'
              }`}
              aria-hidden
            >
              {step.done ? '✓' : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-base ${step.done ? 'text-ink-3 line-through' : 'font-medium text-ink'}`}>
                {step.title}
              </p>
              <p className="mt-0.5 text-tiny text-ink-3">{step.detail}</p>
            </div>
            {!step.done && step.action && (
              <Link to={step.action.to} className="btn-secondary btn-sm shrink-0">
                {step.action.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
