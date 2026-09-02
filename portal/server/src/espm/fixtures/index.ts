// ---------------------------------------------------------------------------
// Recorded Portfolio Manager responses, keyed by "METHOD /path".
//
// These are hand-written to match ESPM's documented response shapes, including
// its quirks: attributes on <address>, ids only in link paths, single-item
// lists arriving unwrapped, and an error envelope returned under HTTP 200.
// When you get access to the live test account, replace these with genuine
// recorded responses — the keys are all that matter.
//
// The five properties here stand in for the five dummy accounts in the ESPM
// test environment.
// ---------------------------------------------------------------------------

const account = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <account>
    <id>555001</id>
    <username>hbs_test_account</username>
    <organization>HBS Solutions</organization>
    <contact>
      <firstName>HBS</firstName>
      <lastName>Benchmarking</lastName>
      <email>benchmarking@example.com</email>
    </contact>
  </account>
</response>`

const propertyList = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <links>
    <link linkDescription="property" id="1810001" hint="Franklin Square Office" link="/property/1810001"/>
    <link linkDescription="property" id="1810002" hint="Kalorama Apartments" link="/property/1810002"/>
    <link linkDescription="property" id="1810003" hint="Rockville Medical Pavilion" link="/property/1810003"/>
    <link linkDescription="property" id="1810004" hint="Wheaton Distribution Center" link="/property/1810004"/>
    <link linkDescription="property" id="1810005" hint="Dupont Grand Hotel" link="/property/1810005"/>
  </links>
</response>`

function property(
  id: number,
  name: string,
  fn: string,
  sqft: number,
  year: number,
  city: string,
  state: string,
  zip: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<property>
  <id>${id}</id>
  <name>${name}</name>
  <primaryFunction>${fn}</primaryFunction>
  <address address1="100 Example Ave NW" city="${city}" state="${state}" postalCode="${zip}" country="US"/>
  <yearBuilt>${year}</yearBuilt>
  <grossFloorArea units="Square Feet"><value>${sqft}</value></grossFloorArea>
  <occupancyPercentage>95</occupancyPercentage>
  <numberOfBuildings>1</numberOfBuildings>
  <constructionStatus>Existing</constructionStatus>
  <isFederalProperty>false</isFederalProperty>
</property>`
}

function meterList(propertyId: number, meterIds: number[]): string {
  const links = meterIds
    .map((m) => `<link linkDescription="meter" id="${m}" link="/meter/${m}"/>`)
    .join('\n    ')
  return `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <links>
    ${links}
  </links>
</response>`
}

function meter(id: number, name: string, type: string, unit: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<meter>
  <id>${id}</id>
  <name>${name}</name>
  <type>${type}</type>
  <unitOfMeasure>${unit}</unitOfMeasure>
  <metered>true</metered>
  <inUse>true</inUse>
  <firstBillDate>2021-01-01</firstBillDate>
</meter>`
}

const CONSUMPTION_YEARS = [2021, 2022, 2023, 2024]

/**
 * Four years of monthly bills.
 *
 * Four rather than one on purpose: the anomaly monitor judges a reading
 * against the same calendar month in previous years, so a single year of
 * history gives it no baseline and it correctly reports nothing. The spike,
 * when asked for, lands in the final year only — which is exactly the shape
 * the monitor is built to catch.
 */
