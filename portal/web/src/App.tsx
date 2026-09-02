// ---------------------------------------------------------------------------
// Application shell: session gate, navigation, routes.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { usePortal } from './state/store'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { BuildingDetail } from './pages/BuildingDetail'
import { Messages } from './pages/Messages'
import { Reports } from './pages/Reports'
import { Admin } from './pages/Admin'
import { Spinner } from './components/primitives'

export function App(): JSX.Element {
  const { user, sessionChecked, bootstrap, justLoggedIn, consumeJustLoggedIn } = usePortal()
  const navigate = useNavigate()

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  // A fresh sign-in lands on the portfolio. Without this the router keeps
  // whatever route was open when the last session ended, so signing out from
  // Reports and back in drops the next person straight into Reports. A session
  // restored on load is deliberately excluded — that one should keep its route.
  useEffect(() => {
    if (!justLoggedIn) return
    consumeJustLoggedIn()
    navigate('/', { replace: true })
  }, [justLoggedIn, consumeJustLoggedIn, navigate])

  // Rendering the login form before the session check would flash it at
  // someone who is already signed in.
  if (!sessionChecked) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Starting…" />
      </div>
    )
  }

  if (!user) return <Login />

  return (
    <div className="min-h-full">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/buildings/:id" element={<BuildingDetail />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/reports" element={<Reports />} />
          {user.role === 'hbs_staff' && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function Header(): JSX.Element {
  const { user, organization, logout } = usePortal()

  const links = [
    { to: '/', label: 'Portfolio', end: true },
    { to: '/messages', label: 'Messages', end: false },
    { to: '/reports', label: 'Reports', end: false },
    ...(user?.role === 'hbs_staff' ? [{ to: '/admin', label: 'Staff', end: false }] : []),
  ]

  return (
    <header className="border-b border-forest-700 bg-forest-800">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <div className="mr-auto">
          <p className="font-semibold text-cream-50">HBS Client Portal</p>
          <p className="text-xs text-cream-200/60">
            {organization?.name ?? 'All organizations'}
            {organization && ` · ${organization.tier} tier`}
          </p>
        </div>

        <nav className="flex gap-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                `rounded px-3 py-1.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-forest-600 text-cream-50'
                    : 'text-cream-200/70 hover:bg-forest-700 hover:text-cream-50'
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-cream-200/70">{user?.fullName}</span>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-cream-200/70 underline-offset-2 hover:text-cream-50 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
