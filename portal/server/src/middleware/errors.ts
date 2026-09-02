// One error shape for the whole API, and one place that decides what a thrown
// value means. Anything unrecognised is a 500 whose detail is logged rather
// than returned — an internal message can leak schema or file paths.
import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { EspmApiError } from '../espm/client.js'
import { ConnectionError } from '../services/connections.js'
import { InvitationError } from '../services/invitations.js'
import { SignupError } from '../services/tenancy.js'
import { HttpError } from './auth.js'

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  // Domain errors carry their own status and a message written for the person
  // reading it, so they pass through rather than becoming a generic 500.
  if (err instanceof InvitationError || err instanceof ConnectionError) {
    res.status(err.status).json({ error: err.message })
    return
  }
  if (err instanceof SignupError) {
    res.status(409).json({ error: err.message, detail: err.field })
    return
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'That request was not valid.',
      detail: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    })
    return
  }
  if (err instanceof EspmApiError) {
    // 502: the portal is fine, Portfolio Manager refused. Its own wording is
    // usually actionable ("meter has no unit of measure"), so pass it through.
    res.status(502).json({ error: 'Portfolio Manager rejected the request.', detail: err.message })
    return
  }

  console.error('[api] unhandled error', err)
  res.status(500).json({ error: 'Something went wrong on our side.' })
}

/** Wrap an async handler so a rejected promise reaches the error handler. */
export function asyncRoute<T extends (req: Request, res: Response) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next)
  }
}
