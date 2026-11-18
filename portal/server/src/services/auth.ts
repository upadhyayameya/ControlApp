// ---------------------------------------------------------------------------
// Password hashing and sessions.
//
// scrypt from node:crypto rather than bcrypt — no native dependency, and it is
// the algorithm Node itself recommends for password storage. Parameters are
// stored alongside each hash so they can be raised later without invalidating
// existing passwords.
//
// Sessions are opaque random ids stored in the database and carried in an
// HttpOnly cookie. Nothing about the user is encoded in the cookie, so
// revoking a session is a DELETE and takes effect on the next request.
// ---------------------------------------------------------------------------

import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { Db } from '../db/index.js'
import { toUser, type UserRow } from '../db/rows.js'
import type { User } from '@hbs/shared'
import { config } from '../config.js'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const SCRYPT_N = 16_384
const SCRYPT_r = 8
const SCRYPT_p = 1
const KEY_LEN = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, KEY_LEN)
  return ['scrypt', SCRYPT_N, SCRYPT_r, SCRYPT_p, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[4] ?? '', 'base64')
  const expected = Buffer.from(parts[5] ?? '', 'base64')
  if (salt.length === 0 || expected.length === 0) return false

  const actual = await scrypt(password, salt, expected.length)
  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, which would leak through as a 500.
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const SESSION_COOKIE = 'hbs_portal_session'

export function createSession(db: Db, userId: string): { id: string; expiresAt: string } {
  const id = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString()
  db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(id, userId, expiresAt, new Date().toISOString())
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), userId)
  return { id, expiresAt }
}

export function userForSession(db: Db, sessionId: string): User | null {
  const row = db
    .prepare<[string, string], UserRow>(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, new Date().toISOString())
  return row ? toUser(row) : null
}

export function destroySession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

/** Housekeeping; called on boot so expired rows do not accumulate forever. */
export function purgeExpiredSessions(db: Db): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
    .changes
}

export async function createUser(
  db: Db,
  input: {
    organizationId: string | null
    email: string
    fullName: string
    role: User['role']
    password: string
  },
): Promise<User> {
  const id = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO users (id, organization_id, email, full_name, role, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.organizationId,
    input.email.toLowerCase(),
    input.fullName,
    input.role,
    await hashPassword(input.password),
    now,
  )
  return {
    id,
    organizationId: input.organizationId,
    email: input.email.toLowerCase(),
    fullName: input.fullName,
    role: input.role,
    lastLoginAt: null,
    createdAt: now,
  }
}

export async function authenticate(
  db: Db,
  email: string,
  password: string,
): Promise<User | null> {
  const row = db
    .prepare<[string], UserRow>('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    .get(email.trim())

  // Hash regardless of whether the user exists, so a missing account and a
  // wrong password take the same time to answer.
  const stored = row?.password_hash ?? (await DUMMY_HASH)
  const ok = await verifyPassword(password, stored)
  if (!row || !ok) return null
  return toUser(row)
}

/** A real hash to compare against for unknown emails. Computed once. */
const DUMMY_HASH: Promise<string> = hashPassword(randomBytes(24).toString('hex'))
