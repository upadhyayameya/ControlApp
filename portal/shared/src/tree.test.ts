// Tests for the portfolio tree.
//
// Weighted towards the ways a tree goes wrong silently: a roll-up that stops
// at one level, a cycle that hangs the render, and a building that disappears
// because the row referencing its group was inconsistent. Losing a customer's
// building is far worse than showing it in the wrong place, so the assembly is
// deliberately forgiving and these tests pin that behaviour down.
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { PortfolioEntry } from './api.js'
import type { Building, ComplianceAssessment } from './types.js'
import { buildTree, flattenNodes, kindLabel, pathTo, type BuildingGroup } from './tree.js'

function group(id: string, name: string, parentId: string | null = null, sortOrder = 0): BuildingGroup {
  return {
    id,
    organizationId: 'org1',
    parentId,
    name,
    kind: parentId === null ? 'portfolio' : 'phase',
    sortOrder,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

function entry(
  id: string,
  groupId: string | null,
  opts: { sqft?: number; penalty?: number; verified?: boolean; status?: ComplianceAssessment['status'] } = {},
): PortfolioEntry {
  const building: Building = {
    id,
    organizationId: 'org1',
    espmPropertyId: null,
    name: id,
    addressLine1: null,
    city: null,
    state: null,
    postalCode: null,
    propertyType: 'Office',
    grossFloorAreaSqFt: opts.sqft ?? 100_000,
    yearBuilt: null,
    jurisdiction: 'dc',
    groupId,
    complianceExempt: false,
    exemptionNote: null,
    lastSyncedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  }
  const status = opts.status ?? (opts.penalty ? 'non-compliant' : 'compliant')
  const assessment: ComplianceAssessment = {
    buildingId: id,
    jurisdiction: 'dc',
    cycleId: 'dc-cycle-1',
    cycleLabel: 'DC BEPS Cycle 1',
    complianceDate: '2026-12-31',
    status,
    metric: 'energy-star-score',
    targetValue: 71,
    currentValue: status === 'compliant' ? 80 : 60,
    gap: status === 'compliant' ? -9 : 11,
    percentOfTarget: 100,
    estimatedPenalty: opts.penalty
      ? {
          amount: opts.penalty,
          low: opts.penalty * 0.6,
          high: opts.penalty * 1.4,
          basis: 'test',
          verified: opts.verified ?? true,
          citationUrl: null,
        }
      : null,
    notes: [],
  }
  return { building, latestMetric: null, assessment, openAlerts: 0 }
}

test('a portfolio rolls up its phases, not just its own buildings', () => {
  // SJP portfolio → Phase 1 → Maple Lawn, exactly the shape from the brief.
  const groups = [group('sjp', 'SJP portfolio'), group('p1', 'Phase 1', 'sjp')]
  const tree = buildTree(groups, [entry('Maple Lawn', 'p1', { sqft: 250_000, penalty: 400_000 })])

  const sjp = tree.roots[0]!
  assert.equal(sjp.group.name, 'SJP portfolio')
  assert.equal(sjp.buildings.length, 0, 'nothing is filed at the portfolio itself')
  assert.equal(sjp.children[0]?.group.name, 'Phase 1')
  assert.equal(sjp.children[0]?.buildings[0]?.building.name, 'Maple Lawn')

  // The roll-up is the point: the portfolio knows what its phases carry.
  assert.equal(sjp.buildingCount, 1)
  assert.equal(sjp.rollup.totalSqFt, 250_000)
  assert.equal(sjp.rollup.estimatedPenaltyExposure, 400_000)
  assert.equal(sjp.rollup.nonCompliant, 1)
})

test('roll-ups accumulate through several levels and siblings', () => {
  const groups = [
    group('sjp', 'SJP portfolio'),
    group('p1', 'Phase 1', 'sjp'),
    group('p2', 'Phase 2', 'sjp', 1),
    group('p1a', 'Phase 1A', 'p1'),
  ]
  const tree = buildTree(groups, [
    entry('a', 'p1a', { sqft: 100_000, penalty: 100_000 }),
    entry('b', 'p1', { sqft: 50_000 }),
    entry('c', 'p2', { sqft: 25_000, penalty: 50_000 }),
    entry('d', null, { sqft: 10_000 }),
  ])

  const sjp = tree.roots[0]!
  assert.equal(sjp.buildingCount, 3, 'the unfiled building is not under the portfolio')
  assert.equal(sjp.rollup.totalSqFt, 175_000)
  assert.equal(sjp.rollup.estimatedPenaltyExposure, 150_000)

  const phase1 = sjp.children.find((c) => c.group.id === 'p1')!
  assert.equal(phase1.buildingCount, 2)
  assert.equal(phase1.rollup.totalSqFt, 150_000)

  // Portfolio totals count everything, filed or not.
  assert.equal(tree.totals.buildings, 4)
  assert.equal(tree.totals.totalSqFt, 185_000)
  assert.equal(tree.ungrouped.length, 1)
})

test('one unverified penalty makes the whole roll-up unverified', () => {
  // A phase total must never look firmer than the numbers underneath it.
  const groups = [group('sjp', 'SJP portfolio'), group('p1', 'Phase 1', 'sjp')]
  const tree = buildTree(groups, [
    entry('a', 'p1', { penalty: 10_000, verified: true }),
    entry('b', 'p1', { penalty: 10_000, verified: false }),
  ])
  assert.equal(tree.roots[0]!.rollup.exposureVerified, false)
  assert.equal(tree.totals.exposureVerified, false)
})

test('a building whose group does not exist is listed, never dropped', () => {
  const tree = buildTree([group('sjp', 'SJP portfolio')], [entry('orphan', 'deleted-group')])
  assert.equal(tree.ungrouped.length, 1)
  assert.equal(tree.ungrouped[0]?.building.name, 'orphan')
  assert.equal(tree.totals.buildings, 1)
})

test('a cycle is treated as roots rather than hanging the render', () => {
  const a = group('a', 'A', 'b')
  const b = group('b', 'B', 'a')
  const tree = buildTree([a, b], [entry('x', 'a')])
  // Neither can reach a root, so both surface at the top level and the
  // building stays visible.
  assert.equal(tree.roots.length, 2)
  assert.equal(tree.totals.buildings, 1)
})

test('a group whose parent is missing becomes a root', () => {
  const tree = buildTree([group('p1', 'Phase 1', 'gone')], [entry('x', 'p1')])
  assert.equal(tree.roots.length, 1)
  assert.equal(tree.roots[0]?.group.name, 'Phase 1')
  assert.equal(tree.roots[0]?.buildingCount, 1)
})

test('siblings order by sortOrder, then name', () => {
  const groups = [
    group('sjp', 'SJP portfolio'),
    group('z', 'Zulu', 'sjp', 0),
    group('a', 'Alpha', 'sjp', 0),
    group('m', 'Mike', 'sjp', -1),
  ]
  const names = buildTree(groups, []).roots[0]!.children.map((c) => c.group.name)
  assert.deepEqual(names, ['Mike', 'Alpha', 'Zulu'])
})

test('buildings within a node lead with the largest exposure', () => {
  const groups = [group('p1', 'Phase 1')]
  const tree = buildTree(groups, [
    entry('small', 'p1', { penalty: 1_000 }),
    entry('large', 'p1', { penalty: 900_000 }),
    entry('fine', 'p1'),
  ])
  assert.deepEqual(
    tree.roots[0]!.buildings.map((e) => e.building.name),
    ['large', 'small', 'fine'],
  )
})

test('depth is assigned from the root down', () => {
  const groups = [
    group('sjp', 'SJP portfolio'),
    group('p1', 'Phase 1', 'sjp'),
    group('p1a', 'Phase 1A', 'p1'),
  ]
  const flat = flattenNodes(buildTree(groups, []).roots)
  assert.deepEqual(
    flat.map((n) => [n.group.name, n.depth]),
    [
      ['SJP portfolio', 0],
      ['Phase 1', 1],
      ['Phase 1A', 2],
    ],
  )
})

test('pathTo gives a breadcrumb from the root down', () => {
  const groups = [
    group('sjp', 'SJP portfolio'),
    group('p1', 'Phase 1', 'sjp'),
    group('p1a', 'Phase 1A', 'p1'),
  ]
  assert.deepEqual(
    pathTo(groups, 'p1a').map((g) => g.name),
    ['SJP portfolio', 'Phase 1', 'Phase 1A'],
  )
  // A broken chain returns what it can rather than throwing.
  assert.deepEqual(pathTo(groups, 'nope'), [])
})

test('the label follows position, not just the stored kind', () => {
  assert.equal(kindLabel('phase', 0), 'Portfolio')
  assert.equal(kindLabel('phase', 1), 'Phase')
  assert.equal(kindLabel('group', 2), 'Group')
})
