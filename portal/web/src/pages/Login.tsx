import { useState, type FormEvent } from 'react'
import { usePortal } from '../state/store'
import { IS_DEMO } from '../api/client'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../api/demoClient'
import { ErrorNote } from '../components/primitives'

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
    <div className="flex min-h-full items-center justify-center bg-forest-800 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-cream-50">HBS Client Portal</h1>
          <p className="mt-1 text-sm text-cream-200/70">
            Building energy performance, benchmarking and BEPS compliance.
          </p>
        </div>

        <form onSubmit={submit} className="card card-pad space-y-4">
          {error && <ErrorNote message={error} />}
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              className="input mt-1"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {IS_DEMO ? (
          /* In the standalone demo the accounts are the point — make them one
             click rather than something to copy out of a README. */
          <div className="mt-4">
            <p className="mb-2 text-center text-xs uppercase tracking-wide text-cream-200/50">
              Sign in as
            </p>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((account) => (
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
                  className="w-full rounded-md border border-forest-600 bg-forest-700/60 px-3 py-2 text-left transition hover:bg-forest-600 disabled:opacity-50"
                >
                  <span className="block text-sm font-medium text-cream-50">{account.name}</span>
                  <span className="block text-xs text-cream-200/60">
                    {account.organization}
                    {account.role === 'hbs_staff' && ' · staff'}
                    {account.role === 'customer_viewer' && ' · read-only'}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-center text-xs text-cream-200/40">
              Static demo — data lives in your browser and resets on refresh.
            </p>
          </div>
        ) : (
          <p className="mt-4 text-center text-xs text-cream-200/50">
            Demo accounts are listed in portal/README.md.
          </p>
        )}
      </div>
    </div>
  )
}
