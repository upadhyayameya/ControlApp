// ---------------------------------------------------------------------------
// The outbox drain, exercised against a real SMTP conversation.
//
// A stub transport would prove the SQL and nothing about the part that
// actually breaks in a deployment, so these tests stand up a socket that
// speaks enough SMTP for nodemailer to complete a delivery — and, in the
// failure test, one that rejects the recipient the way a real relay does.
// ---------------------------------------------------------------------------

import assert from 'node:assert/strict'
import net from 'node:net'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { migrate } from '../db/index.js'
import { config } from '../config.js'

interface FakeSmtp {
  port: number
  received: string[]
  close: () => Promise<void>
}

/**
 * The smallest server nodemailer will talk to. `reject` makes it refuse every
 * recipient, which is how a bad address fails in the real world.
 */
async function startSmtp(reject = false): Promise<FakeSmtp> {
  const received: string[] = []

  const server = net.createServer((socket) => {
    let buffer = ''
    let inData = false
    let message = ''

    socket.write('220 test.local ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      let index: number
      while ((index = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)

        if (inData) {
          if (line === '.') {
            inData = false
            received.push(message)
            message = ''
            socket.write('250 OK queued\r\n')
          } else {
            message += `${line}\n`
          }
          continue
        }

        const verb = line.split(' ')[0]?.toUpperCase()
        if (verb === 'EHLO' || verb === 'HELO') {
          // No STARTTLS and no AUTH advertised: this is a plain relay.
          socket.write('250-test.local\r\n250 8BITMIME\r\n')
        } else if (verb === 'MAIL') {
          socket.write('250 OK\r\n')
        } else if (verb === 'RCPT') {
          socket.write(reject ? '550 No such recipient\r\n' : '250 OK\r\n')
        } else if (verb === 'DATA') {
          inData = true
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
        } else if (verb === 'QUIT') {
          socket.write('221 Bye\r\n')
          socket.end()
        } else {
          socket.write('250 OK\r\n')
        }
      }
    })
    socket.on('error', () => {})
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')

  return {
    port: address.port,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}

function queue(db: Database.Database, to: string[], threadId: string | null = null): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO email_outbox (id, thread_id, to_addresses, subject, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
  ).run(id, threadId, JSON.stringify(to), 'Invitation', 'Body text', new Date().toISOString())
  return id
}

function statusOf(db: Database.Database, id: string) {
  return db
    .prepare<[string], { status: string; attempts: number; error: string | null; next_attempt_at: string | null }>(
      'SELECT status, attempts, error, next_attempt_at FROM email_outbox WHERE id = ?',
    )
    .get(id)
}

let smtp: FakeSmtp
let rejecting: FakeSmtp

before(async () => {
  smtp = await startSmtp()
  rejecting = await startSmtp(true)
})

after(async () => {
  await smtp.close()
  await rejecting.close()
})

function db(): Database.Database {
  const database = new Database(':memory:')
  migrate(database, true)
  return database
}

/**
 * config is read once at import, so the tests point it at the fake server by
 * assignment. Ugly, and better than making every caller pass a transport just
 * so a test can reach in.
 */
function pointAt(port: number): void {
  const email = config.email as { enabled: boolean; host?: string; port: number }
  email.enabled = true
  email.host = '127.0.0.1'
  email.port = port
}

test('a queued message is delivered and marked sent', async () => {
  pointAt(smtp.port)
  const { drainOutbox } = await import(`./mailer.js?smtp=${smtp.port}`)
  const database = db()
  const id = queue(database, ['someone@example.com'])

  const result = await drainOutbox(database)
  assert.equal(result.sent, 1)
  assert.equal(result.failed, 0)

  const row = statusOf(database, id)
  assert.equal(row?.status, 'sent')
  assert.equal(row?.attempts, 1)
  assert.ok(smtp.received.some((m) => m.includes('someone@example.com')))
  assert.ok(smtp.received.some((m) => m.includes('Body text')))
})

test('a message with no usable recipient fails without being retried', async () => {
  pointAt(smtp.port)
  const { drainOutbox } = await import(`./mailer.js?smtp=${smtp.port}`)
  const database = db()
  const id = queue(database, [])

  const result = await drainOutbox(database)
  assert.equal(result.failed, 1)
  assert.equal(statusOf(database, id)?.status, 'failed')
})

test('a rejected message is retried later, not dropped and not resent now', async () => {
  pointAt(rejecting.port)
  const { drainOutbox } = await import(`./mailer.js?smtp=${rejecting.port}`)
  const database = db()
  const id = queue(database, ['nobody@example.com'])

  await drainOutbox(database)
  const first = statusOf(database, id)
  // Still queued, one attempt spent, and scheduled for the future.
  assert.equal(first?.status, 'queued')
  assert.equal(first?.attempts, 1)
  assert.ok(first?.next_attempt_at !== null)
  assert.ok(new Date(first?.next_attempt_at ?? 0).getTime() > Date.now())

  // A second drain now must not touch it — that is what next_attempt_at is for.
  const second = await drainOutbox(database)
  assert.equal(second.sent, 0)
  assert.equal(statusOf(database, id)?.attempts, 1)
})
