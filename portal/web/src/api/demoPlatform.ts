// Plan lookup and onboarding-step construction for the demo, mirroring what
// services/tenancy.ts computes on the server so the two cannot disagree about
// what "done" means.
import { PLANS, type OnboardingStep, type Plan, type ServiceTier } from '@hbs/shared'

export function planFor(tier: ServiceTier): Plan {
  return PLANS.find((p) => p.id === tier) ?? PLANS[0]!
}

export function onboardingStepsFrom(state: {
  organizationName: string
  connected: boolean
  buildings: number
  unplaced: number
  members: number
}): OnboardingStep[] {
  return [
    {
      id: 'account',
      title: 'Create your account',
      detail: `${state.organizationName} is set up.`,
      done: true,
      action: null,
    },
    {
      id: 'connect-espm',
      title: 'Connect Portfolio Manager',
      detail: state.connected
        ? 'Connected. Your properties sync from ENERGY STAR.'
        : 'Link your ENERGY STAR account, or share your properties with HBS.',
      done: state.connected,
      action: { label: 'Connect', to: '/settings/connection' },
    },
    {
      id: 'buildings',
      title: 'Bring in your buildings',
      detail:
        state.buildings > 0
          ? `${state.buildings} building${state.buildings === 1 ? '' : 's'} in your portfolio.`
          : 'Nothing to measure yet — sync or add your first property.',
      done: state.buildings > 0,
      action: { label: 'View portfolio', to: '/' },
    },
    {
      id: 'jurisdictions',
      title: 'Confirm which standards apply',
      detail:
        state.buildings === 0
          ? 'Available once you have buildings.'
          : state.unplaced === 0
            ? 'Every building is matched to a BEPS jurisdiction.'
            : `${state.unplaced} building${state.unplaced === 1 ? ' has' : 's have'} no jurisdiction set.`,
      done: state.buildings > 0 && state.unplaced === 0,
      action: { label: 'Review buildings', to: '/' },
    },
    {
      id: 'invite',
      title: 'Invite your team',
      detail:
        state.members > 1
          ? `${state.members} people have access.`
          : 'Add the people who need to see this — engineering, finance, ownership.',
      done: state.members > 1,
      action: { label: 'Invite', to: '/settings/team' },
    },
  ]
}
