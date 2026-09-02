// ---------------------------------------------------------------------------
// Runtime configuration, read once at startup.
//
// Secrets come from the environment and never from the repository. The ESPM
// password in particular is read here and nowhere else; see .env.example.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import path from 'node:path'

function env(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

const isProduction = env('NODE_ENV') === 'production'

/**
 * ESPM mode:
 *   'fixture' — replay recorded XML; no credentials, no network. The default,
 *               so `npm run dev` works for anyone who just cloned the repo.
 *   'live'    — talk to Portfolio Manager using ESPM_USERNAME / ESPM_PASSWORD.
 */
export type EspmMode = 'fixture' | 'live'

function resolveEspmMode(): EspmMode {
  const explicit = env('ESPM_MODE')
  if (explicit === 'live' || explicit === 'fixture') return explicit
  return env('ESPM_USERNAME') && env('ESPM_PASSWORD') ? 'live' : 'fixture'
}

/**
 * Key for credentials the portal must replay (a customer's ESPM password).
 * Distinct from SESSION_SECRET on purpose: rotating session signing should not
 * make every stored credential undecryptable, and the two have different
 * blast radii if leaked.
 */
function resolveCredentialKey(): string {
  const value = env('CREDENTIAL_KEY')
  if (value) return value
  if (isProduction) {
    throw new Error('CREDENTIAL_KEY must be set in production.')
  }
  // In development a stable dev-only key keeps stored credentials readable
  // across restarts; a random one would break every connection on each boot.
  return 'development-credential-key-not-for-production'
}

function resolveSessionSecret(): string {
  const secret = env('SESSION_SECRET')
  if (secret) return secret
  if (isProduction) {
    // A random per-boot secret in production would silently sign every user out
    // on each restart and would differ between instances behind a load balancer.
    throw new Error('SESSION_SECRET must be set in production.')
  }
  return randomBytes(32).toString('hex')
}

export const config = {
  isProduction,
  port: Number(env('PORT') ?? 4000),
  databasePath: env('DATABASE_PATH') ?? path.resolve(process.cwd(), 'data/portal.db'),
  sessionSecret: resolveSessionSecret(),
  credentialKey: resolveCredentialKey(),
  sessionTtlHours: Number(env('SESSION_TTL_HOURS') ?? 12),
  /** Origin the browser app is served from, for CORS in development. */
  webOrigin: env('WEB_ORIGIN') ?? 'http://localhost:5173',
  espm: {
    mode: resolveEspmMode(),
    /** ESPM's own test environment, which is what the HBS test account lives in. */
    environment: (env('ESPM_ENVIRONMENT') ?? 'test') as 'test' | 'live',
    username: env('ESPM_USERNAME') ?? 'fixture-user',
    password: env('ESPM_PASSWORD') ?? 'fixture-pass',
    /** ESPM account id for the shared HBS service-provider connection. */
    accountId: env('ESPM_ACCOUNT_ID') ? Number(env('ESPM_ACCOUNT_ID')) : null,
  },
  /** Public origin, used to build invitation links. */
  publicOrigin: env('PUBLIC_ORIGIN') ?? env('WEB_ORIGIN') ?? 'http://localhost:5173',
  /**
   * Outbound email. Unset in development, where the outbox is written to the
   * database and rendered in the UI instead of being delivered.
   */
  email: {
    enabled: env('SMTP_HOST') !== undefined,
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT') ?? 587),
    from: env('MAIL_FROM') ?? 'portal@hbssolutions.example',
    /** Replies to this address are threaded back into the portal. */
    replyToDomain: env('MAIL_REPLY_DOMAIN') ?? 'reply.hbssolutions.example',
  },
} as const
