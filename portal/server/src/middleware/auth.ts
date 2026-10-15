// ---------------------------------------------------------------------------
// Request authentication and organization scoping.
//
// The scoping rule is the security boundary of the whole portal, so it lives
// in one function: `scopeOrganizationId` returns the organization a request is
// allowed to read, and every route uses it instead of trusting a path or query
// parameter. A customer cannot widen their scope by editing a URL, because the
// URL is not consulted.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import type { User } from '@hbs/shared'
import { getDb } from '../db/index.js'
import { SESSION_COOKIE, userForSession } from '../services/auth.js'

declare module 'express-serve-static-core' {
  interface Request {
    user?: User
    sessionId?: string
  }
}

export function loadSession(req: Request, _res: Response, next: NextFunction): void {
  const sessionId = readCookie(req.headers.cookie, SESSION_COOKIE)
  if (sessionId) {
    const user = userForSession(getDb(), sessionId)
    if (user) {
      req.user = user
      req.sessionId = sessionId
    }
  }
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Not signed in.' })
    return
  }
  next()
}

export function requireStaff(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'hbs_staff') {
    res.status(403).json({ error: 'This action is restricted to HBS staff.' })
    return
  }
  next()
}

/** Customers may read; only admins and staff may write. */
export function requireWriteAccess(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role === 'customer_viewer') {
    res.status(403).json({ error: 'Your account has read-only access.' })
    return
  }
  next()
}

/**
 * The organization this request may see.
 *
 * Staff get `null`, meaning "no filter — everything". Customers get their own
 * organization and nothing else. Staff may narrow to one organization with
 * `?organizationId=`, which is the only place that parameter is honoured.
 */
export function scopeOrganizationId(req: Request): string | null {
  const user = req.user
  if (!user) return null
  if (user.role === 'hbs_staff') {
    const requested = req.query['organizationId']
    return typeof requested === 'string' && requested !== '' ? requested : null
  }
  return user.organizationId
}

/**
 * Assert the signed-in user may touch this building, and return it.
 * Routes call this before anything else that takes a building id.
 */
export function assertBuildingAccess(req: Request, buildingId: string): { organizationId: string } {
  const row = getDb()
    .prepare<[string], { organization_id: string }>(
      'SELECT organization_id FROM buildings WHERE id = ?',
    )
    .get(buildingId)

  if (!row) throw new HttpError(404, 'No such building.')
  if (req.user?.role !== 'hbs_staff' && row.organization_id !== req.user?.organizationId) {
    // Deliberately the same 404 an unknown id gets: a customer probing ids
    // should not be able to tell which ones exist.
    throw new HttpError(404, 'No such building.')
  }
  return { organizationId: row.organization_id }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    override readonly message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}
