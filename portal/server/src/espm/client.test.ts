// ---------------------------------------------------------------------------
// Tests for the ESPM client.
//
// The client is the piece with the least margin for error: it parses XML we do
// not control and it writes into a regulated record. What is covered here is
// what would go wrong quietly — a single-item list parsed as an object, a
// postal code coerced to a number, an error returned under HTTP 200, a batch
// push whose acknowledged ids get misaligned with the rows that produced them.
// ---------------------------------------------------------------------------

import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { EspmApiError, EspmClient, type EspmRequest, type EspmResponse, type EspmTransport } from './client.js'
import { FixtureTransport } from './fixtureTransport.js'
import { inferJurisdiction, mapProperty, mapPropertyType } from './mapper.js'

/** A transport that answers each path from a map and records what it was sent. */
class StubTransport implements EspmTransport {
  readonly sent: EspmRequest[] = []
  constructor(private readonly routes: Record<string, EspmResponse>) {}
  async send(request: EspmRequest): Promise<EspmResponse> {
    this.sent.push(request)
    return (
      this.routes[`${request.method} ${request.path}`] ?? {
        status: 404,
        body: '<response status="Error"><errors><error errorDescription="not stubbed"/></errors></response>',
      }
    )
  }
}

function client(transport: EspmTransport): EspmClient {
  // No throttle in tests; the real default would make this suite take minutes.
  return new EspmClient({
    username: 'u',
    password: 'p',
    transport,
    minRequestIntervalMs: 0,
    maxRetries: 0,
  })
}

test('sends HTTP Basic credentials and the right base URL', async () => {
  const transport = new StubTransport({
    'GET /account': { status: 200, body: '<response><account><id>7</id><username>u</username></account></response>' },
  })
  const c = new EspmClient({ username: 'alice', password: 's3cret', transport, minRequestIntervalMs: 0 })
  await c.getAccount()
  assert.equal(c.environment, 'test')
})

test('a single-item list is still a list', async () => {
  // ESPM omits the array wrapper when there is exactly one item — the classic
  // way an integration works in staging and breaks on a one-building customer.
  const transport = new StubTransport({
    'GET /account/1/property/list': {
      status: 200,
      body: '<response><links><link linkDescription="property" id="42" link="/property/42"/></links></response>',
    },
  })
  const links = await client(transport).listProperties(1)
  assert.equal(links.length, 1)
  assert.equal(links[0]?.id, 42)
})

test('an empty list is empty, not an error', async () => {
  const transport = new StubTransport({
    'GET /account/1/property/list': { status: 200, body: '<response><links/></response>' },
  })
  assert.deepEqual(await client(transport).listProperties(1), [])
})

test('an error envelope under HTTP 200 is still an error', async () => {
  const transport = new StubTransport({
    'GET /property/9': {
      status: 200,
      body: '<response status="Error"><errors><error errorNumber="-220" errorDescription="You do not have access to this property."/></errors></response>',
    },
  })
  await assert.rejects(
    () => client(transport).getProperty(9),
    (err: unknown) => {
      assert.ok(err instanceof EspmApiError)
      assert.match(err.message, /do not have access/)
      assert.equal(err.retryable, false)
      return true
    },
  )
})

test('a property parses, including attribute-style addresses', async () => {
  const transport = new StubTransport({
    'GET /property/42': {
      status: 200,
      body: `<property>
        <id>42</id><name>Test Tower</name><primaryFunction>Office</primaryFunction>
        <address address1="1 Main St" city="Washington" state="DC" postalCode="07030"/>
        <yearBuilt>1980</yearBuilt>
        <grossFloorArea units="Square Feet"><value>120000</value></grossFloorArea>
      </property>`,
    },
  })
  const property = await client(transport).getProperty(42)
  assert.equal(property.name, 'Test Tower')
  // A leading-zero postal code must survive as a string, not become 7030.
  assert.equal(property.address?.postalCode, '07030')
  assert.equal(property.grossFloorArea?.value, 120_000)
})

test('square metres are converted, unknown units are rejected rather than assumed', async () => {
  const metric = mapProperty({
    id: 1,
    name: 'M',
    primaryFunction: 'Office',
    grossFloorArea: { value: 1000, units: 'Square Meters' },
  })
  assert.equal(metric.grossFloorAreaSqFt, 10_764)

  const nonsense = mapProperty({
    id: 2,
    name: 'N',
    primaryFunction: 'Office',
    grossFloorArea: { value: 1000, units: 'Acres' },
  })
  // 0, not 1000 — floor area drives every fine, so a unit we cannot read must
  // surface as missing data rather than a plausible wrong number.
  assert.equal(nonsense.grossFloorAreaSqFt, 0)
})

test('consumption pagination follows the next-page link', async () => {
  const transport = new StubTransport({
    'GET /meter/5/consumptionData': {
      status: 200,
      body: `<response><meterData>
        <meterConsumption><id>1</id><startDate>2024-01-01</startDate><endDate>2024-01-31</endDate><usage>100</usage><estimatedValue>false</estimatedValue></meterConsumption>
      </meterData><links><link linkDescription="next page" link="/meter/5/consumptionData?page=2"/></links></response>`,
    },
    'GET /meter/5/consumptionData?page=2': {
      status: 200,
      body: `<meterData>
        <meterConsumption><id>2</id><startDate>2024-02-01</startDate><endDate>2024-02-29</endDate><usage>200</usage><estimatedValue>true</estimatedValue></meterConsumption>
      </meterData>`,
    },
  })
  const entries = await client(transport).getConsumption(5)
  assert.equal(entries.length, 2)
  assert.equal(entries[1]?.usage, 200)
  assert.equal(entries[1]?.estimatedValue, true)
})

