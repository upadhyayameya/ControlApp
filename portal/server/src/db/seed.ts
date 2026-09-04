// ---------------------------------------------------------------------------
// Demo seed.
//
// Populates a working portal from the ESPM fixtures: two customer
// organizations, five buildings pulled through the *real* sync path, and
// enough conversation and alert history for every screen to have something on
// it. Running it twice is safe — the sync upserts and the demo rows are keyed.
//
//   npm run seed --workspace=server
//
// Demo passwords are printed at the end. They are obviously not secrets; this
// script refuses to run against a production database for exactly that reason.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { getDb, type Db } from './index.js'
import { slugify } from './migrations.js'
import { clientFor } from '../espm/factory.js'
import { pullProperty } from '../espm/sync.js'
import { toConnection, type ConnectionRow } from './rows.js'
import { createUser } from '../services/auth.js'
import { encryptSecret } from '../services/secrets.js'
import { createThread, postMessage } from '../services/messaging.js'
import { runMonitor } from '../services/alerts.js'

const DEMO_PASSWORD = 'PortalDemo123!'

/** One node of the portfolio tree, with the ESPM properties filed under it. */
interface SeedGroup {
  key: string
  name: string
  /** Key of the parent node, or null for a portfolio. */
  parent: string | null
  espmPropertyIds?: number[]
}

interface SeedOrg {
  id: string
  name: string
  tier: 'benchmarking' | 'compliance' | 'managed'
  billingEmail: string
  /** ESPM property ids from the fixtures that belong to this organization. */
  espmPropertyIds: number[]
  users: Array<{ email: string; fullName: string; role: 'customer_admin' | 'customer_viewer' }>
  accentColor: string
  logoMark: string
  /**
   * The portfolio → phase → building structure. Buildings not named by any
   * node stay unfiled, which is a state the portfolio view has to handle.
   */
  groups: SeedGroup[]
}

const ORGS: SeedOrg[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Meridian Property Group',
    tier: 'compliance',
    billingEmail: 'accounts@meridian.example',
    accentColor: '#0B5D66',
    logoMark: 'MP',
    espmPropertyIds: [1810001, 1810002, 1810005],
    users: [
      { email: 'dana@meridian.example', fullName: 'Dana Whitfield', role: 'customer_admin' },
      { email: 'chris@meridian.example', fullName: 'Chris Okonkwo', role: 'customer_viewer' },
    ],
    groups: [
      { key: 'core', name: 'Meridian core portfolio', parent: null },
      { key: 'core-office', name: 'Office', parent: 'core', espmPropertyIds: [1810001] },
      { key: 'core-resi', name: 'Residential', parent: 'core', espmPropertyIds: [1810002] },
      { key: 'hosp', name: 'Hospitality portfolio', parent: null, espmPropertyIds: [1810005] },
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Cedarline Holdings',
    tier: 'benchmarking',
    billingEmail: 'ops@cedarline.example',
    accentColor: '#7A4A17',
    logoMark: 'CH',
    espmPropertyIds: [1810003, 1810004],
    users: [{ email: 'sam@cedarline.example', fullName: 'Sam Ferreira', role: 'customer_admin' }],
    groups: [
      { key: 'cl', name: 'Cedarline portfolio', parent: null },
      { key: 'cl-md', name: 'Maryland', parent: 'cl', espmPropertyIds: [1810003] },
      // 1810004 is left unfiled on purpose, so the demo shows what an unfiled
      // building looks like rather than pretending everything is always tidy.
    ],
  },
  {
    // The structure from the brief: a portfolio, phases inside it, buildings
    // inside those.
    id: '33333333-3333-4333-8333-333333333333',
    name: 'SJP Development',
    tier: 'managed',
    billingEmail: 'accounts@sjp.example',
    accentColor: '#1F4E79',
    logoMark: 'SJP',
    espmPropertyIds: [1810006, 1810007, 1810008],
    users: [
      { email: 'jordan@sjp.example', fullName: 'Jordan Reyes', role: 'customer_admin' },
      { email: 'priya@sjp.example', fullName: 'Priya Raman', role: 'customer_viewer' },
    ],
    groups: [
      { key: 'sjp', name: 'SJP portfolio', parent: null },
      { key: 'sjp-p1', name: 'Phase 1', parent: 'sjp', espmPropertyIds: [1810006] },
      { key: 'sjp-p2', name: 'Phase 2', parent: 'sjp', espmPropertyIds: [1810007] },
      { key: 'sjp-mc', name: 'Montgomery County', parent: null, espmPropertyIds: [1810008] },
    ],
  },
]

