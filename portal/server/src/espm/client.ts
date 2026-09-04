// ---------------------------------------------------------------------------
// EspmClient — the portal's one and only door to Portfolio Manager.
//
// Design notes worth knowing before changing anything here:
//
//  1. Transport is injected. `HttpTransport` talks to the real service;
//     `FixtureTransport` replays recorded XML. Every test, and every developer
//     without ESPM credentials, runs the exact same client code.
//
//  2. Writes are explicit and separate from reads. Pushing data into a
//     customer's ESPM account is the operation with real consequences, so
//     `addConsumption` / `updateConsumption` are the only methods that mutate,
//     and each returns what ESPM acknowledged rather than what we sent.
//
//  3. Requests are serialized behind a small rate limiter. ESPM throttles
//     aggressively and a burst of parallel property reads is the fastest way
//     to get an account temporarily blocked.
// ---------------------------------------------------------------------------

import {
  METRIC_NAMES,
  type EspmAccount,
  type EspmConsumption,
  type EspmErrorDetail,
  type EspmLink,
  type EspmMeter,
  type EspmMetric,
  type EspmProperty,
  type MetricKey,
} from './types.js'
import { asArray, attr, bool, buildXml, extractErrors, extractLinks, findKey, num, parseXml, str } from './xml.js'

export const ESPM_BASE_URLS = {
  test: 'https://portfoliomanager.energystar.gov/wstest',
  live: 'https://portfoliomanager.energystar.gov/ws',
} as const

export type EspmEnvironment = keyof typeof ESPM_BASE_URLS

export interface EspmRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Path relative to the base URL, e.g. "/property/1234". */
  path: string
  body?: string
  headers?: Record<string, string>
}

export interface EspmResponse {
  status: number
  body: string
}

/** Swap this to replay fixtures instead of calling the live service. */
export interface EspmTransport {
  send(request: EspmRequest, baseUrl: string, auth: string): Promise<EspmResponse>
}

export class EspmApiError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly errors: EspmErrorDetail[] = [],
    readonly path?: string,
  ) {
    super(message)
    this.name = 'EspmApiError'
  }

  /**
   * Whether retrying unchanged could plausibly succeed. A 400 with a validation
   * error will fail identically forever; a 429 or a 503 will not.
   */
  get retryable(): boolean {
    return this.status === 429 || this.status === 408 || this.status >= 500
  }
}

export interface EspmClientOptions {
  username: string
  password: string
  environment?: EspmEnvironment
  transport?: EspmTransport
  /** Minimum milliseconds between requests. ESPM throttles; be polite. */
  minRequestIntervalMs?: number
  maxRetries?: number
  /** Injected so tests can assert on log output without touching stdout. */
  logger?: (level: 'debug' | 'warn' | 'error', message: string, meta?: unknown) => void
}

export class EspmClient {
  private readonly baseUrl: string
  private readonly auth: string
  private readonly transport: EspmTransport
  private readonly minInterval: number
  private readonly maxRetries: number
  private readonly log: NonNullable<EspmClientOptions['logger']>

  /** Tail of the request chain — every call awaits the previous one. */
  private queue: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0

  readonly environment: EspmEnvironment

  constructor(opts: EspmClientOptions) {
    this.environment = opts.environment ?? 'test'
    this.baseUrl = ESPM_BASE_URLS[this.environment]
    this.auth = Buffer.from(`${opts.username}:${opts.password}`, 'utf8').toString('base64')
    this.transport = opts.transport ?? new HttpTransport()
    this.minInterval = opts.minRequestIntervalMs ?? 250
    this.maxRetries = opts.maxRetries ?? 3
    this.log = opts.logger ?? (() => {})
  }

  // --- Account ------------------------------------------------------------

  async getAccount(): Promise<EspmAccount> {
    const parsed = await this.get('/account')
    const account = findKey(parsed, 'account') as Record<string, unknown> | undefined
    if (!account) throw new EspmApiError('No <account> in the response.', 200, [], '/account')
    const contact = (findKey(account, 'contact') ?? {}) as Record<string, unknown>
    return {
      id: num(account['id']) ?? Number.NaN,
      username: str(account['username']) ?? '',
      organizationName: str(account['organization']) ?? str(findKey(account, 'name')),
      contactName: [str(contact['firstName']), str(contact['lastName'])].filter(Boolean).join(' ') || undefined,
      email: str(contact['email']),
    }
  }

  // --- Connections and shares --------------------------------------------
  //
  // A service-provider account does not see a customer's building until the
  // customer shares it. These four calls are the whole handshake, and the
  // portal's onboarding flow is built on them.

