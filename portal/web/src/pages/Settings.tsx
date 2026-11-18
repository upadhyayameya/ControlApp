// ---------------------------------------------------------------------------
// The account console: everything a tenant administers about itself.
//
// Sub-routed rather than tabbed so each section is linkable — the onboarding
// checklist points straight at /settings/connection, and an admin can send a
// colleague a link to the team page.
//
// Read-only members can see this; the write controls are absent for them and
// refused by the API regardless. Hiding a control is presentation, not
// security.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import type {
  AuditEvent,
  EspmConnectionSummary,
  Invitation,
  OrgOverviewResponse,
  Plan,
  User,
} from '@hbs/shared'
import { PLANS } from '@hbs/shared'
import { api, IS_DEMO } from '../api/client'
import { messageFor, usePortal } from '../state/store'
import { dateLabel, int, usd } from '../lib/format'
import {
  Empty,
  ErrorNote,
  Notice,
  PageHead,
  SectionHead,
  Spinner,
} from '../components/primitives'
import { OnboardingPanel } from '../components/OnboardingPanel'

const SECTIONS = [
  { to: '/settings', end: true, label: 'Overview' },
  { to: '/settings/team', end: false, label: 'Team' },
  { to: '/settings/connection', end: false, label: 'Portfolio Manager' },
  { to: '/settings/plan', end: false, label: 'Plan' },
  { to: '/settings/branding', end: false, label: 'Branding' },
  { to: '/settings/audit', end: false, label: 'Activity' },
]

