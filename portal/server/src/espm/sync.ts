// ---------------------------------------------------------------------------
// Two-way synchronization with Portfolio Manager.
//
// Pull is the easy direction: read ESPM, upsert locally, never destroy a local
// edit that has not been pushed yet.
//
// Push is the direction with consequences, and it obeys three rules:
//   1. Only rows the customer created here are ever sent ('local' or 'failed').
//      A row that came from ESPM is never echoed back at it.
//   2. Each row's outcome is recorded individually. A batch that half-succeeds
//      leaves the successful rows 'synced' and the rest 'failed' with the
//      reason ESPM gave, so a retry sends only what is still owed.
//   3. Nothing is deleted in ESPM. Corrections update in place; removal is a
//      deliberate act a human performs in ESPM itself.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { EspmConnection, SyncRun } from '@hbs/shared'
import type { Db } from '../db/index.js'
import {
  toBuilding,
  toConsumptionEntry,
  toSyncRun,
  type BuildingRow,
  type ConsumptionRow,
  type MeterRow,
  type SyncRunRow,
} from '../db/rows.js'
import { EspmApiError, type EspmClient } from './client.js'
import { clientFor } from './factory.js'
import { markConnectionError, markConnectionHealthy } from '../services/connections.js'
import { mapMeter, mapProperty } from './mapper.js'
import { METRIC_NAMES, type MetricKey } from './types.js'

export interface SyncResult {
  run: SyncRun
  processed: number
  failed: number
  messages: string[]
}

/** Years of metric history to pull on a full sync. */
const HISTORY_YEARS = 4

// --- Pull -----------------------------------------------------------------

/**
 * Pull everything this connection can see: properties, meters, consumption
 * history and annual metrics. Safe to re-run; it upserts.
 */
export async function pullAll(
  db: Db,
  connection: EspmConnection,
  organizationId: string,
): Promise<SyncResult> {
  const client = clientFor(db, connection)
  const runId = beginRun(db, connection.id, 'pull', 'full')
  const messages: string[] = []
  let processed = 0
  let failed = 0

  try {
    const accountId = connection.espmAccountId ?? (await client.getAccount()).id
    if (connection.espmAccountId === null) {
      db.prepare('UPDATE espm_connections SET espm_account_id = ? WHERE id = ?').run(
        accountId,
        connection.id,
      )
    }

    const links = await client.listProperties(accountId)
    for (const link of links) {
      try {
        await pullProperty(db, client, link.id, organizationId)
        processed++
      } catch (err) {
        failed++
        messages.push(`Property ${link.id}: ${describe(err)}`)
      }
    }

    db.prepare('UPDATE espm_connections SET last_pull_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      connection.id,
    )
    markConnectionHealthy(db, connection.id)

    return finishRun(db, runId, processed, failed, messages)
  } catch (err) {
    messages.push(describe(err))
    // A pull that failed outright is a connection problem, not a data problem;
    // recording it here is what lets the settings page say why.
    markConnectionError(db, connection.id, describe(err))
    return finishRun(db, runId, processed, failed + 1, messages, 'failed')
  }
}

