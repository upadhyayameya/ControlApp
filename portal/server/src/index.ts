// ---------------------------------------------------------------------------
// Server entry point.
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { getDb } from './db/index.js'
import { api } from './routes/index.js'
import { platform } from './routes/platform.js'
import { errorHandler } from './middleware/errors.js'
import { loadSession } from './middleware/auth.js'
import { purgeExpiredSessions } from './services/auth.js'
import { startScheduler } from './services/scheduler.js'

const app = express()

// Behind a load balancer or reverse proxy the client's real address arrives in
// X-Forwarded-For. Express only believes it when told which hops to trust, and
// trusting blindly would let anyone spoof their address past the rate limiter —
// so this is opt-in through TRUST_PROXY.
if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy)

// CORS only exists for the split-origin development setup. When the app is
// served from this same process there is no second origin, and adding the
// headers anyway would only widen what can reach the API with credentials.
if (config.webOrigin) {
  app.use(
    cors({
      origin: config.webOrigin,
      // The session cookie is HttpOnly, so the browser only sends it when the
      // request is made with credentials and the origin is explicitly allowed.
      credentials: true,
    }),
  )
}
app.use(express.json({ limit: '1mb' }))
app.use(cookieWriter)
app.use(loadSession)

// Liveness: the process is up. Deliberately does not touch the database, so a
// database problem does not get the container killed and restarted in a loop
// when restarting is not the fix.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, espmMode: config.espm.mode })
})

// Readiness: it can actually serve. A failing query here means take this
// instance out of rotation.
app.get('/api/ready', (_req, res) => {
  try {
    db.prepare('SELECT 1').get()
    res.json({ ready: true })
  } catch (err) {
    res.status(503).json({ ready: false, error: err instanceof Error ? err.message : 'unknown' })
  }
})

app.use('/api', platform)
app.use('/api', api)
app.use(errorHandler)

// Serve the built web app, when there is one.
//
// The history fallback is the part that matters: the portal is a
// single-page app, so a deep link like /settings/team or /hbs has no file
// behind it. Without this, opening one of those URLs directly — or refreshing
// on it — is a 404, which is exactly what a customer does with a bookmark.
const webDist = config.webDistPath
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist, { index: false }))
  app.get('*', (req, res, next) => {
    // Anything under /api that reached here is a genuine 404, not a route for
    // the browser to resolve.
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(webDist, 'index.html'))
  })
  console.log(`[portal] serving the web app from ${webDist}`)
}

const db = getDb()
const purged = purgeExpiredSessions(db)
const scheduler = startScheduler(db)

const server = app.listen(config.port, () => {
  console.log(`[portal] listening on http://localhost:${config.port}`)
  console.log(`[portal] database  ${config.databasePath}`)
  console.log(
    `[portal] ESPM mode ${config.espm.mode}${
      config.espm.mode === 'fixture'
        ? ' — replaying recorded responses, nothing leaves this machine'
        : ` — live against the ${config.espm.environment} environment as ${config.espm.username}`
    }`,
  )
  if (purged > 0) console.log(`[portal] purged ${purged} expired session(s)`)

  if (config.isProduction && config.espm.mode === 'fixture') {
    // Running a deployment on recorded responses would look like it worked
    // while silently syncing nothing real.
    console.warn(
      '[portal] WARNING: production with ESPM in fixture mode — no data will sync from ' +
        'Portfolio Manager. Set ESPM_USERNAME and ESPM_PASSWORD, or have each tenant ' +
        'connect their own account.',
    )
  }
})

/**
 * Shut down without dropping requests.
 *
 * A container gets SIGTERM and then a hard kill, so the work here is to stop
 * accepting, let in-flight requests finish, and close the database — an
 * interrupted SQLite write is how a WAL ends up needing recovery. The timer is
 * unref'd so it never itself keeps the process alive.
 */
let shuttingDown = false
function shutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[portal] ${signal} received, finishing in-flight requests`)

  scheduler.stop()

  const force = setTimeout(() => {
    console.error('[portal] shutdown timed out, exiting anyway')
    process.exit(1)
  }, 10_000)
  force.unref()

  server.close(() => {
    try {
      db.close()
    } catch (err) {
      console.error('[portal] error closing the database', err)
    }
    clearTimeout(force)
    console.log('[portal] stopped cleanly')
    process.exit(0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

/**
 * A three-line cookie setter, so the app does not carry cookie-parser just to
 * write one cookie. Reading is handled in middleware/auth.ts.
 */
function cookieWriter(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  res.cookie = ((name: string, value: string, options: Record<string, unknown> = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/']
    if (options['httpOnly']) parts.push('HttpOnly')
    if (options['secure']) parts.push('Secure')
    if (options['sameSite']) parts.push(`SameSite=${String(options['sameSite'])}`)
    if (options['expires'] instanceof Date) parts.push(`Expires=${options['expires'].toUTCString()}`)
    res.append('Set-Cookie', parts.join('; '))
    return res
  }) as express.Response['cookie']

  res.clearCookie = ((name: string) => {
    res.append('Set-Cookie', `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`)
    return res
  }) as express.Response['clearCookie']

  next()
}
