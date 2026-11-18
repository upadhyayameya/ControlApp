// ---------------------------------------------------------------------------
// Rate limiting for the endpoints that guess-ability makes dangerous.
//
// Two counters, because they defend against different attacks. Per-IP stops
// one machine working through a password list. Per-account stops a botnet
// spread across many addresses working through one inbox — which per-IP alone
// does nothing about.
//
// The state is in memory. That is honest for a single node and wrong for
// several: behind two instances an attacker gets double the budget, and every
// counter resets on deploy. Moving to Redis is the fix when this stops being
// one container; the interface below is the seam.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'

interface Bucket {
  count: number
  /** Epoch ms when this bucket's window closes. */
  resetAt: number
}

export interface RateLimitOptions {
  /** How many attempts are allowed inside one window. */
  max: number
  windowMs: number
  /**
   * What is being counted. Returning null skips the check — used to let a
   * request through when it carries nothing worth keying on.
   */
  key: (req: Request) => string | null
  message: string
  /**
   * When true the middleware only *checks* the budget; something downstream
   * decides whether the attempt counted, by calling `.record(req)`. Used for
   * sign-in, where a successful password should not spend anyone's budget.
   */
  checkOnly?: boolean
}

export interface Limiter {
  (req: Request, res: Response, next: NextFunction): void
  /** Count one attempt against this request's key. */
  record: (req: Request) => void
}

/**
 * Buckets are swept lazily rather than on a timer: a timer keeps the process
 * awake and an unbounded map is a slow leak, and sweeping on write costs
 * nothing at this volume.
 */
function sweep(buckets: Map<string, Bucket>, now: number): void {
  if (buckets.size < 1000) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function rateLimit(options: RateLimitOptions): Limiter {
  const buckets = new Map<string, Bucket>()

  function count(key: string, now: number): void {
    const bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs })
      return
    }
    bucket.count += 1
  }

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    const key = options.key(req)
    if (key === null) {
      next()
      return
    }

    const now = Date.now()
    sweep(buckets, now)

    const bucket = buckets.get(key)
    const spent = bucket && bucket.resetAt > now ? bucket.count : 0
    if (spent >= options.max) {
      const retryAfter = Math.ceil(((bucket as Bucket).resetAt - now) / 1000)
      res.setHeader('Retry-After', String(retryAfter))
      res.status(429).json({
        error: options.message,
        detail: `Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
      })
      return
    }

    if (!options.checkOnly) count(key, now)
    next()
  }

  const limiter = middleware as Limiter
  limiter.record = (req: Request): void => {
    const key = options.key(req)
    if (key === null) return
    const now = Date.now()
    sweep(buckets, now)
    count(key, now)
  }
  return limiter
}

/**
 * The client's address.
 *
 * `req.ip` is only trustworthy when Express has been told which proxies to
 * trust (see TRUST_PROXY); otherwise every request behind a load balancer
 * shares one address and the per-IP limit becomes a global one. The per-account
 * limit is what actually protects a single inbox, which is why both exist.
 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown'
}

function emailFrom(req: Request): string | null {
  const body = req.body as { email?: unknown } | undefined
  const email = body?.email
  return typeof email === 'string' && email.trim() !== '' ? email.trim().toLowerCase() : null
}

/** Ten attempts per address per fifteen minutes. */
export const loginIpLimiter = rateLimit({
  max: 10,
  windowMs: 15 * 60_000,
  key: (req) => `ip:${clientIp(req)}`,
  message: 'Too many sign-in attempts from this connection.',
})

/**
 * Five *failed* attempts per account per fifteen minutes, counted regardless of
 * where they came from — that is what stops a botnet spread across many
 * addresses working through one inbox.
 *
 * Only failures count, which is why this is checkOnly and the login route calls
 * `.record()` itself. Counting successes too would lock a person out of their
 * own account for signing in from a laptop, a phone and a tablet in one
 * afternoon, and it buys nothing: someone who already has the password does
 * not need to guess. A failure is never cleared by a later success, so guessing
 * correctly on the fifth try still leaves the four wrong ones on the record.
 */
export const loginAccountLimiter = rateLimit({
  max: 5,
  windowMs: 15 * 60_000,
  checkOnly: true,
  key: (req) => {
    const email = emailFrom(req)
    return email === null ? null : `account:${email}`
  },
  message: 'Too many sign-in attempts for this account.',
})

/** Signup and invitation acceptance create rows, so they get a slower budget. */
export const signupLimiter = rateLimit({
  max: 5,
  windowMs: 60 * 60_000,
  key: (req) => `signup:${clientIp(req)}`,
  message: 'Too many accounts created from this connection.',
})

/**
 * Invitation-token lookups are the one place a guessable secret is checked, so
 * they are limited harder than anything else.
 */
export const inviteLookupLimiter = rateLimit({
  max: 20,
  windowMs: 15 * 60_000,
  key: (req) => `invite:${clientIp(req)}`,
  message: 'Too many invitation lookups from this connection.',
})
