// ---------------------------------------------------------------------------
// Row shapes and row → domain mappers.
//
// SQLite has no booleans and no arrays, so every 0/1 and every JSON blob is
// converted in exactly one place. Route handlers only ever see domain types.
// ---------------------------------------------------------------------------

import type {
  Alert,
  AlertKind,
  AlertSeverity,
  Building,
  ConsumptionEntry,
  EspmConnection,
  Jurisdiction,
  Message,
  MessageThread,
  Meter,
  MeterType,
  MetricSource,
  MetricYear,
  Organization,
  PropertyType,
  ReportRecord,
  ServiceTier,
  SyncRun,
  SyncState,
  User,
  UserRole,
} from '@hbs/shared'

export interface OrganizationRow {
  id: string
  name: string
  billing_email: string | null
  tier: string
  created_at: string
}

export interface UserRow {
  id: string
  organization_id: string | null
  email: string
  full_name: string
  role: string
  password_hash: string
  last_login_at: string | null
  created_at: string
}

export interface BuildingRow {
  id: string
  organization_id: string
  espm_property_id: number | null
  name: string
  address_line1: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  property_type: string
  gross_floor_area_sqft: number
  year_built: number | null
  jurisdiction: string
  compliance_exempt: number
  exemption_note: string | null
  last_synced_at: string | null
  created_at: string
}

export interface MetricYearRow {
  id: string
  building_id: string
  year: number
  energy_star_score: number | null
  site_eui: number | null
  source_eui: number | null
  weather_normalized_site_eui: number | null
  total_ghg_emissions: number | null
  ghg_intensity: number | null
  water_use_intensity: number | null
  total_site_energy_kbtu: number | null
  source: string
  recorded_at: string
}

export interface MeterRow {
  id: string
  building_id: string
  espm_meter_id: number | null
  name: string
  type: string
  unit: string
  active: number
}

export interface ConsumptionRow {
  id: string
  meter_id: string
  building_id: string
  start_date: string
  end_date: string
  quantity: number
  unit: string
  cost: number | null
  estimated: number
  espm_consumption_id: number | null
  sync_state: string
  sync_error: string | null
  entered_by_user_id: string | null
  created_at: string
  updated_at: string
}

export interface ThreadRow {
  id: string
  organization_id: string
  building_id: string | null
  subject: string
  status: string
  email_cc_addresses: string
  created_by_user_id: string
  last_message_at: string
  created_at: string
}

export interface MessageRow {
  id: string
  thread_id: string
  author_user_id: string | null
  author_email: string | null
  author_name: string
  body: string
  channel: string
  created_at: string
}

export interface AlertRow {
  id: string
  organization_id: string
  building_id: string | null
  kind: string
  severity: string
  title: string
  detail: string
  dedupe_key: string
  acknowledged_at: string | null
  created_at: string
}

export interface ReportRow {
  id: string
  organization_id: string
  building_id: string | null
  kind: string
  period_label: string
  status: string
  file_path: string | null
  generated_at: string | null
  created_at: string
}

export interface SyncRunRow {
  id: string
  connection_id: string
  direction: string
  scope: string
  status: string
  items_processed: number
  items_failed: number
  message: string | null
  started_at: string
  finished_at: string | null
}

export interface ConnectionRow {
  id: string
  label: string
  organization_id: string | null
  espm_account_id: number | null
  username: string
  environment: string
  active: number
  last_pull_at: string | null
  created_at: string
}

// --- Mappers --------------------------------------------------------------

export function toOrganization(r: OrganizationRow): Organization {
  return {
    id: r.id,
    name: r.name,
    billingEmail: r.billing_email,
    tier: r.tier as ServiceTier,
    createdAt: r.created_at,
  }
}

export function toUser(r: UserRow): User {
  return {
    id: r.id,
    organizationId: r.organization_id,
    email: r.email,
    fullName: r.full_name,
    role: r.role as UserRole,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  }
}

