// ---------------------------------------------------------------------------
// The application shell: a fixed left rail and a single content measure.
//
// A rail rather than a top bar because the content column then keeps one
// consistent width on every screen, which is what makes a portfolio table and
// a settings form feel like the same product. The tenant's accent appears in
// exactly two places — the organization mark and focus rings — so branding
// never competes with compliance status for meaning.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { OrganizationProfile, User } from '@hbs/shared'
import { usePortal } from '../state/store'

interface NavItem {
  to: string
  label: string
  end: boolean
}

function itemsFor(user: User): NavItem[] {
  const base: NavItem[] = [
    { to: '/', label: 'Portfolio', end: true },
    { to: '/messages', label: 'Messages', end: false },
    { to: '/reports', label: 'Reports', end: false },
  ]
  if (user.role === 'hbs_staff') return [...base, { to: '/staff', label: 'Staff', end: false }]
  return [...base, { to: '/settings', label: 'Account', end: false }]
}

export function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  const { user, profile, logout } = usePortal()
  const [open, setOpen] = useState(false)
  if (!user) return <>{children}</>

  const items = itemsFor(user)

  return (
    <div
      className="min-h-full bg-paper"
      // The tenant's colour is applied as a token override on the subtree, so
      // every focus ring and mark picks it up without a single component
      // knowing that branding exists.
      style={profile ? ({ '--accent': hexToTriple(profile.accentColor) } as React.CSSProperties) : undefined}
    >
      {/* Rail on desktop, disclosure on small screens. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-rail flex-col border-r border-line bg-surface md:flex">
        <RailHead profile={profile} />
        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.to}>
                <RailLink item={item} />
              </li>
            ))}
          </ul>
        </nav>
        <RailFoot user={user} onSignOut={() => void logout()} />
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 md:hidden">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="rail-mobile"
        >
          Menu
        </button>
        <Mark profile={profile} />
        <span className="truncate font-display text-base font-semibold text-ink">
          {profile?.name ?? 'HBS Client Portal'}
        </span>
      </header>

      {open && (
        <nav id="rail-mobile" className="border-b border-line bg-surface px-3 py-2 md:hidden">
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.to} onClick={() => setOpen(false)}>
                <RailLink item={item} />
              </li>
            ))}
            <li>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-base text-ink-2 hover:text-ink"
                onClick={() => void logout()}
              >
                Sign out
              </button>
            </li>
          </ul>
        </nav>
      )}

      <main className="md:pl-rail">
        <div className="mx-auto max-w-6xl px-4 py-7 sm:px-8">{children}</div>
      </main>
    </div>
  )
}

function RailLink({ item }: { item: NavItem }): JSX.Element {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        // The active marker is a rule on the leading edge, in the same ruler
        // idiom as the section dividers.
        `relative block px-3 py-2 text-base transition ${
          isActive
            ? 'font-medium text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:bg-ink'
            : 'text-ink-2 hover:text-ink'
        }`
      }
    >
      {item.label}
    </NavLink>
  )
}

function RailHead({ profile }: { profile: OrganizationProfile | null }): JSX.Element {
  return (
    <div className="border-b border-line px-4 py-4">
      <div className="flex items-center gap-2.5">
        <Mark profile={profile} />
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold leading-tight text-ink">
            {profile?.name ?? 'HBS Solutions'}
          </p>
          <p className="truncate font-mono text-micro uppercase text-ink-3">
            {profile ? `${profile.tier} plan` : 'Staff console'}
          </p>
        </div>
      </div>
    </div>
  )
}

function Mark({ profile }: { profile: OrganizationProfile | null }): JSX.Element {
  const initials =
    profile?.logoMark ??
    (profile?.name ?? 'HBS')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? '')
      .join('')
      .toUpperCase()
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-accent font-display text-tiny font-bold tracking-tight text-white"
    >
      {initials}
    </span>
  )
}

function RailFoot({ user, onSignOut }: { user: User; onSignOut: () => void }): JSX.Element {
  return (
    <div className="border-t border-line px-4 py-3">
      <p className="truncate text-tiny font-medium text-ink">{user.fullName}</p>
      <p className="truncate font-mono text-micro text-ink-3">{roleLabel(user.role)}</p>
      <button
        type="button"
        onClick={onSignOut}
        className="mt-2 font-mono text-micro uppercase text-ink-3 underline-offset-4 hover:text-ink hover:underline"
      >
        Sign out
      </button>
    </div>
  )
}

function roleLabel(role: User['role']): string {
  return role === 'hbs_staff' ? 'HBS staff' : role === 'customer_admin' ? 'Admin' : 'Read-only'
}

/** '#0B5D66' → '11 93 102', the triple form the CSS tokens expect. */
export function hexToTriple(hex: string): string {
  const value = hex.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return '11 93 102'
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)).join(' ')
}
