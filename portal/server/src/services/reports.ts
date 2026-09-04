// ---------------------------------------------------------------------------
// Report generation — the deliverables.
//
// Reports are produced as structured data first and rendered second. That
// split matters: the same `buildComplianceReport` output feeds the HTML a
// customer downloads today and whatever formal template replaces it later,
// without the numbers being recomputed by a second code path that could
// disagree with the portal.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  metricLabel,
  metricUnit,
  type Building,
  type ComplianceAssessment,
  type MetricYear,
  type Organization,
  type ReportRecord,
} from '@hbs/shared'
import type { Db } from '../db/index.js'
import { toReport, type ReportRow } from '../db/rows.js'
import { assessmentsFor, listBuildings, metricsFor } from './portfolio.js'
import { organizationById } from './organizations.js'

export interface ComplianceReport {
  organizationName: string
  generatedAt: string
  periodLabel: string
  buildings: Array<{
    building: Building
    metrics: MetricYear[]
    assessment: ComplianceAssessment | null
  }>
  totals: {
    buildings: number
    totalSqFt: number
    nonCompliant: number
    estimatedExposure: number
    exposureVerified: boolean
  }
}

export function buildComplianceReport(
  db: Db,
  organizationId: string,
  buildingId?: string,
): ComplianceReport {
  const org = organizationById(db, organizationId)
  const all = listBuildings(db, organizationId)
  const buildings = buildingId ? all.filter((b) => b.id === buildingId) : all

  const rows = buildings.map((building) => {
    const metrics = metricsFor(db, building.id)
    return { building, metrics, assessment: assessmentsFor(building, metrics).current }
  })

  let exposure = 0
  let exposureVerified = true
  let nonCompliant = 0
  for (const { assessment } of rows) {
    if (assessment?.status === 'non-compliant') nonCompliant++
    if (assessment?.estimatedPenalty) {
      exposure += assessment.estimatedPenalty.amount
      if (!assessment.estimatedPenalty.verified) exposureVerified = false
    }
  }

  return {
    organizationName: org?.name ?? 'Unknown organization',
    generatedAt: new Date().toISOString(),
    periodLabel: String(new Date().getUTCFullYear() - 1),
    buildings: rows,
    totals: {
      buildings: rows.length,
      totalSqFt: rows.reduce((sum, r) => sum + r.building.grossFloorAreaSqFt, 0),
      nonCompliant,
      estimatedExposure: exposure,
      exposureVerified,
    },
  }
}

/**
 * Render a report to a self-contained HTML file on disk and record it.
 *
 * HTML rather than PDF on purpose: it prints to PDF from any browser, needs no
 * headless-Chrome dependency in the deployment, and stays editable when
 * somebody wants to add a cover note before sending it to a client.
 */
export function generateReport(
  db: Db,
  input: {
    organizationId: string
    buildingId?: string | null
    kind: ReportRecord['kind']
    outputDir: string
  },
): ReportRecord {
  const id = randomUUID()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO reports (id, organization_id, building_id, kind, period_label, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
  ).run(id, input.organizationId, input.buildingId ?? null, input.kind, String(new Date().getUTCFullYear() - 1), now)

  try {
    const report = buildComplianceReport(db, input.organizationId, input.buildingId ?? undefined)
    fs.mkdirSync(input.outputDir, { recursive: true })
    const filePath = path.join(input.outputDir, `${input.kind}-${id}.html`)
    fs.writeFileSync(filePath, renderHtml(report), 'utf8')

    db.prepare("UPDATE reports SET status = 'ready', file_path = ?, generated_at = ? WHERE id = ?").run(
      filePath,
      new Date().toISOString(),
      id,
    )
  } catch (err) {
    db.prepare("UPDATE reports SET status = 'failed' WHERE id = ?").run(id)
    throw err
  }

  const row = db.prepare<[string], ReportRow>('SELECT * FROM reports WHERE id = ?').get(id)!
  return toReport(row)
}

