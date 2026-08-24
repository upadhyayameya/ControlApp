// Exercises the Monarch client and the snapshot fetch against a stand-in server
// that speaks the same shapes Monarch does. Nothing here touches the real API.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'

const routes = { login: null, graphql: null }

const mock = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
  const handler = request.url.startsWith('/auth/login') ? routes.login : routes.graphql
  const result = handler(body, request)
  response.writeHead(result.status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(result.body ?? {}))
})

mock.listen(0, '127.0.0.1')
await once(mock, 'listening')
process.env.MONARCH_BASE_URL = `http://127.0.0.1:${mock.address().port}`

const { MonarchClient, AuthExpiredError, MonarchError, parseCookieString, parseSessionPaste } = await import('../server/monarch.mjs')
const { MonarchSource } = await import('../server/snapshot.mjs')

test.after(() => mock.close())

test('parseCookieString reads a browser Cookie header', () => {
  const cookies = parseCookieString(' session_id=abc; csrftoken=def; other=1=2 ')
  assert.equal(cookies.session_id, 'abc')
  assert.equal(cookies.csrftoken, 'def')
  assert.equal(cookies.other, '1=2')
})

test('parseSessionPaste reads cookies out of a Chrome "Copy as cURL" paste', () => {
  const curl = [
    "curl 'https://api.monarch.com/graphql' \\",
    "  -H 'accept: application/json' \\",
    "  -H 'cookie: session_id=abc123; csrftoken=xyz789; ajs_anonymous_id=nope' \\",
    "  --data-raw '{\"operationName\":\"GetAccounts\"}'",
  ].join('\n')
  const { candidates } = parseSessionPaste(curl)
  assert.equal(candidates[0].kind, 'cookies')
  assert.equal(candidates[0].cookies.session_id, 'abc123')
  assert.equal(candidates[0].cookies.csrftoken, 'xyz789')
})

test('parseSessionPaste accepts curl -b, a bare Cookie header, and raw pairs', () => {
  for (const paste of [
    `curl 'https://api.monarch.com/graphql' -b 'session_id=s1; csrftoken=c1'`,
    'Cookie: session_id=s1; csrftoken=c1',
    'session_id=s1; csrftoken=c1',
  ]) {
    const { candidates } = parseSessionPaste(paste)
    assert.equal(candidates[0].kind, 'cookies', paste)
    assert.equal(candidates[0].cookies.session_id, 's1')
  }
})

test('parseSessionPaste finds an auth token in a header line, a curl, or on its own', () => {
  const token = 'a1b2c3d4e5f6g7h8i9j0k1l2m3'
  for (const paste of [
    `curl 'https://api.monarch.com/graphql' -H 'authorization: Token ${token}'`,
    `Authorization: Token ${token}`,
    token,
  ]) {
    const { candidates } = parseSessionPaste(paste)
    assert.equal(candidates[0].kind, 'token', paste)
    assert.equal(candidates[0].token, token)
  }
})

test('parseSessionPaste offers both a cookie jar and a token when the paste has both', () => {
  const { candidates, summary } = parseSessionPaste(
    `curl 'https://api.monarch.com/graphql' -H 'cookie: session_id=s; csrftoken=c' -H 'authorization: Token tok_abcdefghijklmnopqrst'`,
  )
  assert.deepEqual(candidates.map((candidate) => candidate.kind), ['cookies', 'token'])
  assert.match(summary, /cookies .*and an authorization token/)
})

test('parseSessionPaste falls back to the token when the cookies are incomplete', () => {
  const { candidates } = parseSessionPaste(
    `curl 'https://api.monarch.com/graphql' -H 'cookie: session_id=only' -H 'authorization: Token tok_abcdefghijklmnopqrst'`,
  )
  assert.deepEqual(candidates.map((candidate) => candidate.kind), ['token'])
})

test('parseSessionPaste explains an incomplete cookie paste and an unusable one', () => {
  assert.throws(() => parseSessionPaste('session_id=abc'), /csrftoken/)
  assert.throws(() => parseSessionPaste(''), /Paste something/)
  assert.throws(() => parseSessionPaste('hello there'), /Copy as cURL/)
})

test('login stores the token and sends the MFA-capable payload', async () => {
  let seen = null
  routes.login = (body) => {
    seen = body
    return { status: 200, body: { token: 'tok_123' } }
  }
  const client = new MonarchClient()
  const result = await client.login({ email: 'a@b.co', password: 'pw', totp: '123 456' })
  assert.equal(result.status, 'ok')
  assert.equal(client.token, 'tok_123')
  assert.equal(client.mode, 'token')
  assert.deepEqual(seen, {
    username: 'a@b.co',
    password: 'pw',
    supports_mfa: true,
    trusted_device: true,
    totp: '123456',
  })
})

test('a 403 asks for MFA, and a CAPTCHA code is reported distinctly', async () => {
  routes.login = () => ({ status: 403, body: { detail: 'MFA required' } })
  const client = new MonarchClient()
  assert.equal((await client.login({ email: 'a@b.co', password: 'pw' })).status, 'mfa_required')

  routes.login = () => ({ status: 403, body: { error_code: 'CAPTCHA_REQUIRED' } })
  const captcha = await client.login({ email: 'a@b.co', password: 'pw' })
  assert.equal(captcha.status, 'captcha_required')
  assert.match(captcha.message, /cookie/i)
})