async function seed(): Promise<void> {
  if (config.isProduction) {
    throw new Error('Refusing to seed demo accounts into a production database.')
  }

  const db = getDb()
  const now = new Date().toISOString()

  // --- The shared HBS connection ---
  const connectionId = '00000000-0000-4000-8000-000000000001'
  db.prepare(
    `INSERT INTO espm_connections (id, label, organization_id, espm_account_id, username, environment, active, created_at)
     VALUES (?, 'HBS service-provider account', NULL, ?, ?, ?, 1, ?)
     ON CONFLICT (id) DO UPDATE SET username = excluded.username, environment = excluded.environment`,
  ).run(
    connectionId,
    config.espm.accountId ?? 555001,
    config.espm.username,
    config.espm.environment,
    now,
  )
  const connection = toConnection(
    db.prepare<[string], ConnectionRow>('SELECT * FROM espm_connections WHERE id = ?').get(connectionId)!,
  )

  // --- Staff ---
  await ensureUser(db, {
    organizationId: null,
    email: 'staff@hbssolutions.example',
    fullName: 'Alex Rivera (HBS)',
    role: 'hbs_staff',
  })

  const client = clientFor(db, connection)

  for (const org of ORGS) {
    db.prepare(
      `INSERT INTO organizations
         (id, name, billing_email, tier, created_at, slug, accent_color, logo_mark,
          plan_status, trial_ends_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, tier = excluded.tier,
         accent_color = excluded.accent_color, logo_mark = excluded.logo_mark,
         plan_status = excluded.plan_status`,
    ).run(
      org.id,
      org.name,
      org.billingEmail,
      org.tier,
      now,
      slugify(org.name),
      org.accentColor,
      org.logoMark,
    )

    for (const user of org.users) {
      await ensureUser(db, { organizationId: org.id, ...user })
    }

    // Pull each property through the same code path production uses, so the
    // demo data is shaped exactly like real synced data — including sync
    // states, meter links and metric history.
    const buildingIdByEspmId = new Map<number, string>()
    for (const espmPropertyId of org.espmPropertyIds) {
      const buildingId = await pullProperty(db, client, espmPropertyId, org.id)
      buildingIdByEspmId.set(espmPropertyId, buildingId)
      console.log(`  pulled ${espmPropertyId} → ${buildingId}`)
    }

    seedGroups(db, org, buildingIdByEspmId)
  }

  seedConversations(db)
  seedPendingEntry(db)
  seedTenantConnections(db)

  const monitor = runMonitor(db)
  console.log(`\nMonitor: ${monitor.created} alert(s) created, ${monitor.updated} updated.`)

  console.log('\nDemo accounts (password for all: %s)', DEMO_PASSWORD)
  console.log('  staff@hbssolutions.example  — HBS staff, sees every organization')
  for (const org of ORGS) {
    for (const user of org.users) {
      console.log(`  ${user.email.padEnd(27)} — ${org.name} (${user.role.replace('customer_', '')})`)
    }
  }
}

async function ensureUser(
  db: Db,
  input: {
    organizationId: string | null
    email: string
    fullName: string
    role: 'hbs_staff' | 'customer_admin' | 'customer_viewer'
  },
): Promise<void> {
  const existing = db
    .prepare<[string], { id: string }>('SELECT id FROM users WHERE email = ? COLLATE NOCASE')
    .get(input.email)
  if (existing) return
  await createUser(db, { ...input, password: DEMO_PASSWORD })
}

/** A conversation on each organization, including one with an email CC. */
/**
 * Build the organization's portfolio tree and file its buildings into it.
 * Idempotent by name, so re-running the seed does not stack duplicate phases.
 */