function consumption(meterId: number, base: number, spikeMonth: number | null): string {
  const rows: string[] = []
  for (const year of CONSUMPTION_YEARS) {
    // A gentle efficiency trend, so the years are not identical.
    const trend = 1 - 0.02 * (year - CONSUMPTION_YEARS[0]!)
    for (let m = 1; m <= 12; m++) {
      const seasonal = 1 + 0.35 * Math.cos(((m - 1) / 12) * 2 * Math.PI)
      // Deterministic month-to-month jitter keeps the series from being so
      // flat that the detector's zero-spread fallback is what gets tested.
      const jitter = 1 + 0.03 * Math.sin(year * 7.3 + m * 2.1)
      const spike = m === spikeMonth && year === CONSUMPTION_YEARS.at(-1) ? 1.9 : 1
      const usage = Math.round(base * seasonal * trend * jitter * spike)
      const end = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10)
      rows.push(`  <meterConsumption>
    <id>${meterId}${year}${String(m).padStart(2, '0')}</id>
    <startDate>${year}-${String(m).padStart(2, '0')}-01</startDate>
    <endDate>${end}</endDate>
    <usage>${usage}</usage>
    <cost>${(usage * 0.12).toFixed(2)}</cost>
    <estimatedValue>false</estimatedValue>
  </meterConsumption>`)
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<meterData>
${rows.join('\n')}
</meterData>`
}

function metrics(
  year: number,
  score: number | null,
  siteEui: number,
  sourceEui: number,
  wnSiteEui: number,
  siteTotal: number,
  ghg: number,
  ghgIntensity: number,
  water: number,
): string {
  const scoreNode =
    score === null
      ? `<metric name="score" dataQuality="Not Available"><value xsi:nil="true"/></metric>`
      : `<metric name="score" dataQuality="Metered"><value>${score}</value></metric>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<propertyMetrics year="${year}">
  ${scoreNode}
  <metric name="siteIntensity" uom="kBtu/ft²"><value>${siteEui}</value></metric>
  <metric name="sourceIntensity" uom="kBtu/ft²"><value>${sourceEui}</value></metric>
  <metric name="siteIntensityWN" uom="kBtu/ft²"><value>${wnSiteEui}</value></metric>
  <metric name="siteTotal" uom="kBtu"><value>${siteTotal}</value></metric>
  <metric name="totalLocationBasedGHGEmissions" uom="Metric Tons CO2e"><value>${ghg}</value></metric>
  <metric name="totalLocationBasedGHGEmissionsIntensity" uom="kgCO2e/ft²"><value>${ghgIntensity}</value></metric>
  <metric name="waterIntensityTotal" uom="gal/ft²"><value>${water}</value></metric>
</propertyMetrics>`
}

/**
 * Per-property metric trajectories for 2021-2024. The shapes are chosen so the
 * demo portfolio exercises every compliance state: comfortably compliant,
 * improving-but-short, badly short, and missing a score entirely.
 */
const METRIC_SERIES: Record<number, Array<[number, number | null, number, number, number, number, number, number, number]>> = {
  // [year, score, siteEUI, sourceEUI, wnSiteEUI, siteTotal kBtu, GHG mt, GHG kg/ft², water gal/ft²]
  1810001: [
    [2021, 54, 82.4, 191.2, 81.0, 20_600_000, 1_180, 4.72, 21.5],
    [2022, 57, 79.1, 184.0, 78.2, 19_775_000, 1_130, 4.52, 20.9],
    [2023, 59, 76.8, 178.5, 76.0, 19_200_000, 1_090, 4.36, 20.4],
    [2024, 62, 73.9, 171.8, 73.1, 18_475_000, 1_040, 4.16, 19.8],
  ],
  1810002: [
    [2021, 71, 61.2, 138.4, 60.5, 9_180_000, 520, 3.47, 45.2],
    [2022, 74, 59.0, 133.6, 58.4, 8_850_000, 500, 3.33, 44.1],
    [2023, 77, 56.8, 128.9, 56.2, 8_520_000, 481, 3.21, 43.5],
    [2024, 79, 55.1, 125.0, 54.6, 8_265_000, 466, 3.11, 42.8],
  ],
  1810003: [
    [2021, 48, 118.6, 268.1, 117.2, 8_302_000, 690, 9.86, 32.4],
    [2022, 46, 121.3, 274.2, 120.1, 8_491_000, 705, 10.07, 33.1],
    [2023, 45, 123.8, 279.8, 122.4, 8_666_000, 719, 10.27, 33.8],
    [2024, 44, 126.2, 285.2, 124.9, 8_834_000, 733, 10.47, 34.2],
  ],
  1810004: [
    [2021, null, 24.1, 54.5, 23.8, 4_820_000, 268, 1.34, 4.1],
    [2022, null, 23.4, 52.9, 23.1, 4_680_000, 260, 1.30, 4.0],
    [2023, null, 22.8, 51.5, 22.5, 4_560_000, 253, 1.27, 3.9],
    [2024, null, 22.1, 50.0, 21.9, 4_420_000, 246, 1.23, 3.8],
  ],
  1810005: [
    [2021, 41, 132.5, 299.5, 131.0, 15_900_000, 1_020, 8.50, 88.2],
    [2022, 43, 129.8, 293.4, 128.4, 15_576_000, 999, 8.33, 86.9],
    [2023, 44, 127.9, 289.1, 126.6, 15_348_000, 984, 8.20, 85.7],
    [2024, 46, 124.6, 281.6, 123.4, 14_952_000, 959, 7.99, 84.1],
  ],
}

function metricFixtures(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [propertyId, series] of Object.entries(METRIC_SERIES)) {
    for (const row of series) {
      const [year, score, siteEui, sourceEui, wn, total, ghg, ghgI, water] = row
      out[
        `GET /property/${propertyId}/metrics?measurementSystem=EPA&month=12&year=${year}`
      ] = metrics(year, score, siteEui, sourceEui, wn, total, ghg, ghgI, water)
    }
  }
  return out
}

export const FIXTURES: Record<string, string> = {
  'GET /account': account,
  'GET /account/555001/property/list': propertyList,
  'GET /connect/account/pending/list': '<response><links/></response>',
  'GET /share/property/pending/list': '<response><links/></response>',

  'GET /property/1810001': property(1810001, 'Franklin Square Office', 'Office', 250_000, 1974, 'Washington', 'DC', '20005'),
  'GET /property/1810002': property(1810002, 'Kalorama Apartments', 'Multifamily Housing', 150_000, 1962, 'Washington', 'DC', '20009'),
  'GET /property/1810003': property(1810003, 'Rockville Medical Pavilion', 'Medical Office', 70_000, 1988, 'Rockville', 'MD', '20850'),
  'GET /property/1810004': property(1810004, 'Wheaton Distribution Center', 'Non-Refrigerated Warehouse', 200_000, 2001, 'Wheaton', 'MD', '20902'),
  'GET /property/1810005': property(1810005, 'Dupont Grand Hotel', 'Hotel', 120_000, 1955, 'Washington', 'DC', '20036'),

  'GET /property/1810001/meter/list': meterList(1810001, [4410011, 4410012]),
  'GET /property/1810002/meter/list': meterList(1810002, [4410021, 4410022]),
  'GET /property/1810003/meter/list': meterList(1810003, [4410031]),
  'GET /property/1810004/meter/list': meterList(1810004, [4410041]),
  'GET /property/1810005/meter/list': meterList(1810005, [4410051, 4410052]),

  'GET /meter/4410011': meter(4410011, 'Franklin Square — Electric', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
  'GET /meter/4410012': meter(4410012, 'Franklin Square — Gas', 'Natural Gas', 'therms'),
  'GET /meter/4410021': meter(4410021, 'Kalorama — Electric', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
  'GET /meter/4410022': meter(4410022, 'Kalorama — Gas', 'Natural Gas', 'therms'),
  'GET /meter/4410031': meter(4410031, 'Rockville Medical — Electric', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
  'GET /meter/4410041': meter(4410041, 'Wheaton DC — Electric', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
  'GET /meter/4410051': meter(4410051, 'Dupont Grand — Electric', 'Electric - Grid', 'kWh (thousand Watt-hours)'),
  'GET /meter/4410052': meter(4410052, 'Dupont Grand — Steam', 'District Steam', 'kBtu (thousand Btu)'),

  // Meter 4410011 carries an August 2024 spike, which the anomaly monitor should catch.
  'GET /meter/4410011/consumptionData': consumption(4410011, 420_000, 8),
  'GET /meter/4410012/consumptionData': consumption(4410012, 18_000, null),
  'GET /meter/4410021/consumptionData': consumption(4410021, 155_000, null),
  'GET /meter/4410022/consumptionData': consumption(4410022, 12_500, null),
  'GET /meter/4410031/consumptionData': consumption(4410031, 190_000, null),
  'GET /meter/4410041/consumptionData': consumption(4410041, 96_000, null),
  'GET /meter/4410051/consumptionData': consumption(4410051, 310_000, null),
  'GET /meter/4410052/consumptionData': consumption(4410052, 240_000, null),

  ...metricFixtures(),
}
