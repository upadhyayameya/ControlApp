import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usePortal } from '../state/store'
import { IS_DEMO } from '../api/client'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../api/demoClient'
import { ErrorNote } from '../components/primitives'
import { AuthFrame } from './AuthFrame'

export function Login(): JSX.Element {
  const { login, loading, error, clearError } = usePortal()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    clearError()
    await login(email, password).catch(() => undefined)
  }

  return (
    <AuthFrame
      eyebrow="Client portal"
      title="Sign in"
      footer={
        <>
          {IS_DEMO ? (
            'Static demo — everything runs in your browser and resets on refresh.'
          ) : (
            <>
              No account yet?{' '}
              <Link className="text-ink underline underline-offset-4" to="/signup">
                Create one
              </Link>
              .
            </>
          )}
          <span className="mt-2 block">
            HBS staff?{' '}
            <Link className="text-ink underline underline-offset-4" to="/hbs">
              Sign in to the console
            </Link>
            .
          </span>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            className="field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
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

      {IS_DEMO && (
        <div className="mt-7 border-t border-line pt-5">
          {/* In the demo the accounts are the point — one click, rather than
              something to copy out of a README. */}
          <p className="eyebrow mb-2.5">Sign in as</p>
          <ul className="space-y-1.5">
            {/* Staff sign in at their own door, so they are not listed here. */}
            {DEMO_ACCOUNTS.filter((a) => a.role !== 'hbs_staff').map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    setEmail(account.email)
                    setPassword(DEMO_PASSWORD)
                    clearError()
                    void login(account.email, DEMO_PASSWORD).catch(() => undefined)
                  }}
                  className="w-full border border-line bg-surface px-3 py-2 text-left transition hover:border-line-strong hover:bg-raised disabled:opacity-50"
                >
                  <span className="block text-base font-medium text-ink">{account.name}</span>
                  <span className="block font-mono text-micro uppercase text-ink-3">
                    {account.organization}
                    {account.role === 'customer_viewer' && ' · read-only'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AuthFrame>
  )
}
