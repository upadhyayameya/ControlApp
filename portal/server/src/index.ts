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

const app = express()

app.use(
  cors({
    origin: config.webOrigin,
    // The session cookie is HttpOnly, so the browser only sends it when the
    // request is made with credentials and the origin is explicitly allowed.
    credentials: true,
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieWriter)
app.use(loadSession)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, espmMode: config.espm.mode })
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
const webDist = path.resolve(process.cwd(), '../web/dist')
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

app.listen(config.port, () => {
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
})

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
