// GraphQL documents for Monarch's private web API.
//
// Monarch publishes no public API, so these are the operations its own web app
// sends. Operation names are kept exactly as the web client uses them; the field
// selections are trimmed to what this dashboard renders. If Monarch changes a
// field, the affected panel reports its own error and the rest keeps working
// (see server/snapshot.mjs).

export const GET_ACCOUNTS = `
  query GetAccounts {
    accounts {
      id
      displayName
      currentBalance
      displayBalance
      isAsset
      isHidden
      includeInNetWorth
      isManual
      syncDisabled
      deactivatedAt
      displayLastUpdatedAt
      updatedAt
      order
      logoUrl
      hasSyncInProgress
      type { name display __typename }
      subtype { name display __typename }
      credential {
        id
        updateRequired
        disconnectedFromDataProviderAt
        institution { id name status __typename }
        __typename
      }
      institution { id name primaryColor __typename }
      __typename
    }
  }
`

export const GET_AGGREGATE_SNAPSHOTS = `
  query GetAggregateSnapshots($filters: AggregateSnapshotFilters) {
    aggregateSnapshots(filters: $filters) {
      date
      balance
      __typename
    }
  }
`

export const GET_TRANSACTIONS = `
  query GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {
    allTransactions(filters: $filters) {
      totalCount
      results(offset: $offset, limit: $limit, orderBy: $orderBy) {
        id
        amount
        pending
        date
        notes
        isRecurring
        needsReview
        isSplitTransaction
        plaidName
        category { id name group { id type __typename } __typename }
        merchant { id name logoUrl __typename }
        account { id displayName __typename }
        __typename
      }
      __typename
    }
  }
`

export const GET_CASHFLOW = `
  query Web_GetCashFlowPage($filters: TransactionFilterInput) {
    byCategory: aggregates(filters: $filters, groupBy: ["category"]) {
      groupBy {
        category {
          id
          name
          group { id type __typename }
          __typename
        }
        __typename
      }
      summary { sum __typename }
      __typename
    }
    summary: aggregates(filters: $filters, fillEmptyValues: true) {
      summary {
        sumIncome
        sumExpense
        savings
        savingsRate
        __typename
      }
      __typename
    }
  }
`

export const GET_BUDGETS = `
  query GetJointPlanningData($startDate: Date!, $endDate: Date!, $useV2Goals: Boolean!) {
    budgetData(startMonth: $startDate, endMonth: $endDate) {
      monthlyAmountsByCategoryGroup {
        categoryGroup { id __typename }
        monthlyAmounts {
          month
          plannedCashFlowAmount
          actualAmount
          remainingAmount
          __typename
        }
        __typename
      }
      totalsByMonth {
        month
        totalIncome { plannedAmount actualAmount remainingAmount __typename }
        totalExpenses { plannedAmount actualAmount remainingAmount __typename }
        __typename
      }
      __typename
    }
    categoryGroups {
      id
      name
      order
      type
      __typename
    }
  }
`

export const FORCE_REFRESH_ACCOUNTS = `
  mutation Common_ForceRefreshAccountsMutation($input: ForceRefreshAccountsInput!) {
    forceRefreshAccounts(input: $input) {
      success
      errors {
        message
        code
        __typename
      }
      __typename
    }
  }
`

export const GET_SYNC_STATUS = `
  query ForceRefreshAccountsQuery {
    accounts {
      id
      hasSyncInProgress
      __typename
    }
  }
`
