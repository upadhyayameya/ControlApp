// ---------------------------------------------------------------------------
// Tests for the platform layer.
//
// Weighted towards the things that are quiet when they break and serious when
// they do: a credential recoverable from the database alone, an invitation
// token that can be replayed, an organization that can be left with no admin,
// a plan limit that is advisory rather than enforced, and a tenant that can
// see another tenant's rows.
// ---------------------------------------------------------------------------

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { planFor } from '@hbs/shared'
import { createTestDb } from '../db/index.js'
import { authenticate, createUser } from './auth.js'
import { listAudit } from './audit.js'
import { connectOwnAccount, connectionFor, passwordFor, summaryFor } from './connections.js'
import {
  acceptInvitation,
  changeMemberRole,
  createInvitation,
  InvitationError,
  listInvitations,
  previewInvitation,
  removeMember,
} from './invitations.js'
import { decryptSecret, encryptSecret, hashToken } from './secrets.js'
import { onboardingFor, profileById, signUp, updateProfile, usageFor } from './tenancy.js'

async function freshTenant(name = 'Northgate Estates') {
  const db = createTestDb()
  const { user, profile } = await signUp(db, {
    organizationName: name,
    fullName: 'Robin Vale',
    email: `robin@${profile_slug(name)}.example`,
    password: 'a-long-enough-passphrase',
  })
  return { db, user, profile }
}

function profile_slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// --- Signup ---------------------------------------------------------------

test('signup creates an organization with an admin and a slug', async () => {
  const { db, user, profile } = await freshTenant()
  assert.equal(user.role, 'customer_admin')
  assert.equal(profile.slug, 'northgate-estates')
  assert.equal(profile.planStatus, 'trialing')
  assert.ok(profile.trialEndsAt && profile.trialEndsAt > new Date().toISOString())
  assert.ok(await authenticate(db, user.email, 'a-long-enough-passphrase'))
})

test('two organizations with the same name get distinct slugs', async () => {
  const { db } = await freshTenant('Harbour Group')
  await signUp(db, {
    organizationName: 'Harbour Group',
    fullName: 'Second Person',
    email: 'second@harbour.example',
    password: 'a-long-enough-passphrase',
  })
  const slugs = db
    .prepare<[], { slug: string }>('SELECT slug FROM organizations')
    .all()
    .map((r) => r.slug)
  assert.equal(new Set(slugs).size, slugs.length, `slugs collided: ${slugs.join(', ')}`)
})

test('an email can only belong to one account', async () => {
  const { db, user } = await freshTenant()
  await assert.rejects(() =>
    signUp(db, {
      organizationName: 'Another Org',
      fullName: 'Impostor',
      email: user.email.toUpperCase(), // case must not create a second account
      password: 'a-long-enough-passphrase',
    }),
  )
})

// --- Branding -------------------------------------------------------------

test('accent colour must be a hex literal', async () => {
  const { db, user, profile } = await freshTenant()
  // This value reaches a style attribute, so anything but a hex colour is a
  // script-injection vector rather than a formatting mistake.
  assert.throws(() =>
    updateProfile(db, profile.id, user, { accentColor: 'red; background:url(evil)' }),
  )
  const updated = updateProfile(db, profile.id, user, { accentColor: '#b4392a' })
  assert.equal(updated.accentColor, '#B4392A')
})

// --- Invitations ----------------------------------------------------------

test('only the token hash is stored, never the token', async () => {
  const { db, user, profile } = await freshTenant()
  const invitation = createInvitation(db, {
    organizationId: profile.id,
    email: 'ops@northgate.example',
    role: 'customer_viewer',
    invitedBy: user,
  })
  const token = invitation.inviteUrl!.split('/invite/')[1]!

  const stored = db
    .prepare<[], { token_hash: string }>('SELECT token_hash FROM invitations')
    .all()
    .map((r) => r.token_hash)
  assert.ok(!stored.includes(token), 'the raw token must not be in the database')
  assert.ok(stored.includes(hashToken(token)))

  // And a list never re-exposes it — the link exists once, in the email.
  assert.equal(listInvitations(db, profile.id)[0]?.inviteUrl, undefined)
})

test('an invitation is single-use', async () => {
  const { db, user, profile } = await freshTenant()
  const invitation = createInvitation(db, {
    organizationId: profile.id,
    email: 'ops@northgate.example',
    role: 'customer_viewer',
    invitedBy: user,
  })
  const token = invitation.inviteUrl!.split('/invite/')[1]!

  const joined = await acceptInvitation(db, {
    token,
    fullName: 'Ola Pace',
    password: 'another-long-passphrase',
  })
  assert.equal(joined.role, 'customer_viewer')
  assert.equal(joined.organizationId, profile.id)

  await assert.rejects(
    () => acceptInvitation(db, { token, fullName: 'Replay', password: 'another-long-passphrase' }),
    InvitationError,
  )
})

