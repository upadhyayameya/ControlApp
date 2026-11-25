// ---------------------------------------------------------------------------
// Service offerings and the rules that surface them.
//
// The pitch only ever appears when the building's own numbers justify it, and
// never for something the customer's tier already includes. A recommendation
// carries the sentence that earned it — "you are 14 points under the Office
// standard" — so the portal reads as advice rather than advertising.
// ---------------------------------------------------------------------------

import type {
  ComplianceAssessment,
  Recommendation,
  ServiceOffering,
  ServiceTier,
} from './types.js'
import { metricLabel, metricUnit } from './beps/engine.js'

export const OFFERINGS: ServiceOffering[] = [
  {
    id: 'utility-tune-up',
    name: 'Utility-Funded Retro-Commissioning',
    summary:
      'A funded existing-building tune-up: we survey the systems, correct sequences and setpoints, and document the savings. Typically recovers 8–15% of site energy with little or no capital outlay.',
    includedInTiers: [],
    trigger: { kind: 'eui-above-target', minGapPct: 5 },
    ctaLabel: 'Check program eligibility',
    learnMoreUrl: null,
  },
  {
    id: 'bas-optimization',
    name: 'BAS Optimization & Sequence Review',
    summary:
      'Our controls team reviews your building automation sequences — resets, schedules, staging, economizer operation — and implements the corrections. The fastest lever when a building is close to the standard.',
    includedInTiers: ['managed'],
    trigger: { kind: 'eui-above-target', minGapPct: 2 },
    ctaLabel: 'Request a sequence review',
    learnMoreUrl: null,
  },
  {
    id: 'deep-retrofit-study',
    name: 'Capital Retrofit Study',
    summary:
      'An engineered path to the standard: measure list, capital cost, projected EUI after each measure, and the payback against your penalty exposure. The right first step when the gap is too large to control your way out of.',
    includedInTiers: [],
    trigger: { kind: 'eui-above-target', minGapPct: 20 },
    ctaLabel: 'Scope a retrofit study',
    learnMoreUrl: null,
  },
  {
    id: 'espm-data-management',
    name: 'Benchmarking Data Management',
    summary:
      'We take over meter data entry, chase down missing bills, and keep your ESPM record complete and audit-ready ahead of every reporting deadline.',
    includedInTiers: ['compliance', 'managed'],
    trigger: { kind: 'missing-data' },
    ctaLabel: 'Hand off data management',
    learnMoreUrl: null,
  },
  {
    id: 'compliance-pathway-filing',
    name: 'Compliance Pathway Selection & Filing',
    summary:
      'We model the performance, prescriptive and standard-target pathways against your building, recommend the cheapest route to compliance, and file it.',
    includedInTiers: ['managed'],
    trigger: { kind: 'penalty-exposure', minAmount: 50_000 },
    ctaLabel: 'Model my pathways',
    learnMoreUrl: null,
  },
  {
    id: 'ghg-reduction-plan',
    name: 'Decarbonization Roadmap',
    summary:
      'A phased electrification and load-reduction plan sized to your emissions gap, sequenced around equipment end-of-life so you replace things once.',
    includedInTiers: [],
    trigger: { kind: 'ghg-above-target', minGapPct: 10 },
    ctaLabel: 'Build a roadmap',
    learnMoreUrl: null,
  },
]

/**
 * Rank the offerings worth showing for one building.
 *
 * Ordering is by what is at stake: an offering tied to real penalty exposure
 * outranks a generic one, so the top of the list is always the thing that
 * saves the most money.
 */
export function recommendationsFor(
  assessment: ComplianceAssessment,
  tier: ServiceTier,
  hasMissingData: boolean,
): Recommendation[] {
  const out: Recommendation[] = []

  for (const offering of OFFERINGS) {
    if (offering.includedInTiers.includes(tier)) continue
    const reason = evaluateTrigger(offering, assessment, hasMissingData)
    if (reason === null) continue
    out.push({
      offering,
      buildingId: assessment.buildingId,
      reason,
      potentialValue: assessment.estimatedPenalty?.amount ?? null,
    })
  }

  return out.sort((a, b) => (b.potentialValue ?? 0) - (a.potentialValue ?? 0))
}

function evaluateTrigger(
  offering: ServiceOffering,
  a: ComplianceAssessment,
  hasMissingData: boolean,
): string | null {
  const t = offering.trigger
  switch (t.kind) {
    case 'always':
      return 'Available to every building in your portfolio.'

    case 'missing-data':
      if (!hasMissingData && a.status !== 'insufficient-data') return null
      return 'This building is missing energy data, which puts its benchmarking submission at risk.'

    case 'penalty-exposure': {
      const amount = a.estimatedPenalty?.amount
      if (amount === undefined || amount < t.minAmount) return null
      return `Estimated exposure of ${usd(amount)} by ${year(a.complianceDate)} — worth modelling the cheaper pathway.`
    }

    case 'score-below-target': {
      if (a.metric !== 'energy-star-score' || a.gap === null || a.gap < t.minGapPoints) return null
      return `${round(a.gap)} points under the ${a.cycleLabel} standard of ${a.targetValue}.`
    }

    case 'eui-above-target': {
      if (a.gap === null || a.gap <= 0) return null
      const pct = gapPct(a)
      if (pct === null || pct < t.minGapPct) return null
      // An ENERGY STAR score gap is an energy gap too — read it in its own units.
      return a.metric === 'energy-star-score'
        ? `${round(a.gap)} points under the ${a.cycleLabel} standard — roughly ${round(pct)}% short.`
        : `${metricLabel(a.metric)} is ${round(a.gap)} ${metricUnit(a.metric)} over the ${
            a.cycleLabel
          } target of ${a.targetValue}, about ${round(pct)}% short.`
    }

    case 'ghg-above-target': {
      if (a.metric !== 'ghg-intensity' || a.gap === null || a.gap <= 0) return null
      const pct = gapPct(a)
      if (pct === null || pct < t.minGapPct) return null
      return `Emissions intensity is about ${round(pct)}% above the ${a.cycleLabel} target.`
    }
  }
}

function gapPct(a: ComplianceAssessment): number | null {
  if (a.gap === null || a.targetValue === null || a.targetValue === 0) return null
  return (a.gap / Math.abs(a.targetValue)) * 100
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}

function year(isoDate: string): string {
  return isoDate.slice(0, 4)
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}