test('a bad password surfaces Monarch\'s own detail', async () => {
  routes.login = () => ({ status: 400, body: { detail: 'Invalid credentials' } })
  const client = new MonarchClient()
  await assert.rejects(() => client.login({ email: 'a@b.co', password: 'nope' }), /Invalid credentials/)
})

test('cookie auth sends the CSRF token and cookie header', async () => {
  let headers = null
  routes.graphql = (_body, request) => {
    headers = request.headers
    return { status: 200, body: { data: { accounts: [] } } }
  }
  const client = new MonarchClient()
  client.setCookies({ session_id: 's', csrftoken: 'c' })
  await client.gql('GetAccounts', 'query GetAccounts { accounts { id } }')
  assert.equal(headers['x-csrftoken'], 'c')
  assert.equal(headers.cookie, 'session_id=s; csrftoken=c')
  assert.equal(headers.origin, 'https://app.monarch.com')
  assert.equal(headers.authorization, undefined)
})

test('incomplete cookies are refused before any request', () => {
  const client = new MonarchClient()
  assert.throws(() => client.setCookies({ session_id: 's' }), /csrftoken/)
})

test('401 and auth-flavoured GraphQL errors both raise AuthExpiredError', async () => {
  const client = new MonarchClient({ token: 'tok' })
  routes.graphql = () => ({ status: 401, body: {} })
  await assert.rejects(() => client.gql('GetAccounts', '{}'), AuthExpiredError)

  routes.graphql = () => ({ status: 200, body: { errors: [{ message: 'Invalid token signature' }] } })
  await assert.rejects(() => client.gql('GetAccounts', '{}'), AuthExpiredError)
})

test('other GraphQL errors keep the operation name in the message', async () => {
  const client = new MonarchClient({ token: 'tok' })
  routes.graphql = () => ({ status: 200, body: { errors: [{ message: 'Unknown field foo' }] } })
  await assert.rejects(() => client.gql('GetAccounts', '{}'), (error) => {
    assert.ok(error instanceof MonarchError)
    assert.match(error.message, /GetAccounts failed: Unknown field foo/)
    return true
  })
})

test('fetchSnapshot assembles every panel and keeps going when one query fails', async () => {
  routes.graphql = (body) => {
    switch (body.operationName) {
      case 'GetAccounts':
        return {
          status: 200,
          body: {
            data: {
              accounts: [
                {
                  id: '1',
                  displayName: 'Checking',
                  displayBalance: 500,
                  isAsset: true,
                  type: { display: 'Cash' },
                  institution: { name: 'Chase' },
                },
                {
                  id: '2',
                  displayName: 'Card',
                  displayBalance: 200,
                  isAsset: false,
                  type: { display: 'Credit Cards' },
                },
              ],
            },
          },
        }
      case 'GetAggregateSnapshots':
        return { status: 200, body: { data: { aggregateSnapshots: [{ date: '2026-08-01', balance: 300 }] } } }
      case 'GetTransactionsList':
        return {
          status: 200,
          body: {
            data: {
              allTransactions: {
                totalCount: 1,
                results: [{ id: 't1', date: '2026-08-20', amount: -10, merchant: { name: 'Cafe' } }],
              },
            },
          },
        }
      case 'Web_GetCashFlowPage':
        // This panel is the one that breaks.
        return { status: 200, body: { errors: [{ message: 'aggregates is temporarily unavailable' }] } }
      case 'GetJointPlanningData':
        return { status: 200, body: { data: { budgetData: { monthlyAmountsByCategoryGroup: [] }, categoryGroups: [] } } }
      default:
        return { status: 200, body: { data: {} } }
    }
  }

  const source = new MonarchSource(new MonarchClient({ token: 'tok' }))
  const snapshot = await source.fetchSnapshot()

  assert.equal(snapshot.netWorth.total, 300)
  assert.equal(snapshot.accounts.length, 2)
  assert.equal(snapshot.transactions[0].merchant, 'Cafe')
  assert.equal(snapshot.netWorthSeries.length, 1)
  assert.match(snapshot.errors.cashflow, /temporarily unavailable/)
  assert.equal(snapshot.errors.accounts, undefined)
  assert.equal(snapshot.cashflow.income, 0)
})

test('an expired session during a snapshot fetch fails the whole fetch', async () => {
  routes.graphql = () => ({ status: 401, body: {} })
  const source = new MonarchSource(new MonarchClient({ token: 'tok' }))
  await assert.rejects(() => source.fetchSnapshot(), AuthExpiredError)
})

test('requestSync reports Monarch refusing the request', async () => {
  routes.graphql = () => ({
    status: 200,
    body: { data: { forceRefreshAccounts: { success: false, errors: [{ message: 'Too many refreshes' }] } } },
  })
  const source = new MonarchSource(new MonarchClient({ token: 'tok' }))
  await assert.rejects(() => source.requestSync(['1']), /Too many refreshes/)
})