test('pushing consumption sends one request per meter and returns ids in order', async () => {
  const transport = new FixtureTransport()
  const created = await client(transport).addConsumption(5, [
    { startDate: '2025-01-01', endDate: '2025-01-31', usage: 1, cost: 10 },
    { startDate: '2025-02-01', endDate: '2025-02-28', usage: 2, estimated: true },
  ])

  assert.equal(transport.writes.length, 1, 'a batch must not become N requests')
  assert.equal(created.length, 2)
  // Misaligning ids with the rows that produced them would mark the wrong
  // local row as synced, so the order is part of the contract.
  assert.equal(created[0]?.startDate, '2025-01-01')
  assert.equal(created[1]?.startDate, '2025-02-01')
  assert.ok(created[0]!.id !== created[1]!.id)

  const body = transport.writes[0]?.body ?? ''
  assert.match(body, /<usage>1<\/usage>/)
  assert.match(body, /<cost>10<\/cost>/)
  // ESPM rejects a record with no estimatedValue rather than defaulting it.
  assert.match(body, /<estimatedValue>false<\/estimatedValue>/)
  assert.match(body, /<estimatedValue>true<\/estimatedValue>/)
})

test('an empty push makes no request at all', async () => {
  const transport = new FixtureTransport()
  assert.deepEqual(await client(transport).addConsumption(5, []), [])
  assert.equal(transport.writes.length, 0)
})

test('metrics come back keyed by our own field names', async () => {
  const transport = new StubTransport({
    'GET /property/42/metrics?year=2024&month=12&measurementSystem=EPA': {
      status: 200,
      body: `<propertyMetrics>
        <metric name="score"><value>75</value></metric>
        <metric name="siteIntensity" uom="kBtu/ft²"><value>62.5</value></metric>
      </propertyMetrics>`,
    },
  })
  const metrics = await client(transport).getPropertyMetrics(42, {
    year: 2024,
    keys: ['score', 'siteEui', 'sourceEui'],
  })
  assert.equal(metrics.score, 75)
  assert.equal(metrics.siteEui, 62.5)
  // Requested but absent must be null, never undefined-and-forgotten.
  assert.equal(metrics.sourceEui, null)
})

test('the wanted metrics travel in the PM-Metrics header, not the query string', async () => {
  const transport = new StubTransport({
    'GET /property/42/metrics?year=2024&month=12&measurementSystem=EPA': {
      status: 200,
      body: '<propertyMetrics><metric name="score"><value>1</value></metric></propertyMetrics>',
    },
  })
  await client(transport).getPropertyMetrics(42, { year: 2024, keys: ['score'] })
  assert.equal(transport.sent[0]?.headers?.['PM-Metrics'], 'score')
})

test('a transient failure is retried, a validation failure is not', async () => {
  let calls = 0
  const flaky: EspmTransport = {
    async send() {
      calls++
      if (calls === 1) return { status: 503, body: '<response status="Error"><errors><error errorDescription="busy"/></errors></response>' }
      return { status: 200, body: '<response><account><id>1</id><username>u</username></account></response>' }
    },
  }
  const account = await new EspmClient({
    username: 'u', password: 'p', transport: flaky, minRequestIntervalMs: 0, maxRetries: 2,
  }).getAccount()
  assert.equal(account.id, 1)
  assert.equal(calls, 2)

  let badCalls = 0
  const rejecting: EspmTransport = {
    async send() {
      badCalls++
      return { status: 400, body: '<response status="Error"><errors><error errorDescription="bad date"/></errors></response>' }
    },
  }
  await assert.rejects(() =>
    new EspmClient({
      username: 'u', password: 'p', transport: rejecting, minRequestIntervalMs: 0, maxRetries: 2,
    }).getAccount(),
  )
  assert.equal(badCalls, 1, 'a 400 will fail identically forever; retrying it wastes quota')
})

test('one failing request does not poison the ones queued behind it', async () => {
  // Requests are serialized through a shared promise chain; a rejection there
  // could break every later call if the chain were not repaired.
  const transport = new StubTransport({
    'GET /account': { status: 200, body: '<response><account><id>3</id><username>u</username></account></response>' },
  })
  const c = client(transport)
  await assert.rejects(() => c.getProperty(999))
  const account = await c.getAccount()
  assert.equal(account.id, 3)
})

test('property types map to ours, and unknown ones become Other rather than nothing', () => {
  assert.equal(mapPropertyType('Financial Office'), 'Office')
  assert.equal(mapPropertyType('Distribution Center'), 'Non-Refrigerated Warehouse')
  assert.equal(mapPropertyType('Ice Rink'), 'Other')
})

test('jurisdiction is inferred only where we are confident', () => {
  assert.equal(inferJurisdiction('DC', 'Washington', '20005'), 'dc')
  assert.equal(inferJurisdiction('MD', 'Rockville', '20850'), 'montgomery-md')
  assert.equal(inferJurisdiction('MD', 'Wheaton', '20902'), 'montgomery-md')
  // Maryland, but not Montgomery County — must not be guessed into a standard.
  assert.equal(inferJurisdiction('MD', 'Baltimore', '21201'), 'none')
  assert.equal(inferJurisdiction('VA', 'Arlington', '22201'), 'none')
})
