// ---------------------------------------------------------------------------
// Background work, run in-process.
//
// Two jobs, on very different clocks:
//
//   * draining the email outbox, every minute;
//   * the anomaly sweep, twice a month — the cadence HBS already works to.
//
// In-process rather than a separate worker because the whole application is
// one container and one SQLite file; a second process would contend for the
// same write lock to do less work. The cost is that running two instances runs
// every job twice, which is the same constraint the in-memory rate limiter
// has, and the same fix: when this stops being one container, these move to a
// scheduler with a lock. Both are documented in the README rather than left as
// a surprise.
//
// Every timer is unref'd so a shutdown is not held open by a job that is not
// due for another fortnight.
// ---------------------------------------------------------------------------

import type { Db } from '../db/index.js'
import { runMonitor } from './alerts.js'
import { drainOutbox, mailConfigured } from './mailer.js'

const OUTBOX_INTERVAL_MS = 60_000
const MONITOR_INTERVAL_MS = 12 * 60 * 60_000

/** Days of the month the anomaly sweep runs on — twice monthly. */
const MONITOR_DAYS = [1, 15]

export interface Scheduler {
  stop: () => void
}

export function startScheduler(db: Db): Scheduler {
  const timers: NodeJS.Timeout[] = []

  if (mailConfigured()) {
    timers.push(every(OUTBOX_INTERVAL_MS, async () => {
      const { sent, failed } = await drainOutbox(db)
      if (sent > 0 || failed > 0) {
        console.log(`[mail] sent ${sent}, gave up on ${failed}`)
      }
    }))
    console.log('[portal] outbound email enabled, draining the outbox every minute')
  } else {
    // Said out loud because the failure is otherwise invisible: invitations
    // look sent, and nobody receives one.
    console.log(
      '[portal] SMTP_HOST is not set — invitations and notifications are queued in the ' +
        'outbox but not delivered. Copy invitation links from the admin console, or set ' +
        'SMTP_HOST to start sending.',
    )
  }

  // Checked twice a day rather than scheduled to the minute: a container that
  // restarts on the 15th should still run that day's sweep, and a job that
  // fires a few hours late is fine for something that runs fortnightly.
  let lastMonitorDay: string | null = null
  timers.push(every(MONITOR_INTERVAL_MS, async () => {
    const now = new Date()
    const day = now.getUTCDate()
    const stamp = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${day}`
    if (!MONITOR_DAYS.includes(day) || stamp === lastMonitorDay) return
    lastMonitorDay = stamp
    try {
      const result = runMonitor(db)
      console.log(
        `[monitor] fortnightly sweep: ${result.created} new alert(s), ${result.updated} updated`,
      )
    } catch (err) {
      // A failed sweep must not stop the next one.
      console.error('[monitor] sweep failed', err)
    }
  }))

  return {
    stop: () => {
      for (const timer of timers) clearInterval(timer)
      timers.length = 0
    },
  }
}

/**
 * setInterval with two properties this needs: it never lets two runs of the
 * same job overlap, and it never keeps the process alive on its own.
 */
function every(ms: number, job: () => Promise<void>): NodeJS.Timeout {
  let running = false
  const timer = setInterval(() => {
    if (running) return
    running = true
    void job()
      .catch((err) => console.error('[scheduler] job failed', err))
      .finally(() => {
        running = false
      })
  }, ms)
  timer.unref()
  return timer
}
