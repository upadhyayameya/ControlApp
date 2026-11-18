// Tests for the ESPM → portal mapping.
//
// The meter type map is the part that failed silently in production-like use:
// fixtures were written against Portfolio Manager's *display labels*, while
// the API sends different strings, and an unrecognised string used to default
// to grid electricity. A live pull therefore recorded gallons of water as
// kilowatt-hours without any error. These tests pin the strings ESPM really
// sends, so the next person to extend the map cannot regress it against
// hand-written fixtures.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isWaterMeter, meterTypeFor } from './mapper.js'
import { metricYearsToPull } from './sync.js'

/**
 * Read off <type> for every meter of the six EPA sample properties in ESPM's
 * test environment on 2026-11-18. Left side: what ESPM sends. Right side:
 * what the portal must record.
 */
const LIVE_TYPES: Array<[string, string]> = [
  ['Electric', 'Electric - Grid'],
  ['Electric on Site Solar', 'Electric - Solar'],
  ['Natural Gas', 'Natural Gas'],
  ['Fuel Oil No 2', 'Fuel Oil No. 2'],
  ['Municipally Supplied Potable Water - Indoor', 'Potable Water'],
  ['Municipally Supplied Potable Water - Outdoor', 'Potable Water'],
  ['Municipally Supplied Potable Water - Mixed Indoor/Outdoor', 'Potable Water'],
]

test('every meter type ESPM actually sends maps to the right fuel', () => {
  for (const [espmType, expected] of LIVE_TYPES) {
    assert.equal(meterTypeFor(espmType), expected, `ESPM type "${espmType}"`)
  }
})

test('an unrecognised meter type is Unknown, never guessed as electricity', () => {
  // The old default. A new ESPM fuel must not arrive as purchased grid power.
  assert.equal(meterTypeFor('Coal Anthracite'), 'Unknown')
  assert.equal(meterTypeFor(''), 'Unknown')
})

test('water is recognised from the type string even if the map misses it', () => {
  // ESPM has added water type names before; the fallback catches them as
  // water rather than as an energy fuel, which would corrupt every EUI.
  assert.equal(meterTypeFor('Reclaimed Potable Water - Indoor'), 'Potable Water')
  // District chilled water is energy, not water use, despite the name.
  assert.equal(isWaterMeter('District Chilled Water'), false)
  assert.equal(meterTypeFor('District Chilled Water'), 'District Chilled Water')
})

test('display labels still resolve, so existing fixtures and rows keep working', () => {
  assert.equal(meterTypeFor('Electric - Grid'), 'Electric - Grid')
  assert.equal(meterTypeFor('Fuel Oil No. 2'), 'Fuel Oil No. 2')
  assert.equal(meterTypeFor('  Natural Gas  '), 'Natural Gas')
})

// --- Which years to ask ESPM for metrics on -------------------------------

test('metric years follow the data, not just the calendar', () => {
  // A building being benchmarked now: last four complete years.
  assert.deepEqual(metricYearsToPull(2026, 2026), [2025, 2024, 2023, 2022])

  // A building whose readings stop in 2016 — every EPA sample property is
  // like this. The fixed recent window asked only for years that hold
  // nothing, so no metrics were stored at all and the utility analysis had
  // no ESPM figure to check the bills against.
  const stale = metricYearsToPull(2016, 2026)
  assert.ok(stale.includes(2016), 'the last year with a reading must be pulled')
  assert.ok(stale.includes(2015))
  assert.ok(stale.includes(2025), 'recent years are still pulled')
  // Newest first, no duplicates.
  assert.deepEqual(stale, [...stale].sort((a, b) => b - a))
  assert.equal(new Set(stale).size, stale.length)

  // No readings at all: nothing to anchor on, so just the recent window.
  assert.deepEqual(metricYearsToPull(null, 2026), [2025, 2024, 2023, 2022])
})
