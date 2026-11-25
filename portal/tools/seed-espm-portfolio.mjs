// ---------------------------------------------------------------------------
// Create a DC / Montgomery County portfolio in an ENERGY STAR *test* account.
//
// Why this exists. A seed script that writes buildings straight into SQLite
// produces a portal that demos well and proves nothing: the numbers never pass
// through ESPM, so nothing about the integration is exercised and every figure
// on screen is one this repository made up. This pushes the portfolio into
// Portfolio Manager instead — properties, use details, meters, and three years
// of monthly bills — and lets ESPM compute the scores and intensities. What
// the portal then shows came back through the same API a customer's data would.
//
// What is synthetic and what is not. The consumption and cost figures here are
// generated: a seasonal shape, a target site EUI, a tariff with a standing
// charge, and a little deterministic noise. The ENERGY STAR scores, site and
// source EUI, weather-normalized EUI and emissions are NOT — ESPM computes
// those from the uploaded bills, and they are whatever they are. Two buildings
// were aimed either side of the DC office standard and landed at 93 and 67
// against a standard of 71; that spread is ESPM's arithmetic, not a number
// chosen here.
//
// Two deliberate, documented flaws are seeded so the data-quality engine has
// something true to find: Harrington Place is missing its March 2024 gas bill,
// and Woodmont Tower has one electric reading marked estimated. Both are
// ordinary in a real portfolio. Nothing else is wrong on purpose.
//
// Deterministic: the same run produces the same numbers, so a re-seed does not
// quietly change what a demo shows.
//
// Usage:
//   . ./.env && node tools/seed-espm-portfolio.mjs            # whole portfolio
//   . ./.env && node tools/seed-espm-portfolio.mjs 'The Kenmore'   # one building
//
// Requires ESPM_USERNAME, ESPM_PASSWORD and ESPM_ACCOUNT_ID in the
// environment. It is kept as plain ESM rather than TypeScript because it is a
// one-off operator tool that writes to an external system, not application
// code: nothing in the portal imports it and it is not part of the build.
// ---------------------------------------------------------------------------

// Hard-wired to ESPM's test host. This script creates and deletes properties,
// and pointing it at a live account would put fabricated bills into a real
// customer's benchmarking record. Changing this line is not a configuration
// decision; it is a different script.
const BASE = 'https://portfoliomanager.energystar.gov/wstest'
const ACCOUNT = Number(process.env.ESPM_ACCOUNT_ID ?? '0')
const AUTH =
  'Basic ' + Buffer.from(`${process.env.ESPM_USERNAME}:${process.env.ESPM_PASSWORD}`).toString('base64')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(method, path, body) {
  await sleep(140)
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: AUTH, 'Content-Type': 'application/xml' },
    body,
  })
  const text = await res.text()
  if (!res.ok || /<errors>/.test(text)) {
    const msgs = [...text.matchAll(/<errorDescription>([^<]*)<\/errorDescription>/g)].map((m) => m[1])
    throw new Error(`${method} ${path} → ${res.status}${msgs.length ? `: ${msgs.join(' | ')}` : `\n${text.slice(0, 600)}`}`)
  }
  return text
}

const idFrom = (xml) => {
  const m = xml.match(/<id>(\d+)<\/id>/) ?? xml.match(/<link[^>]*id="(\d+)"/)
  if (!m) throw new Error(`no id in response: ${xml.slice(0, 300)}`)
  return Number(m[1])
}

// --- Deterministic noise ---------------------------------------------------

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// --- Climate shape (DC / suburban Maryland) --------------------------------

// Jan..Dec. Heating peaks in January, cooling in July; both near zero in the
// shoulder months. Crude next to real degree days, but it produces bills with
// the seasonal shape a reviewer would expect to see, which is the point.
const HEAT = [1.0, 0.92, 0.70, 0.38, 0.12, 0.02, 0.0, 0.0, 0.04, 0.22, 0.55, 0.88]
const COOL = [0.0, 0.0, 0.05, 0.18, 0.45, 0.8, 1.0, 0.95, 0.62, 0.25, 0.05, 0.0]