export function Settings(): JSX.Element {
  const { org, loadOrg, user } = usePortal()

  useEffect(() => {
    if (!org) void loadOrg()
  }, [org, loadOrg])

  if (!org) return <Spinner label="Loading account" />

  const isAdmin = user?.role === 'customer_admin'

  return (
    <div>
      <PageHead eyebrow="Account" title={org.profile.name} detail={`${org.profile.slug}`} />

      <nav className="mb-6 flex flex-wrap gap-0.5 border-b border-line">
        {SECTIONS.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-base transition ${
                isActive
                  ? 'border-ink font-medium text-ink'
                  : 'border-transparent text-ink-3 hover:text-ink'
              }`
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route path="/" element={<Overview org={org} />} />
        <Route path="team" element={<Team org={org} isAdmin={isAdmin} onChanged={loadOrg} />} />
        <Route
          path="connection"
          element={<Connection org={org} isAdmin={isAdmin} onChanged={loadOrg} />}
        />
        <Route path="plan" element={<PlanSection org={org} isAdmin={isAdmin} />} />
        <Route
          path="branding"
          element={<Branding org={org} isAdmin={isAdmin} onChanged={loadOrg} />}
        />
        <Route path="audit" element={<Activity isAdmin={isAdmin} />} />
        <Route path="*" element={<Navigate to="/settings" replace />} />
      </Routes>
    </div>
  )
}

// --- Overview -------------------------------------------------------------

function Overview({ org }: { org: OrgOverviewResponse }): JSX.Element {
  const { usage } = org
  return (
    <div className="space-y-5">
      {!org.onboarding.complete && <OnboardingPanel onboarding={org.onboarding} />}

      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
        <div className="rule">
          <p className="eyebrow">Plan</p>
          <p className="mt-1.5 font-display text-h2 text-ink">{usage.plan.name}</p>
          <p className="mt-1 text-tiny text-ink-3">
            {usage.status === 'trialing' && usage.trialEndsAt
              ? `Trial ends ${dateLabel(usage.trialEndsAt)}`
              : usage.status}
          </p>
        </div>
        <div className="rule">
          <p className="eyebrow">Buildings</p>
          <p className="mt-1.5 font-display text-h2 tab text-ink">
            {int(usage.buildings)}
            {usage.plan.limits.maxBuildings !== null && (
              <span className="text-h3 text-ink-3"> / {usage.plan.limits.maxBuildings}</span>
            )}
          </p>
        </div>
        <div className="rule">
          <p className="eyebrow">People</p>
          <p className="mt-1.5 font-display text-h2 tab text-ink">
            {int(usage.users)}
            {usage.plan.limits.maxUsers !== null && (
              <span className="text-h3 text-ink-3"> / {usage.plan.limits.maxUsers}</span>
            )}
          </p>
        </div>
      </div>

      {usage.exceeded.length > 0 && (
        <div className="border-l-2 border-warn bg-warn-soft/50 px-3 py-2.5 text-base text-ink">
          <strong className="font-semibold">Over your plan.</strong>
          <ul className="mt-1 space-y-0.5 text-ink-2">
            {usage.exceeded.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// --- Team -----------------------------------------------------------------

function Team({
  org,
  isAdmin,
  onChanged,
}: {
  org: OrgOverviewResponse
  isAdmin: boolean
  onChanged: () => Promise<void>
}): JSX.Element {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'customer_admin' | 'customer_viewer'>('customer_viewer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastLink, setLastLink] = useState<string | null>(null)

  async function invite(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const invitation = await api.createInvitation({ email, role })
      // Shown once, right after creating it. The token exists nowhere else —
      // there is no way to display it again later, by design.
      setLastLink(invitation.inviteUrl ?? null)
      setEmail('')
      await onChanged()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  async function act(fn: () => Promise<unknown>): Promise<void> {
    setError(null)
    try {
      await fn()
      await onChanged()
    } catch (err) {
      setError(messageFor(err))
    }
  }

  return (
    <div className="space-y-6">
      {error && <ErrorNote message={error} />}

      {isAdmin && (
        <section className="panel panel-pad">
          <SectionHead title="Invite someone" detail="They choose their own password." />
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <label className="field-label" htmlFor="invite-email">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                className="field"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="invite-role">
                Access
              </label>
              <select
                id="invite-role"
                className="field"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="customer_viewer">Read-only</option>
                <option value="customer_admin">Admin</option>
              </select>
            </div>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Sending' : 'Send invitation'}
            </button>
          </form>

          {lastLink && (
            <div className="mt-4 border-l-2 border-good bg-good-soft/50 px-3 py-2.5">
              <p className="text-base text-ink">
                Invitation sent. This link is shown once and cannot be retrieved later:
              </p>
              <code className="measure mt-1.5 block break-all text-tiny text-ink-2">{lastLink}</code>
            </div>
          )}
        </section>
      )}

      <section>
        <SectionHead title="People" />
        <div className="panel overflow-hidden">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Access</th>
                <th>Last signed in</th>
                {isAdmin && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {org.members.map((member: User) => (
                <tr key={member.id}>
                  <td className="font-medium text-ink">{member.fullName}</td>
                  <td className="measure text-tiny text-ink-2">{member.email}</td>
                  <td>
                    <span className={member.role === 'customer_admin' ? 'chip-good' : 'chip-inert'}>
                      {member.role === 'customer_admin' ? 'Admin' : 'Read-only'}
                    </span>
                  </td>
                  <td className="text-tiny text-ink-3">{dateLabel(member.lastLoginAt)}</td>
                  {isAdmin && (
                    <td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() =>
                            void act(() =>
                              api.changeMemberRole(
                                member.id,
                                member.role === 'customer_admin' ? 'customer_viewer' : 'customer_admin',
                              ),
                            )
                          }
                        >
                          {member.role === 'customer_admin' ? 'Make read-only' : 'Make admin'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => void act(() => api.removeMember(member.id))}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && org.invitations.length > 0 && (
        <section>
          <SectionHead title="Invitations" />
          <div className="panel overflow-hidden">
            <table className="grid-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Access</th>
                  <th>State</th>
                  <th>Expires</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {org.invitations.map((invitation: Invitation) => (
                  <tr key={invitation.id}>
                    <td className="measure text-tiny text-ink">{invitation.email}</td>
                    <td className="text-tiny text-ink-2">
                      {invitation.role === 'customer_admin' ? 'Admin' : 'Read-only'}
                    </td>
                    <td>
                      <span
                        className={
                          invitation.state === 'accepted'
                            ? 'chip-good'
                            : invitation.state === 'pending'
                              ? 'chip-warn'
                              : 'chip-inert'
                        }
                      >
                        {invitation.state}
                      </span>
                    </td>
                    <td className="text-tiny text-ink-3">{dateLabel(invitation.expiresAt)}</td>
                    <td className="text-right">
                      {invitation.state === 'pending' && (
                        <button
                          type="button"
                          className="btn-danger btn-sm"
                          onClick={() => void act(() => api.revokeInvitation(invitation.id))}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

// --- Connection -----------------------------------------------------------

function Connection({
  org,
  isAdmin,
  onChanged,
}: {
  org: OrgOverviewResponse
  isAdmin: boolean
  onChanged: () => Promise<void>
}): JSX.Element {
  const connection: EspmConnectionSummary | null = org.connection
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [environment, setEnvironment] = useState<'test' | 'live'>('test')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const allowed = org.usage.plan.limits.ownEspmConnection

  async function connect(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.connectEspm({ username, password, environment })
      setNotice('Connected. Your properties will sync from ENERGY STAR.')
      setPassword('')
      await onChanged()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {error && <ErrorNote message={error} />}
      {notice && <Notice message={notice} />}

      <section className="panel panel-pad">
        <SectionHead title="Current connection" />
        {connection ? (
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label="Account" value={connection.username} mono />
            <Field
              label="Scope"
              value={connection.scope === 'own-account' ? 'Your ENERGY STAR account' : 'Shared HBS account'}
            />
            <Field label="Environment" value={connection.environment} />
            <Field
              label="Status"
              value={
                <span
                  className={
                    connection.status === 'connected'
                      ? 'chip-good'
                      : connection.status === 'error'
                        ? 'chip-bad'
                        : 'chip-inert'
                  }
                >
                  {connection.status}
                </span>
              }
            />
            <Field label="Last verified" value={dateLabel(connection.verifiedAt)} />
            <Field label="Last pull" value={dateLabel(connection.lastPullAt)} />
            {connection.lastError && (
              <div className="sm:col-span-2">
                <ErrorNote message={connection.lastError} />
              </div>
            )}
          </dl>
        ) : (
          <p className="text-base text-ink-2">
            No connection yet. Either connect your own ENERGY STAR account below, or share your
            properties with the HBS service-provider account and we will pull them for you.
          </p>
        )}

        {isAdmin && connection?.scope === 'own-account' && (
          <button
            type="button"
            className="btn-danger btn-sm mt-4"
            onClick={async () => {
              await api.disconnectEspm().catch((err: unknown) => setError(messageFor(err)))
              await onChanged()
            }}
          >
            Disconnect
          </button>
        )}
      </section>

      {isAdmin && (
        <section className="panel panel-pad">
          <SectionHead
            title="Connect your own account"
            detail="We store the credential encrypted and use it only to read and write your properties."
          />
          {!allowed ? (
            <p className="text-base text-ink-2">
              Connecting your own ENERGY STAR account is part of the Compliance plan. On{' '}
              {org.usage.plan.name}, share your properties with the HBS account instead.
            </p>
          ) : (
            <form onSubmit={connect} className="max-w-md space-y-3.5">
              <div>
                <label className="field-label" htmlFor="espm-user">
                  ENERGY STAR username
                </label>
                <input
                  id="espm-user"
                  className="field measure"
                  required
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="espm-pass">
                  Password
                </label>
                <input
                  id="espm-pass"
                  type="password"
                  className="field"
                  required
                  autoComplete="off"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="espm-env">
                  Environment
                </label>
                <select
                  id="espm-env"
                  className="field"
                  value={environment}
                  onChange={(e) => setEnvironment(e.target.value as 'test' | 'live')}
                >
                  <option value="test">Test (wstest)</option>
                  <option value="live">Live</option>
                </select>
              </div>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? 'Verifying' : 'Verify and connect'}
              </button>
              <p className="text-tiny text-ink-3">
                We check the credentials against Portfolio Manager before saving them, so a typo is
                an error here rather than a sync that fails silently tomorrow.
                {IS_DEMO && ' In this demo any values are accepted.'}
              </p>
            </form>
          )}
        </section>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}): JSX.Element {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-1 text-base text-ink ${mono ? 'measure' : ''}`}>{value}</dd>
    </div>
  )
}

