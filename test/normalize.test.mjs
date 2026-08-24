import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeNetWorth,
  diffSnapshots,
  groupAccounts,
  normalizeAccounts,
  normalizeBudget,
  normalizeCashflow,
  normalizeSeries,
  normalizeTransactions,
} from '../server/snapshot.mjs'

test('normalizeAccounts drops deactivated accounts and flattens the shape', () => {
  const accounts = normalizeAccounts([
    {
      id: 1,
      displayName: 'Checking',
      displayBalance: 100.5,
      isAsset: true,
      type: { name: 'depository', display: 'Cash' },
      institution: { name: 'Chase' },
      order: 1,
    },
    { id: 2, displayName: 'Closed', deactivatedAt: '2026-01-01', type: { display: 'Cash' } },
    {
      id: 3,
      displayName: 'Card',
      currentBalance: 40,
      isAsset: false,
      type: { display: 'Credit Cards' },
      credential: { updateRequired: true, institution: { name: 'Amex' } },
      order: 0,
    },
  ])

  assert.equal(accounts.length, 2)
  assert.deepEqual(accounts.map((account) => account.name), ['Card', 'Checking'])
  assert.equal(accounts[0].institution, 'Amex')
  assert.equal(accounts[0].needsAttention, true)
  assert.equal(accounts[1].balance, 100.5)
  assert.equal(accounts[1].type, 'Cash')
})

test('computeNetWorth nets liabilities out and honours exclusions', () => {
  const netWorth = computeNetWorth([
    { balance: 1000, isAsset: true, includeInNetWorth: true, hidden: false },
    { balance: -250, isAsset: false, includeInNetWorth: true, hidden: false },
    { balance: 9999, isAsset: true, includeInNetWorth: false, hidden: false },
    { balance: 5555, isAsset: true, includeInNetWorth: true, hidden: true },
  ])
  assert.deepEqual(netWorth, { assets: 1000, liabilities: 250, total: 750 })
})

test('groupAccounts signs liabilities negative in the group total', () => {
  const groups = groupAccounts([
    { name: 'A', type: 'Cash', balance: 100, isAsset: true, hidden: false },
    { name: 'B', type: 'Cash', balance: 300, isAsset: true, hidden: false },
    { name: 'C', type: 'Loans', balance: 900, isAsset: false, hidden: false },
  ])
  const byType = Object.fromEntries(groups.map((group) => [group.type, group.total]))
  assert.equal(byType.Cash, 400)
  assert.equal(byType.Loans, -900)
})

test('normalizeSeries sorts by date and drops malformed points', () => {
  const series = normalizeSeries([
    { date: '2026-02-01', balance: '2' },
    { date: 'nonsense', balance: 5 },
    { date: '2026-01-01T00:00:00Z', balance: 1 },
  ])
  assert.deepEqual(series, [
    { date: '2026-01-01', balance: 1 },
    { date: '2026-02-01', balance: 2 },
  ])
})

test('normalizeTransactions falls back to the raw bank description', () => {
  const rows = normalizeTransactions([
    { id: 'b', date: '2026-08-01', amount: -5, plaidName: 'SQ *COFFEE', category: { name: 'Coffee' } },
    { id: 'a', date: '2026-08-02', amount: 12, merchant: { name: 'Refund' }, pending: true },
  ])
  assert.deepEqual(rows.map((row) => row.id), ['a', 'b'])
  assert.equal(rows[1].merchant, 'SQ *COFFEE')
  assert.equal(rows[0].pending, true)
  assert.equal(rows[0].category, 'Uncategorized')
})

test('normalizeCashflow keeps only expense categories and derives a savings rate', () => {
  const cashflow = normalizeCashflow(
    {
      byCategory: [
        { groupBy: { category: { id: '1', name: 'Groceries', group: { type: 'expense' } } }, summary: { sum: -200 } },
        { groupBy: { category: { id: '2', name: 'Salary', group: { type: 'income' } } }, summary: { sum: 1000 } },
        { groupBy: { category: { id: '3', name: 'Empty', group: { type: 'expense' } } }, summary: { sum: 0 } },
      ],
      summary: [{ summary: { sumIncome: 1000, sumExpense: -200, savings: null, savingsRate: null } }],
    },
    '2026-08-01',
  )
  assert.equal(cashflow.income, 1000)
  assert.equal(cashflow.expense, 200)
  assert.equal(cashflow.savings, 800)
  assert.equal(cashflow.savingsRate, 0.8)
  assert.deepEqual(cashflow.spending.map((row) => row.name), ['Groceries'])
})

test('normalizeBudget matches the requested month and hides income groups', () => {
  const budget = normalizeBudget(
    {
      budgetData: {
        monthlyAmountsByCategoryGroup: [
          {
            categoryGroup: { id: '10' },
            monthlyAmounts: [
              { month: '2026-07-01', plannedCashFlowAmount: 100, actualAmount: 90 },
              { month: '2026-08-01', plannedCashFlowAmount: 500, actualAmount: -620, remainingAmount: -120 },
            ],
          },
          {
            categoryGroup: { id: '20' },
            monthlyAmounts: [{ month: '2026-08-01', plannedCashFlowAmount: 4000, actualAmount: 4200 }],
          },
        ],
        totalsByMonth: [
          {
            month: '2026-08-01',
            totalIncome: { plannedAmount: 4000, actualAmount: 4200 },
            totalExpenses: { plannedAmount: -500, actualAmount: -620 },
          },
        ],
      },
      categoryGroups: [
        { id: '10', name: 'Food', type: 'expense' },
        { id: '20', name: 'Paychecks', type: 'income' },
      ],
    },
    '2026-08-01',
  )

  assert.deepEqual(budget.groups.map((group) => group.name), ['Food'])
  assert.equal(budget.groups[0].planned, 500)
  assert.equal(budget.groups[0].actual, 620)
  assert.equal(budget.totals.actualExpenses, 620)
})

test('diffSnapshots reports new transactions, balance moves and net-worth change', () => {
  const base = {
    fetchedAt: '2026-08-24T00:00:00.000Z',
    transactions: [{ id: 't1', merchant: 'A', category: 'X', amount: -5, pending: false }],
    accounts: [{ id: 'a1', name: 'Checking', balance: 100 }],
    netWorth: { total: 100 },
  }
  const next = {
    fetchedAt: '2026-08-24T00:02:00.000Z',
    transactions: [
      { id: 't2', merchant: 'B', category: 'Y', amount: -12, pending: true },
      ...base.transactions,
    ],
    accounts: [{ id: 'a1', name: 'Checking', balance: 88 }],
    netWorth: { total: 88 },
  }

  assert.deepEqual(diffSnapshots(null, next), [])
  const events = diffSnapshots(base, next)
  assert.deepEqual(events.map((event) => event.type), ['transaction', 'balance', 'networth'])
  assert.equal(events[0].id, 't2')
  assert.equal(events[1].amount, -12)
  assert.equal(events[2].amount, -12)
})