export function toBuilding(r: BuildingRow): Building {
  return {
    id: r.id,
    organizationId: r.organization_id,
    espmPropertyId: r.espm_property_id,
    name: r.name,
    addressLine1: r.address_line1,
    city: r.city,
    state: r.state,
    postalCode: r.postal_code,
    propertyType: r.property_type as PropertyType,
    grossFloorAreaSqFt: r.gross_floor_area_sqft,
    yearBuilt: r.year_built,
    jurisdiction: r.jurisdiction as Jurisdiction,
    complianceExempt: r.compliance_exempt === 1,
    exemptionNote: r.exemption_note,
    lastSyncedAt: r.last_synced_at,
    createdAt: r.created_at,
  }
}

export function toMetricYear(r: MetricYearRow): MetricYear {
  return {
    id: r.id,
    buildingId: r.building_id,
    year: r.year,
    energyStarScore: r.energy_star_score,
    siteEui: r.site_eui,
    sourceEui: r.source_eui,
    weatherNormalizedSiteEui: r.weather_normalized_site_eui,
    totalGhgEmissions: r.total_ghg_emissions,
    ghgIntensity: r.ghg_intensity,
    waterUseIntensity: r.water_use_intensity,
    totalSiteEnergyKbtu: r.total_site_energy_kbtu,
    source: r.source as MetricSource,
    recordedAt: r.recorded_at,
  }
}

export function toMeter(r: MeterRow): Meter {
  return {
    id: r.id,
    buildingId: r.building_id,
    espmMeterId: r.espm_meter_id,
    name: r.name,
    type: r.type as MeterType,
    unit: r.unit,
    active: r.active === 1,
  }
}

export function toConsumptionEntry(r: ConsumptionRow): ConsumptionEntry {
  return {
    id: r.id,
    meterId: r.meter_id,
    buildingId: r.building_id,
    startDate: r.start_date,
    endDate: r.end_date,
    quantity: r.quantity,
    unit: r.unit,
    cost: r.cost,
    estimated: r.estimated === 1,
    espmConsumptionId: r.espm_consumption_id,
    syncState: r.sync_state as SyncState,
    syncError: r.sync_error,
    enteredByUserId: r.entered_by_user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function toThread(r: ThreadRow): MessageThread {
  return {
    id: r.id,
    organizationId: r.organization_id,
    buildingId: r.building_id,
    subject: r.subject,
    status: r.status === 'closed' ? 'closed' : 'open',
    emailCcAddresses: parseJsonArray(r.email_cc_addresses),
    createdByUserId: r.created_by_user_id,
    lastMessageAt: r.last_message_at,
    createdAt: r.created_at,
  }
}

export function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    threadId: r.thread_id,
    authorUserId: r.author_user_id,
    authorEmail: r.author_email,
    authorName: r.author_name,
    body: r.body,
    channel: r.channel === 'email' ? 'email' : 'portal',
    createdAt: r.created_at,
  }
}

export function toAlert(r: AlertRow): Alert {
  return {
    id: r.id,
    organizationId: r.organization_id,
    buildingId: r.building_id,
    kind: r.kind as AlertKind,
    severity: r.severity as AlertSeverity,
    title: r.title,
    detail: r.detail,
    acknowledgedAt: r.acknowledged_at,
    createdAt: r.created_at,
  }
}

export function toReport(r: ReportRow): ReportRecord {
  return {
    id: r.id,
    organizationId: r.organization_id,
    buildingId: r.building_id,
    kind: r.kind as ReportRecord['kind'],
    periodLabel: r.period_label,
    status: r.status as ReportRecord['status'],
    filePath: r.file_path,
    generatedAt: r.generated_at,
    createdAt: r.created_at,
  }
}

export function toSyncRun(r: SyncRunRow): SyncRun {
  return {
    id: r.id,
    connectionId: r.connection_id,
    direction: r.direction as SyncRun['direction'],
    scope: r.scope,
    status: r.status as SyncRun['status'],
    itemsProcessed: r.items_processed,
    itemsFailed: r.items_failed,
    message: r.message,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  }
}

export function toConnection(r: ConnectionRow): EspmConnection {
  return {
    id: r.id,
    label: r.label,
    organizationId: r.organization_id,
    espmAccountId: r.espm_account_id,
    username: r.username,
    environment: r.environment === 'live' ? 'live' : 'test',
    active: r.active === 1,
    lastPullAt: r.last_pull_at,
    createdAt: r.created_at,
  }
}

/** Tolerates a malformed blob rather than 500ing a whole thread list over it. */
function parseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
