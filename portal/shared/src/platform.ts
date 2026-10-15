// ---------------------------------------------------------------------------
// The platform layer: what makes this a product organizations sign up for
// rather than an internal tool with a login screen.
//
// Plans are defined here, in the shared package, because both sides need them:
// the server enforces the limits and the browser explains them. A limit that
// existed only on the server would surface to a customer as an unexplained
// error the moment they crossed it.
// ---------------------------------------------------------------------------

import type { ServiceTier } from './types.js'

// --- Plans ----------------------------------------------------------------

export type PlanStatus = 'trialing' | 'active' | 'past_due' | 'canceled'

export interface Plan {
  id: ServiceTier
  name: string
  /** One line a prospective customer reads before the feature list. */
  pitch: string
  /** USD per month. Null means "talk to us" — the managed tier is scoped. */
  monthlyPrice: number | null
  /** Per-building monthly component, where the plan charges that way. */
  perBuildingPrice: number | null
  limits: PlanLimits
  features: string[]
  /** Shown against the plan the customer is on today. */
  highlight?: string
}

export interface PlanLimits {
  /** null means no limit. */
  maxBuildings: number | null
  maxUsers: number | null
  /** Whether the org may connect its own ESPM account rather than sharing HBS's. */
  ownEspmConnection: boolean
  /** Whether the portal pushes data back to ESPM for this plan. */
  twoWaySync: boolean
  /** Automated anomaly and deadline monitoring. */
  monitoring: boolean
  /** Scheduled report generation rather than on-demand only. */
  scheduledReports: boolean
}

export const PLANS: Plan[] = [
  {
    id: 'benchmarking',
    name: 'Benchmarking',
    pitch: 'Keep your ENERGY STAR record complete and see where every building stands.',
    monthlyPrice: 0,
    perBuildingPrice: 12,
    limits: {
      maxBuildings: 5,
      maxUsers: 3,
      ownEspmConnection: false,
      twoWaySync: false,
      monitoring: false,
      scheduledReports: false,
    },
    features: [
      'Portfolio and building dashboards',
      'BEPS standing and penalty exposure',
      'Historical trends and targets',
      'On-demand reports',
      'Data shared from the HBS Portfolio Manager account',
    ],
  },
  {
    id: 'compliance',
    name: 'Compliance',
    pitch: 'Two-way Portfolio Manager sync, monitoring, and the deadlines handled.',
    monthlyPrice: 450,
    perBuildingPrice: 9,
    limits: {
      maxBuildings: 40,
      maxUsers: 15,
      ownEspmConnection: true,
      twoWaySync: true,
      monitoring: true,
      scheduledReports: true,
    },
    features: [
      'Everything in Benchmarking',
      'Enter data in the portal, pushed back to Portfolio Manager',
      'Connect your own Portfolio Manager account',
      'Anomaly and usage-spike monitoring',
      'Scheduled reports and deadline alerts',
      'Conversations mirrored to your inbox',
    ],
    highlight: 'Most portfolios start here',
  },
  {
    id: 'managed',
    name: 'Managed',
    pitch: 'We run the compliance programme — pathway selection, filing, and the work behind it.',
    monthlyPrice: null,
    perBuildingPrice: null,
    limits: {
      maxBuildings: null,
      maxUsers: null,
      ownEspmConnection: true,
      twoWaySync: true,
      monitoring: true,
      scheduledReports: true,
    },
    features: [
      'Everything in Compliance',
      'HBS manages your benchmarking data end to end',
      'Compliance pathway modelling and filing',
      'BAS optimization and sequence review included',
      'Named engineer and quarterly review',
    ],
  },
]

export function planFor(tier: ServiceTier): Plan {
  return PLANS.find((p) => p.id === tier) ?? PLANS[0]!
}

/** What an organization is using against what its plan allows. */
export interface PlanUsage {
  plan: Plan
  status: PlanStatus
  trialEndsAt: string | null
  buildings: number
  users: number
  /** Limits the organization is at or over, phrased for a human. */
  exceeded: string[]
}

/**
 * Whether a capability is available, and if not, why — so the UI can explain
 * rather than just disable. Every gated action goes through this.
 */
export function planAllows(plan: Plan, capability: keyof PlanLimits): boolean {
  const value = plan.limits[capability]
  return typeof value === 'boolean' ? value : true
}

// --- Organization profile -------------------------------------------------

/**
 * The tenant-facing settings an organization's own admin controls. Branding is
 * deliberately narrow — an accent colour and a short mark — because a portal
 * that lets tenants supply arbitrary CSS or images becomes an XSS surface and
 * a support burden at the same time.
 */
export interface OrganizationProfile {
  id: string
  name: string
  slug: string
  billingEmail: string | null
  tier: ServiceTier
  planStatus: PlanStatus
  trialEndsAt: string | null
  accentColor: string
  /** 1–3 characters shown in the portal's mark. */
  logoMark: string | null
  onboardingCompletedAt: string | null
  createdAt: string
}

// --- Invitations ----------------------------------------------------------

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface Invitation {
  id: string
  organizationId: string
  email: string
  role: 'customer_admin' | 'customer_viewer'
  state: InvitationState
  invitedByName: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
  /**
   * Present only in the response to creating the invitation — the one moment
   * the raw token exists outside the email. Never returned by a list.
   */
  inviteUrl?: string
}

// --- Audit ----------------------------------------------------------------

export interface AuditEvent {
  id: string
  organizationId: string | null
  actorLabel: string
  action: string
  targetType: string | null
  targetLabel: string | null
  detail: string | null
  createdAt: string
}

// --- Onboarding -----------------------------------------------------------

/**
 * The checklist a new organization works through. Computed from real state
 * rather than stored flags, so it cannot claim a step is done when it is not.
 */
export interface OnboardingStep {
  id: 'account' | 'connect-espm' | 'buildings' | 'jurisdictions' | 'invite'
  title: string
  detail: string
  done: boolean
  /** Where to go to do it. */
  action: { label: string; to: string } | null
}

export interface OnboardingState {
  steps: OnboardingStep[]
  complete: boolean
  completedCount: number
}
