// ---------------------------------------------------------------------------
// Portfolio Manager connections, per tenant.
//
// Two shapes, one code path. A row with `organization_id` NULL is the shared
// HBS service-provider account that customers share properties into; a row
// with an organization is that customer's own ENERGY STAR account, connected
// by them. Which one a request uses is decided here and nowhere else.
//
// Credentials are encrypted at rest (services/secrets.ts) because ESPM speaks
// HTTP Basic and the password therefore has to be replayable. The summary type
// returned to the browser never carries it.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { EspmConnection, EspmConnectionSummary, User } from '@hbs/shared'
import { config } from '../config.js'
import type { Db } from '../db/index.js'
import { toConnection, type ConnectionRow } from '../db/rows.js'
import { EspmApiError, EspmClient } from '../espm/client.js'
import { fixtureTransport, isFixtureMode } from '../espm/factory.js'
import { record } from './audit.js'
import { decryptSecret, encryptSecret } from './secrets.js'

export interface ConnectionRowWithSecret extends ConnectionRow {
  status: string
  last_error: string | null
  verified_at: string | null
  secret_ciphertext: string | null
  secret_iv: string | null
  secret_tag: string | null
}

export class ConnectionError extends Error {
  constructor(
    override readonly message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * The connection a request should use: the organization's own if it has a
 * working one, otherwise the shared HBS account. Every sync goes through here,
 * so adding a third arrangement later is a change to this function alone.
 */
export function connectionFor(db: Db, organizationId: string | null): EspmConnection {
  if (organizationId) {
    const own = db
      .prepare<[string], ConnectionRowWithSecret>(
        `SELECT * FROM espm_connections
         WHERE organization_id = ? AND active = 1
         ORDER BY status = 'connected' DESC LIMIT 1`,
      )
      .get(organizationId)
    if (own) return toConnection(own)
  }

  const shared = db
    .prepare<[], ConnectionRowWithSecret>(
      'SELECT * FROM espm_connections WHERE organization_id IS NULL AND active = 1 LIMIT 1',
    )
    .get()
  if (!shared) throw new ConnectionError('No Portfolio Manager connection is configured.', 503)
  return toConnection(shared)
}

export function summaryFor(db: Db, organizationId: string | null): EspmConnectionSummary | null {
  const row = organizationId
    ? db
        .prepare<[string], ConnectionRowWithSecret>(
          `SELECT * FROM espm_connections WHERE organization_id = ? AND active = 1
           ORDER BY status = 'connected' DESC LIMIT 1`,
        )
        .get(organizationId)
    : db
        .prepare<[], ConnectionRowWithSecret>(
          'SELECT * FROM espm_connections WHERE organization_id IS NULL AND active = 1 LIMIT 1',
        )
        .get()
  if (!row) return null
  return toSummary(row)
}

export function toSummary(row: ConnectionRowWithSecret): EspmConnectionSummary {
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    environment: row.environment === 'live' ? 'live' : 'test',
    scope: row.organization_id === null ? 'shared-hbs' : 'own-account',
    status: normalizeStatus(row.status),
    lastError: row.last_error,
    verifiedAt: row.verified_at,
    lastPullAt: row.last_pull_at,
  }
}

function normalizeStatus(value: string | null): EspmConnectionSummary['status'] {
  return value === 'connected' || value === 'error' ? value : 'unverified'
}

/**
 * Resolve the password for a connection.
 *
 * The shared HBS account reads from the environment; a tenant's own account
 * decrypts what they supplied. Returning null (rather than falling back to the
 * shared password) matters: silently authenticating as HBS against a
 * customer's account would be both wrong and very hard to notice.
 */
export function passwordFor(db: Db, connectionId: string): string | null {
  const row = db
    .prepare<[string], ConnectionRowWithSecret>('SELECT * FROM espm_connections WHERE id = ?')
    .get(connectionId)
  if (!row) return null
  if (row.organization_id === null) return config.espm.password
  return decryptSecret({
    ciphertext: row.secret_ciphertext ?? undefined,
    iv: row.secret_iv ?? undefined,
    tag: row.secret_tag ?? undefined,
  })
}

/**
 * Store a tenant's ENERGY STAR credentials, after proving they work.
 *
 * Verification happens before the write, so a mistyped password is an error
 * message rather than a connection that appears fine until the first sync
 * fails hours later.
 */
export async function connectOwnAccount(
  db: Db,
  input: {
    organizationId: string
    organizationName: string
    username: string
    password: string
    environment: 'test' | 'live'
    actor: User
  },
): Promise<EspmConnectionSummary> {
  const probe = new EspmClient({
    username: input.username,
    password: input.password,
    environment: input.environment,
    transport: isFixtureMode() ? fixtureTransport() : undefined,
    maxRetries: 1,
  })

  let accountId: number
  try {
    accountId = (await probe.getAccount()).id
  } catch (err) {
    const detail =
      err instanceof EspmApiError
        ? err.message
        : 'Could not reach Portfolio Manager. Check the username and password and try again.'
    throw new ConnectionError(detail, 400)
  }

  const sealed = encryptSecret(input.password)
  const now = new Date().toISOString()

  // One active connection per organization: replacing supersedes rather than
  // accumulating rows nobody can tell apart.
  const existing = db
    .prepare<[string], ConnectionRowWithSecret>(
      'SELECT * FROM espm_connections WHERE organization_id = ? AND active = 1',
    )
    .get(input.organizationId)

  const id = existing?.id ?? randomUUID()

  if (existing) {
    db.prepare(
      `UPDATE espm_connections
       SET username = ?, environment = ?, espm_account_id = ?, status = 'connected',
           last_error = NULL, verified_at = ?,
           secret_ciphertext = ?, secret_iv = ?, secret_tag = ?
       WHERE id = ?`,
    ).run(
      input.username,
      input.environment,
      accountId,
      now,
      sealed.ciphertext,
      sealed.iv,
      sealed.tag,
      id,
    )
  } else {
    db.prepare(
      `INSERT INTO espm_connections
         (id, label, organization_id, espm_account_id, username, environment, active, created_at,
          status, verified_at, secret_ciphertext, secret_iv, secret_tag)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'connected', ?, ?, ?, ?)`,
    ).run(
      id,
      `${input.organizationName} — Portfolio Manager`,
      input.organizationId,
      accountId,
      input.username,
      input.environment,
      now,
      now,
      sealed.ciphertext,
      sealed.iv,
      sealed.tag,
    )
  }

  record(db, {
    organizationId: input.organizationId,
    actor: input.actor,
    action: 'espm.connected',
    targetType: 'espm_connection',
    targetId: id,
    targetLabel: input.username,
    detail: `${input.environment} environment, account ${accountId}`,
  })

  return summaryFor(db, input.organizationId)!
}

export function disconnect(db: Db, organizationId: string, actor: User): void {
  const row = db
    .prepare<[string], ConnectionRowWithSecret>(
      'SELECT * FROM espm_connections WHERE organization_id = ? AND active = 1',
    )
    .get(organizationId)
  if (!row) throw new ConnectionError('There is no connection to remove.', 404)

  // Deactivated and stripped of the credential rather than deleted: the sync
  // runs that reference it stay readable, which is the point of an audit trail.
  db.prepare(
    `UPDATE espm_connections
     SET active = 0, status = 'unverified', secret_ciphertext = NULL, secret_iv = NULL,
         secret_tag = NULL, verified_at = NULL
     WHERE id = ?`,
  ).run(row.id)

  record(db, {
    organizationId,
    actor,
    action: 'espm.disconnected',
    targetType: 'espm_connection',
    targetId: row.id,
    targetLabel: row.username,
  })
}

/** Records why a sync failed, so the settings page can explain itself. */
export function markConnectionError(db: Db, connectionId: string, message: string): void {
  db.prepare("UPDATE espm_connections SET status = 'error', last_error = ? WHERE id = ?").run(
    message.slice(0, 500),
    connectionId,
  )
}

export function markConnectionHealthy(db: Db, connectionId: string): void {
  db.prepare(
    "UPDATE espm_connections SET status = 'connected', last_error = NULL, verified_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), connectionId)
}
