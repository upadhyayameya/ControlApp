// ---------------------------------------------------------------------------
// The API contract, shared verbatim by the server and the web app.
//
// Both sides import these types, so a route that changes shape breaks the
// frontend build rather than a customer's dashboard.
// ---------------------------------------------------------------------------

import type {
  AuditEvent,
  Invitation,
  OnboardingState,
  OrganizationProfile,
  PlanUsage,
} from './platform.js'
import type {
  Alert,
  Building,
  ComplianceAssessment,
  ConsumptionEntry,
  Message,
  MessageThread,
  Meter,
  MetricYear,
  Organization,
  Recommendation,
  ReportRecord,
  SyncRun,
  User,
} from './types.js'

export interface LoginRequest {
  email: string
  password: string
}

export interface SessionResponse {
  user: User
  organization: Organization | null
  /** Tenant settings and branding; null for HBS staff, who belong to no tenant. */
  profile: OrganizationProfile | null
}

export interface SignupRequest {
  organizationName: string
  fullName: string
  email: string
  password: string
}

export interface AcceptInviteRequest {
  token: string
  fullName: string
  password: string
}

/** What an invited person is shown before they choose a password. */
export interface InvitePreview {
  organizationName: string
  email: string
  role: 'customer_admin' | 'customer_viewer'
  invitedByName: string
  expiresAt: string
}

export interface OrgOverviewResponse {
  profile: OrganizationProfile
  usage: PlanUsage
  onboarding: OnboardingState
  members: User[]
  invitations: Invitation[]
  connection: EspmConnectionSummary | null
}

/** Never carries the credential — only whether one is stored and whether it works. */
export interface EspmConnectionSummary {
  id: string
  label: string
  username: string
  environment: 'test' | 'live'
  scope: 'shared-hbs' | 'own-account'
  status: 'unverified' | 'connected' | 'error'
  lastError: string | null
  verifiedAt: string | null
  lastPullAt: string | null
}

export interface ConnectEspmRequest {
  username: string
  password: string
  environment: 'test' | 'live'
}

export interface UpdateOrgRequest {
  name?: string
  billingEmail?: string | null
  accentColor?: string
  logoMark?: string | null
}

export interface CreateInvitationRequest {
  email: string
  role: 'customer_admin' | 'customer_viewer'
}

export interface AuditResponse {
  events: AuditEvent[]
}

/** One row of the portfolio table: the building plus everything it is judged on. */
export interface PortfolioEntry {
  building: Building
  latestMetric: MetricYear | null
  assessment: ComplianceAssessment | null
  openAlerts: number
}

export interface PortfolioResponse {
  entries: PortfolioEntry[]
  totals: PortfolioTotals
}

export interface PortfolioTotals {
  buildings: number
  totalSqFt: number
  compliant: number
  atRisk: number
  nonCompliant: number
  insufficientData: number
  /** Sum of best-estimate penalties across non-compliant buildings. */
  estimatedPenaltyExposure: number
  /** False if any figure in the exposure total rests on an unverified constant. */
  exposureVerified: boolean
}

export interface BuildingDetailResponse {
  building: Building
  meters: Meter[]
  metrics: MetricYear[]
  assessments: ComplianceAssessment[]
  currentAssessment: ComplianceAssessment | null
  recommendations: Recommendation[]
  alerts: Alert[]
  recentEntries: ConsumptionEntry[]
}

export interface CreateConsumptionRequest {
  meterId: string
  startDate: string
  endDate: string
  quantity: number
  cost?: number | null
  estimated?: boolean
  /** When true the server pushes to ESPM immediately instead of queueing. */
  pushNow?: boolean
}

export interface PushResultResponse {
  entry: ConsumptionEntry
  pushed: boolean
  message: string
}

export interface ThreadWithMessages {
  thread: MessageThread
  messages: Message[]
}

export interface CreateThreadRequest {
  subject: string
  body: string
  buildingId?: string | null
  emailCcAddresses?: string[]
}

export interface PostMessageRequest {
  body: string
}

export interface SyncStatusResponse {
  runs: SyncRun[]
  lastPullAt: string | null
  pendingPushes: number
  failedPushes: number
}

export interface ReportsResponse {
  reports: ReportRecord[]
}

export interface ApiError {
  error: string
  detail?: string
}
