// ---------------------------------------------------------------------------
// Where an EspmClient comes from.
//
// This is the one place that decides fixture-vs-live and resolves credentials,
// so no other module has to know or care. A connection row names a username;
// the matching password is resolved from the environment and never from the
// database.
// ---------------------------------------------------------------------------

import type { EspmConnection } from '@hbs/shared'
import { config } from '../config.js'
import { EspmClient, type EspmEnvironment } from './client.js'
import { FixtureTransport } from './fixtureTransport.js'

/** Shared across calls so the fixture transport's recorded writes accumulate. */
const sharedFixtureTransport = new FixtureTransport()

export function fixtureTransport(): FixtureTransport {
  return sharedFixtureTransport
}

/**
 * Resolve the password for a connection.
 *
 * Today: the shared HBS account's password comes from ESPM_PASSWORD, and a
 * per-customer connection looks for ESPM_PASSWORD_<CONNECTION_ID>. When
 * per-customer connections become real this should move to a secret manager —
 * the function signature is the seam, and nothing else needs to change.
 */
function resolvePassword(connection: EspmConnection): string {
  if (connection.organizationId === null) return config.espm.password
  const key = `ESPM_PASSWORD_${connection.id.replace(/-/g, '_').toUpperCase()}`
  const specific = process.env[key]
  if (specific && specific.trim() !== '') return specific.trim()
  return config.espm.password
}

export function clientFor(connection: EspmConnection): EspmClient {
  return new EspmClient({
    username: connection.username,
    password: resolvePassword(connection),
    environment: connection.environment as EspmEnvironment,
    transport: config.espm.mode === 'fixture' ? sharedFixtureTransport : undefined,
    logger: (level, message, meta) => {
      const line = `[espm:${level}] ${message}`
      if (level === 'error') console.error(line, meta ?? '')
      else if (level === 'warn') console.warn(line, meta ?? '')
    },
  })
}

/** True when the portal is replaying fixtures rather than calling ESPM. */
export function isFixtureMode(): boolean {
  return config.espm.mode === 'fixture'
}
