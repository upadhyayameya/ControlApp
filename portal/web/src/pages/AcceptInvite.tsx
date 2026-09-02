// Accepting a team invitation. The link carries the only copy of the token.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { InvitePreview } from '@hbs/shared'
import { api } from '../api/client'
import { messageFor, usePortal } from '../state/store'
import { ErrorNote, Spinner } from '../components/primitives'
import { AuthFrame } from './AuthFrame'

export function AcceptInvite(): JSX.Element {
  const { token } = useParams<{ token: string }>()
  const { adoptSession } = usePortal()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api
      .invitePreview(token)
      .then(setPreview)
      .catch((err: unknown) => setLoadError(messageFor(err)))
  }, [token])

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      await adoptSession(await api.acceptInvite({ token, fullName, password }))
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) {
    return (
      <AuthFrame
        eyebrow="Invitation"
        title="This link is not valid"
        footer={
          <Link className="text-ink underline underline-offset-4" to="/login">
            Go to sign in
          </Link>
        }
      >
        <ErrorNote message={loadError} />
        <p className="mt-4 text-base text-ink-2">
          Invitation links expire, and each one can be used once. Ask whoever invited you to send a
          new one.
        </p>
      </AuthFrame>
    )
  }

  if (!preview) {
    return (
      <AuthFrame eyebrow="Invitation" title="Checking your invitation">
        <Spinner />
      </AuthFrame>
    )
  }

  return (
    <AuthFrame
      eyebrow="Invitation"
      title={`Join ${preview.organizationName}`}
      intro={
        <>
          {preview.invitedByName} invited{' '}
          <span className="measure text-ink">{preview.email}</span>{' '}
          {preview.role === 'customer_admin' ? 'as an admin.' : 'with read-only access.'}
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorNote message={error} />}
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
          <label className="field-label" htmlFor="password">
            Choose a password
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
          <p className="mt-1 text-tiny text-ink-3">At least 10 characters.</p>
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Joining' : 'Join and sign in'}
        </button>
      </form>
    </AuthFrame>
  )
}
