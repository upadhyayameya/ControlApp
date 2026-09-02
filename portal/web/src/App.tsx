// ---------------------------------------------------------------------------
// Routes and the session gate.
// ---------------------------------------------------------------------------

import { useEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { usePortal } from './state/store'
import { Shell } from './components/Shell'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { AcceptInvite } from './pages/AcceptInvite'
import { Dashboard } from './pages/Dashboard'
import { BuildingDetail } from './pages/BuildingDetail'
import { Messages } from './pages/Messages'
import { Reports } from './pages/Reports'
import { Settings } from './pages/Settings'
import { Staff } from './pages/Staff'
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

  // Rendering the signed-out routes before the session check would flash a
  // login screen at someone who is already signed in.
  if (!sessionChecked) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Starting" />
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/buildings/:id" element={<BuildingDetail />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/reports" element={<Reports />} />
        {user.role !== 'hbs_staff' && <Route path="/settings/*" element={<Settings />} />}
        {user.role === 'hbs_staff' && <Route path="/staff" element={<Staff />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}
