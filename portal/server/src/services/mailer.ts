// ---------------------------------------------------------------------------
// Draining the email outbox.
//
// Everything outbound is written to `email_outbox` first and delivered from
// here, rather than sent inline. Two reasons, both learned the hard way by
// anyone who has done it the other way:
//
//   1. An invitation is a database row. If SMTP is down when an admin invites
//      someone, the invitation still exists and its link still works — a mail
//      failure loses a notification, not the grant.
//   2. Sending inline makes an HTTP request as slow, and as failure-prone, as
//      the slowest mail server on the other end.
//
// With no SMTP_HOST configured nothing here runs at all and rows stay queued,
// which is the development behaviour: the outbox is visible in the UI and an
// admin can copy an invitation link out by hand.
// ---------------------------------------------------------------------------

import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { config } from '../config.js'
import type { Db } from '../db/index.js'
import { replyToAddress } from './messaging.js'

/** After this many failures a message stops being retried. */
const MAX_ATTEMPTS = 5

/** How long to wait before attempt n+1: 1, 5, 25, 125 minutes. */
function backoffMs(attempts: number): number {
  return 60_000 * 5 ** Math.min(attempts - 1, 3)
}

interface OutboxRow {
  id: string
  thread_id: string | null
  to_addresses: string
  subject: string
  body: string
  attempts: number
}

let transporter: Transporter | null = null

function getTransporter(): Transporter | null {
  if (!config.email.enabled || !config.email.host) return null
  if (transporter) return transporter
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    // 465 is implicit TLS; everything else starts plaintext and upgrades with
    // STARTTLS, which nodemailer requires when the server offers it.
    secure: config.email.port === 465,
    auth:
      config.email.user && config.email.password
        ? { user: config.email.user, pass: config.email.password }
        : undefined,
  })
  return transporter
}

/**
 * Send whatever is due. Returns what happened, so a caller (a test, or the
 * scheduler's log line) can see it without reading the database.
 *
 * Messages are sent one at a time on purpose. The volume is invitations and
 * thread notifications, not a newsletter, and one connection reused serially
 * is both simpler and kinder to the relay than a burst.
 */
export async function drainOutbox(db: Db, limit = 25): Promise<{ sent: number; failed: number }> {
  const mail = getTransporter()
  if (!mail) return { sent: 0, failed: 0 }

  const now = new Date().toISOString()
  const rows = db
    .prepare<[string, number], OutboxRow>(
      `SELECT id, thread_id, to_addresses, subject, body, attempts
         FROM email_outbox
        WHERE status = 'queued'
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at
        LIMIT ?`,
    )
    .all(now, limit)

  let sent = 0
  let failed = 0

  for (const row of rows) {
    const to = parseAddresses(row.to_addresses)
    if (to.length === 0) {
      // Nothing to send to. Retrying cannot fix an empty recipient list.
      markFailed(db, row.id, row.attempts + 1, 'no valid recipient addresses')
      failed += 1
      continue
    }

    try {
      await mail.sendMail({
        from: config.email.from,
        to,
        subject: row.subject,
        text: row.body,
        // Replies to a thread notification come back into the portal; an
        // invitation has no thread, so it keeps the default reply-to.
        ...(row.thread_id ? { replyTo: replyToAddress(row.thread_id) } : {}),
      })
      db.prepare(
        `UPDATE email_outbox
            SET status = 'sent', sent_at = ?, attempts = ?, error = NULL, next_attempt_at = NULL
          WHERE id = ?`,
      ).run(new Date().toISOString(), row.attempts + 1, row.id)
      sent += 1
    } catch (err) {
      const attempts = row.attempts + 1
      const message = err instanceof Error ? err.message : String(err)
      if (attempts >= MAX_ATTEMPTS) {
        markFailed(db, row.id, attempts, message)
        failed += 1
      } else {
        db.prepare(
          `UPDATE email_outbox SET attempts = ?, error = ?, next_attempt_at = ? WHERE id = ?`,
        ).run(attempts, message, new Date(Date.now() + backoffMs(attempts)).toISOString(), row.id)
      }
    }
  }

  return { sent, failed }
}

function markFailed(db: Db, id: string, attempts: number, error: string): void {
  db.prepare(
    `UPDATE email_outbox SET status = 'failed', attempts = ?, error = ?, next_attempt_at = NULL
      WHERE id = ?`,
  ).run(attempts, error, id)
}

/**
 * Recipients are stored as a JSON array. Anything else in that column is a bug
 * elsewhere, and reading it should not take the sender down with it.
 */
function parseAddresses(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((a): a is string => typeof a === 'string' && a.includes('@'))
  } catch {
    return []
  }
}

/** True when mail is configured; used to decide whether to run the scheduler. */
export function mailConfigured(): boolean {
  return getTransporter() !== null
}
