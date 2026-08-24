#!/usr/bin/env node
// The portal itself: a dependency-free HTTP server that owns the Monarch session,
// keeps a fresh snapshot, serves the dashboard, and pushes updates over SSE.
//
//   node server/server.mjs            # live — sign in at http://127.0.0.1:4174
//   MONARCH_DEMO=1 node server/...    # synthetic data, no account needed
//
// It binds to loopback by default: the session token lives in this process, so
// the surface stays on your machine.

import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MonarchClient, MonarchError, AuthExpiredError, parseSessionPaste } from './monarch.mjs'
import { SessionStore } from './session.mjs'
import { MonarchSource, SnapshotService, TRANSACTION_PAGE, normalizeTransactions } from './snapshot.mjs'
import { DemoSource } from './demo.mjs'
import { GET_TRANSACTIONS } from './queries.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PUBLIC_DIR = join(ROOT, 'public')
const PORT = Number(process.env.PORT || 4174)
const HOST = process.env.HOST || '127.0.0.1'
const DEMO = process.env.MONARCH_DEMO === '1' || process.argv.includes('--demo')
const POLL_MS = Math.max(15, Number(process.env.MONARCH_POLL_SECONDS || 120)) * 1000
const MAX_BODY_BYTES = 64 * 1024

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

const sessions = new SessionStore()
const client = new MonarchClient()
const service = new SnapshotService({
  source: DEMO ? new DemoSource() : new MonarchSource(client),
  intervalMs: POLL_MS,
})

let authEmail = null

if (!DEMO) {
  const saved = sessions.load()
  if (saved?.cookies) {
    try {
      client.setCookies(saved.cookies)
      authEmail = saved.email || null
    } catch {
      sessions.clear()
    }
  } else if (saved?.token) {
    client.token = saved.token
    authEmail = saved.email || null
  }
}

service.on('auth-expired', () => {
  client.clear()
  sessions.clear()
  service.stop()
  broadcast('auth', { authed: false, reason: 'Monarch rejected the saved session. Sign in again.' })
})

if (DEMO || client.authed) service.start()

/* ------------------------------------------------------------ SSE broadcast */

const streams = new Set()

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const stream of streams) {
    try {
      stream.write(frame)
    } catch {
      streams.delete(stream)
    }
  }
}

service.on('snapshot', ({ snapshot, events, activity }) =>
  broadcast('snapshot', { snapshot, events, activity, status: service.status }),
)
service.on('status', (status) => broadcast('status', status))
service.on('activity', (entry) => broadcast('activity', entry))

/* -------------------------------------------------------------------- server */

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)

  try {
    if (url.pathname.startsWith('/api/')) {
      if (!originAllowed(request)) {
        return sendJson(response, 403, { error: 'Cross-origin requests are not allowed.' })
      }
      return await handleApi(request, response, url)
    }
    return serveStatic(request, response, url)
  } catch (error) {
    const status = error instanceof AuthExpiredError ? 401 : error instanceof MonarchError ? 502 : 500
    if (!response.headersSent) sendJson(response, status, { error: error.message || 'Server error' })
    else response.end()
  }
})