const YEARS = [2023, 2024, 2025]
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/**
 * Monthly electric kWh and gas therms for one building.
 *
 * Built backwards from a target site EUI so the property lands where intended
 * against its BEPS standard: pick the annual kBtu, split it between fuels,
 * then shape it across the year. ESPM computes the actual score and EUI from
 * what is uploaded, so these targets steer the result rather than set it.
 */
function bills(b) {
  const rand = rng(b.seed)
  const out = { electric: [], gas: [], water: [] }

  for (const [yi, year] of YEARS.entries()) {
    const trend = (1 + b.annualTrend) ** yi
    const annualKbtu = b.targetSiteEui * b.sqft * trend
    const elecKwh = (annualKbtu * b.electricShare) / 3.412
    const gasTherms = (annualKbtu * (1 - b.electricShare)) / 100

    const elecWeights = []
    const gasWeights = []
    for (let m = 0; m < 12; m++) {
      const days = daysIn(year, m)
      elecWeights.push(days * (1 + 0.55 * COOL[m]))
      gasWeights.push(days * (0.1 + HEAT[m]))
    }
    const elecTotal = elecWeights.reduce((a, c) => a + c, 0)
    const gasTotal = gasWeights.reduce((a, c) => a + c, 0)

    for (let m = 0; m < 12; m++) {
      const days = daysIn(year, m)
      const start = iso(year, m, 1)
      const end = iso(year, m, days)
      const jitter = () => 0.97 + rand() * 0.06

      const kwh = Math.round((elecKwh * elecWeights[m]) / elecTotal * jitter())
      const elecRate = b.electricRate * 1.04 ** yi
      out.electric.push({
        start,
        end,
        quantity: kwh,
        cost: Math.round((kwh * elecRate + b.electricFixed) * 100) / 100,
      })

      const therms = Math.round((gasTherms * gasWeights[m]) / gasTotal * jitter())
      const gasRate = b.gasRate * 1.05 ** yi
      out.gas.push({
        start,
        end,
        quantity: therms,
        cost: Math.round((therms * gasRate + b.gasFixed) * 100) / 100,
      })

      if (b.waterGalPerSqFt) {
        const annualGal = b.waterGalPerSqFt * b.sqft
        const gal = Math.round((annualGal / 365) * days * jitter())
        out.water.push({
          start,
          end,
          quantity: gal,
          cost: Math.round((gal * 0.0145 + 60) * 100) / 100,
        })
      }
    }
  }
  return out
}

// --- The portfolio ---------------------------------------------------------

