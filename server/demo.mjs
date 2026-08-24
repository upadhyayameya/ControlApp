// A synthetic Monarch account, so the dashboard can be opened, demoed and
// developed against without credentials. Same snapshot shape as MonarchSource;
// each refresh nudges balances and occasionally posts a transaction, so the live
// behaviour (push updates, new-row highlights, activity feed) is real.

import { computeNetWorth, groupAccounts, isoDate, startOfMonth } from './snapshot.mjs'

const MERCHANTS = [
  ['Blue Bottle Coffee', 'Coffee Shops', -6.75],
  ['Whole Foods', 'Groceries', -84.12],
  ['Shell', 'Gas', -52.4],
  ['Netflix', 'Streaming', -22.99],
  ['Lyft', 'Taxi & Ride Shares', -18.3],
  ['Home Depot', 'Home Improvement', -137.88],
  ['Chipotle', 'Restaurants', -14.65],
  ['Amazon', 'Shopping', -63.2],
  ['PG&E', 'Utilities', -142.11],
  ['Trader Joes', 'Groceries', -57.9],
]

const ACCOUNTS = [
  { id: 'a1', name: 'Everyday Checking', type: 'Cash', institution: 'Chase', balance: 8421.55, isAsset: true },
  { id: 'a2', name: 'High-Yield Savings', type: 'Cash', institution: 'Ally', balance: 24350.0, isAsset: true },
  { id: 'a3', name: 'Sapphire Card', type: 'Credit Cards', institution: 'Chase', balance: 1843.22, isAsset: false },
  { id: 'a4', name: 'Brokerage', type: 'Investments', institution: 'Fidelity', balance: 96240.18, isAsset: true },
  { id: 'a5', name: '401(k)', type: 'Investments', institution: 'Vanguard', balance: 184920.4, isAsset: true },
  { id: 'a6', name: 'Home', type: 'Real Estate', institution: null, balance: 612000, isAsset: true, manual: true },
  { id: 'a7', name: 'Mortgage', type: 'Loans', institution: 'Rocket Mortgage', balance: 384210.9, isAsset: false },
  { id: 'a8', name: 'Car Loan', type: 'Loans', institution: 'Capital One', balance: 12480.33, isAsset: false },
]

const SPENDING = [
  ['Groceries', 842.16],
  ['Restaurants', 611.4],
  ['Mortgage', 2410.0],
  ['Utilities', 318.72],
  ['Shopping', 289.55],
  ['Gas', 176.3],
  ['Streaming', 68.97],
  ['Coffee Shops', 54.2],
  ['Pets', 44.0],
  ['Home Improvement', 137.88],
]

const BUDGET_GROUPS = [
  ['Housing', 2600, 2410],
  ['Food & Dining', 1200, 1453.56],
  ['Transportation', 450, 246.3],
  ['Bills & Utilities', 400, 318.72],
  ['Shopping', 350, 289.55],
  ['Travel & Lifestyle', 300, 122.4],
]

