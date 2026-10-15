// Self-service signup: one form creates the organization and its first admin.
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { messageFor, usePortal } from '../state/store'
import { ErrorNote } from '../components/primitives'
import { AuthFrame } from './AuthFrame'

export function Signup(): JSX.Element {
  const { adoptSession } = usePortal()
  const [organizationName, setOrganizationName] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adoptSession(await api.signup({ organizationName, fullName, email, password }))
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      eyebrow="Get started"
      title="Create your account"
      intro="Set up your organization and connect your buildings. No card required."
      footer={
        <>
          Already have an account?{' '}
          <Link className="text-ink underline underline-offset-4" to="/login">
            Sign in
          </Link>
          .
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div>
          <label className="field-label" htmlFor="org">
            Organization
          </label>
          <input
            id="org"
            className="field"
            required
            minLength={2}
            placeholder="Meridian Property Group"
            value={organizationName}
            onChange={(e) => setOrganizationName(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            className="field"
            required
            minLength={2}
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="email">
            Work email
          </label>
          <input
            id="email"
            type="email"
            className="field"
            required
            autoComplete="username"
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
            className="field"
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {/* Length rather than composition: it is what actually resists
              guessing, and composition rules mostly produce Pa55word! */}
          <p className="mt-1 text-tiny text-ink-3">At least 10 characters. A phrase works well.</p>
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating your account' : 'Create account'}
        </button>
      </form>
    </AuthFrame>
  )
}
