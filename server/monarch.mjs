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
      return {
        status: 'mfa_required',
        message: payload?.detail || 'Monarch wants your two-factor code.',
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