  /** Customers who have asked to connect to this account. */
  async listPendingConnectionRequests(): Promise<EspmLink[]> {
    return extractLinks(await this.get('/connect/account/pending/list'))
  }

  async acceptConnectionRequest(accountId: number): Promise<void> {
    await this.post(
      `/connect/account/${accountId}`,
      buildXml({ sharingResponse: { action: 'Accept' } }),
    )
  }

  /** Properties customers have offered to share with this account. */
  async listPendingShareRequests(): Promise<EspmLink[]> {
    return extractLinks(await this.get('/share/property/pending/list'))
  }

  async acceptShareRequest(propertyId: number): Promise<void> {
    await this.post(
      `/share/property/${propertyId}`,
      buildXml({ sharingResponse: { action: 'Accept' } }),
    )
  }

  // --- Properties ---------------------------------------------------------

  /** Properties owned by the authenticated account. */
  async listProperties(accountId: number): Promise<EspmLink[]> {
    return extractLinks(await this.get(`/account/${accountId}/property/list`))
  }

  /** Properties a connected customer has shared with this account. */
  async listCustomerProperties(customerAccountId: number): Promise<EspmLink[]> {
    return extractLinks(await this.get(`/customer/${customerAccountId}/property/list`))
  }

  async getProperty(propertyId: number): Promise<EspmProperty> {
    const parsed = await this.get(`/property/${propertyId}`)
    const node = findKey(parsed, 'property') as Record<string, unknown> | undefined
    if (!node) {
      throw new EspmApiError('No <property> in the response.', 200, [], `/property/${propertyId}`)
    }
    return parseProperty(node, propertyId)
  }

  // --- Meters -------------------------------------------------------------

  async listMeters(propertyId: number): Promise<EspmLink[]> {
    return extractLinks(await this.get(`/property/${propertyId}/meter/list`))
  }

  async getMeter(meterId: number): Promise<EspmMeter> {
    const parsed = await this.get(`/meter/${meterId}`)
    const node = findKey(parsed, 'meter') as Record<string, unknown> | undefined
    if (!node) throw new EspmApiError('No <meter> in the response.', 200, [], `/meter/${meterId}`)
    return {
      id: num(node['id']) ?? meterId,
      name: str(node['name']) ?? `Meter ${meterId}`,
      type: str(node['type']) ?? 'Unknown',
      unitOfMeasure: str(node['unitOfMeasure']) ?? '',
      metered: bool(node['metered']) ?? true,
      inUse: bool(node['inUse']) ?? true,
      firstBillDate: str(node['firstBillDate']),
      inUseAsOf: str(node['inUseAsOf']),
    }
  }

  // --- Consumption: read --------------------------------------------------

  /**
   * ESPM paginates consumption 24 entries at a time and signals "more" with a
   * `<links><link linkDescription="next page">`. We follow that chain rather
   * than guessing page counts.
   */
  async getConsumption(meterId: number, maxPages = 20): Promise<EspmConsumption[]> {
    const out: EspmConsumption[] = []
    let path: string | undefined = `/meter/${meterId}/consumptionData`

    for (let page = 0; page < maxPages && path; page++) {
      const parsed: Record<string, unknown> = await this.get(path)
      const meterData = findKey(parsed, 'meterData') as Record<string, unknown> | undefined
      for (const node of asArray(meterData?.['meterConsumption'])) {
        const entry = parseConsumption(node)
        if (entry) out.push(entry)
      }
      const next = extractLinks(parsed).find((l) => /next/i.test(l.linkDescription ?? ''))
      path = next?.link
    }

    return out
  }

  // --- Consumption: write (the two-way half) ------------------------------

  /**
   * Push new consumption records into ESPM.
   *
   * Returns the ids ESPM assigned, in the order submitted, so the caller can
   * mark exactly which local rows are now synced. If ESPM accepts some and
   * rejects others it reports per-record errors; we surface the whole response
   * rather than pretending the batch succeeded.
   */
  async addConsumption(
    meterId: number,
    entries: ConsumptionInput[],
  ): Promise<EspmConsumption[]> {
    if (entries.length === 0) return []
    const body = buildXml({
      meterData: { meterConsumption: entries.map(consumptionToXml) },
    })
    const parsed = await this.post(`/meter/${meterId}/consumptionData`, body)

    // ESPM answers either with the created objects or with a link list of ids.
    const meterData = findKey(parsed, 'meterData') as Record<string, unknown> | undefined
    const created = asArray(meterData?.['meterConsumption'])
      .map(parseConsumption)
      .filter((c): c is EspmConsumption => c !== null)
    if (created.length > 0) return created

    return extractLinks(parsed).map((link, i) => ({
      id: link.id,
      startDate: entries[i]?.startDate ?? '',
      endDate: entries[i]?.endDate ?? '',
      usage: entries[i]?.usage ?? 0,
      cost: entries[i]?.cost ?? undefined,
      estimatedValue: entries[i]?.estimated ?? false,
    }))
  }

