// ---------------------------------------------------------------------------
// A transport that replays canned XML instead of calling Portfolio Manager.
//
// This is what makes the portal runnable — and testable — with no ESPM
// credentials and no network. It exercises the real EspmClient: the same
// parsing, the same error handling, the same pagination. Only the bytes'
// origin differs.
//
// It also records writes, so a test (or a developer clicking around the demo)
// can assert that the portal pushed what it claimed to push.
// ---------------------------------------------------------------------------

import type { EspmRequest, EspmResponse, EspmTransport } from './client.js'
import { FIXTURES } from './fixtures/index.js'

export interface RecordedWrite {
  method: string
  path: string
  body: string | undefined
  at: string
}

export class FixtureTransport implements EspmTransport {
  readonly writes: RecordedWrite[] = []
  /** Ids handed out for pushed consumption, so replays look like real ESPM. */
  private nextConsumptionId = 900_000

  constructor(private readonly extra: Record<string, string> = {}) {}

  async send(request: EspmRequest): Promise<EspmResponse> {
    const key = `${request.method} ${normalize(request.path)}`

    if (request.method !== 'GET') {
      this.writes.push({
        method: request.method,
        path: request.path,
        body: request.body,
        at: new Date().toISOString(),
      })
    }

    const canned = this.extra[key] ?? FIXTURES[key]
    if (canned !== undefined) return { status: 200, body: canned }

    // Writes we have no specific fixture for get a generic success carrying a
    // fresh id — the shape ESPM returns when it accepts a new record.
    if (request.method === 'POST' && /\/consumptionData$/.test(request.path)) {
      const count = (request.body?.match(/<meterConsumption>/g) ?? ['']).length
      const links = Array.from({ length: count }, () => {
        const id = this.nextConsumptionId++
        return `<link linkDescription="consumption data" id="${id}" link="/consumptionData/${id}"/>`
      }).join('')
      return { status: 200, body: `<response status="Ok"><links>${links}</links></response>` }
    }
    if (request.method === 'PUT' || request.method === 'DELETE' || request.method === 'POST') {
      return { status: 200, body: '<response status="Ok"/>' }
    }

    return {
      status: 404,
      body: `<response status="Error"><errors><error errorNumber="-404" errorDescription="No fixture recorded for ${key}"/></errors></response>`,
    }
  }
}

/** Fixture keys ignore query-string ordering noise; match on path + query. */
function normalize(path: string): string {
  const [base, query] = path.split('?')
  if (!query) return base ?? path
  const sorted = query.split('&').sort().join('&')
  return `${base}?${sorted}`
}
