// ---------------------------------------------------------------------------
// The portfolio tree.
//
//   SJP portfolio            $2.4M exposure · 3 buildings · 585,000 ft²
//     └ Phase 1
//         └ Maple Lawn       ▓▓▓▓▓▓▏░░  82 / 71   Meeting standard
//
// A group is only worth the indentation if it says something the building list
// does not, so every node leads with its roll-up. The distribution bar beside
// it is the threshold idiom one level up: instead of one building against its
// line, it is every building underneath, sorted by how they stand.
//
// Rendered as a grid rather than a table because the rows nest; the column
// track is shared by group rows and building rows so everything still lines up.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { GroupNode, PortfolioEntry, PortfolioTotals, PortfolioTree as Tree } from '@hbs/shared'
import { kindLabel, metricLabel } from '@hbs/shared'
import { int, num, penaltyText, usdCompact } from '../lib/format'
import { ThresholdTrack } from './Threshold'
import { StatusChip } from './primitives'

/** Shared column track: name | instrument | current | standard | status | exposure. */
const COLUMNS =
  'grid grid-cols-[minmax(0,2.2fr)_minmax(7rem,1fr)_4.5rem_4.5rem_9rem_8rem] items-center gap-3'

export function PortfolioTree({
  tree,
  manage,
  onFileBuilding,
  onAddChild,
  onRename,
  onDelete,
}: {
  tree: Tree
  /** Management controls are hidden for read-only members. */
  manage: boolean
  onFileBuilding?: (buildingId: string, groupId: string | null) => void
  onAddChild?: (parentId: string | null) => void
  onRename?: (groupId: string, name: string) => void
  onDelete?: (groupId: string) => void
}): JSX.Element {
  const groupOptions = flatOptions(tree.roots)

  return (
    <div className="panel overflow-hidden">
      <div className={`${COLUMNS} border-b border-line-strong px-3 py-2`}>
        <span className="font-mono text-micro uppercase text-ink-3">Portfolio</span>
        <span className="font-mono text-micro uppercase text-ink-3">Against standard</span>
        <span className="text-right font-mono text-micro uppercase text-ink-3">Now</span>
        <span className="text-right font-mono text-micro uppercase text-ink-3">Std</span>
        <span className="font-mono text-micro uppercase text-ink-3">Status</span>
        <span className="text-right font-mono text-micro uppercase text-ink-3">Exposure</span>
      </div>

      <div className="divide-y divide-line">
        {tree.roots.map((node) => (
          <NodeRows
            key={node.group.id}
            node={node}
            manage={manage}
            groupOptions={groupOptions}
            onFileBuilding={onFileBuilding}
            onAddChild={onAddChild}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}

        {tree.ungrouped.length > 0 && (
          <UnfiledSection
            entries={tree.ungrouped}
            manage={manage}
            groupOptions={groupOptions}
            onFileBuilding={onFileBuilding}
          />
        )}
      </div>

      {manage && onAddChild && (
        <div className="border-t border-line px-3 py-2.5">
          <button type="button" className="btn-secondary btn-sm" onClick={() => onAddChild(null)}>
            New portfolio
          </button>
        </div>
      )}
    </div>
  )
}

function NodeRows({
  node,
  manage,
  groupOptions,
  onFileBuilding,
  onAddChild,
  onRename,
  onDelete,
}: {
  node: GroupNode
  manage: boolean
  groupOptions: Array<{ id: string; label: string }>
  onFileBuilding?: (buildingId: string, groupId: string | null) => void
  onAddChild?: (parentId: string | null) => void
  onRename?: (groupId: string, name: string) => void
  onDelete?: (groupId: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(node.group.name)

  // Indent by depth, but only the name column — the numbers must stay in their
  // track or the roll-ups stop being comparable down the page.
  const indent = { paddingLeft: `${node.depth * 1.1}rem` }

  return (
    <div>
      <div className={`${COLUMNS} px-3 py-2.5 ${node.depth === 0 ? 'bg-raised/50' : ''}`}>
        <div className="flex min-w-0 items-center gap-1.5" style={indent}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex h-4 w-4 shrink-0 items-center justify-center font-mono text-micro text-ink-3 hover:text-ink"
          >
            {open ? '▾' : '▸'}
          </button>

          {renaming ? (
            <input
              autoFocus
              className="field py-1 text-base"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                setRenaming(false)
                if (draft.trim() && draft !== node.group.name) onRename?.(node.group.id, draft.trim())
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setDraft(node.group.name)
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <>
              <span
                className={`truncate ${node.depth === 0 ? 'font-display text-base font-semibold text-ink' : 'text-base text-ink'}`}
              >
                {node.group.name}
              </span>
              <span className="shrink-0 font-mono text-micro uppercase text-ink-3">
                {kindLabel(node.group.kind, node.depth)}
              </span>
            </>
          )}
        </div>

        <DistributionBar totals={node.rollup} />

        <span className="text-right font-mono text-micro text-ink-3">
          {int(node.buildingCount)}
        </span>
        <span className="text-right font-mono text-micro text-ink-3">
          {node.rollup.totalSqFt > 0 ? `${Math.round(node.rollup.totalSqFt / 1000)}k` : '—'}
        </span>
        <span className="font-mono text-micro uppercase text-ink-3">
          {summarize(node.rollup)}
        </span>
        <span className="measure text-right text-base font-medium text-bad">
          {node.rollup.estimatedPenaltyExposure > 0
            ? usdCompact(node.rollup.estimatedPenaltyExposure)
            : '—'}
        </span>
      </div>

      {manage && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2" style={{ paddingLeft: `${node.depth * 1.1 + 2.4}rem` }}>
          <button type="button" className="btn-ghost btn-sm" onClick={() => onAddChild?.(node.group.id)}>
            + phase
          </button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button type="button" className="btn-ghost btn-sm text-bad" onClick={() => onDelete?.(node.group.id)}>
            Delete
          </button>
        </div>
      )}

      {open && (
        <div>
          {node.buildings.map((entry) => (
            <BuildingRow
              key={entry.building.id}
              entry={entry}
              depth={node.depth + 1}
              manage={manage}
              groupOptions={groupOptions}
              onFileBuilding={onFileBuilding}
            />
          ))}
          {node.children.map((child) => (
            <NodeRows
              key={child.group.id}
              node={child}
              manage={manage}
              groupOptions={groupOptions}
              onFileBuilding={onFileBuilding}
              onAddChild={onAddChild}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BuildingRow({
  entry,
  depth,
  manage,
  groupOptions,
  onFileBuilding,
}: {
  entry: PortfolioEntry
  depth: number
  manage: boolean
  groupOptions: Array<{ id: string; label: string }>
  onFileBuilding?: (buildingId: string, groupId: string | null) => void
}): JSX.Element {
  const { building, assessment, openAlerts } = entry
  return (
    <div className={`${COLUMNS} border-t border-line px-3 py-2.5 transition-colors hover:bg-raised/40`}>
      <div className="min-w-0" style={{ paddingLeft: `${depth * 1.1 + 1.4}rem` }}>
        <Link
          to={`/buildings/${building.id}`}
          className="block truncate font-medium text-ink hover:underline"
        >
          {building.name}
        </Link>
        <p className="truncate text-tiny text-ink-3">
          {building.propertyType} · <span className="measure">{int(building.grossFloorAreaSqFt)}</span> ft²
          {building.city ? ` · ${building.city}, ${building.state ?? ''}` : ''}
        </p>
        {openAlerts > 0 && (
          <span className="chip-warn mt-1">
            {openAlerts} alert{openAlerts === 1 ? '' : 's'}
          </span>
        )}
        {manage && (
          <select
            className="field mt-1.5 py-1 text-tiny"
            value={building.groupId ?? ''}
            onChange={(e) => onFileBuilding?.(building.id, e.target.value || null)}
          >
            <option value="">Unfiled</option>
            {groupOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        {assessment ? (
          <>
            <ThresholdTrack assessment={assessment} />
            <p className="mt-1 truncate font-mono text-micro uppercase text-ink-3">
              {metricLabel(assessment.metric)}
            </p>
          </>
        ) : (
          <span className="text-tiny text-ink-3">—</span>
        )}
      </div>

      <span className="measure text-right text-base text-ink">
        {num(assessment?.currentValue ?? null)}
      </span>
      <span className="measure text-right text-base text-ink-3">
        {num(assessment?.targetValue ?? null)}
      </span>
      <span>
        <StatusChip status={assessment?.status} jurisdiction={building.jurisdiction} />
      </span>
      <span className="measure text-right text-base font-medium text-bad">
        {penaltyText(assessment?.estimatedPenalty)}
      </span>
    </div>
  )
}

function UnfiledSection({
  entries,
  manage,
  groupOptions,
  onFileBuilding,
}: {
  entries: PortfolioEntry[]
  manage: boolean
  groupOptions: Array<{ id: string; label: string }>
  onFileBuilding?: (buildingId: string, groupId: string | null) => void
}): JSX.Element {
  return (
    <div>
      <div className={`${COLUMNS} bg-raised/50 px-3 py-2.5`}>
        <span className="font-display text-base font-semibold text-ink-2">Not in a portfolio</span>
        <span />
        <span className="text-right font-mono text-micro text-ink-3">{int(entries.length)}</span>
        <span />
        <span className="font-mono text-micro uppercase text-ink-3">unfiled</span>
        <span />
      </div>
      {entries.map((entry) => (
        <BuildingRow
          key={entry.building.id}
          entry={entry}
          depth={0}
          manage={manage}
          groupOptions={groupOptions}
          onFileBuilding={onFileBuilding}
        />
      ))}
    </div>
  )
}

/**
 * How the buildings beneath a node stand, as one bar.
 *
 * The same reading as a single building's threshold track, one level up: the
 * proportion in good standing versus at risk versus short. A phase carrying
 * one failing building out of twelve looks different at a glance from one
 * carrying eleven.
 */
function DistributionBar({ totals }: { totals: PortfolioTotals }): JSX.Element {
  const counted = totals.compliant + totals.atRisk + totals.nonCompliant + totals.insufficientData
  if (counted === 0) return <span className="text-tiny text-ink-3">—</span>

  const segments = [
    { n: totals.compliant, className: 'bg-good', label: 'meeting standard' },
    { n: totals.atRisk, className: 'bg-warn', label: 'at risk' },
    { n: totals.nonCompliant, className: 'bg-bad', label: 'below standard' },
    { n: totals.insufficientData, className: 'bg-inert', label: 'data needed' },
  ].filter((s) => s.n > 0)

  return (
    <div
      className="track flex h-2 w-full"
      role="img"
      aria-label={segments.map((s) => `${s.n} ${s.label}`).join(', ')}
    >
      {segments.map((segment) => (
        <div
          key={segment.label}
          className={segment.className}
          style={{ width: `${(segment.n / counted) * 100}%` }}
        />
      ))}
    </div>
  )
}

function summarize(totals: PortfolioTotals): string {
  const parts: string[] = []
  if (totals.nonCompliant > 0) parts.push(`${totals.nonCompliant} short`)
  if (totals.atRisk > 0) parts.push(`${totals.atRisk} at risk`)
  if (totals.insufficientData > 0) parts.push(`${totals.insufficientData} no data`)
  if (parts.length === 0 && totals.compliant > 0) return 'all meeting'
  return parts.join(', ') || '—'
}

/** Every group as a flat, indented list for the "file this building" picker. */
function flatOptions(roots: GroupNode[]): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = []
  const walk = (nodes: GroupNode[], prefix: string): void => {
    for (const node of nodes) {
      out.push({ id: node.group.id, label: `${prefix}${node.group.name}` })
      walk(node.children, `${prefix}— `)
    }
  }
  walk(roots, '')
  return out
}
