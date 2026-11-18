// Tests for the alert rules, and specifically for the anomaly detector.
//
// What is covered here is what made the alert list unusable against real data:
// a detector that fired once per reading rather than once per meter, that
// raised alerts about readings years in the past, and that claimed a
// 3.5-sigma event off three observations.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createTestDb, type Db } from '../db/index.js'
import { detectAnomalies } from './alerts.js'

/** A tenant with one building and one electric meter, and nothing else. */
function seedBuildingWithMeter(db: Db): { buildingId: string; meterId: string } {
  const orgId = randomUUID()
  const buildingId = randomUUID()
  const meterId = randomUUID()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO organizations (id, name, slug, tier, created_at) VALUES (?, ?, ?, ?, ?)').run(
    orgId,
    'Anomaly Test Co',
    `anomaly-${orgId.slice(0, 8)}`,
    'benchmarking',
    now,
  )
  db.prepare(
    `INSERT INTO buildings (id, organization_id, espm_property_id, name, property_type,
                            gross_floor_area_sqft, jurisdiction, created_at)
     VALUES (?, ?, NULL, ?, 'Office', 100000, 'dc', ?)`,
  ).run(buildingId, orgId, 'Test Building', now)
  db.prepare(
    `INSERT INTO meters (id, building_id, espm_meter_id, name, type, unit, active)
     VALUES (?, ?, NULL, 'Electric Grid Meter', 'Electric - Grid', 'kWh (thousand Watt-hours)', 1)`,
  ).run(meterId, buildingId)
  return { buildingId, meterId }
}

function insertConsumption(
  db: Db,
  buildingId: string,
  meterId: string,
  rows: Array<[string, string, number]>,
): void {
  const stmt = db.prepare(
    `INSERT INTO consumption_entries
       (id, meter_id, building_id, start_date, end_date, quantity, unit, cost, estimated,
        espm_consumption_id, sync_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'kWh (thousand Watt-hours)', NULL, 0, NULL, 'remote', ?, ?)`,
  )
  const now = new Date().toISOString()
  for (const [start, end, quantity] of rows) {
    stmt.run(randomUUID(), meterId, buildingId, start, end, quantity, now, now)
  }
}

/** Three years of flat monthly readings, with an optional spike. */
function threeYears(spike?: { year: number; month: number; quantity: number }): Array<[string, string, number]> {
  const rows: Array<[string, string, number]> = []
  for (let year = 2023; year <= 2025; year++) {
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, '0')
      const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
      const hit = spike && spike.year === year && spike.month === m
      rows.push([`${year}-${mm}-01`, `${year}-${mm}-${lastDay}`, hit ? spike!.quantity : 100_000])
    }
  }
  return rows
}

test('a usage spike is one alert per meter, not one per reading', () => {
  // Three years of monthly bills on one building produced sixty near-identical
  // "unusual usage" alerts and buried the compliance alerts underneath them.
  // An alert list is a queue someone works through, not a log of everything
  // the detector ever noticed.
  const db = createTestDb()
  const { buildingId, meterId } = seedBuildingWithMeter(db)
  insertConsumption(db, buildingId, meterId, threeYears({ year: 2025, month: 7, quantity: 300_000 }))

  const findings = detectAnomalies(db, buildingId)
  assert.equal(findings.length, 1, `expected one finding per meter, got ${findings.length}`)
  assert.match(findings[0]!.detail, /2025-07/)
})

test('an old spike is not raised as an alert', () => {
  // An anomaly from three years ago is history. The utility analysis reports
  // it without demanding action; the alert queue should not.
  const db = createTestDb()
  const { buildingId, meterId } = seedBuildingWithMeter(db)
  insertConsumption(db, buildingId, meterId, threeYears({ year: 2023, month: 7, quantity: 300_000 }))
  assert.equal(detectAnomalies(db, buildingId).length, 0)
})

test('a thin history needs a large jump, not just a sigma figure', () => {
  // Three observations of a meter that barely varies produce a MAD small
  // enough to make an ordinary month look like a 3.5-sigma event. A 6% drift
  // is real and is not an incident.
  const db = createTestDb()
  const { buildingId, meterId } = seedBuildingWithMeter(db)
  insertConsumption(db, buildingId, meterId, threeYears({ year: 2025, month: 7, quantity: 106_000 }))
  assert.equal(detectAnomalies(db, buildingId).length, 0, 'a 6% drift is not an alert')
})

test('a genuine recent spike is still caught', () => {
  // The detector must not have been quietened into uselessness by the above.
  const db = createTestDb()
  const { buildingId, meterId } = seedBuildingWithMeter(db)
  insertConsumption(db, buildingId, meterId, threeYears({ year: 2025, month: 11, quantity: 180_000 }))
  const findings = detectAnomalies(db, buildingId)
  assert.equal(findings.length, 1)
  assert.match(findings[0]!.detail, /80% above/)
})