const BUILDINGS = [
  {
    name: 'Harrington Place',
    seed: 101,
    primaryFunction: 'Office',
    usePath: 'office',
    address1: '1200 New Hampshire Ave NW',
    city: 'Washington',
    state: 'DC',
    postalCode: '20036',
    yearBuilt: 1986,
    sqft: 185_000,
    occupancy: 90,
    // Well above the DC office median, so this one should miss the standard.
    targetSiteEui: 78,
    electricShare: 0.6,
    annualTrend: -0.01,
    electricRate: 0.115,
    electricFixed: 425,
    gasRate: 1.05,
    gasFixed: 95,
    waterGalPerSqFt: 14,
    use: {
      weeklyOperatingHours: 60,
      numberOfWorkers: 520,
      numberOfComputers: 560,
      percentOfficeHeated: '50% or more',
      percentOfficeCooled: '50% or more',
    },
    // A deliberate, documented hole: no gas bill for March 2024. It is here so
    // the data-quality engine has a real gap to find in demo data; it is not a
    // fault in the pipeline.
    skipGas: ['2024-03-01'],
  },
  {
    name: 'Lafayette Court',
    seed: 102,
    primaryFunction: 'Office',
    usePath: 'office',
    address1: '800 K Street NW',
    city: 'Washington',
    state: 'DC',
    postalCode: '20001',
    yearBuilt: 2009,
    sqft: 240_000,
    occupancy: 95,
    // A modern, efficient building: should clear the DC standard comfortably.
    targetSiteEui: 44,
    electricShare: 0.72,
    annualTrend: -0.02,
    electricRate: 0.108,
    electricFixed: 510,
    gasRate: 1.02,
    gasFixed: 110,
    waterGalPerSqFt: 11,
    use: {
      weeklyOperatingHours: 65,
      numberOfWorkers: 900,
      numberOfComputers: 1_050,
      percentOfficeHeated: '50% or more',
      percentOfficeCooled: '50% or more',
    },
  },
  {
    name: 'The Kenmore',
    seed: 103,
    primaryFunction: 'Multifamily Housing',
    usePath: 'multifamilyHousing',
    address1: '2400 16th Street NW',
    city: 'Washington',
    state: 'DC',
    postalCode: '20009',
    yearBuilt: 1964,
    sqft: 142_000,
    occupancy: 95,
    targetSiteEui: 58,
    electricShare: 0.48,
    annualTrend: 0.005,
    electricRate: 0.119,
    electricFixed: 300,
    gasRate: 1.08,
    gasFixed: 80,
    waterGalPerSqFt: 42,
    use: {
      numberOfResidentialLivingUnits: 164,
      numberOfBedrooms: 212,
      numberOfResidentialLivingUnitsLowRiseSetting: 0,
      numberOfResidentialLivingUnitsMidRiseSetting: 0,
      numberOfResidentialLivingUnitsHighRiseSetting: 164,
      percentCooled: 100,
      percentHeated: 100,
    },
  },
  {
    name: 'Dupont Row Hotel',
    seed: 104,
    primaryFunction: 'Hotel',
    usePath: 'hotel',
    address1: '1500 Connecticut Ave NW',
    city: 'Washington',
    state: 'DC',
    postalCode: '20036',
    yearBuilt: 1992,
    sqft: 96_000,
    occupancy: 80,
    targetSiteEui: 94,
    electricShare: 0.58,
    annualTrend: 0.01,
    electricRate: 0.121,
    electricFixed: 280,
    gasRate: 1.1,
    gasFixed: 90,
    waterGalPerSqFt: 58,
    use: {
      numberOfHotelRooms: 148,
      numberOfWorkers: 95,
      percentCooled: 100,
      percentHeated: 100,
    },
  },
  {
    name: 'Woodmont Tower',
    seed: 201,
    primaryFunction: 'Office',
    usePath: 'office',
    address1: '7600 Wisconsin Avenue',
    city: 'Bethesda',
    state: 'MD',
    postalCode: '20814',
    yearBuilt: 1984,
    sqft: 310_000,
    occupancy: 90,
    targetSiteEui: 71,
    electricShare: 0.63,
    annualTrend: -0.015,
    electricRate: 0.112,
    electricFixed: 640,
    gasRate: 0.98,
    gasFixed: 140,
    waterGalPerSqFt: 13,
    use: {
      weeklyOperatingHours: 55,
      numberOfWorkers: 820,
      numberOfComputers: 900,
      percentOfficeHeated: '50% or more',
      percentOfficeCooled: '50% or more',
    },
    // One reading entered as an estimate rather than a billed figure, which
    // is ordinary in a real portfolio and gives the UI something true to flag.
    estimateElectric: ['2025-07-01'],
  },
  {
    name: 'Shady Grove Medical Offices',
    seed: 202,
    primaryFunction: 'Medical Office',
    usePath: 'medicalOffice',
    address1: '9900 Medical Center Drive',
    city: 'Rockville',
    state: 'MD',
    postalCode: '20850',
    yearBuilt: 2001,
    sqft: 72_000,
    occupancy: 90,
    targetSiteEui: 86,
    electricShare: 0.66,
    annualTrend: -0.005,
    electricRate: 0.114,
    electricFixed: 310,
    gasRate: 1.0,
    gasFixed: 85,
    waterGalPerSqFt: 19,
    use: {
      weeklyOperatingHours: 70,
      numberOfWorkers: 240,
      numberOfComputers: 260,
      percentHeated: 100,
      percentCooled: 100,
    },
  },
  {
    name: 'Layhill Distribution Center',
    seed: 203,
    primaryFunction: 'Non-Refrigerated Warehouse',
    usePath: 'nonRefrigeratedWarehouse',
    address1: '11500 Georgia Avenue',
    city: 'Wheaton',
    state: 'MD',
    postalCode: '20902',
    yearBuilt: 1998,
    sqft: 205_000,
    occupancy: 100,
    targetSiteEui: 26,
    electricShare: 0.55,
    annualTrend: -0.01,
    electricRate: 0.106,
    electricFixed: 380,
    gasRate: 0.95,
    gasFixed: 70,
    waterGalPerSqFt: 3,
    use: {
      weeklyOperatingHours: 50,
      numberOfWorkers: 85,
      percentHeated: 80,
      percentCooled: 20,
    },
  },
  {
    name: 'Glenmont Gardens',
    seed: 204,
    primaryFunction: 'Multifamily Housing',
    usePath: 'multifamilyHousing',
    address1: '12200 Georgia Avenue',
    city: 'Silver Spring',
    state: 'MD',
    postalCode: '20902',
    yearBuilt: 1972,
    sqft: 128_000,
    occupancy: 95,
    targetSiteEui: 62,
    electricShare: 0.45,
    annualTrend: 0.0,
    electricRate: 0.117,
    electricFixed: 260,
    gasRate: 1.06,
    gasFixed: 75,
    waterGalPerSqFt: 46,
    use: {
      numberOfResidentialLivingUnits: 148,
      numberOfBedrooms: 196,
      numberOfResidentialLivingUnitsLowRiseSetting: 0,
      numberOfResidentialLivingUnitsMidRiseSetting: 148,
      numberOfResidentialLivingUnitsHighRiseSetting: 0,
      percentCooled: 100,
      percentHeated: 100,
    },
  },
]

