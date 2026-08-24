// A minimal client for Monarch's private web API.
//
// Two ways in, both of which the real web app uses:
//   1. Token auth  — POST /auth/login/ with username/password (+ TOTP), keep the
//                    returned long-lived token and send `Authorization: Token …`.
//   2. Cookie auth — paste the `session_id` + `csrftoken` cookies from a signed-in
//                    browser. This is the fallback when login is CAPTCHA-gated.
//
// Nothing here is officially supported by Monarch; it can break whenever they
// ship. Errors are surfaced with enough detail for the UI to say what happened.

const BASE_URL = process.env.MONARCH_BASE_URL || 'https://api.monarch.com'
const APP_URL = 'https://app.monarch.com'
const USER_AGENT = 'monarch-live-dashboard (local, personal use)'
const REQUIRED_COOKIES = ['session_id', 'csrftoken']

export class MonarchError extends Error {
  constructor(message, { code = null, status = null, retryAfter = null } = {}) {
    super(message)
    this.name = 'MonarchError'
    this.code = code
    this.status = status
    this.retryAfter = retryAfter
  }
}

/** The session was rejected — the caller should clear it and ask for a new login. */
export class AuthExpiredError extends MonarchError {
  constructor(message = 'Monarch session expired or was rejected. Sign in again.') {
    super(message, { code: 'AUTH_EXPIRED', status: 401 })
    this.name = 'AuthExpiredError'
  }
}

