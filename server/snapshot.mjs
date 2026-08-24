// Turns Monarch's API responses into the one JSON shape the dashboard renders,
// and keeps that shape fresh on a timer.
//
// Every panel is fetched independently: one failing query (Monarch renamed a
// field, a query is temporarily 500ing) degrades that panel only — the rest of
// the dashboard keeps updating, and the panel shows why it's empty.

import { EventEmitter } from 'node:events'
import { AuthExpiredError, MonarchError } from './monarch.mjs'
import {
  FORCE_REFRESH_ACCOUNTS,
  GET_ACCOUNTS,
  GET_AGGREGATE_SNAPSHOTS,
  GET_BUDGETS,
  GET_CASHFLOW,
  GET_SYNC_STATUS,
  GET_TRANSACTIONS,
} from './queries.mjs'

export const HISTORY_YEARS = 5
export const TRANSACTION_PAGE = 60
const MAX_ACTIVITY = 60

/* ---------------------------------------------------------------- date utils */

export function isoDate(date) {
  return date.toISOString().slice(0, 10)
}

export function startOfMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export function endOfMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
}

function yearsAgo(years, now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()))
}

/* --------------------------------------------------------------- normalizers */

export function normalizeAccounts(raw = []) {
  return raw
    .filter((account) => !account?.deactivatedAt)
    .map((account) => {
      const balance = num(account.displayBalance ?? account.currentBalance)
      const institution = account.institution?.name || account.credential?.institution?.name || null
      return {
        id: String(account.id),
        name: account.displayName || 'Account',
        balance,
        isAsset: account.isAsset !== false,
        includeInNetWorth: account.includeInNetWorth !== false,
        hidden: Boolean(account.isHidden),
        manual: Boolean(account.isManual),
        syncing: Boolean(account.hasSyncInProgress),
        syncDisabled: Boolean(account.syncDisabled),
        needsAttention: Boolean(
          account.credential?.updateRequired || account.credential?.disconnectedFromDataProviderAt,
        ),
        type: account.type?.display || account.type?.name || 'Other',
        typeKey: account.type?.name || 'other',
        subtype: account.subtype?.display || null,
        institution,
        logoUrl: account.logoUrl || null,
        lastUpdated: account.displayLastUpdatedAt || account.updatedAt || null,
        order: Number.isFinite(account.order) ? account.order : 0,
      }
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

export function computeNetWorth(accounts = []) {
  let assets = 0
  let liabilities = 0
  for (const account of accounts) {
    if (!account.includeInNetWorth || account.hidden) continue
    if (account.isAsset) assets += account.balance
    else liabilities += Math.abs(account.balance)
  }
  return { assets, liabilities, total: assets - liabilities }
}

export function groupAccounts(accounts = []) {
  const groups = new Map()
  for (const account of accounts) {
    if (account.hidden) continue
    const key = account.type
    if (!groups.has(key)) groups.set(key, { type: key, total: 0, accounts: [] })
    const group = groups.get(key)
    group.accounts.push(account)
    group.total += account.isAsset ? account.balance : -Math.abs(account.balance)
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
}

export function normalizeSeries(raw = []) {
  return raw
    .map((point) => ({ date: String(point.date).slice(0, 10), balance: num(point.balance) }))
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function normalizeTransactions(raw = []) {
  return raw
    .map((transaction) => ({
      id: String(transaction.id),
      date: String(transaction.date).slice(0, 10),
      amount: num(transaction.amount),
      merchant: transaction.merchant?.name || transaction.plaidName || 'Transaction',
      category: transaction.category?.name || 'Uncategorized',
      categoryType: transaction.category?.group?.type || null,
      account: transaction.account?.displayName || null,
      pending: Boolean(transaction.pending),
      needsReview: Boolean(transaction.needsReview),
      recurring: Boolean(transaction.isRecurring),
      split: Boolean(transaction.isSplitTransaction),
      notes: transaction.notes || null,
    }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

export function normalizeCashflow(data, month) {
  const summary = data?.summary?.[0]?.summary ?? {}
  const income = Math.abs(num(summary.sumIncome))
  const expense = Math.abs(num(summary.sumExpense))
  const savings = summary.savings == null ? income - expense : num(summary.savings)
  const savingsRate =
    summary.savingsRate == null ? (income > 0 ? savings / income : 0) : num(summary.savingsRate)

  const byCategory = (data?.byCategory ?? [])
    .map((row) => ({
      id: String(row?.groupBy?.category?.id ?? ''),
      name: row?.groupBy?.category?.name || 'Uncategorized',
      groupType: row?.groupBy?.category?.group?.type || null,
      amount: Math.abs(num(row?.summary?.sum)),
      signedAmount: num(row?.summary?.sum),
    }))
    .filter((row) => row.amount > 0)

  const spending = byCategory
    .filter((row) => row.groupType !== 'income' && row.signedAmount <= 0)
    .sort((a, b) => b.amount - a.amount)

  return { month, income, expense, savings, savingsRate, spending }
}

export function normalizeBudget(data, month) {
  const groupsById = new Map(
    (data?.categoryGroups ?? []).map((group) => [String(group.id), group]),
  )
  const rows = []
  for (const entry of data?.budgetData?.monthlyAmountsByCategoryGroup ?? []) {
    const groupId = String(entry?.categoryGroup?.id ?? '')
    const meta = groupsById.get(groupId)
    const amounts = (entry?.monthlyAmounts ?? []).find(
      (amount) => String(amount?.month).slice(0, 7) === month.slice(0, 7),
    )
    if (!amounts) continue
    const planned = Math.abs(num(amounts.plannedCashFlowAmount))
    const actual = Math.abs(num(amounts.actualAmount))
    if (!planned && !actual) continue
    rows.push({
      id: groupId,
      name: meta?.name || 'Group',
      type: meta?.type || null,
      planned,
      actual,
      remaining: num(amounts.remainingAmount),
    })
  }

  const totals = (data?.budgetData?.totalsByMonth ?? []).find(
    (total) => String(total?.month).slice(0, 7) === month.slice(0, 7),
  )

  return {
    month,
    groups: rows
      .filter((row) => row.type !== 'income')
      .sort((a, b) => b.planned - a.planned || b.actual - a.actual),
    totals: totals
      ? {
          plannedIncome: num(totals.totalIncome?.plannedAmount),
          actualIncome: num(totals.totalIncome?.actualAmount),
          plannedExpenses: Math.abs(num(totals.totalExpenses?.plannedAmount)),
          actualExpenses: Math.abs(num(totals.totalExpenses?.actualAmount)),
        }
      : null,
  }
}

function num(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/* -------------------------------------------------------------- data sources */

/** Reads a live Monarch account. */
export class MonarchSource {
  constructor(client) {
    this.client = client
    this.demo = false
  }

  async fetchSnapshot() {
    const now = new Date()
    const month = isoDate(startOfMonth(now))
    const monthEnd = isoDate(endOfMonth(now))

    const results = await Promise.allSettled([
      this.client.gql('GetAccounts', GET_ACCOUNTS),
      this.client.gql('GetAggregateSnapshots', GET_AGGREGATE_SNAPSHOTS, {
        filters: { startDate: isoDate(yearsAgo(HISTORY_YEARS, now)), endDate: isoDate(now) },
      }),
      this.client.gql('GetTransactionsList', GET_TRANSACTIONS, {
        offset: 0,
        limit: TRANSACTION_PAGE,
        orderBy: 'date',
        filters: {},
      }),
      this.client.gql('Web_GetCashFlowPage', GET_CASHFLOW, {
        filters: { startDate: month, endDate: monthEnd },
      }),
      this.client.gql('GetJointPlanningData', GET_BUDGETS, {
        startDate: month,
        endDate: monthEnd,
        useV2Goals: false,
      }),
    ])

    // An expired session is fatal for every panel, so surface it as one error.
    const expired = results.find(
      (result) => result.status === 'rejected' && result.reason instanceof AuthExpiredError,
    )
    if (expired) throw expired.reason

    const [accountsResult, seriesResult, transactionsResult, cashflowResult, budgetResult] = results
    const errors = {}
    const take = (result, key, transform, fallback) => {
      if (result.status === 'fulfilled') {
        try {
          return transform(result.value)
        } catch (error) {
          errors[key] = `Could not read Monarch's response: ${error.message}`
          return fallback
        }
      }
      errors[key] = describe(result.reason)
      return fallback
    }

    const accounts = take(accountsResult, 'accounts', (data) => normalizeAccounts(data.accounts), [])
    const series = take(
      seriesResult,
      'netWorth',
      (data) => normalizeSeries(data.aggregateSnapshots),
      [],
    )
    const transactions = take(
      transactionsResult,
      'transactions',
      (data) => normalizeTransactions(data.allTransactions?.results),
      [],
    )
    const cashflow = take(cashflowResult, 'cashflow', (data) => normalizeCashflow(data, month), {
      month,
      income: 0,
      expense: 0,
      savings: 0,
      savingsRate: 0,
      spending: [],
    })
    const budget = take(budgetResult, 'budget', (data) => normalizeBudget(data, month), {
      month,
      groups: [],
      totals: null,
    })

    return {
      demo: false,
      fetchedAt: new Date().toISOString(),
      accounts,
      accountGroups: groupAccounts(accounts),
      netWorth: computeNetWorth(accounts),
      netWorthSeries: series,
      transactions,
      cashflow,
      budget,
      syncing: accounts.some((account) => account.syncing),
      errors,
    }
  }

  /** Ask Monarch to pull fresh data from the institutions themselves. */
  async requestSync(accountIds) {
    const data = await this.client.gql('Common_ForceRefreshAccountsMutation', FORCE_REFRESH_ACCOUNTS, {
      input: { accountIds },
    })
    const payload = data?.forceRefreshAccounts
    if (!payload?.success) {
      const message = (payload?.errors ?? []).map((error) => error?.message).filter(Boolean).join('; ')
      throw new MonarchError(message || 'Monarch refused the sync request.', { code: 'SYNC_REFUSED' })
    }
    return true
  }

  async syncInProgress() {
    const data = await this.client.gql('ForceRefreshAccountsQuery', GET_SYNC_STATUS)
    return (data?.accounts ?? []).some((account) => account.hasSyncInProgress)
  }
}

function describe(error) {
  if (error instanceof MonarchError) return error.message
  return error?.message || String(error)
}

/* ------------------------------------------------------------------- service */

/**
 * Holds the current snapshot, refreshes it on an interval, and emits changes so
 * connected browsers can be pushed to over SSE.
 *
 * Events: `snapshot` ({snapshot, activity}), `status` (status object).
 */
export class SnapshotService extends EventEmitter {
  constructor({ source, intervalMs = 120000 }) {
    super()
    this.source = source
    this.intervalMs = intervalMs
    this.snapshot = null
    this.activity = []
    this.timer = null
    this.inFlight = null
    this.syncWatcher = null
    this.status = {
      refreshing: false,
      syncing: false,
      lastRefreshAt: null,
      lastError: null,
      nextRefreshAt: null,
      intervalMs,
      demo: Boolean(source?.demo),
    }
  }

  start() {
    this.stop()
    this.refresh('startup').catch(() => {})
    this.timer = setInterval(() => {
      this.refresh('interval').catch(() => {})
    }, this.intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    this.#patchStatus({ nextRefreshAt: new Date(Date.now() + this.intervalMs).toISOString() })
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.syncWatcher) clearInterval(this.syncWatcher)
    this.syncWatcher = null
  }

  setSource(source) {
    this.source = source
    this.snapshot = null
    this.activity = []
    this.#patchStatus({ demo: Boolean(source?.demo), lastError: null, lastRefreshAt: null })
  }

  setInterval(intervalMs) {
    this.intervalMs = Math.max(15000, Math.min(3600000, intervalMs))
    this.#patchStatus({ intervalMs: this.intervalMs })
    if (this.timer) this.start()
  }

  /** Refresh, collapsing concurrent callers onto one in-flight fetch. */
  async refresh(reason = 'manual') {
    if (this.inFlight) return this.inFlight
    this.#patchStatus({ refreshing: true })
    this.inFlight = (async () => {
      try {
        const next = await this.source.fetchSnapshot()
        const events = diffSnapshots(this.snapshot, next)
        this.snapshot = next
        if (events.length) {
          this.activity = [...events, ...this.activity].slice(0, MAX_ACTIVITY)
        }
        this.#patchStatus({
          refreshing: false,
          syncing: Boolean(next.syncing),
          lastRefreshAt: next.fetchedAt,
          lastError: null,
          nextRefreshAt: new Date(Date.now() + this.intervalMs).toISOString(),
          reason,
        })
        this.emit('snapshot', { snapshot: next, events, activity: this.activity })
        return next
      } catch (error) {
        const authExpired = error instanceof AuthExpiredError
        this.#patchStatus({
          refreshing: false,
          lastError: describe(error),
          authExpired,
          nextRefreshAt: new Date(Date.now() + this.intervalMs).toISOString(),
        })
        if (authExpired) this.emit('auth-expired')
        throw error
      } finally {
        this.inFlight = null
      }
    })()
    return this.inFlight
  }

  /**
   * Kick off an institution-side sync, then poll until Monarch reports it done
   * (or we hit the cap) so balances land without the user reloading.
   */
  async sync() {
    if (!this.source.requestSync) throw new MonarchError('This source cannot sync.', { code: 'NO_SYNC' })
    const accounts = (this.snapshot?.accounts ?? []).filter(
      (account) => !account.manual && !account.syncDisabled,
    )
    if (!accounts.length) throw new MonarchError('No linked accounts to sync.', { code: 'NO_ACCOUNTS' })

    await this.source.requestSync(accounts.map((account) => account.id))
    this.#patchStatus({ syncing: true })
    this.#pushActivity({ type: 'sync', message: `Sync requested for ${accounts.length} accounts` })

    if (this.syncWatcher) clearInterval(this.syncWatcher)
    let ticks = 0
    this.syncWatcher = setInterval(async () => {
      ticks += 1
      try {
        const running = await this.source.syncInProgress()
        if (!running || ticks > 40) {
          clearInterval(this.syncWatcher)
          this.syncWatcher = null
          this.#patchStatus({ syncing: false })
          this.#pushActivity({ type: 'sync', message: 'Sync finished — pulling fresh data' })
          await this.refresh('sync-complete')
        }
      } catch {
        clearInterval(this.syncWatcher)
        this.syncWatcher = null
        this.#patchStatus({ syncing: false })
      }
    }, 5000)
    if (typeof this.syncWatcher.unref === 'function') this.syncWatcher.unref()
    return true
  }

  #pushActivity(event) {
    const entry = { at: new Date().toISOString(), ...event }
    this.activity = [entry, ...this.activity].slice(0, MAX_ACTIVITY)
    this.emit('activity', entry)
  }

  #patchStatus(patch) {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }
}

/** What changed between two snapshots — this is what makes the dashboard feel live. */
export function diffSnapshots(previous, next) {
  if (!previous) return []
  const events = []
  const seen = new Set(previous.transactions.map((transaction) => transaction.id))
  for (const transaction of next.transactions) {
    if (seen.has(transaction.id)) continue
    events.push({
      at: next.fetchedAt,
      type: 'transaction',
      id: transaction.id,
      message: `${transaction.merchant} · ${transaction.category}`,
      amount: transaction.amount,
      pending: transaction.pending,
    })
  }

  const previousBalances = new Map(previous.accounts.map((account) => [account.id, account.balance]))
  for (const account of next.accounts) {
    if (!previousBalances.has(account.id)) continue
    const delta = account.balance - previousBalances.get(account.id)
    if (Math.abs(delta) < 0.01) continue
    events.push({
      at: next.fetchedAt,
      type: 'balance',
      id: account.id,
      message: `${account.name} balance changed`,
      amount: delta,
    })
  }

  const netDelta = next.netWorth.total - previous.netWorth.total
  if (Math.abs(netDelta) >= 0.01) {
    events.push({
      at: next.fetchedAt,
      type: 'networth',
      id: 'net-worth',
      message: 'Net worth updated',
      amount: netDelta,
    })
  }
  return events
}