  /** Correct a record ESPM already holds. */
  async updateConsumption(consumptionId: number, entry: ConsumptionInput): Promise<void> {
    await this.put(
      `/consumptionData/${consumptionId}`,
      buildXml({ meterConsumption: consumptionToXml(entry) }),
    )
  }

  async deleteConsumption(consumptionId: number): Promise<void> {
    await this.delete(`/consumptionData/${consumptionId}`)
  }

  // --- Metrics ------------------------------------------------------------

  /**
   * Annual metrics for a property, as of the 12-month period ending
   * `year`-`month`. ESPM takes the wanted metric names in a `PM-Metrics`
   * header rather than the query string.
   *
   * A name ESPM does not recognise is dropped silently from the response, so
   * anything requested and not returned is logged — that is the tripwire for a
   * stale name in METRIC_NAMES.
   */
  async getPropertyMetrics(
    propertyId: number,
    opts: { year: number; month?: number; keys?: MetricKey[] } ,
  ): Promise<Partial<Record<MetricKey, number | null>>> {
    const keys = opts.keys ?? (Object.keys(METRIC_NAMES) as MetricKey[])
    const month = opts.month ?? 12
    const wanted = keys.map((k) => METRIC_NAMES[k])

    const parsed = await this.get(
      `/property/${propertyId}/metrics?year=${opts.year}&month=${month}&measurementSystem=EPA`,
      { 'PM-Metrics': wanted.join(',') },
    )

    const byName = new Map<string, EspmMetric>()
    const root = findKey(parsed, 'propertyMetrics') ?? parsed
    for (const node of asArray((root as Record<string, unknown>)['metric'])) {
      const name = attr(node, 'name')
      if (!name) continue
      const valueNode = (node as Record<string, unknown>)['value']
      byName.set(name, {
        name,
        value: num(valueNode) ?? null,
        uom: attr(node, 'uom'),
        dataQuality: attr(node, 'dataQuality'),
      })
    }

    const missing = wanted.filter((n) => !byName.has(n))
    if (missing.length > 0) {
      this.log('warn', 'ESPM returned no value for requested metrics', {
        propertyId,
        year: opts.year,
        missing,
      })
    }

    const out: Partial<Record<MetricKey, number | null>> = {}
    for (const key of keys) {
      out[key] = byName.get(METRIC_NAMES[key])?.value ?? null
    }
    return out
  }

  // --- HTTP plumbing ------------------------------------------------------

  private get(path: string, headers?: Record<string, string>): Promise<Record<string, unknown>> {
    return this.send({ method: 'GET', path, headers })
  }

  private post(path: string, body: string): Promise<Record<string, unknown>> {
    return this.send({ method: 'POST', path, body })
  }

  private put(path: string, body: string): Promise<Record<string, unknown>> {
    return this.send({ method: 'PUT', path, body })
  }

  private delete(path: string): Promise<Record<string, unknown>> {
    return this.send({ method: 'DELETE', path })
  }

  /**
   * Every request funnels through here: queued so at most one is in flight,
   * spaced by `minInterval`, retried with exponential backoff when ESPM says
   * the failure is transient, and parsed into either a document or an error.
   */
  private send(request: EspmRequest): Promise<Record<string, unknown>> {
    const run = this.queue.then(() => this.sendNow(request))
    // Keep the chain alive even when this request rejects, or one failure
    // would poison every queued call behind it.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async sendNow(request: EspmRequest): Promise<Record<string, unknown>> {
    let lastError: unknown

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.throttle()
      try {
        const response = await this.transport.send(
          {
            ...request,
            headers: {
              Accept: 'application/xml',
              ...(request.body ? { 'Content-Type': 'application/xml' } : {}),
              ...request.headers,
            },
          },
          this.baseUrl,
          this.auth,
        )
        return this.handle(request, response)
      } catch (err) {
        lastError = err
        const retryable = err instanceof EspmApiError ? err.retryable : isNetworkError(err)
        if (!retryable || attempt === this.maxRetries) break
        const backoffMs = 500 * 2 ** attempt
        this.log('warn', `ESPM request failed, retrying in ${backoffMs}ms`, {
          path: request.path,
          attempt: attempt + 1,
        })
        await sleep(backoffMs)
      }
    }

