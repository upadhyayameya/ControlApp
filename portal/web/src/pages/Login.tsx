import { useState, type FormEvent } from 'react'
import { usePortal } from '../state/store'
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

        <p className="mt-4 text-center text-xs text-cream-200/50">
          Demo accounts are listed in portal/README.md.
        </p>
      </div>
    </div>
  )
}