export function parseCookieString(cookieString) {
  const cookies = {}
  for (const pair of String(cookieString || '').split(';')) {
    const trimmed = pair.trim()
    if (!trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    cookies[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return cookies
}

/**
 * Work out what someone pasted from their browser. Copying one exact header out
 * of DevTools is fiddly and easy to get wrong, so accept every form the browser
 * hands over easily:
 *
 *   - a whole `curl` command (Chrome's "Copy as cURL" — by far the easiest)
 *   - a raw `Cookie:` header line, or just the cookie pairs
 *   - an `Authorization: Token …` line, or the bare token on its own
 *
 * @returns {{kind: 'token', token: string} | {kind: 'cookies', cookies: Record<string,string>}}
 */
export function parseSessionPaste(pasted) {
  const text = String(pasted || '').trim()
  if (!text) {
    throw new MonarchError('Paste something from your signed-in browser tab first.', { code: 'PASTE_EMPTY' })
  }

  // An auth token, whether inside a curl command, a header line, or bare.
  const token =
    (text.match(/authorization:\s*Token\s+([A-Za-z0-9._~+/=-]{16,})/i) ||
      text.match(/^Token\s+([A-Za-z0-9._~+/=-]{16,})$/i) ||
      text.match(/^([A-Za-z0-9._~+/=-]{24,})$/))?.[1] ?? null

  // Cookies, from -b/--cookie, a cookie header (in curl or on its own), or raw pairs.
  const cookieSource =
    text.match(/(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/)?.[2] ??
    text.match(/-H\s+(['"])\s*cookie:\s*([\s\S]*?)\1/i)?.[2] ??
    text.match(/^\s*cookie:\s*(.+)$/im)?.[1] ??
    (text.includes('session_id=') ? text : null)
  const cookies = cookieSource ? parseCookieString(cookieSource) : null
  const cookiesComplete = Boolean(cookies) && REQUIRED_COOKIES.every((name) => cookies[name])

  // A paste often carries both a cookie jar and an Authorization header, and
  // which one Monarch honours has changed before. Hand back every candidate so
  // the caller can try them for real instead of guessing.
  const candidates = []
  if (cookiesComplete) candidates.push({ kind: 'cookies', cookies })
  if (token) candidates.push({ kind: 'token', token })

  if (!candidates.length) {
    if (cookies && Object.keys(cookies).length) {
      const missing = REQUIRED_COOKIES.filter((name) => !cookies[name])
      throw new MonarchError(
        `That paste has cookies, but not the ${missing.join(' and ')} one${missing.length > 1 ? 's' : ''} ` +
          'and no auth token either. Copy a request to api.monarch.com (not to app.monarch.com) ' +
          'from a tab where you are signed in.',
        { code: 'COOKIES_INCOMPLETE' },
      )
    }
    throw new MonarchError(
      "That doesn't look like a browser session. Paste the whole \"Copy as cURL\" command, " +
        'or the Cookie / Authorization header from a request to api.monarch.com.',
      { code: 'PASTE_UNRECOGNIZED' },
    )
  }

  return { candidates, summary: describeCandidates(cookiesComplete ? cookies : null, token) }
}

function describeCandidates(cookies, token) {
  const parts = []
  if (cookies) parts.push(`cookies (${Object.keys(cookies).slice(0, 4).join(', ')})`)
  if (token) parts.push('an authorization token')
  return parts.join(' and ')
}

export class MonarchClient {
  /**
   * @param {{token?: string|null, cookies?: Record<string,string>|null, timeoutMs?: number}} [options]
   */
  constructor({ token = null, cookies = null, timeoutMs = 30000 } = {}) {
    this.token = token
    this.cookies = cookies
    this.timeoutMs = timeoutMs
  }

  get mode() {
    if (this.cookies) return 'cookie'
    if (this.token) return 'token'
    return 'none'
  }

  get authed() {
    return this.mode !== 'none'
  }

  clear() {
    this.token = null
    this.cookies = null
  }

  setCookies(cookies) {
    const missing = REQUIRED_COOKIES.filter((name) => !cookies?.[name])
    if (missing.length) {
      throw new MonarchError(
        `Missing required cookie(s): ${missing.join(', ')}. Copy the whole Cookie header from a signed-in browser tab.`,
        { code: 'COOKIES_INCOMPLETE' },
      )
    }
    this.token = null
    this.cookies = cookies
  }

  headers() {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Client-Platform': 'web',
      'User-Agent': USER_AGENT,
    }
    if (this.cookies) {
      headers.Origin = APP_URL
      headers.Referer = `${APP_URL}/`
      headers['monarch-client'] = 'web'
      headers['X-Csrftoken'] = this.cookies.csrftoken
      headers.Cookie = Object.entries(this.cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join('; ')
    } else if (this.token) {
      headers.Authorization = `Token ${this.token}`
    }
    return headers
  }

  async #fetch(url, init) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new MonarchError(`Monarch did not respond within ${Math.round(this.timeoutMs / 1000)}s.`, {
          code: 'TIMEOUT',
        })
      }
      throw new MonarchError(`Could not reach Monarch: ${error?.message || error}`, { code: 'NETWORK' })
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Password login. Returns the outcome rather than throwing for the two states
   * the UI has to handle interactively (MFA needed, CAPTCHA wall).
   * @returns {Promise<{status: 'ok'|'mfa_required'|'captcha_required', message?: string}>}
   */
  async login({ email, password, totp = null, trustedDevice = true }) {
    const body = {
      username: email,
      password,
      supports_mfa: true,
      trusted_device: trustedDevice,
    }
    if (totp) body.totp = String(totp).replace(/\s+/g, '')

    const response = await this.#fetch(`${BASE_URL}/auth/login/`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Client-Platform': 'web',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
    })

    const payload = await readJson(response)

    if (response.status === 403) {
      if (payload?.error_code === 'CAPTCHA_REQUIRED') {
        return {
          status: 'captcha_required',
          message:
            'Monarch is requiring a CAPTCHA for programmatic sign-in. Use the browser-cookie option instead.',
        }
      }
      // Monarch answers 403 both for "send me the second factor" and for a
      // blocked sign-in, so say what to do in either case.
      return {
        status: 'mfa_required',
        message:
          'Monarch asked for a second factor. Enter the 6-digit code from your authenticator app. ' +
          "If you don't have two-factor turned on, Monarch is refusing this sign-in — " +
          'use the Browser session tab instead.' +
          (payload?.detail ? ` (Monarch said: ${payload.detail})` : ''),
      }
    }

    if (response.status === 429) {
      throw new MonarchError('Too many sign-in attempts. Wait a few minutes and try again.', {
        code: 'RATE_LIMITED',
        status: 429,
        retryAfter: Number(response.headers.get('retry-after')) || null,
      })
    }

    if (!response.ok) {
      const detail = payload?.detail || payload?.error_code || `HTTP ${response.status}`
      throw new MonarchError(`Monarch rejected the sign-in: ${detail}`, {
        code: payload?.error_code || 'LOGIN_FAILED',
        status: response.status,
      })
    }

    const token = payload?.token
    if (!token) {
      throw new MonarchError('Monarch accepted the sign-in but returned no token.', { code: 'NO_TOKEN' })
    }

    this.cookies = null
    this.token = token
    return { status: 'ok' }
  }

  /**
   * Run one GraphQL operation.
   * @param {string} operationName
   * @param {string} query
   * @param {object} [variables]
   */
  async gql(operationName, query, variables = {}) {
    if (!this.authed) throw new AuthExpiredError('Not signed in to Monarch.')

    const response = await this.#fetch(`${BASE_URL}/graphql`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ operationName, query, variables }),
    })

    if (response.status === 401 || response.status === 403) {
      throw new AuthExpiredError()
    }
    if (response.status === 429) {
      throw new MonarchError('Monarch is rate-limiting this session. Slowing down.', {
        code: 'RATE_LIMITED',
        status: 429,
        retryAfter: Number(response.headers.get('retry-after')) || null,
      })
    }

    const payload = await readJson(response)

    if (!response.ok) {
      throw new MonarchError(`${operationName} failed: HTTP ${response.status}`, {
        code: 'HTTP_ERROR',
        status: response.status,
      })
    }
    if (payload?.errors?.length) {
      const message = payload.errors.map((error) => error?.message).filter(Boolean).join('; ')
      if (/signature|authenticat|credential|token/i.test(message)) throw new AuthExpiredError()
      throw new MonarchError(`${operationName} failed: ${message || 'unknown GraphQL error'}`, {
        code: 'GRAPHQL_ERROR',
      })
    }
    if (!payload?.data) {
      throw new MonarchError(`${operationName} returned no data.`, { code: 'EMPTY_RESPONSE' })
    }
    return payload.data
  }
}

async function readJson(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