// --- XML builders ----------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function propertyXml(b) {
  return `<property>
  <name>${esc(b.name)}</name>
  <primaryFunction>${esc(b.primaryFunction)}</primaryFunction>
  <address address1="${esc(b.address1)}" city="${esc(b.city)}" state="${esc(b.state)}" postalCode="${esc(b.postalCode)}" country="US"/>
  <yearBuilt>${b.yearBuilt}</yearBuilt>
  <constructionStatus>Existing</constructionStatus>
  <grossFloorArea units="Square Feet"><value>${b.sqft}</value></grossFloorArea>
  <occupancyPercentage>${b.occupancy}</occupancyPercentage>
  <isFederalProperty>false</isFederalProperty>
  <numberOfBuildings>1</numberOfBuildings>
</property>`
}

function useXml(b) {
  const asOf = `${YEARS[0]}-01-01`
  const details = Object.entries(b.use)
    .map(([k, v]) => `    <${k} currentAsOf="${asOf}"><value>${esc(v)}</value></${k}>`)
    .join('\n')
  return `<${b.usePath}>
  <name>${esc(b.name)} — whole building</name>
  <useDetails>
${details}
    <totalGrossFloorArea units="Square Feet" currentAsOf="${asOf}"><value>${b.sqft}</value></totalGrossFloorArea>
  </useDetails>
</${b.usePath}>`
}

function meterXml({ type, name, unit, first }) {
  return `<meter>
  <type>${esc(type)}</type>
  <name>${esc(name)}</name>
  <metered>true</metered>
  <unitOfMeasure>${esc(unit)}</unitOfMeasure>
  <firstBillDate>${first}</firstBillDate>
  <inUse>true</inUse>
</meter>`
}

