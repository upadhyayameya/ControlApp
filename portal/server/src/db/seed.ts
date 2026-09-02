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
import { clientFor } from '../espm/factory.js'
import { pullProperty } from '../espm/sync.js'
import { toConnection, type ConnectionRow } from './rows.js'
import { createUser } from '../services/auth.js'
import { createThread, postMessage } from '../services/messaging.js'
import { runMonitor } from '../services/alerts.js'

const DEMO_PASSWORD = 'PortalDemo123!'

interface SeedOrg {
  id: string
  name: string
  tier: 'benchmarking' | 'compliance' | 'managed'
  billingEmail: string
  /** ESPM property ids from the fixtures that belong to this organization. */
  espmPropertyIds: number[]
  users: Array<{ email: string; fullName: string; role: 'customer_admin' | 'customer_viewer' }>
}

const ORGS: SeedOrg[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Meridian Property Group',
    tier: 'compliance',
    billingEmail: 'accounts@meridian.example',
    espmPropertyIds: [1810001, 1810002, 1810005],
    users: [
      { email: 'dana@meridian.example', fullName: 'Dana Whitfield', role: 'customer_admin' },
      { email: 'chris@meridian.example', fullName: 'Chris Okonkwo', role: 'customer_viewer' },
    ],
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Cedarline Holdings',
    tier: 'benchmarking',
    billingEmail: 'ops@cedarline.example',
    espmPropertyIds: [1810003, 1810004],
    users: [{ email: 'sam@cedarline.example', fullName: 'Sam Ferreira', role: 'customer_admin' }],
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

  const client = clientFor(connection)

  for (const org of ORGS) {
    db.prepare(
      `INSERT INTO organizations (id, name, billing_email, tier, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, tier = excluded.tier`,
    ).run(org.id, org.name, org.billingEmail, org.tier, now)

    for (const user of org.users) {
      await ensureUser(db, { organizationId: org.id, ...user })
    }

    // Pull each property through the same code path production uses, so the
    // demo data is shaped exactly like real synced data — including sync
    // states, meter links and metric history.
    for (const espmPropertyId of org.espmPropertyIds) {
      const buildingId = await pullProperty(db, client, espmPropertyId, org.id)
      console.log(`  pulled ${espmPropertyId} → ${buildingId}`)
    }
  }

  seedConversations(db)
  seedPendingEntry(db)

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
