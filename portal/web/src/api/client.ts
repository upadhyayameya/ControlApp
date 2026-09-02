// ---------------------------------------------------------------------------
// The one place the browser talks to the API.
//
// Every call goes through `request`, which carries the session cookie, parses
// the server's error envelope into a real Error, and returns typed data using
// the same contract types the server implements — so a route whose shape
// changes breaks this build rather than a customer's screen.
// ---------------------------------------------------------------------------

import type {
  Alert,
  BuildingDetailResponse,
  ConsumptionEntry,
  CreateConsumptionRequest,
  CreateThreadRequest,
  MessageThread,
  Organization,
  PortfolioResponse,
  PushResultResponse,
  ReportRecord,
  SessionResponse,
  SyncStatusResponse,
  ThreadWithMessages,
} from '@hbs/shared'

export class ApiError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    // Without this the browser withholds the session cookie and every call
    // after login reads as signed-out.
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  const text = await response.text()
  const payload: unknown = text ? safeParse(text) : null

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; detail?: string }
    throw new ApiError(
      body.error ?? `Request failed (${response.status}).`,
      response.status,
      body.detail,
    )
  }

  return payload as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const api = {
  login: (email: string, password: string) =>
    request<SessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  session: () => request<SessionResponse>('/auth/session'),

  portfolio: (organizationId?: string) =>
    request<PortfolioResponse>(`/portfolio${organizationId ? `?organizationId=${organizationId}` : ''}`),
  building: (id: string) => request<BuildingDetailResponse>(`/buildings/${id}`),

  addConsumption: (buildingId: string, body: CreateConsumptionRequest) =>
    request<PushResultResponse>(`/buildings/${buildingId}/consumption`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  consumption: (buildingId: string) =>
    request<{ entries: ConsumptionEntry[] }>(`/buildings/${buildingId}/consumption`),

  syncStatus: () => request<SyncStatusResponse>('/sync/status'),
  push: (buildingId?: string) =>
    request<{ processed: number; failed: number; messages: string[] }>(
      `/sync/push${buildingId ? `?buildingId=${buildingId}` : ''}`,
      { method: 'POST' },
    ),
  pull: (organizationId: string) =>
    request<{ processed: number; failed: number; messages: string[] }>(
      `/sync/pull?organizationId=${organizationId}`,
      { method: 'POST' },
    ),

  alerts: (organizationId?: string) =>
    request<{ alerts: Alert[] }>(`/alerts${organizationId ? `?organizationId=${organizationId}` : ''}`),
  acknowledgeAlert: (id: string) =>
    request<{ ok: true }>(`/alerts/${id}/acknowledge`, { method: 'POST' }),
  runMonitor: (organizationId?: string) =>
    request<{ created: number; updated: number; findings: string[] }>(
      `/alerts/run-monitor${organizationId ? `?organizationId=${organizationId}` : ''}`,
      { method: 'POST' },
    ),

  threads: (buildingId?: string) =>
    request<{ threads: MessageThread[] }>(`/threads${buildingId ? `?buildingId=${buildingId}` : ''}`),
  thread: (id: string) => request<ThreadWithMessages>(`/threads/${id}`),
  createThread: (body: CreateThreadRequest) =>
    request<MessageThread>('/threads', { method: 'POST', body: JSON.stringify(body) }),
  postMessage: (threadId: string, body: string) =>
    request<Comment>(`/threads/${threadId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  reports: () => request<{ reports: ReportRecord[] }>('/reports'),
  generateReport: (kind: ReportRecord['kind'], buildingId?: string | null) =>
    request<ReportRecord>('/reports', {
      method: 'POST',
      body: JSON.stringify({ kind, buildingId: buildingId ?? null }),
    }),

  organizations: () => request<{ organizations: Organization[] }>('/organizations'),
}
