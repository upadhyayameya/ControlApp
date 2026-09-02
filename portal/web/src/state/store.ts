// ---------------------------------------------------------------------------
// Application store.
//
// Deliberately small: session, the portfolio, and the currently-open building.
// Everything else is fetched by the page that needs it. A customer portal is
// read-mostly and the data changes when the customer acts on it, so a global
// cache would mostly be a source of stale screens.
// ---------------------------------------------------------------------------

import { create } from 'zustand'
import type {
  BuildingDetailResponse,
  Organization,
  PortfolioResponse,
  User,
} from '@hbs/shared'
import { ApiError, api } from '../api/client'

interface PortalState {
  user: User | null
  organization: Organization | null
  /** Staff only: which organization the portfolio view is narrowed to. */
  viewingOrganizationId: string | null
  organizations: Organization[]

  portfolio: PortfolioResponse | null
  building: BuildingDetailResponse | null

  sessionChecked: boolean
  loading: boolean
  error: string | null
  /**
   * Set by a sign-in through the login form, and only that — a session
   * restored on page load must not steal the route the user opened. App.tsx
   * consumes it to send a fresh sign-in to the portfolio.
   */
  justLoggedIn: boolean

  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  loadPortfolio: () => Promise<void>
  loadBuilding: (id: string) => Promise<void>
  setViewingOrganization: (id: string | null) => Promise<void>
  consumeJustLoggedIn: () => void
  clearError: () => void
}

export const usePortal = create<PortalState>((set, get) => ({
  user: null,
  organization: null,
  viewingOrganizationId: null,
  organizations: [],
  portfolio: null,
  building: null,
  sessionChecked: false,
  loading: false,
  error: null,
  justLoggedIn: false,

  /** Restore an existing session on first paint, so a refresh does not log out. */
  bootstrap: async () => {
    try {
      const session = await api.session()
      set({ user: session.user, organization: session.organization })
      if (session.user.role === 'hbs_staff') {
        const { organizations } = await api.organizations()
        set({ organizations })
      }
      await get().loadPortfolio()
    } catch {
      // A 401 here is the normal signed-out case, not an error worth showing.
      set({ user: null, organization: null })
    } finally {
      set({ sessionChecked: true })
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const session = await api.login(email, password)
      set({ user: session.user, organization: session.organization, justLoggedIn: true })
      if (session.user.role === 'hbs_staff') {
        const { organizations } = await api.organizations()
        set({ organizations })
      }
      await get().loadPortfolio()
    } catch (err) {
      set({ error: messageFor(err) })
      throw err
    } finally {
      set({ loading: false })
    }
  },

  logout: async () => {
    await api.logout().catch(() => undefined)
    set({
      user: null,
      organization: null,
      portfolio: null,
      building: null,
      organizations: [],
      viewingOrganizationId: null,
    })
  },

  loadPortfolio: async () => {
    set({ loading: true, error: null })
    try {
      const portfolio = await api.portfolio(get().viewingOrganizationId ?? undefined)
      set({ portfolio })
    } catch (err) {
      set({ error: messageFor(err) })
    } finally {
      set({ loading: false })
    }
  },

  /**
   * Load a building, or refresh the one already open.
   *
   * The distinction matters: blanking `building` on a refresh unmounts the
   * page, which throws away the open tab and any local component state — so
   * saving a meter reading would discard the confirmation message it had just
   * produced. Only a genuine navigation to a different building clears it.
   */
  loadBuilding: async (id) => {
    const isRefresh = get().building?.building.id === id
    set({ loading: true, error: null, ...(isRefresh ? {} : { building: null }) })
    try {
      set({ building: await api.building(id) })
    } catch (err) {
      set({ error: messageFor(err) })
    } finally {
      set({ loading: false })
    }
  },

  setViewingOrganization: async (id) => {
    set({ viewingOrganizationId: id })
    await get().loadPortfolio()
  },

  consumeJustLoggedIn: () => set({ justLoggedIn: false }),

  clearError: () => set({ error: null }),
}))

export function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.detail ? `${err.message} ${err.detail}` : err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}