export function listReports(db: Db, organizationId: string | null): ReportRecord[] {
  const rows = organizationId
    ? db
        .prepare<[string], ReportRow>(
          'SELECT * FROM reports WHERE organization_id = ? ORDER BY created_at DESC',
        )
        .all(organizationId)
    : db.prepare<[], ReportRow>('SELECT * FROM reports ORDER BY created_at DESC').all()
  return rows.map(toReport)
}

export function renderHtml(report: ComplianceReport): string {
  const rows = report.buildings
    .map(({ building, assessment }) => {
      const a = assessment
      const status = a?.status ?? 'insufficient-data'
      return `<tr class="${status}">
      <td>${escapeHtml(building.name)}</td>
      <td>${escapeHtml(building.propertyType)}</td>
      <td class="num">${building.grossFloorAreaSqFt.toLocaleString('en-US')}</td>
      <td>${escapeHtml(a?.cycleLabel ?? '—')}</td>
      <td>${a ? escapeHtml(metricLabel(a.metric)) : '—'}</td>
      <td class="num">${fmt(a?.currentValue ?? null)}</td>
      <td class="num">${fmt(a?.targetValue ?? null)}</td>
      <td><span class="badge ${status}">${statusLabel(status)}</span></td>
      <td class="num">${a?.estimatedPenalty ? usd(a.estimatedPenalty.amount) : '—'}</td>
    </tr>`
    })
    .join('\n')

  const caveat = report.totals.exposureVerified
    ? ''
    : `<p class="caveat"><strong>Provisional figures.</strong> Penalty rates and one or more
       performance standards in this report are placeholders pending verification against the
       published rule. Treat the exposure column as an order of magnitude, not a quotation.</p>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>BEPS Compliance Report — ${escapeHtml(report.organizationName)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; color:#14301c; margin:2rem auto; max-width:60rem; padding:0 1rem; }
  h1 { font-size:1.5rem; margin-bottom:0.25rem; }
  .meta { color:#5b6b60; font-size:0.875rem; margin-bottom:1.5rem; }
  table { border-collapse:collapse; width:100%; font-size:0.875rem; }
  th, td { border-bottom:1px solid #e0dcd0; padding:0.5rem 0.6rem; text-align:left; }
  th { background:#f4eede; font-weight:600; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .badge { padding:0.15rem 0.5rem; border-radius:999px; font-size:0.75rem; font-weight:600; }
  .badge.compliant { background:#dcefe2; color:#1c4227; }
  .badge.at-risk { background:#fbeccd; color:#7a5410; }
  .badge.non-compliant { background:#f8d9d3; color:#8f2e1c; }
  .badge.exempt, .badge.insufficient-data { background:#e8e6e1; color:#54514a; }
  .totals { margin-top:1.5rem; padding:1rem; background:#f4eede; border-radius:0.5rem; }
  .caveat { margin-top:1.5rem; padding:0.9rem; border-left:4px solid #c97f4a; background:#fdf4ea; font-size:0.875rem; }
  footer { margin-top:2rem; color:#5b6b60; font-size:0.75rem; }
</style></head><body>
<h1>BEPS Compliance Report</h1>
<p class="meta">${escapeHtml(report.organizationName)} · performance year ${escapeHtml(
    report.periodLabel,
  )} · generated ${escapeHtml(report.generatedAt.slice(0, 10))}</p>
<table>
  <thead><tr>
    <th>Building</th><th>Type</th><th class="num">ft²</th><th>Cycle</th><th>Metric</th>
    <th class="num">Current</th><th class="num">Target</th><th>Status</th><th class="num">Est. exposure</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="totals">
  <strong>${report.totals.buildings}</strong> buildings ·
  <strong>${report.totals.totalSqFt.toLocaleString('en-US')}</strong> ft² ·
  <strong>${report.totals.nonCompliant}</strong> below standard ·
  estimated exposure <strong>${usd(report.totals.estimatedExposure)}</strong>
</div>
${caveat}
<footer>Prepared by HBS Solutions from ENERGY STAR Portfolio Manager data.</footer>
</body></html>`
}

function statusLabel(status: string): string {
  return status.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function fmt(value: number | null): string {
  return value === null ? '—' : String(Math.round(value * 10) / 10)
}

function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

export { metricUnit }