function consumptionXml(rows) {
  const items = rows
    .map(
      (r) => `  <meterConsumption estimatedValue="${r.estimated ? 'true' : 'false'}">
    <startDate>${r.start}</startDate>
    <endDate>${r.end}</endDate>
    <usage>${r.quantity}</usage>
    <cost>${r.cost}</cost>
  </meterConsumption>`,
    )
    .join('\n')
  return `<meterData>\n${items}\n</meterData>`
}

function associationXml(energyIds, waterIds) {
  const energy = energyIds.length
    ? `  <energyMeterAssociation>
    <meters>${energyIds.map((id) => `<meterId>${id}</meterId>`).join('')}</meters>
    <propertyRepresentation><propertyRepresentationType>Whole Property</propertyRepresentationType></propertyRepresentation>
  </energyMeterAssociation>`
    : ''
  const water = waterIds.length
    ? `  <waterMeterAssociation>
    <meters>${waterIds.map((id) => `<meterId>${id}</meterId>`).join('')}</meters>
    <propertyRepresentation><propertyRepresentationType>Whole Property</propertyRepresentationType></propertyRepresentation>
  </waterMeterAssociation>`
    : ''
  return `<meterPropertyAssociationList>\n${energy}\n${water}\n</meterPropertyAssociationList>`
}

// --- Run -------------------------------------------------------------------

const only = process.argv[2] ? BUILDINGS.filter((b) => b.name === process.argv[2]) : BUILDINGS

for (const b of only) {
  let createdId = null
  try {
    const propertyId = idFrom(await call('POST', `/account/${ACCOUNT}/property`, propertyXml(b)))
    createdId = propertyId
    console.log(`\n${b.name}: property ${propertyId}`)

    await call('POST', `/property/${propertyId}/propertyUse`, useXml(b))
    console.log('  use details ok')

    const data = bills(b)
    const first = `${YEARS[0]}-01-01`

    const elecId = idFrom(
      await call('POST', `/property/${propertyId}/meter`, meterXml({ type: 'Electric', name: 'Electric Grid Meter', unit: 'kWh (thousand Watt-hours)', first })),
    )
    const gasId = idFrom(
      await call('POST', `/property/${propertyId}/meter`, meterXml({ type: 'Natural Gas', name: 'Natural Gas', unit: 'therms', first })),
    )
    const waterId = b.waterGalPerSqFt
      ? idFrom(
          await call('POST', `/property/${propertyId}/meter`, meterXml({ type: 'Municipally Supplied Potable Water - Mixed Indoor/Outdoor', name: 'Potable Water', unit: 'Gallons (US)', first })),
        )
      : null
    console.log(`  meters: electric ${elecId}, gas ${gasId}${waterId ? `, water ${waterId}` : ''}`)

    await call('POST', `/association/property/${propertyId}/meter`, associationXml([elecId, gasId], waterId ? [waterId] : []))
    console.log('  associated with property')

    const elecRows = data.electric.map((r) => ({ ...r, estimated: (b.estimateElectric ?? []).includes(r.start) }))
    const gasRows = data.gas.filter((r) => !(b.skipGas ?? []).includes(r.start))

    for (const [id, rows, label] of [
      [elecId, elecRows, 'electric'],
      [gasId, gasRows, 'gas'],
      ...(waterId ? [[waterId, data.water, 'water']] : []),
    ]) {
      for (let i = 0; i < rows.length; i += 24) {
        await call('POST', `/meter/${id}/consumptionData`, consumptionXml(rows.slice(i, i + 24)))
      }
      console.log(`  ${label}: ${rows.length} bills`)
    }
  } catch (err) {
    console.error(`\n${b.name}: FAILED — ${err.message}`)
    if (createdId !== null) {
      try {
        await call('DELETE', `/property/${createdId}`)
        console.error(`  rolled back property ${createdId}`)
      } catch (cleanupErr) {
        console.error(`  could not roll back property ${createdId}: ${cleanupErr.message}`)
      }
    }
  }
}
