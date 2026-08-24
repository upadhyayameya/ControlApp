// Session persistence: the Monarch auth token (or browser cookies) is written to
// .monarch/session.json with owner-only permissions so a restart doesn't force a
// new sign-in. The password is never written anywhere.

import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DEFAULT_PATH = resolve(process.env.MONARCH_SESSION_FILE || '.monarch/session.json')

export class SessionStore {
  constructor(filePath = DEFAULT_PATH) {
    this.filePath = filePath
  }

  load() {
    if (!existsSync(this.filePath)) return null
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (!parsed?.token && !parsed?.cookies) return null
      return parsed
    } catch {
      return null
    }
  }

  save({ token = null, cookies = null, email = null }) {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const body = JSON.stringify({ token, cookies, email, savedAt: new Date().toISOString() }, null, 2)
    writeFileSync(this.filePath, body, { mode: 0o600 })
    try {
      chmodSync(this.filePath, 0o600)
    } catch {
      // Best effort — some filesystems (e.g. mounted volumes) don't support chmod.
    }
  }

  clear() {
    rmSync(this.filePath, { force: true })
  }
}
