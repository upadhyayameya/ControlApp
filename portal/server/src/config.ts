// ---------------------------------------------------------------------------
// Runtime configuration, read once at startup.
//
// Secrets come from the environment and never from the repository. The ESPM
// password in particular is read here and nowhere else; see .env.example.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

function resolveTrustProxy(): number | false {
  const value = env('TRUST_PROXY')
  if (value === undefined) return false
  const hops = Number(value)
  return Number.isFinite(hops) && hops > 0 ? hops : false
}

function resolveWebOrigin(): string | null {
  const value = env('WEB_ORIGIN')
  if (value) return value
  // Only in development is there a separate origin to allow by default.
  return isProduction ? null : 'http://localhost:5173'
}

function resolvePublicOrigin(): string {
  // RENDER_EXTERNAL_URL is injected by Render and is the full https:// origin
  // the service is reachable at. Honouring it means the hostname does not have
  // to be copied by hand into an env var after the first deploy — which is
  // exactly the step someone forgets, and the failure is invitation links that
  // point at the wrong place.
  const value = env('PUBLIC_ORIGIN') ?? env('RENDER_EXTERNAL_URL') ?? env('WEB_ORIGIN')
  if (value) return value
  if (isProduction) {
    // Invitation and password links are built from this. Defaulting to
    // localhost would send customers a link that cannot possibly work, and
    // nothing would surface the mistake until someone clicked one.
    throw new Error('PUBLIC_ORIGIN must be set in production (e.g. https://portal.example.com).')
  }
  return 'http://localhost:5173'
}

/** portal/web/dist, from either server/src/config.ts or server/dist/config.js. */
function defaultWebDist(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist')
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
  /**
   * Origin the browser app is served from, when it is served from a *different*
   * origin than the API. That is the development setup: Vite on :5173, the API
   * on :4000. A deployment serves the built app from this same process, so
   * there is no second origin and CORS should be off entirely — an
   * Access-Control-Allow-Origin header naming a stale dev host, with
   * credentials allowed, is a way in that nothing needs.
   */
  webOrigin: resolveWebOrigin(),
  espm: {
    mode: resolveEspmMode(),
    /** ESPM's own test environment, which is what the HBS test account lives in. */
    environment: (env('ESPM_ENVIRONMENT') ?? 'test') as 'test' | 'live',
    username: env('ESPM_USERNAME') ?? 'fixture-user',
    password: env('ESPM_PASSWORD') ?? 'fixture-pass',
    /** ESPM account id for the shared HBS service-provider connection. */
    accountId: env('ESPM_ACCOUNT_ID') ? Number(env('ESPM_ACCOUNT_ID')) : null,
  },
  /**
   * Where the built browser app lives.
   *
   * Resolved from this module's own location rather than the working
   * directory, so it is right whether the process was started from the
   * workspace root, from server/, or by a host that picks its own cwd. Getting
   * this wrong is silent: the API works and every page is a 404.
   */
  webDistPath: env('WEB_DIST_PATH') ?? defaultWebDist(),
  /**
   * How many reverse-proxy hops to trust for the client address. Off by
   * default: trusting a header nobody set lets a caller spoof their IP past
   * the rate limiter. Set to the number of proxies in front of the app (1 for
   * a single load balancer).
   */
  trustProxy: resolveTrustProxy(),
  /** Public origin, used to build invitation links. */
  publicOrigin: resolvePublicOrigin(),
  /**
   * Outbound email. Unset in development, where the outbox is written to the
   * database and rendered in the UI instead of being delivered.
   */
  email: {
    enabled: env('SMTP_HOST') !== undefined,
    host: env('SMTP_HOST'),
    port: Number(env('SMTP_PORT') ?? 587),
    /** Optional: relays on a private network often need no credentials. */
    user: env('SMTP_USER'),
    password: env('SMTP_PASSWORD'),
    from: env('MAIL_FROM') ?? 'portal@hbssolutions.example',
    /** Replies to this address are threaded back into the portal. */
    replyToDomain: env('MAIL_REPLY_DOMAIN') ?? 'reply.hbssolutions.example',
  },
} as const