async function handleApi(request, response, url) {
  const route = `${request.method} ${url.pathname}`

  switch (route) {
    case 'GET /api/state':
      return sendJson(response, 200, statePayload())

    case 'GET /api/stream':
      return openStream(request, response)

    case 'POST /api/auth/login': {
      const body = await readBody(request)
      const email = String(body.email || '').trim()
      const password = String(body.password || '')
      if (!email || !password) {
        return sendJson(response, 400, { error: 'Email and password are required.' })
      }
      const result = await client.login({ email, password, totp: body.totp || null })
      if (result.status !== 'ok') {
        return sendJson(response, 200, { authed: false, ...result })
      }
      authEmail = email
      sessions.save({ token: client.token, email })
      service.setSource(new MonarchSource(client))
      service.start()
      return sendJson(response, 200, { authed: true, status: 'ok' })
    }

    case 'POST /api/auth/session':
    case 'POST /api/auth/cookie': {
      const body = await readBody(request)
      const { candidates, summary } = parseSessionPaste(body.session ?? body.cookie ?? '')

      // Try each session the paste contained, keeping the first that Monarch
      // actually accepts. Nothing is saved until one has proved itself.
      let failure = null
      for (const candidate of candidates) {
        if (candidate.kind === 'cookies') client.setCookies(candidate.cookies)
        else {
          client.cookies = null
          client.token = candidate.token
        }
        service.setSource(new MonarchSource(client))
        try {
          await service.refresh('browser-session')
          failure = null
          break
        } catch (error) {
          failure = error
        }
      }

      if (failure) {
        client.clear()
        const detail =
          failure instanceof AuthExpiredError
            ? 'Monarch answered 401 — it did not recognise that session.'
            : failure.message
        return sendJson(response, 401, {
          authed: false,
          error:
            `Monarch turned down the session in that paste (found ${summary}). ` +
            `${detail} ` +
            'Copy a request to api.monarch.com from a tab where you are still signed in — ' +
            'the Network tab keeps requests from before you signed in, and those will not work.',
        })
      }

      authEmail = body.email || null
      sessions.save({ token: client.token, cookies: client.cookies, email: authEmail })
      service.start()
      return sendJson(response, 200, { authed: true, status: 'ok', mode: client.mode })
    }

    case 'POST /api/auth/logout': {
      client.clear()
      sessions.clear()
      service.stop()
      service.setSource(DEMO ? new DemoSource() : new MonarchSource(client))
      authEmail = null
      broadcast('auth', { authed: false, reason: 'Signed out.' })
      return sendJson(response, 200, { authed: false })
    }

    case 'POST /api/refresh': {
      requireAuth()
      const snapshot = await service.refresh('manual')
      return sendJson(response, 200, { snapshot, status: service.status })
    }

    case 'POST /api/sync': {
      requireAuth()
      await service.sync()
      return sendJson(response, 200, { status: service.status })
    }

    case 'POST /api/settings': {
      const body = await readBody(request)
      if (body.intervalSeconds != null) service.setInterval(Number(body.intervalSeconds) * 1000)
      return sendJson(response, 200, { status: service.status })
    }

    case 'GET /api/transactions': {
      requireAuth()
      const offset = Math.max(0, Number(url.searchParams.get('offset') || 0))
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || TRANSACTION_PAGE)))
      if (service.source.demo) {
        const rows = (service.snapshot?.transactions ?? []).slice(offset, offset + limit)
        return sendJson(response, 200, { transactions: rows, hasMore: false })
      }
      const data = await client.gql('GetTransactionsList', GET_TRANSACTIONS, {
        offset,
        limit,
        orderBy: 'date',
        filters: {},
      })
      const transactions = normalizeTransactions(data.allTransactions?.results)
      return sendJson(response, 200, {
        transactions,
        hasMore: offset + transactions.length < Number(data.allTransactions?.totalCount || 0),
      })
    }

    default:
      return sendJson(response, 404, { error: `No route for ${route}` })
  }
}

function requireAuth() {
  if (!DEMO && !client.authed) throw new AuthExpiredError('Not signed in to Monarch.')
}

function statePayload() {
  return {
    authed: DEMO || client.authed,
    demo: Boolean(service.source?.demo),
    mode: DEMO ? 'demo' : client.mode,
    email: authEmail,
    status: service.status,
    snapshot: service.snapshot,
    activity: service.activity,
  }
}

function openStream(request, response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  })
  response.write(`event: state\ndata: ${JSON.stringify(statePayload())}\n\n`)
  streams.add(response)

  const heartbeat = setInterval(() => {
    try {
      response.write(': ping\n\n')
    } catch {
      clearInterval(heartbeat)
    }
  }, 25000)
  if (typeof heartbeat.unref === 'function') heartbeat.unref()

  request.on('close', () => {
    clearInterval(heartbeat)
    streams.delete(response)
  })
}

/* -------------------------------------------------------------------- helpers */

/**
 * The server holds a live financial session, so only same-origin callers are
 * accepted: a page on another origin must not be able to drive it.
 */
function originAllowed(request) {
  const origin = request.headers.origin
  if (!origin) return true // curl and same-origin GETs send none
  try {
    const host = new URL(origin).host
    return host === request.headers.host
  } catch {
    return false
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new MonarchError('Request body too large.', { code: 'BODY_TOO_LARGE' }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new MonarchError('Expected a JSON body.', { code: 'BAD_JSON' }))
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  response.end(body)
}

function serveStatic(request, response, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname
  const filePath = join(PUBLIC_DIR, normalize(requested).replace(/^(\.\.[/\\])+/, ''))
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  createReadStream(filePath).pipe(response)
}

server.listen(PORT, HOST, () => {
  const where = `http://${HOST}:${PORT}`
  console.log(`Monarch live dashboard → ${where}`)
  if (DEMO) console.log('Running in demo mode with synthetic data (no Monarch account used).')
  else if (client.authed) console.log(`Reusing saved ${client.mode} session${authEmail ? ` for ${authEmail}` : ''}.`)
  else console.log('No saved session — sign in from the page to connect your Monarch account.')
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    service.stop()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 500).unref()
  })
}
