// ---------------------------------------------------------------------------
// The first account, created at boot from the environment.
//
// Why this exists: on a host with no persistent disk — Render's free tier, and
// most "just deploy it and look at it" tiers elsewhere — the SQLite file is
// deleted whenever the instance restarts or redeploys. The normal way in is
// `npm run create-admin` in a shell, which works once and then has to be done
// again after every reset. A deployment nobody can sign into is not a
// deployment anyone can check.
//
// So: when the database has no users at all and BOOTSTRAP_ADMIN_EMAIL is set,
// create that one HBS staff account. Three properties make this safe enough to
// leave in the production path:
//
//   1. It only ever fires on an empty user table. It cannot add an account to,
//      or change an account on, a database that is in use — so it is not a way
//      into someone's running portal.
//   2. Nothing happens unless the environment explicitly asks for it. Absent
//      the variables this is inert, which is what a real deployment wants.
//   3. The password comes from the environment and is never generated or
//      logged. A generated one would end up in a log file, which is worse than
//      the problem it solves.
//
// It creates an account and nothing else: no organizations, no buildings, no
// sample readings. Whoever signs in pulls real data from Portfolio Manager.
// Seeding demo rows into a deployment that may be shown to a customer is how a
// portal ends up quoting invented figures at someone.
// ---------------------------------------------------------------------------

import type { Db } from '../db/index.js'
import { createUser } from './auth.js'

/** Short enough to be a mistake rather than a password. */
const MIN_PASSWORD_LENGTH = 12

export interface BootstrapResult {
  status: 'created' | 'skipped-not-configured' | 'skipped-users-exist' | 'refused'
  message: string
}

export async function ensureBootstrapAdmin(db: Db): Promise<BootstrapResult> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim()
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim()
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'HBS Staff'

  if (!email) return { status: 'skipped-not-configured', message: '' }

  if (!password) {
    return {
      status: 'refused',
      message:
        'BOOTSTRAP_ADMIN_EMAIL is set but BOOTSTRAP_ADMIN_PASSWORD is not. No account was created. ' +
        'A generated password would have to be written to the log to be useful, and a password in a log is not a password.',
    }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: 'refused',
      message: `BOOTSTRAP_ADMIN_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters. No account was created.`,
    }
  }

  const existing = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM users').get()
  if ((existing?.n ?? 0) > 0) {
    return { status: 'skipped-users-exist', message: '' }
  }

  await createUser(db, {
    organizationId: null,
    email,
    fullName: name,
    role: 'hbs_staff',
    password,
  })

  return {
    status: 'created',
    message:
      `created the first HBS staff account for ${email} from the environment, because the database was empty. ` +
      'Unset BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD once this deployment has a disk that survives restarts.',
  }
}
