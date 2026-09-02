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
import type { Db } from '../db/index.js'
import { passwordFor } from '../services/connections.js'
import { EspmClient, type EspmEnvironment } from './client.js'
import { FixtureTransport } from './fixtureTransport.js'

/** Shared across calls so the fixture transport's recorded writes accumulate. */
const sharedFixtureTransport = new FixtureTransport()

export function fixtureTransport(): FixtureTransport {
  return sharedFixtureTransport
}

/**
 * A client for one connection.
 *
 * The credential comes from services/connections.ts: the environment for the
 * shared HBS account, the tenant's own encrypted record for their own account.
 * A tenant connection with no usable credential is refused rather than falling
 * back to the HBS password — authenticating as HBS against a customer's
 * account would be wrong and nearly invisible.
 */
export function clientFor(db: Db, connection: EspmConnection): EspmClient {
  const password = passwordFor(db, connection.id)
  if (password === null) {
    throw new Error(
      `No stored credential for Portfolio Manager connection "${connection.label}". Reconnect it in settings.`,
    )
  }
  return new EspmClient({
    username: connection.username,
    password,
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