/** Pull one property and everything hanging off it. */
export async function pullProperty(
  db: Db,
  client: EspmClient,
  espmPropertyId: number,
  organizationId: string,
): Promise<string> {
  const property = mapProperty(await client.getProperty(espmPropertyId))
  const now = new Date().toISOString()

  const existing = db
    .prepare<[number], BuildingRow>('SELECT * FROM buildings WHERE espm_property_id = ?')
    .get(espmPropertyId)

  const buildingId = existing?.id ?? randomUUID()

  if (existing) {
    // Preserve the fields a human set here: jurisdiction overrides and
    // exemptions are portal decisions ESPM knows nothing about.
    db.prepare(
      `UPDATE buildings SET name = ?, address_line1 = ?, city = ?, state = ?, postal_code = ?,
              property_type = ?, gross_floor_area_sqft = ?, year_built = ?, last_synced_at = ?
       WHERE id = ?`,
    ).run(
      property.name,
      property.addressLine1,
      property.city,
      property.state,
      property.postalCode,
      property.propertyType,
      property.grossFloorAreaSqFt,
      property.yearBuilt,
      now,
      buildingId,
    )
  } else {
    db.prepare(
      `INSERT INTO buildings (id, organization_id, espm_property_id, name, address_line1, city,
                              state, postal_code, property_type, gross_floor_area_sqft, year_built,
                              jurisdiction, last_synced_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      buildingId,
      organizationId,
      espmPropertyId,
      property.name,
      property.addressLine1,
      property.city,
      property.state,
      property.postalCode,
      property.propertyType,
      property.grossFloorAreaSqFt,
      property.yearBuilt,
      property.jurisdiction,
      now,
      now,
    )
  }

  await pullMeters(db, client, espmPropertyId, buildingId)
  await pullMetrics(db, client, espmPropertyId, buildingId)
  return buildingId
}

async function pullMeters(
  db: Db,
  client: EspmClient,
  espmPropertyId: number,
  buildingId: string,
): Promise<void> {
  const links = await client.listMeters(espmPropertyId)

  for (const link of links) {
    const mapped = mapMeter(await client.getMeter(link.id))
    const existing = db
      .prepare<[number], MeterRow>('SELECT * FROM meters WHERE espm_meter_id = ?')
      .get(link.id)
    const meterId = existing?.id ?? randomUUID()

    if (existing) {
      db.prepare('UPDATE meters SET name = ?, type = ?, unit = ?, active = ? WHERE id = ?').run(
        mapped.name,
        mapped.type,
        mapped.unit,
        mapped.active ? 1 : 0,
        meterId,
      )
    } else {
      db.prepare(
        `INSERT INTO meters (id, building_id, espm_meter_id, name, type, unit, active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(meterId, buildingId, link.id, mapped.name, mapped.type, mapped.unit, mapped.active ? 1 : 0)
    }

    await pullConsumption(db, client, link.id, meterId, buildingId, mapped.unit)
  }
}

async function pullConsumption(
  db: Db,
  client: EspmClient,
  espmMeterId: number,
  meterId: string,
  buildingId: string,
  unit: string,
): Promise<void> {
  const entries = await client.getConsumption(espmMeterId)
  const now = new Date().toISOString()

  const upsert = db.prepare(
    `INSERT INTO consumption_entries
       (id, meter_id, building_id, start_date, end_date, quantity, unit, cost, estimated,
        espm_consumption_id, sync_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remote', ?, ?)
     ON CONFLICT (meter_id, start_date, end_date) DO UPDATE SET
       quantity = excluded.quantity,
       cost = excluded.cost,
       estimated = excluded.estimated,
       espm_consumption_id = excluded.espm_consumption_id,
       updated_at = excluded.updated_at
     -- Never overwrite a local edit that has not reached ESPM yet: the
     -- customer's unsent correction outranks the stale value ESPM still holds.
     WHERE consumption_entries.sync_state IN ('remote', 'synced')`,
  )

  const run = db.transaction(() => {
    for (const entry of entries) {
      upsert.run(
        randomUUID(),
        meterId,
        buildingId,
        entry.startDate,
        entry.endDate,
        entry.usage,
        unit,
        entry.cost ?? null,
        entry.estimatedValue ? 1 : 0,
        entry.id,
        now,
        now,
      )
    }
  })
  run()
}

async function pullMetrics(
  db: Db,
  client: EspmClient,
  espmPropertyId: number,
  buildingId: string,
): Promise<void> {
  const thisYear = new Date().getUTCFullYear()
  const keys = Object.keys(METRIC_NAMES) as MetricKey[]

  for (let i = 0; i < HISTORY_YEARS; i++) {
    // ESPM's metrics for the current year are incomplete until the year ends,
    // so start from last year and walk back.
    const year = thisYear - 1 - i
    let metrics: Partial<Record<MetricKey, number | null>>
    try {
      metrics = await client.getPropertyMetrics(espmPropertyId, { year, keys })
    } catch (err) {
      // A year with no data is normal for a recently-benchmarked building;
      // it must not abort the years that do have data.
      if (err instanceof EspmApiError && err.status === 404) continue
      throw err
    }

    if (Object.values(metrics).every((v) => v === null || v === undefined)) continue

    db.prepare(
      `INSERT INTO metric_years
         (id, building_id, year, energy_star_score, site_eui, source_eui,
          weather_normalized_site_eui, total_ghg_emissions, ghg_intensity,
          water_use_intensity, total_site_energy_kbtu, source, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'espm', ?)
       ON CONFLICT (building_id, year) DO UPDATE SET
         energy_star_score = excluded.energy_star_score,
         site_eui = excluded.site_eui,
         source_eui = excluded.source_eui,
         weather_normalized_site_eui = excluded.weather_normalized_site_eui,
         total_ghg_emissions = excluded.total_ghg_emissions,
         ghg_intensity = excluded.ghg_intensity,
         water_use_intensity = excluded.water_use_intensity,
         total_site_energy_kbtu = excluded.total_site_energy_kbtu,
         source = 'espm',
         recorded_at = excluded.recorded_at`,
    ).run(
      randomUUID(),
      buildingId,
      year,
      metrics.score ?? null,
      metrics.siteEui ?? null,
      metrics.sourceEui ?? null,
      metrics.weatherNormalizedSiteEui ?? null,
      metrics.totalGhgEmissions ?? null,
      metrics.ghgIntensity ?? null,
      metrics.waterUseIntensity ?? null,
      metrics.totalSiteEnergyKbtu ?? null,
      new Date().toISOString(),
    )
  }
}

// --- Push -----------------------------------------------------------------

/**
 * Send everything the portal owes ESPM.
 *
 * Grouped per meter because ESPM's consumption endpoint is per meter, and
 * batched within a meter because one request for twelve months beats twelve.
 */
export async function pushPending(
  db: Db,
  connection: EspmConnection,
  opts: { buildingId?: string } = {},
): Promise<SyncResult> {
  const client = clientFor(db, connection)
  const runId = beginRun(db, connection.id, 'push', opts.buildingId ?? 'all')
  const messages: string[] = []
  let processed = 0
  let failed = 0

  const pending = db
    .prepare<string[], ConsumptionRow & { espm_meter_id: number | null }>(
      `SELECT c.*, m.espm_meter_id FROM consumption_entries c
       JOIN meters m ON m.id = c.meter_id
       WHERE c.sync_state IN ('local','failed')
         ${opts.buildingId ? 'AND c.building_id = ?' : ''}
       ORDER BY c.meter_id, c.start_date`,
    )
    .all(...(opts.buildingId ? [opts.buildingId] : []))

  const byMeter = new Map<string, Array<ConsumptionRow & { espm_meter_id: number | null }>>()
  for (const row of pending) {
    const list = byMeter.get(row.meter_id) ?? []
    list.push(row)
    byMeter.set(row.meter_id, list)
  }

  for (const [meterId, rows] of byMeter) {
    const espmMeterId = rows[0]?.espm_meter_id
    if (espmMeterId === null || espmMeterId === undefined) {
      failed += rows.length
      const reason = 'Meter is not linked to Portfolio Manager yet.'
      markFailed(db, rows, reason)
      messages.push(`Meter ${meterId}: ${reason}`)
      continue
    }

    markPending(db, rows)

    // Rows ESPM already knows about are corrections, and go one at a time
    // through the update endpoint; genuinely new rows go as one batch.
    const updates = rows.filter((r) => r.espm_consumption_id !== null)
    const creates = rows.filter((r) => r.espm_consumption_id === null)

    for (const row of updates) {
      try {
        await client.updateConsumption(row.espm_consumption_id!, toInput(row))
        markSynced(db, row.id, row.espm_consumption_id)
        processed++
      } catch (err) {
        failed++
        markFailed(db, [row], describe(err))
        messages.push(`Entry ${row.start_date}–${row.end_date}: ${describe(err)}`)
      }
    }

    if (creates.length > 0) {
      try {
        const created = await client.addConsumption(espmMeterId, creates.map(toInput))
        creates.forEach((row, i) => {
          markSynced(db, row.id, created[i]?.id ?? null)
        })
        processed += creates.length
      } catch (err) {
        failed += creates.length
        markFailed(db, creates, describe(err))
        messages.push(`Meter ${meterId}: ${describe(err)}`)
      }
    }
  }

  return finishRun(db, runId, processed, failed, messages)
}

function toInput(row: ConsumptionRow) {
  return {
    startDate: row.start_date,
    endDate: row.end_date,
    usage: row.quantity,
    cost: row.cost,
    estimated: row.estimated === 1,
  }
}

function markPending(db: Db, rows: Array<{ id: string }>): void {
  const stmt = db.prepare(
    "UPDATE consumption_entries SET sync_state = 'pending', sync_error = NULL, updated_at = ? WHERE id = ?",
  )
  const now = new Date().toISOString()
  db.transaction(() => rows.forEach((r) => stmt.run(now, r.id)))()
}

function markSynced(db: Db, entryId: string, espmConsumptionId: number | null): void {
  db.prepare(
    `UPDATE consumption_entries
     SET sync_state = 'synced', sync_error = NULL, espm_consumption_id = COALESCE(?, espm_consumption_id),
         updated_at = ?
     WHERE id = ?`,
  ).run(espmConsumptionId, new Date().toISOString(), entryId)
}

function markFailed(db: Db, rows: Array<{ id: string }>, reason: string): void {
  const stmt = db.prepare(
    "UPDATE consumption_entries SET sync_state = 'failed', sync_error = ?, updated_at = ? WHERE id = ?",
  )
  const now = new Date().toISOString()
  db.transaction(() => rows.forEach((r) => stmt.run(reason, now, r.id)))()
}

// --- Run bookkeeping ------------------------------------------------------

function beginRun(db: Db, connectionId: string, direction: 'pull' | 'push', scope: string): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO sync_runs (id, connection_id, direction, scope, status, started_at)
     VALUES (?, ?, ?, ?, 'running', ?)`,
  ).run(id, connectionId, direction, scope, new Date().toISOString())
  return id
}

function finishRun(
  db: Db,
  runId: string,
  processed: number,
  failed: number,
  messages: string[],
  forced?: 'failed',
): SyncResult {
  const status = forced ?? (failed === 0 ? 'success' : processed > 0 ? 'partial' : 'failed')
  db.prepare(
    `UPDATE sync_runs SET status = ?, items_processed = ?, items_failed = ?, message = ?, finished_at = ?
     WHERE id = ?`,
  ).run(
    status,
    processed,
    failed,
    messages.length > 0 ? messages.slice(0, 20).join('\n') : null,
    new Date().toISOString(),
    runId,
  )
  const row = db.prepare<[string], SyncRunRow>('SELECT * FROM sync_runs WHERE id = ?').get(runId)!
  return { run: toSyncRun(row), processed, failed, messages }
}

function describe(err: unknown): string {
  if (err instanceof EspmApiError) return err.message
  return err instanceof Error ? err.message : String(err)
}

/** Re-read a building after a sync, for handing straight back to the caller. */
export function readBuilding(db: Db, buildingId: string) {
  const row = db.prepare<[string], BuildingRow>('SELECT * FROM buildings WHERE id = ?').get(buildingId)
  return row ? toBuilding(row) : null
}

export function readEntry(db: Db, entryId: string) {
  const row = db
    .prepare<[string], ConsumptionRow>('SELECT * FROM consumption_entries WHERE id = ?')
    .get(entryId)
  return row ? toConsumptionEntry(row) : null
}