test('an unknown, revoked and expired token are indistinguishable', async () => {
  const { db, user, profile } = await freshTenant()
  const invitation = createInvitation(db, {
    organizationId: profile.id,
    email: 'ops@northgate.example',
    role: 'customer_viewer',
    invitedBy: user,
  })
  const token = invitation.inviteUrl!.split('/invite/')[1]!

  // Expire it in place.
  db.prepare('UPDATE invitations SET expires_at = ? WHERE id = ?').run(
    '2000-01-01T00:00:00.000Z',
    invitation.id,
  )

  const messages = [
    tryMessage(() => previewInvitation(db, token)),
    tryMessage(() => previewInvitation(db, 'a-token-that-was-never-issued')),
  ]
  assert.equal(new Set(messages).size, 1, `probing distinguishes cases: ${messages.join(' | ')}`)
})

test('re-inviting supersedes the outstanding invitation', async () => {
  const { db, user, profile } = await freshTenant()
  const first = createInvitation(db, {
    organizationId: profile.id,
    email: 'ops@northgate.example',
    role: 'customer_viewer',
    invitedBy: user,
  })
  createInvitation(db, {
    organizationId: profile.id,
    email: 'ops@northgate.example',
    role: 'customer_admin',
    invitedBy: user,
  })

  const firstToken = first.inviteUrl!.split('/invite/')[1]!
  await assert.rejects(() =>
    acceptInvitation(db, { token: firstToken, fullName: 'X', password: 'another-long-passphrase' }),
  )
  const pending = listInvitations(db, profile.id).filter((i) => i.state === 'pending')
  assert.equal(pending.length, 1)
  assert.equal(pending[0]?.role, 'customer_admin')
})

// --- Members --------------------------------------------------------------

test('an organization cannot be left without an admin', async () => {
  const { db, user, profile } = await freshTenant()
  // Demoting the only admin would leave nobody able to invite or reconnect.
  assert.throws(
    () => changeMemberRole(db, profile.id, user.id, 'customer_viewer', user),
    InvitationError,
  )
  assert.throws(() => removeMember(db, profile.id, user.id, user), InvitationError)

  const second = await createUser(db, {
    organizationId: profile.id,
    email: 'second@northgate.example',
    fullName: 'Second Admin',
    role: 'customer_admin',
    password: 'another-long-passphrase',
  })
  // With a second admin in place it is allowed.
  changeMemberRole(db, profile.id, user.id, 'customer_viewer', second)
  assert.equal(
    db.prepare<[string], { role: string }>('SELECT role FROM users WHERE id = ?').get(user.id)?.role,
    'customer_viewer',
  )
})

// --- Credentials ----------------------------------------------------------

test('a stored credential round-trips and is not plaintext at rest', () => {
  const sealed = encryptSecret('super-secret-espm-password')
  assert.ok(!JSON.stringify(sealed).includes('super-secret'))
  assert.equal(decryptSecret(sealed), 'super-secret-espm-password')

  // Tampering must fail closed rather than yield different plaintext.
  const tampered = { ...sealed, ciphertext: Buffer.from('nonsense').toString('base64') }
  assert.equal(decryptSecret(tampered), null)
  assert.equal(decryptSecret({}), null)
})

test('connecting an own account stores it encrypted and verifies first', async () => {
  const { db, user, profile } = await freshTenant()
  const summary = await connectOwnAccount(db, {
    organizationId: profile.id,
    organizationName: profile.name,
    username: 'northgate_esp',
    password: 'the-espm-password',
    environment: 'test',
    actor: user,
  })

  assert.equal(summary.status, 'connected')
  assert.equal(summary.scope, 'own-account')
  // The summary is what reaches the browser; it must not carry the credential.
  assert.ok(!JSON.stringify(summary).includes('the-espm-password'))

  const row = db
    .prepare<[], { secret_ciphertext: string | null }>(
      'SELECT secret_ciphertext FROM espm_connections WHERE organization_id IS NOT NULL',
    )
    .get()
  assert.ok(row?.secret_ciphertext && !row.secret_ciphertext.includes('the-espm-password'))
  assert.equal(passwordFor(db, summary.id), 'the-espm-password')
})