// --- Plan -----------------------------------------------------------------

function PlanSection({ org, isAdmin }: { org: OrgOverviewResponse; isAdmin: boolean }): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function request(plan: Plan): Promise<void> {
    setBusy(plan.id)
    setError(null)
    try {
      const result = await api.requestPlan(plan.id)
      setNotice(result.message)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      {error && <ErrorNote message={error} />}
      {notice && <Notice message={notice} />}

      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const current = plan.id === org.profile.tier
          return (
            <article
              key={plan.id}
              className={`panel flex flex-col ${current ? 'border-ink' : ''}`}
            >
              <div className="border-b border-line px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-h3 text-ink">{plan.name}</h3>
                  {current && <span className="chip-good">Current</span>}
                  {!current && plan.highlight && <span className="chip-inert">{plan.highlight}</span>}
                </div>
                <p className="mt-1.5 measure text-h3 text-ink">
                  {plan.monthlyPrice === null ? (
                    'Scoped'
                  ) : plan.monthlyPrice === 0 ? (
                    'From free'
                  ) : (
                    <>
                      {usd(plan.monthlyPrice)}
                      <span className="text-tiny text-ink-3"> /month</span>
                    </>
                  )}
                </p>
                {/* Rendered even when empty so the divider below sits at the
                    same height on all three cards. */}
                <p className="mt-0.5 min-h-[1.1rem] text-tiny text-ink-3">
                  {plan.perBuildingPrice !== null
                    ? `plus ${usd(plan.perBuildingPrice)} per building`
                    : 'priced per engagement'}
                </p>
              </div>

              <div className="flex flex-1 flex-col p-4">
                <p className="text-base text-ink-2">{plan.pitch}</p>
                <ul className="mt-3 flex-1 space-y-1.5 text-tiny text-ink-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span aria-hidden className="text-ink-3">
                        ▏
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                {isAdmin && !current && (
                  <button
                    type="button"
                    className="btn-secondary mt-4"
                    disabled={busy !== null}
                    onClick={() => void request(plan)}
                  >
                    {busy === plan.id ? 'Sending' : `Ask about ${plan.name}`}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <p className="text-tiny text-ink-3">
        {/* There is no payment processor wired up, and pretending otherwise in
            the UI would be worse than saying so. */}
        Plan changes are handled by your HBS contact rather than charged automatically — asking here
        starts that conversation.
      </p>
    </div>
  )
}

// --- Branding -------------------------------------------------------------

function Branding({
  org,
  isAdmin,
  onChanged,
}: {
  org: OrgOverviewResponse
  isAdmin: boolean
  onChanged: () => Promise<void>
}): JSX.Element {
  const [name, setName] = useState(org.profile.name)
  const [billingEmail, setBillingEmail] = useState(org.profile.billingEmail ?? '')
  const [accentColor, setAccentColor] = useState(org.profile.accentColor)
  const [logoMark, setLogoMark] = useState(org.profile.logoMark ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!isAdmin) {
    return <Empty title="Only an account admin can change these settings." />
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.updateOrg({
        name,
        billingEmail: billingEmail === '' ? null : billingEmail,
        accentColor,
        logoMark: logoMark === '' ? null : logoMark,
      })
      setNotice('Saved.')
      await onChanged()
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="panel panel-pad max-w-lg space-y-4">
      {error && <ErrorNote message={error} />}
      {notice && <Notice message={notice} />}

      <div>
        <label className="field-label" htmlFor="org-name">
          Organization name
        </label>
        <input
          id="org-name"
          className="field"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div>
        <label className="field-label" htmlFor="billing">
          Billing email
        </label>
        <input
          id="billing"
          type="email"
          className="field"
          value={billingEmail}
          onChange={(e) => setBillingEmail(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="field-label" htmlFor="accent">
            Accent colour
          </label>
          <div className="flex items-center gap-2">
            <input
              id="accent"
              type="color"
              className="h-9 w-12 cursor-pointer border border-line-strong bg-surface p-1"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value.toUpperCase())}
            />
            <span className="measure text-tiny text-ink-2">{accentColor}</span>
          </div>
        </div>
        <div>
          <label className="field-label" htmlFor="mark">
            Mark
          </label>
          <input
            id="mark"
            className="field w-24 measure uppercase"
            maxLength={3}
            placeholder="MP"
            value={logoMark}
            onChange={(e) => setLogoMark(e.target.value.toUpperCase())}
          />
        </div>
        <div className="pb-1">
          <p className="eyebrow mb-1">Preview</p>
          <span
            className="flex h-9 w-9 items-center justify-center rounded-sm font-display text-tiny font-bold text-white"
            style={{ background: accentColor }}
          >
            {logoMark || name.slice(0, 2).toUpperCase()}
          </span>
        </div>
      </div>

      <p className="text-tiny text-ink-3">
        {/* Deliberately narrow: a portal that accepts arbitrary CSS or uploaded
            images from tenants becomes an injection surface and a support
            burden at the same time. */}
        Branding is limited to a colour and a short mark — enough to make the portal feel like
        yours, without turning tenant settings into a place arbitrary markup can be injected.
      </p>

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? 'Saving' : 'Save changes'}
      </button>
    </form>
  )
}

// --- Activity -------------------------------------------------------------

function Activity({ isAdmin }: { isAdmin: boolean }): JSX.Element {
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setEvents((await api.audit()).events)
    } catch (err) {
      setError(messageFor(err))
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

  if (!isAdmin) return <Empty title="Only an account admin can see the activity log." />
  if (error) return <ErrorNote message={error} />
  if (!events) return <Spinner label="Loading activity" />
  if (events.length === 0) return <Empty title="Nothing recorded yet." />

  return (
    <div className="panel overflow-hidden">
      <table className="grid-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Subject</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="measure whitespace-nowrap text-tiny text-ink-3">
                {dateLabel(event.createdAt)}
              </td>
              <td className="text-base text-ink">{event.actorLabel}</td>
              <td className="measure text-tiny text-ink-2">{event.action}</td>
              <td className="text-tiny text-ink-2">
                {event.targetLabel ?? '—'}
                {event.detail && <span className="block text-ink-3">{event.detail}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