/** Small deterministic PRNG so a demo run looks the same every time it starts. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class DemoSource {
  constructor() {
    this.demo = true
    this.random = mulberry32(20260824)
    this.tick = 0
    this.balances = new Map(ACCOUNTS.map((account) => [account.id, account.balance]))
    this.extraTransactions = []
    this.series = buildSeries()
  }

  async fetchSnapshot() {
    this.tick += 1
    const now = new Date()
    const month = isoDate(startOfMonth(now))

    // Drift a couple of balances every refresh so the live updates are visible.
    for (const account of ACCOUNTS) {
      if (account.manual) continue
      const drift = (this.random() - 0.45) * (account.type === 'Investments' ? 240 : 30)
      this.balances.set(account.id, round(this.balances.get(account.id) + drift))
    }

    // Roughly every third refresh, a new transaction posts.
    if (this.tick > 1 && this.random() < 0.34) {
      const [merchant, category, amount] = MERCHANTS[Math.floor(this.random() * MERCHANTS.length)]
      this.extraTransactions.unshift({
        id: `live-${Date.now()}`,
        date: isoDate(now),
        amount: round(amount * (0.7 + this.random() * 0.9)),
        merchant,
        category,
        categoryType: 'expense',
        account: 'Sapphire Card',
        pending: true,
        needsReview: true,
        recurring: false,
        split: false,
        notes: null,
      })
      this.extraTransactions = this.extraTransactions.slice(0, 20)
    }

    const accounts = ACCOUNTS.map((account, index) => ({
      id: account.id,
      name: account.name,
      balance: round(this.balances.get(account.id)),
      isAsset: account.isAsset,
      includeInNetWorth: true,
      hidden: false,
      manual: Boolean(account.manual),
      syncing: false,
      syncDisabled: Boolean(account.manual),
      needsAttention: account.id === 'a8',
      type: account.type,
      typeKey: account.type.toLowerCase(),
      subtype: null,
      institution: account.institution,
      logoUrl: null,
      lastUpdated: new Date(Date.now() - index * 1000 * 60 * 17).toISOString(),
      order: index,
    }))

    // Shift the synthetic history so it lands exactly on today's net worth —
    // a chart that disagrees with the headline figure reads as a bug.
    const netWorth = computeNetWorth(accounts)
    const offset = netWorth.total - this.series[this.series.length - 1].balance
    const series = this.series.map((point) => ({ date: point.date, balance: round(point.balance + offset) }))
    series[series.length - 1] = { date: isoDate(now), balance: round(netWorth.total) }

    const transactions = [...this.extraTransactions, ...baseTransactions(now)].slice(0, 60)
    const income = 9200
    const expense = SPENDING.reduce((sum, [, amount]) => sum + amount, 0)

    return {
      demo: true,
      fetchedAt: new Date().toISOString(),
      accounts,
      accountGroups: groupAccounts(accounts),
      netWorth,
      netWorthSeries: series,
      transactions,
      cashflow: {
        month,
        income,
        expense: round(expense),
        savings: round(income - expense),
        savingsRate: (income - expense) / income,
        spending: SPENDING.map(([name, amount], index) => ({
          id: `c${index}`,
          name,
          groupType: 'expense',
          amount,
          signedAmount: -amount,
        })).sort((a, b) => b.amount - a.amount),
      },
      budget: {
        month,
        groups: BUDGET_GROUPS.map(([name, planned, actual], index) => ({
          id: `g${index}`,
          name,
          type: 'expense',
          planned,
          actual,
          remaining: round(planned - actual),
        })),
        totals: {
          plannedIncome: 9000,
          actualIncome: income,
          plannedExpenses: BUDGET_GROUPS.reduce((sum, [, planned]) => sum + planned, 0),
          actualExpenses: round(expense),
        },
      },
      syncing: false,
      errors: {},
    }
  }

  async requestSync() {
    return true
  }

  async syncInProgress() {
    return false
  }
}

function baseTransactions(now) {
  const random = mulberry32(4242)
  const rows = []
  for (let index = 0; index < 45; index += 1) {
    const [merchant, category, amount] = MERCHANTS[Math.floor(random() * MERCHANTS.length)]
    const date = new Date(now.getTime() - index * 1000 * 60 * 60 * 9)
    rows.push({
      id: `demo-${index}`,
      date: isoDate(date),
      amount: index === 3 ? 4600 : round(amount * (0.6 + random() * 1.2)),
      merchant: index === 3 ? 'Paycheck' : merchant,
      category: index === 3 ? 'Paychecks' : category,
      categoryType: index === 3 ? 'income' : 'expense',
      account: index % 3 === 0 ? 'Everyday Checking' : 'Sapphire Card',
      pending: index < 2,
      needsReview: index === 1 || index === 5,
      recurring: index === 3,
      split: false,
      notes: null,
    })
  }
  return rows
}

function buildSeries() {
  const random = mulberry32(99)
  const points = []
  const today = new Date()
  let balance = 372000
  for (let daysAgo = 730; daysAgo >= 0; daysAgo -= 1) {
    const date = new Date(today.getTime() - daysAgo * 86400000)
    balance += 190 + (random() - 0.42) * 1400
    points.push({ date: isoDate(date), balance: round(balance) })
  }
  return points
}

function round(value) {
  return Math.round(value * 100) / 100
}