    throw lastError
  }

  private handle(request: EspmRequest, response: EspmResponse): Record<string, unknown> {
    let parsed: Record<string, unknown>
    try {
      parsed = parseXml(response.body)
    } catch {
      throw new EspmApiError(
        `Portfolio Manager returned a response that is not valid XML (HTTP ${response.status}).`,
        response.status,
        [],
        request.path,
      )
    }

    const errors = extractErrors(parsed)
    // ESPM sometimes returns HTTP 200 with an error envelope inside, so the
    // status code alone is not enough to decide success.
    if (response.status >= 400 || errors.length > 0) {
      const summary =
        errors.map((e) => e.errorDescription).join('; ') ||
        `Portfolio Manager returned HTTP ${response.status}.`
      throw new EspmApiError(summary, response.status, errors, request.path)
    }

    return parsed
  }

  private async throttle(): Promise<void> {
    const wait = this.lastRequestAt + this.minInterval - Date.now()
    if (wait > 0) await sleep(wait)
    this.lastRequestAt = Date.now()
  }
}

// --- Transports -----------------------------------------------------------

export class HttpTransport implements EspmTransport {
  constructor(private readonly timeoutMs = 30_000) {}

  async send(request: EspmRequest, baseUrl: string, auth: string): Promise<EspmResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: { ...request.headers, Authorization: `Basic ${auth}` },
        body: request.body,
        signal: controller.signal,
      })
      return { status: res.status, body: await res.text() }
    } finally {
      clearTimeout(timer)
    }
  }
}

// --- Parsing helpers ------------------------------------------------------

export interface ConsumptionInput {
  startDate: string
  endDate: string
  usage: number
  cost?: number | null
  estimated?: boolean
}

function consumptionToXml(entry: ConsumptionInput): Record<string, unknown> {
  const node: Record<string, unknown> = {
    startDate: entry.startDate,
    endDate: entry.endDate,
    usage: entry.usage,
    // ESPM requires the flag; omitting it is rejected rather than defaulted.
    estimatedValue: entry.estimated ? 'true' : 'false',
  }
  if (entry.cost !== null && entry.cost !== undefined) node['cost'] = entry.cost
  return node
}

function parseConsumption(node: unknown): EspmConsumption | null {
  if (typeof node !== 'object' || node === null) return null
  const obj = node as Record<string, unknown>
  const startDate = str(obj['startDate'])
  const endDate = str(obj['endDate'])
  const usage = num(obj['usage'])
  if (!startDate || !endDate || usage === undefined) return null
  return {
    id: num(obj['id']) ?? Number(attr(node, 'id') ?? Number.NaN),
    startDate,
    endDate,
    usage,
    cost: num(obj['cost']),
    estimatedValue: bool(obj['estimatedValue']) ?? false,
    energyExportedOffSite: num(obj['energyExportedOffSite']),
  }
}

function parseProperty(node: Record<string, unknown>, fallbackId: number): EspmProperty {
  const address = (node['address'] ?? {}) as Record<string, unknown>
  const gfa = node['grossFloorArea'] as Record<string, unknown> | undefined
  return {
    id: num(node['id']) ?? fallbackId,
    name: str(node['name']) ?? `Property ${fallbackId}`,
    primaryFunction: str(node['primaryFunction']) ?? 'Other',
    address: {
      address1: str(address['@_address1']) ?? str(address['address1']),
      address2: str(address['@_address2']) ?? str(address['address2']),
      city: str(address['@_city']) ?? str(address['city']),
      state: str(address['@_state']) ?? str(address['state']),
      postalCode: str(address['@_postalCode']) ?? str(address['postalCode']),
      country: str(address['@_country']) ?? str(address['country']),
    },
    yearBuilt: num(node['yearBuilt']),
    grossFloorArea: gfa
      ? { value: num(gfa['value']) ?? 0, units: attr(gfa, 'units') ?? 'Square Feet' }
      : undefined,
    occupancyPercentage: num(node['occupancyPercentage']),
    numberOfBuildings: num(node['numberOfBuildings']),
    constructionStatus: str(node['constructionStatus']),
    isFederalProperty: bool(node['isFederalProperty']),
  }
}

function isNetworkError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TypeError')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