function seedGroups(db: Db, org: SeedOrg, buildingIdByEspmId: Map<number, string>): void {
  const idByKey = new Map<string, string>()
  const now = new Date().toISOString()

  org.groups.forEach((node, index) => {
    const parentId = node.parent === null ? null : (idByKey.get(node.parent) ?? null)

    const existing = db
      .prepare<[string, string], { id: string }>(
        'SELECT id FROM building_groups WHERE organization_id = ? AND name = ?',
      )
      .get(org.id, node.name)

    const id = existing?.id ?? randomUUID()
    if (!existing) {
      db.prepare(
        `INSERT INTO building_groups (id, organization_id, parent_id, name, kind, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, org.id, parentId, node.name, parentId === null ? 'portfolio' : 'phase', index, now)
    }
    idByKey.set(node.key, id)

    for (const espmPropertyId of node.espmPropertyIds ?? []) {
      const buildingId = buildingIdByEspmId.get(espmPropertyId)
      if (buildingId) {
        db.prepare('UPDATE buildings SET group_id = ? WHERE id = ?').run(id, buildingId)
      }
    }
  })
}

function seedConversations(db: Db): void {
  const already = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM message_threads').get()
  if ((already?.n ?? 0) > 0) return

  const staff = db
    .prepare<[], { id: string; full_name: string }>(
      "SELECT id, full_name FROM users WHERE role = 'hbs_staff' LIMIT 1",
    )
    .get()
  if (!staff) return

  for (const org of ORGS) {
    const building = db
      .prepare<[string], { id: string; name: string }>(
        'SELECT id, name FROM buildings WHERE organization_id = ? ORDER BY name LIMIT 1',
      )
      .get(org.id)
    if (!building) continue

    const thread = createThread(db, {
      organizationId: org.id,
      buildingId: building.id,
      subject: `${building.name} — 2024 benchmarking review`,
      body:
        `We have finished loading ${building.name}'s 2024 data into Portfolio Manager and reviewed it ` +
        `against the BEPS standard. The summary is on the building's page in the portal. ` +
        `Happy to walk through the numbers whenever suits.`,
      emailCcAddresses: [org.billingEmail],
      author: { id: staff.id, name: staff.full_name },
    })

    const customer = db
      .prepare<[string], { id: string; full_name: string }>(
        'SELECT id, full_name FROM users WHERE organization_id = ? ORDER BY role LIMIT 1',
      )
      .get(org.id)
    if (customer) {
      postMessage(
        db,
        thread.id,
        'Thanks — the gap on the older building is bigger than we expected. What would closing it involve?',
        { id: customer.id, name: customer.full_name },
      )
    }
  }
}

/**
 * Give one organization its own connected ENERGY STAR account, so the demo
 * shows both arrangements the platform supports: Meridian on their own
 * account, Cedarline sharing properties into the HBS account.
 */
function seedTenantConnections(db: Db): void {
  const meridian = ORGS[0]!
  const already = db
    .prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM espm_connections WHERE organization_id = ?',
    )
    .get(meridian.id)
  if ((already?.n ?? 0) > 0) return

  const sealed = encryptSecret('demo-portfolio-manager-password')
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO espm_connections
       (id, label, organization_id, espm_account_id, username, environment, active, created_at,
        status, verified_at, secret_ciphertext, secret_iv, secret_tag)
     VALUES (?, ?, ?, 555001, ?, ?, 1, ?, 'connected', ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    `${meridian.name} — Portfolio Manager`,
    meridian.id,
    'meridian_esp',
    config.espm.environment,
    now,
    now,
    sealed.ciphertext,
    sealed.iv,
    sealed.tag,
  )
}

/**
 * One entry sitting in the local queue, so the two-way sync UI has something
 * to show without the demo user having to type a reading first.
 */
function seedPendingEntry(db: Db): void {
  const already = db
    .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM consumption_entries WHERE sync_state = 'local'")
    .get()
  if ((already?.n ?? 0) > 0) return

  const meter = db
    .prepare<[], { id: string; building_id: string; unit: string }>(
      "SELECT id, building_id, unit FROM meters WHERE type = 'Electric - Grid' ORDER BY name LIMIT 1",
    )
    .get()
  if (!meter) return

  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO consumption_entries
       (id, meter_id, building_id, start_date, end_date, quantity, unit, cost, estimated,
        sync_state, created_at, updated_at)
     VALUES (?, ?, ?, '2025-01-01', '2025-01-31', 438000, ?, 52560, 0, 'local', ?, ?)
     ON CONFLICT (meter_id, start_date, end_date) DO NOTHING`,
  ).run(randomUUID(), meter.id, meter.building_id, meter.unit, now, now)
}

seed()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
