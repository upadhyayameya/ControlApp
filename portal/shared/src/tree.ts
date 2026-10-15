// ---------------------------------------------------------------------------
// The portfolio tree: portfolios, phases, and the buildings under them.
//
//   SJP portfolio
//     └ Phase 1
//         └ Maple Lawn
//
// A group only earns its place if it tells you something the building list
// does not, so every node carries a roll-up: the combined floor area,
// compliance counts and penalty exposure of everything beneath it, however
// deep. That is what makes "Phase 1 is carrying $2.4M of exposure" answerable
// without opening five buildings.
//
// Pure functions, no database — the same assembly runs on the server, in the
// background tools and in the browser, and all three agree.
// ---------------------------------------------------------------------------

import type { PortfolioEntry, PortfolioTotals } from './api.js'

/** Depth 0 is a portfolio; anything nested is a phase unless named otherwise. */
export type GroupKind = 'portfolio' | 'phase' | 'group'

export interface BuildingGroup {
  id: string
  organizationId: string
  parentId: string | null
  name: string
  kind: GroupKind
  sortOrder: number
  createdAt: string
}

/**
 * How deep the tree may go. Not a schema constraint — a guard against a cycle
 * or a pathological import turning a render into an infinite descent.
 */
export const MAX_GROUP_DEPTH = 6

export interface GroupNode {
  group: BuildingGroup
  /** Zero-based: a portfolio is 0, a phase directly under it is 1. */
  depth: number
  children: GroupNode[]
  /** Buildings filed directly at this node, not in one of its children. */
  buildings: PortfolioEntry[]
  /** Everything beneath this node, at any depth. */
  rollup: PortfolioTotals
  /** Count of buildings anywhere beneath, used for the collapsed summary. */
  buildingCount: number
}

export interface PortfolioTree {
  roots: GroupNode[]
  /** Buildings in no group. Listed, never hidden. */
  ungrouped: PortfolioEntry[]
  totals: PortfolioTotals
}

export function emptyTotals(): PortfolioTotals {
  return {
    buildings: 0,
    totalSqFt: 0,
    compliant: 0,
    atRisk: 0,
    nonCompliant: 0,
    insufficientData: 0,
    estimatedPenaltyExposure: 0,
    exposureVerified: true,
  }
}

/** Fold one building's standing into a running total. */
export function addToTotals(totals: PortfolioTotals, entry: PortfolioEntry): void {
  totals.buildings += 1
  totals.totalSqFt += entry.building.grossFloorAreaSqFt

  switch (entry.assessment?.status) {
    case 'compliant':
      totals.compliant += 1
      break
    case 'at-risk':
      totals.atRisk += 1
      break
    case 'non-compliant':
      totals.nonCompliant += 1
      break
    case 'insufficient-data':
      totals.insufficientData += 1
      break
    default:
      // 'exempt' and buildings under no jurisdiction belong in none of the
      // compliance buckets — they are not at risk of anything.
      break
  }

  const penalty = entry.assessment?.estimatedPenalty
  if (penalty) {
    totals.estimatedPenaltyExposure += penalty.amount
    // One unverified constant makes the whole roll-up unverified, so a phase
    // total can never look firmer than the numbers underneath it.
    if (!penalty.verified) totals.exposureVerified = false
  }
}

export function mergeTotals(into: PortfolioTotals, from: PortfolioTotals): void {
  into.buildings += from.buildings
  into.totalSqFt += from.totalSqFt
  into.compliant += from.compliant
  into.atRisk += from.atRisk
  into.nonCompliant += from.nonCompliant
  into.insufficientData += from.insufficientData
  into.estimatedPenaltyExposure += from.estimatedPenaltyExposure
  if (!from.exposureVerified) into.exposureVerified = false
}

/**
 * Assemble the tree from a flat group list and a flat building list.
 *
 * Defensive about its inputs on purpose: a group whose parent is missing, or
 * part of a cycle, is treated as a root rather than vanishing. A building
 * filed under an unknown group is listed as ungrouped. Losing a customer's
 * building because a row was inconsistent would be far worse than showing it
 * in the wrong place.
 */
