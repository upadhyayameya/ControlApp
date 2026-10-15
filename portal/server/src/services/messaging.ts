// ---------------------------------------------------------------------------
// Communication tracking: portal threads that are also email threads.
//
// The design goal from the notes was "direct messages, and/or an email CC
// system similar to what we have for Monday". So: the thread in the database
// is the record of truth, and email is a mirror of it in both directions.
//
//   * A portal reply is written to the thread, then queued to the thread's CC
//     list in the same transaction. Delivery can fail; the message cannot be
//     lost, because it is already in the thread.
//   * An inbound email is matched back to its thread by a token in the
//     reply-to address, so a customer who just hits Reply stays in the thread
//     without knowing the portal exists.
// ---------------------------------------------------------------------------

import { createHmac, randomUUID } from 'node:crypto'
import type { Message, MessageThread } from '@hbs/shared'
import { config } from '../config.js'
import type { Db } from '../db/index.js'
import { toMessage, toThread, type MessageRow, type ThreadRow } from '../db/rows.js'

export interface CreateThreadInput {
  organizationId: string
  buildingId?: string | null
  subject: string
  body: string
  emailCcAddresses?: string[]
  author: { id: string; name: string }
}

export function createThread(db: Db, input: CreateThreadInput): MessageThread {
  const threadId = randomUUID()
  const now = new Date().toISOString()
  const cc = normalizeAddresses(input.emailCcAddresses ?? [])

  db.transaction(() => {
    db.prepare(
      `INSERT INTO message_threads
         (id, organization_id, building_id, subject, status, email_cc_addresses,
          created_by_user_id, last_message_at, created_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    ).run(
      threadId,
      input.organizationId,
      input.buildingId ?? null,
      input.subject,
      JSON.stringify(cc),
      input.author.id,
      now,
      now,
    )
    insertMessage(db, {
      threadId,
      authorUserId: input.author.id,
      authorName: input.author.name,
      body: input.body,
      channel: 'portal',
      at: now,
    })
    if (cc.length > 0) queueEmail(db, threadId, cc, input.subject, input.body, input.author.name)
  })()

  return getThread(db, threadId)!
}

export function postMessage(
  db: Db,
  threadId: string,
  body: string,
  author: { id: string | null; name: string; email?: string | null },
  channel: 'portal' | 'email' = 'portal',
): Message {
  const thread = getThread(db, threadId)
  if (!thread) throw new Error(`No such thread: ${threadId}`)
  const now = new Date().toISOString()
  const messageId = randomUUID()

  db.transaction(() => {
    insertMessage(db, {
      id: messageId,
      threadId,
      authorUserId: author.id,
      authorEmail: author.email ?? null,
      authorName: author.name,
      body,
      channel,
      at: now,
    })
    db.prepare('UPDATE message_threads SET last_message_at = ?, status = ? WHERE id = ?').run(
      now,
      // Any new message reopens a closed thread; a customer replying to a
      // resolved issue should not be silently filed away.
      'open',
      threadId,
    )
    // Do not bounce an inbound email straight back to the person who sent it.
    const recipients =
      channel === 'email'
        ? thread.emailCcAddresses.filter((a) => a.toLowerCase() !== author.email?.toLowerCase())
        : thread.emailCcAddresses
    if (recipients.length > 0) {
      queueEmail(db, threadId, recipients, `Re: ${thread.subject}`, body, author.name)
    }
  })()

  const row = db.prepare<[string], MessageRow>('SELECT * FROM messages WHERE id = ?').get(messageId)!
  return toMessage(row)
}

export function getThread(db: Db, threadId: string): MessageThread | null {
  const row = db
    .prepare<[string], ThreadRow>('SELECT * FROM message_threads WHERE id = ?')
    .get(threadId)
  return row ? toThread(row) : null
}

export function listThreads(
  db: Db,
  organizationId: string | null,
  buildingId?: string,
): MessageThread[] {
  const clauses: string[] = []
  const params: string[] = []
  if (organizationId) {
    clauses.push('organization_id = ?')
    params.push(organizationId)
  }
  if (buildingId) {
    clauses.push('building_id = ?')
    params.push(buildingId)
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return db
    .prepare<string[], ThreadRow>(
      `SELECT * FROM message_threads ${where} ORDER BY last_message_at DESC`,
    )
    .all(...params)
    .map(toThread)
}

export function listMessages(db: Db, threadId: string): Message[] {
  return db
    .prepare<[string], MessageRow>(
      'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at',
    )
    .all(threadId)
    .map(toMessage)
}

export function setThreadStatus(db: Db, threadId: string, status: 'open' | 'closed'): void {
  db.prepare('UPDATE message_threads SET status = ? WHERE id = ?').run(status, threadId)
}

// --- Email bridge ---------------------------------------------------------

/**
 * The address customers reply to. The thread id is signed into the local part
 * so an inbound message can be routed without a lookup table, and so a guessed
 * address does not let an outsider post into someone else's thread.
 */
export function replyToAddress(threadId: string): string {
  return `thread+${threadId}.${signThreadId(threadId)}@${config.email.replyToDomain}`
}

/** Inverse of replyToAddress. Returns null when the signature does not check out. */
export function threadIdFromReplyAddress(address: string): string | null {
  const match = /thread\+([0-9a-f-]{36})\.([0-9a-f]+)@/i.exec(address)
  const threadId = match?.[1]
  const signature = match?.[2]
  if (!threadId || !signature) return null
  return signature === signThreadId(threadId) ? threadId : null
}

function signThreadId(threadId: string): string {
  return createHmac('sha256', config.sessionSecret).update(threadId).digest('hex').slice(0, 16)
}

/**
 * Handle a message that arrived by email. Unknown senders are dropped rather
 * than creating a thread — the signed address proves which thread, but not
 * that the sender is entitled to post to it, so we additionally require the
 * address to be on the thread's CC list or belong to a user in the org.
 */
export function ingestInboundEmail(
  db: Db,
  input: { to: string; from: string; fromName?: string; body: string },
): Message | null {
  const threadId = threadIdFromReplyAddress(input.to)
  if (!threadId) return null
  const thread = getThread(db, threadId)
  if (!thread) return null

  const from = input.from.trim().toLowerCase()
  const onCcList = thread.emailCcAddresses.some((a) => a.toLowerCase() === from)
  const isOrgMember =
    db
      .prepare<[string, string], { n: number }>(
        'SELECT COUNT(*) AS n FROM users WHERE email = ? COLLATE NOCASE AND organization_id = ?',
      )
      .get(from, thread.organizationId)?.n ?? 0

  if (!onCcList && isOrgMember === 0) return null

  return postMessage(
    db,
    threadId,
    stripQuotedReply(input.body),
    { id: null, name: input.fromName ?? input.from, email: input.from },
    'email',
  )
}

/**
 * Trim the quoted history most mail clients append, so a thread does not
 * accumulate the same text N times. Deliberately conservative: it only cuts at
 * markers that are unambiguous.
 */
export function stripQuotedReply(body: string): string {
  const markers = [
    /^On .+ wrote:$/m,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
    /^_{10,}$/m,
    /^From:\s.+$/m,
  ]
  let cut = body.length
  for (const marker of markers) {
    const match = marker.exec(body)
    if (match?.index !== undefined && match.index < cut) cut = match.index
  }
  return body.slice(0, cut).trimEnd()
}

function insertMessage(
  db: Db,
  m: {
    id?: string
    threadId: string
    authorUserId: string | null
    authorEmail?: string | null
    authorName: string
    body: string
    channel: 'portal' | 'email'
    at: string
  },
): void {
  db.prepare(
    `INSERT INTO messages (id, thread_id, author_user_id, author_email, author_name, body, channel, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    m.id ?? randomUUID(),
    m.threadId,
    m.authorUserId,
    m.authorEmail ?? null,
    m.authorName,
    m.body,
    m.channel,
    m.at,
  )
}

/**
 * Queue an outbound copy. Nothing here sends mail — wiring an SMTP transport
 * means draining this table, and until then the outbox is visible in the UI so
 * the behaviour is inspectable rather than invisible.
 */
function queueEmail(
  db: Db,
  threadId: string,
  to: string[],
  subject: string,
  body: string,
  authorName: string,
): void {
  db.prepare(
    `INSERT INTO email_outbox (id, thread_id, to_addresses, subject, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
  ).run(
    randomUUID(),
    threadId,
    JSON.stringify(to),
    subject,
    `${authorName} wrote:\n\n${body}\n\n--\nReply to this email to respond in the HBS portal.`,
    new Date().toISOString(),
  )
}

function normalizeAddresses(addresses: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of addresses) {
    const address = raw.trim().toLowerCase()
    if (address === '' || !address.includes('@') || seen.has(address)) continue
    seen.add(address)
    out.push(address)
  }
  return out
}
