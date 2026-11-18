// ---------------------------------------------------------------------------
// The HBS staff door.
//
// A separate address from the client sign-in so a customer never lands on an
// internal screen, and so staff have somewhere unbranded to go. Both doors hit
// the same endpoint — the split is about where people arrive, not about a
// second authentication system, which would be two places to get wrong.
//
// Signing in with the "wrong" kind of account still works and simply routes
// you where you belong. Refusing would add friction and tell an attacker with
// valid credentials nothing they do not already know.
// ---------------------------------------------------------------------------

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usePortal } from '../state/store'
import { IS_DEMO } from '../api/client'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../api/demoClient'
import { ErrorNote } from '../components/primitives'
import { AuthFrame } from './AuthFrame'

export function StaffLogin(): JSX.Element {
  const { login, loading, error, clearError } = usePortal()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const staffAccounts = DEMO_ACCOUNTS.filter((a) => a.role === 'hbs_staff')

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    clearError()
    await login(email, password).catch(() => undefined)
  }

  return (
    <AuthFrame
      variant="staff"
      eyebrow="Staff sign-in"
      title="HBS console"
      intro="Every client account, their portfolios, and the Portfolio Manager sync behind them."
      footer={
        <>
          Client looking for their portal?{' '}
          <Link className="text-ink underline underline-offset-4" to="/login">
            Sign in here
          </Link>
          .
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div>
          <label className="field-label" htmlFor="staff-email">
            HBS email
          </label>
          <input
            id="staff-email"
            type="email"
            autoComplete="username"
            required
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="staff-password">
            Password
          </label>
          <input
            id="staff-password"
            type="password"
            autoComplete="current-password"
            required
            className="field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Signing in' : 'Sign in'}
        </button>
      </form>

      {IS_DEMO && staffAccounts.length > 0 && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="eyebrow mb-2.5">Demo</p>
          {staffAccounts.map((account) => (
            <button
              key={account.email}
              type="button"
              disabled={loading}
              onClick={() => {
                setEmail(account.email)
                setPassword(DEMO_PASSWORD)
                clearError()
                void login(account.email, DEMO_PASSWORD).catch(() => undefined)
              }}
              className="w-full border border-line bg-surface px-3 py-2 text-left transition hover:border-line-strong hover:bg-paper disabled:opacity-50"
            >
              <span className="block text-base font-medium text-ink">{account.name}</span>
              <span className="block font-mono text-micro uppercase text-ink-3">
                HBS staff · sees every client
              </span>
            </button>
          ))}
        </div>
      )}
    </AuthFrame>
  )
}