export function buildTree(groups: BuildingGroup[], entries: PortfolioEntry[]): PortfolioTree {
  const byId = new Map<string, BuildingGroup>()
  for (const group of groups) byId.set(group.id, group)

  const nodes = new Map<string, GroupNode>()
  for (const group of groups) {
    nodes.set(group.id, {
      group,
      depth: 0,
      children: [],
      buildings: [],
      rollup: emptyTotals(),
      buildingCount: 0,
    })
  }

  // File buildings against their group, or into the ungrouped list.
  const ungrouped: PortfolioEntry[] = []
  for (const entry of entries) {
    const groupId = entry.building.groupId
    const node = groupId === null ? undefined : nodes.get(groupId)
    if (node) node.buildings.push(entry)
    else ungrouped.push(entry)
  }

  // Link children to parents. `reachesRoot` rejects a parent chain that is
  // broken or circular, so a bad row cannot make the tree infinite.
  const roots: GroupNode[] = []
  for (const node of nodes.values()) {
    const parentId = node.group.parentId
    const parent = parentId === null ? undefined : nodes.get(parentId)
    if (parent && reachesRoot(node.group, byId)) parent.children.push(node)
    else roots.push(node)
  }

  const totals = emptyTotals()
  for (const root of sortNodes(roots)) {
    finalize(root, 0)
    mergeTotals(totals, root.rollup)
  }
  for (const entry of ungrouped) addToTotals(totals, entry)

  return { roots: sortNodes(roots), ungrouped: sortEntries(ungrouped), totals }
}

/** Depth-first: assign depth, sort, and roll totals up from the leaves. */
function finalize(node: GroupNode, depth: number): void {
  node.depth = depth
  node.buildings = sortEntries(node.buildings)
  node.children = sortNodes(node.children)

  node.rollup = emptyTotals()
  node.buildingCount = 0

  for (const entry of node.buildings) {
    addToTotals(node.rollup, entry)
    node.buildingCount += 1
  }

  for (const child of node.children) {
    // Guard the recursion as well as the linking: belt and braces, because an
    // infinite descent here takes the whole page down.
    if (depth + 1 >= MAX_GROUP_DEPTH) {
      child.children = []
    }
    finalize(child, depth + 1)
    mergeTotals(node.rollup, child.rollup)
    node.buildingCount += child.buildingCount
  }
}

/**
 * Whether following parentId from this group terminates at a root, without
 * revisiting a group or exceeding the depth bound.
 */
function reachesRoot(group: BuildingGroup, byId: Map<string, BuildingGroup>): boolean {
  const seen = new Set<string>([group.id])
  let current = group.parentId
  for (let depth = 0; depth < MAX_GROUP_DEPTH; depth++) {
    if (current === null) return true
    if (seen.has(current)) return false // a cycle
    const parent = byId.get(current)
    if (!parent) return false // a dangling reference
    seen.add(current)
    current = parent.parentId
  }
  return false
}

function sortNodes(nodes: GroupNode[]): GroupNode[] {
  return [...nodes].sort(
    (a, b) => a.group.sortOrder - b.group.sortOrder || a.group.name.localeCompare(b.group.name),
  )
}

/** Largest exposure first, as the flat portfolio does, then by name. */
function sortEntries(entries: PortfolioEntry[]): PortfolioEntry[] {
  const weight = (e: PortfolioEntry): number => {
    const penalty = e.assessment?.estimatedPenalty?.amount ?? 0
    if (penalty > 0) return 1_000_000_000 + penalty
    if (e.assessment?.status === 'insufficient-data') return 500_000
    if (e.assessment?.status === 'at-risk') return 400_000
    return 0
  }
  return [...entries].sort(
    (a, b) => weight(b) - weight(a) || a.building.name.localeCompare(b.building.name),
  )
}

/** Every node flattened in display order, for a picker or a breadcrumb. */
export function flattenNodes(roots: GroupNode[]): GroupNode[] {
  const out: GroupNode[] = []
  const walk = (nodes: GroupNode[]): void => {
    for (const node of nodes) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(roots)
  return out
}

/** The path from the root down to this group, for a breadcrumb. */
export function pathTo(groups: BuildingGroup[], groupId: string): BuildingGroup[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const path: BuildingGroup[] = []
  const seen = new Set<string>()
  let current: string | null = groupId
  while (current !== null && !seen.has(current) && path.length < MAX_GROUP_DEPTH) {
    const group: BuildingGroup | undefined = byId.get(current)
    if (!group) break
    seen.add(current)
    path.unshift(group)
    current = group.parentId
  }
  return path
}

/** The label a node should carry given where it sits. */
export function kindLabel(kind: GroupKind, depth: number): string {
  if (kind === 'portfolio' || depth === 0) return 'Portfolio'
  return kind === 'group' ? 'Group' : 'Phase'
}