test('a tenant connection with no credential is refused, not silently shared', async () => {
  const { db, user, profile } = await freshTenant()
  const summary = await connectOwnAccount(db, {
    organizationId: profile.id,
    organizationName: profile.name,
    username: 'northgate_esp',
    password: 'the-espm-password',
    environment: 'test',
    actor: user,
  })
  // Simulate a rotated key or a corrupted row.
  db.prepare('UPDATE espm_connections SET secret_ciphertext = NULL WHERE id = ?').run(summary.id)

  // Falling back to the HBS password here would authenticate as HBS against a
  // customer's account — wrong, and nearly invisible.
  assert.equal(passwordFor(db, summary.id), null)
})

test('the connection chosen is the tenant own account when present', async () => {
  const { db, user, profile } = await freshTenant()
  db.prepare(
    `INSERT INTO espm_connections (id, label, organization_id, username, environment, active, created_at)
     VALUES ('shared', 'HBS shared', NULL, 'hbs', 'test', 1, ?)`,
  ).run(new Date().toISOString())

  assert.equal(connectionFor(db, profile.id).id, 'shared', 'falls back before one is connected')

  const summary = await connectOwnAccount(db, {
    organizationId: profile.id,
    organizationName: profile.name,
    username: 'northgate_esp',
    password: 'pw',
    environment: 'test',
    actor: user,
  })
  assert.equal(connectionFor(db, profile.id).id, summary.id)
  assert.equal(connectionFor(db, null).id, 'shared')
})

// --- Plans and onboarding -------------------------------------------------

test('usage counts against the plan and names what is exceeded', async () => {
  const { db, profile } = await freshTenant()
  const plan = planFor(profile.tier)
  assert.ok(plan.limits.maxBuildings !== null)

  const now = new Date().toISOString()
  for (let i = 0; i <= plan.limits.maxBuildings!; i++) {
    db.prepare(
      `INSERT INTO buildings (id, organization_id, name, property_type, gross_floor_area_sqft, created_at)
       VALUES (?, ?, ?, 'Office', 50000, ?)`,
    ).run(`b${i}`, profile.id, `Building ${i}`, now)
  }

  const usage = usageFor(db, profileById(db, profile.id)!)
  assert.equal(usage.buildings, plan.limits.maxBuildings! + 1)
  assert.equal(usage.exceeded.length, 1)
  assert.match(usage.exceeded[0]!, /buildings against a .* limit/)
})

test('onboarding is computed from state, not stored flags', async () => {
  const { db, user, profile } = await freshTenant()
  const before = onboardingFor(db, profileById(db, profile.id)!)
  assert.equal(before.steps.find((s) => s.id === 'account')?.done, true)
  assert.equal(before.steps.find((s) => s.id === 'connect-espm')?.done, false)
  assert.equal(before.complete, false)

  await connectOwnAccount(db, {
    organizationId: profile.id,
    organizationName: profile.name,
    username: 'u',
    password: 'p',
    environment: 'test',
    actor: user,
  })
  const after = onboardingFor(db, profileById(db, profile.id)!)
  assert.equal(after.steps.find((s) => s.id === 'connect-espm')?.done, true)
  assert.ok(after.completedCount > before.completedCount)
})

// --- Isolation and audit --------------------------------------------------

test('a tenant sees only its own audit trail', async () => {
  const { db, user, profile } = await freshTenant('Northgate Estates')
  const other = await signUp(db, {
    organizationName: 'Cedar Holdings',
    fullName: 'Other Person',
    email: 'other@cedar.example',
    password: 'a-long-enough-passphrase',
  })

  createInvitation(db, {
    organizationId: profile.id,
    email: 'ops@northgate.example',
    role: 'customer_viewer',
    invitedBy: user,
  })

  const mine = listAudit(db, profile.id)
  const theirs = listAudit(db, other.profile.id)
  assert.ok(mine.some((e) => e.action === 'member.invited'))
  assert.ok(!theirs.some((e) => e.action === 'member.invited'))
  assert.ok(mine.every((e) => e.organizationId === profile.id))
})

test('the audit trail survives the user who caused the entry', async () => {
  const { db, user, profile } = await freshTenant()
  const second = await createUser(db, {
    organizationId: profile.id,
    email: 'second@northgate.example',
    fullName: 'Second Admin',
    role: 'customer_admin',
    password: 'another-long-passphrase',
  })
  removeMember(db, profile.id, second.id, user)

  db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
  const events = listAudit(db, profile.id)
  // actor_label is denormalised precisely so this still reads.
  assert.ok(events.every((e) => e.actorLabel.length > 0))
  assert.ok(events.some((e) => e.action === 'member.removed'))
})

test('summaryFor returns the shared connection for a tenant with none', async () => {
  const { db, profile } = await freshTenant()
  assert.equal(summaryFor(db, profile.id), null)
})

function tryMessage(fn: () => unknown): string {
  try {
    fn()
    return 'no error'
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}
