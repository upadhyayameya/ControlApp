// Dashboard client: reads state from the local server, subscribes to its SSE
// stream, and re-renders in place. No framework, no build step.

const state = {
  snapshot: null,
  status: null,
  activity: [],
  authed: false,
  demo: false,
  range: 365,
  transactions: [],
  seenIds: new Set(),
  freshIds: new Set(),
  firstRender: true,
  txOffset: 0,
  hasMore: true,
}

const $ = (id) => document.getElementById(id)
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const moneyCents = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

/* --------------------------------------------------------------------- theme */

const storedTheme = localStorage.getItem('monarch-theme')
if (storedTheme) document.documentElement.dataset.theme = storedTheme
$('theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  localStorage.setItem('monarch-theme', next)
  renderNetWorthChart()
})

/* ------------------------------------------------------------------- sign-in */

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => {
    for (const other of document.querySelectorAll('.tab')) other.classList.toggle('is-active', other === tab)
    for (const panel of document.querySelectorAll('[data-panel]')) {
      panel.hidden = panel.dataset.panel !== tab.dataset.tab
    }
    // The error line is shared, so a message from the other tab would read as
    // if it belonged to this one.
    gateError('')
  })
}

$('password-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector('button')
  const data = Object.fromEntries(new FormData(form).entries())
  button.disabled = true
  gateError('')
  try {
    const result = await postJson('/api/auth/login', {
      email: data.email,
      password: data.password,
      totp: data.totp || null,
    })
    if (result.authed) return location.reload()
    if (result.status === 'mfa_required') {
      $('totp-field').hidden = false
      $('totp-field').querySelector('input').focus()
      gateError(result.message || 'Enter the six-digit code from your authenticator app.')
      return
    }
    gateError(result.message || 'Sign-in failed.')
  } catch (error) {
    gateError(error.message)
  } finally {
    button.disabled = false
  }
})

$('cookie-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const form = event.currentTarget
  const button = form.querySelector('button')
  button.disabled = true
  gateError('')
  try {
    const result = await postJson('/api/auth/cookie', {
      cookie: new FormData(form).get('cookie'),
    })
    if (result.authed) return location.reload()
    gateError(result.error || 'Those cookies were rejected.')
  } catch (error) {
    gateError(error.message)
  } finally {
    button.disabled = false
  }
})

function gateError(message) {
  const node = $('gate-error')
  node.textContent = message
  node.hidden = !message
}

/* ------------------------------------------------------------------ controls */

// `event.currentTarget` is null once the handler awaits, so hold the button.
$('refresh').addEventListener('click', async (event) => {
  const button = event.currentTarget
  button.disabled = true
  try {
    await postJson('/api/refresh', {})
  } catch (error) {
    banner(error.message)
  } finally {
    button.disabled = false
  }
})

$('sync').addEventListener('click', async (event) => {
  const button = event.currentTarget
  button.disabled = true
  try {
    await postJson('/api/sync', {})
    banner('Sync requested — Monarch is pulling from your institutions. This can take a minute.')
  } catch (error) {
    banner(error.message)
  } finally {
    button.disabled = false
  }
})

$('logout').addEventListener('click', async () => {
  await postJson('/api/auth/logout', {})
  location.reload()
})

$('interval').addEventListener('change', async (event) => {
  await postJson('/api/settings', { intervalSeconds: Number(event.currentTarget.value) })
})

for (const button of document.querySelectorAll('.range')) {
  button.addEventListener('click', () => {
    state.range = button.dataset.range === 'all' ? 'all' : Number(button.dataset.range)
    for (const other of document.querySelectorAll('.range')) other.classList.toggle('is-active', other === button)
    renderNetWorthChart()
  })
}

$('tx-more').addEventListener('click', async (event) => {
  const button = event.currentTarget
  button.disabled = true
  try {
    const url = `/api/transactions?offset=${state.txOffset}&limit=40`
    const response = await fetch(url)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Could not load more transactions.')
    const existing = new Set(state.transactions.map((row) => row.id))
    const added = (data.transactions || []).filter((row) => !existing.has(row.id))
    state.transactions = [...state.transactions, ...added]
    state.txOffset += data.transactions?.length || 0
    state.hasMore = Boolean(data.hasMore) && added.length > 0
    for (const row of added) state.seenIds.add(row.id)
    renderTransactions()
  } catch (error) {
    panelError('tx-error', error.message)
  } finally {
    button.disabled = false
  }
})

/* --------------------------------------------------------------------- wiring */

async function boot() {
  try {
    const response = await fetch('/api/state')
    const data = await response.json()
    applyState(data)
  } catch {
    banner('Cannot reach the local server. Is `npm start` still running?')
  }
  openStream()
  setInterval(updateClocks, 1000)
}

function openStream() {
  const source = new EventSource('/api/stream')
  source.addEventListener('state', (event) => applyState(JSON.parse(event.data)))
  source.addEventListener('snapshot', (event) => {
    const payload = JSON.parse(event.data)
    state.activity = payload.activity || state.activity
    state.status = payload.status || state.status
    applySnapshot(payload.snapshot)
  })
  source.addEventListener('status', (event) => {
    state.status = JSON.parse(event.data)
    renderStatus()
  })
  source.addEventListener('activity', (event) => {
    state.activity = [JSON.parse(event.data), ...state.activity].slice(0, 60)
    renderActivity()
  })
  source.addEventListener('auth', (event) => {
    const payload = JSON.parse(event.data)
    if (!payload.authed) {
      banner(payload.reason || 'Signed out.')
      setTimeout(() => location.reload(), 1200)
    }
  })
  source.addEventListener('error', () => {
    setPill('offline', 'reconnecting…')
  })
}

function applyState(data) {
  state.authed = Boolean(data.authed)
  state.demo = Boolean(data.demo)
  state.status = data.status || state.status
  state.activity = data.activity || []
  $('gate').hidden = state.authed
  $('app').hidden = !state.authed
  $('logout').hidden = state.demo
  if (data.status?.intervalMs) $('interval').value = String(Math.round(data.status.intervalMs / 1000))
  if (data.snapshot) applySnapshot(data.snapshot)
  else renderStatus()
}

function applySnapshot(snapshot) {
  if (!snapshot) return
  const incoming = snapshot.transactions || []

  if (state.firstRender) {
    for (const row of incoming) state.seenIds.add(row.id)
    state.transactions = incoming
    state.txOffset = incoming.length
    state.firstRender = false
  } else {
    const fresh = incoming.filter((row) => !state.seenIds.has(row.id))
    for (const row of fresh) {
      state.seenIds.add(row.id)
      state.freshIds.add(row.id)
      setTimeout(() => {
        state.freshIds.delete(row.id)
      }, 8000)
    }
    const byId = new Map(incoming.map((row) => [row.id, row]))
    const merged = [...incoming, ...state.transactions.filter((row) => !byId.has(row.id))]
    state.transactions = merged
    state.txOffset = Math.max(state.txOffset, incoming.length)
  }

  state.snapshot = snapshot
  render()
}

/* -------------------------------------------------------------------- render */

function render() {
  renderStatus()
  renderNetWorth()
  renderCashflow()
  renderSpending()
  renderAccounts()
  renderTransactions()
  renderBudget()
  renderActivity()
}

function renderStatus() {
  const status = state.status || {}
  const snapshot = state.snapshot

  if (status.refreshing) setPill('busy', 'refreshing')
  else if (status.syncing) setPill('busy', 'syncing banks')
  else if (status.lastError) setPill('offline', 'error')
  else setPill('live', 'live')

  const bits = []
  if (state.demo) bits.push('demo data')
  else bits.push(status.mode === 'cookie' ? 'browser session' : 'connected')
  if (snapshot?.fetchedAt) bits.push(`updated ${relativeTime(snapshot.fetchedAt)}`)
  $('connection').textContent = bits.join(' · ')

  if (status.lastError) banner(status.lastError)
  else if (state.demo) {
    banner('Demo mode — synthetic data, no Monarch account is being used. Run `npm start` to connect a real account.')
  } else clearBanner()

  updateClocks()
}

function updateClocks() {
  const status = state.status || {}
  const parts = []
  if (state.snapshot?.fetchedAt) parts.push(`Last read ${relativeTime(state.snapshot.fetchedAt)}`)
  if (status.nextRefreshAt && !status.refreshing) {
    const seconds = Math.max(0, Math.round((new Date(status.nextRefreshAt) - Date.now()) / 1000))
    parts.push(`next in ${seconds}s`)
  }
  $('footer-status').textContent = parts.join(' · ') || '—'
}

function setPill(stateName, text) {
  $('live-pill').dataset.state = stateName
  $('live-text').textContent = text
}

function renderNetWorth() {
  const snapshot = state.snapshot
  if (!snapshot) return
  $('net-worth').textContent = money.format(snapshot.netWorth.total)
  $('assets').textContent = money.format(snapshot.netWorth.assets)
  $('liabilities').textContent = money.format(-Math.abs(snapshot.netWorth.liabilities))
  panelError('accounts-error', snapshot.errors?.accounts)
  renderNetWorthChart()
}

function visibleSeries() {
  const series = state.snapshot?.netWorthSeries ?? []
  if (state.range === 'all' || series.length === 0) return series
  const cutoff = new Date(Date.now() - state.range * 86400000).toISOString().slice(0, 10)
  const sliced = series.filter((point) => point.date >= cutoff)
  return sliced.length > 1 ? sliced : series.slice(-2)
}

function renderNetWorthChart() {
  const host = $('nw-chart')
  const series = visibleSeries()
  const error = state.snapshot?.errors?.netWorth

  if (error) {
    host.innerHTML = `<p class="panel-error">${escapeHtml(error)}</p>`
    $('net-worth-delta').textContent = ''
    return
  }
  if (series.length < 2) {
    host.innerHTML = '<p class="empty">Not enough balance history yet for a chart.</p>'
    $('net-worth-delta').textContent = ''
    return
  }

  const first = series[0].balance
  const last = series[series.length - 1].balance
  const delta = last - first
  const deltaNode = $('net-worth-delta')
  const label = state.range === 'all' ? 'all time' : `${state.range} days`
  deltaNode.className = `delta ${delta >= 0 ? 'up' : 'down'}`
  deltaNode.textContent = `${delta >= 0 ? '▲' : '▼'} ${money.format(Math.abs(delta))} (${percent.format(
    first === 0 ? 0 : Math.abs(delta / first),
  )}) over ${label}`
  $('nw-caption').textContent = `${series[0].date} → ${series[series.length - 1].date}, ${series.length} daily points from Monarch.`

  drawLineChart(host, series)
}

/** Single-series line + soft area, 2px stroke, recessive grid, crosshair on hover. */
function drawLineChart(host, series) {
  const width = Math.max(320, host.clientWidth || 640)
  const height = host.clientHeight || 220
  const pad = { top: 12, right: 12, bottom: 22, left: 58 }
  const plotWidth = width - pad.left - pad.right
  const plotHeight = height - pad.top - pad.bottom

  const values = series.map((point) => point.balance)
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  const span = rawMax - rawMin || Math.abs(rawMax) || 1
  const min = rawMin - span * 0.08
  const max = rawMax + span * 0.08

  const x = (index) => pad.left + (index / (series.length - 1)) * plotWidth
  const y = (value) => pad.top + plotHeight - ((value - min) / (max - min)) * plotHeight

  const ticks = niceTicks(min, max, 4)
  const gridLines = ticks
    .map(
      (tick) =>
        `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(tick).toFixed(1)}" y2="${y(tick).toFixed(
          1,
        )}" stroke="var(--grid)" stroke-width="1" />` +
        `<text x="${pad.left - 8}" y="${(y(tick) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted)">${compactMoney(
          tick,
        )}</text>`,
    )
    .join('')

  const line = series.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.balance).toFixed(1)}`).join(' ')
  const area = `${line} L${x(series.length - 1).toFixed(1)},${(pad.top + plotHeight).toFixed(1)} L${x(0).toFixed(
    1,
  )},${(pad.top + plotHeight).toFixed(1)} Z`

  const firstDate = series[0].date
  const midDate = series[Math.floor(series.length / 2)].date
  const lastDate = series[series.length - 1].date

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      ${gridLines}
      <path d="${area}" fill="var(--series-1-soft)" />
      <path d="${line}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <line class="crosshair" y1="${pad.top}" y2="${pad.top + plotHeight}" stroke="var(--axis)" stroke-width="1" style="display:none" />
      <circle class="marker" r="4" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2" style="display:none" />
      <text x="${pad.left}" y="${height - 5}" font-size="10" fill="var(--text-muted)">${firstDate}</text>
      <text x="${pad.left + plotWidth / 2}" y="${height - 5}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${midDate}</text>
      <text x="${width - pad.right}" y="${height - 5}" font-size="10" fill="var(--text-muted)" text-anchor="end">${lastDate}</text>
    </svg>
  `

  const svg = host.querySelector('svg')
  const crosshair = svg.querySelector('.crosshair')
  const marker = svg.querySelector('.marker')

  const onMove = (event) => {
    const box = host.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    const index = Math.round(ratio * width - pad.left) / plotWidth
    const clamped = Math.min(series.length - 1, Math.max(0, Math.round(index * (series.length - 1))))
    const point = series[clamped]
    if (!point) return
    crosshair.setAttribute('x1', x(clamped))
    crosshair.setAttribute('x2', x(clamped))
    crosshair.style.display = ''
    marker.setAttribute('cx', x(clamped))
    marker.setAttribute('cy', y(point.balance))
    marker.style.display = ''
    showTooltip(event, `${point.date}<br /><b>${moneyCents.format(point.balance)}</b>`)
  }

  host.onpointermove = onMove
  host.onpointerleave = () => {
    crosshair.style.display = 'none'
    marker.style.display = 'none'
    hideTooltip()
  }
}

function renderCashflow() {
  const cashflow = state.snapshot?.cashflow
  panelError('cf-error', state.snapshot?.errors?.cashflow)
  if (!cashflow) return
  $('cf-month').textContent = monthLabel(cashflow.month)
  $('income').textContent = money.format(cashflow.income)
  $('expense').textContent = money.format(cashflow.expense)
  $('savings').textContent = money.format(cashflow.savings)
  $('savings-rate').textContent = percent.format(cashflow.savingsRate || 0)
  const meter = $('savings-meter')
  const rate = Math.max(0, Math.min(1, cashflow.savingsRate || 0))
  meter.style.width = `${(cashflow.savings < 0 ? 1 : rate) * 100}%`
  meter.classList.toggle('negative', cashflow.savings < 0)
}

function renderSpending() {
  const host = $('spend-chart')
  panelError('spend-error', state.snapshot?.errors?.cashflow)
  const rows = state.snapshot?.cashflow?.spending ?? []
  if (!rows.length) {
    host.innerHTML = '<p class="empty">No spending recorded this month yet.</p>'
    return
  }

  const top = rows.slice(0, 8)
  const rest = rows.slice(8)
  if (rest.length) {
    top.push({
      id: 'other',
      name: `Other (${rest.length} categories)`,
      amount: rest.reduce((sum, row) => sum + row.amount, 0),
    })
  }
  const max = Math.max(...top.map((row) => row.amount))

  host.innerHTML = top
    .map(
      (row) => `
        <div class="bar-row" data-amount="${row.amount}" data-name="${escapeHtml(row.name)}">
          <span class="bar-name">${escapeHtml(row.name)}</span>
          <span class="bar-value">${money.format(row.amount)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${((row.amount / max) * 100).toFixed(1)}%"></div></div>
        </div>`,
    )
    .join('')

  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  for (const node of host.querySelectorAll('.bar-row')) {
    node.onpointermove = (event) => {
      const amount = Number(node.dataset.amount)
      showTooltip(
        event,
        `${escapeHtml(node.dataset.name)}<br /><b>${moneyCents.format(amount)}</b> · ${percent.format(
          total ? amount / total : 0,
        )} of spend`,
      )
    }
    node.onpointerleave = hideTooltip
  }
}

function renderAccounts() {
  const host = $('accounts')
  const groups = state.snapshot?.accountGroups ?? []
  const accounts = state.snapshot?.accounts ?? []
  $('accounts-count').textContent = accounts.length ? `${accounts.length} accounts` : ''

  if (!groups.length) {
    host.innerHTML = '<p class="empty">No accounts returned.</p>'
    return
  }

  host.innerHTML = groups
    .map(
      (group) => `
        <div>
          <div class="account-group-name"><span>${escapeHtml(group.type)}</span><span>${money.format(group.total)}</span></div>
          ${group.accounts
            .map(
              (account) => `
                <div class="account-row">
                  <div class="account-name">
                    <span>${escapeHtml(account.name)}</span>
                    <span class="muted small">
                      ${escapeHtml(account.institution || (account.manual ? 'Manual' : '—'))}
                      ${account.lastUpdated ? ` · ${relativeTime(account.lastUpdated)}` : ''}
                    </span>
                  </div>
                  <div style="display:flex;gap:6px;align-items:center">
                    ${account.needsAttention ? '<span class="chip attention">⚠ needs relink</span>' : ''}
                    ${account.syncing ? '<span class="chip">syncing…</span>' : ''}
                    <span class="account-balance">${moneyCents.format(account.isAsset ? account.balance : -Math.abs(account.balance))}</span>
                  </div>
                </div>`,
            )
            .join('')}
        </div>`,
    )
    .join('')
}

function renderTransactions() {
  const body = $('tx-body')
  panelError('tx-error', state.snapshot?.errors?.transactions)
  const rows = state.transactions
  $('tx-meta').textContent = rows.length ? `${rows.length} most recent` : ''
  $('tx-more').hidden = state.demo || !state.hasMore

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No transactions yet.</td></tr>'
    return
  }

  body.innerHTML = rows
    .map(
      (row) => `
        <tr class="${state.freshIds.has(row.id) ? 'tx-new' : ''}">
          <td class="muted">${row.date.slice(5)}</td>
          <td>
            <div class="tx-merchant">
              <span>${escapeHtml(row.merchant)}</span>
              ${row.pending ? '<span class="chip pending">pending</span>' : ''}
              ${row.needsReview ? '<span class="chip review">review</span>' : ''}
              ${row.recurring ? '<span class="chip">recurring</span>' : ''}
            </div>
          </td>
          <td class="muted">${escapeHtml(row.category)}</td>
          <td class="muted">${escapeHtml(row.account || '—')}</td>
          <td class="right ${row.amount > 0 ? 'amount-in' : ''}">${moneyCents.format(row.amount)}</td>
        </tr>`,
    )
    .join('')
}

function renderBudget() {
  const host = $('budget')
  panelError('budget-error', state.snapshot?.errors?.budget)
  const budget = state.snapshot?.budget
  const groups = budget?.groups ?? []
  $('budget-meta').textContent = budget ? monthLabel(budget.month) : ''

  if (!groups.length) {
    host.innerHTML = '<p class="empty">No budget set for this month in Monarch.</p>'
    return
  }

  host.innerHTML = groups
    .map((group) => {
      const ratio = group.planned > 0 ? group.actual / group.planned : 1
      const over = group.planned > 0 && group.actual > group.planned
      return `
        <div class="budget-row">
          <div class="budget-head">
            <span>${escapeHtml(group.name)}</span>
            <span class="budget-amounts">
              ${money.format(group.actual)} / ${money.format(group.planned)}
              ${over ? `<span class="budget-over">⚠ over by ${money.format(group.actual - group.planned)}</span>` : ''}
            </span>
          </div>
          <div class="meter">
            <div class="meter-fill ${over ? 'negative' : ''}" style="width:${Math.min(100, ratio * 100).toFixed(1)}%"></div>
          </div>
        </div>`
    })
    .join('')
}

function renderActivity() {
  const host = $('activity')
  if (!state.activity.length) {
    host.innerHTML = '<li class="empty">Nothing new yet — updates land here as Monarch reports them.</li>'
    return
  }
  host.innerHTML = state.activity
    .slice(0, 25)
    .map(
      (entry) => `
        <li>
          <time datetime="${entry.at}">${new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          <span>${escapeHtml(entry.message)}</span>
          <span class="amount ${entry.amount > 0 ? 'amount-in' : ''}">${
            entry.amount == null ? '' : moneyCents.format(entry.amount)
          }</span>
        </li>`,
    )
    .join('')
}

/* -------------------------------------------------------------------- helpers */

function showTooltip(event, html) {
  const tooltip = $('tooltip')
  tooltip.innerHTML = html
  tooltip.hidden = false
  const box = tooltip.getBoundingClientRect()
  const left = Math.min(window.innerWidth - box.width - 10, event.clientX + 12)
  const top = Math.max(10, event.clientY - box.height - 12)
  tooltip.style.left = `${left}px`
  tooltip.style.top = `${top}px`
}

function hideTooltip() {
  $('tooltip').hidden = true
}

function banner(message) {
  const node = $('banner')
  node.textContent = message
  node.hidden = !message
}

function clearBanner() {
  $('banner').hidden = true
}

function panelError(id, message) {
  const node = $(id)
  if (!node) return
  node.textContent = message || ''
  node.hidden = !message
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

function niceTicks(min, max, count) {
  const step = Math.pow(10, Math.floor(Math.log10((max - min) / count)))
  const candidates = [1, 2, 2.5, 5, 10].map((factor) => factor * step)
  const chosen = candidates.find((candidate) => (max - min) / candidate <= count) || step * 10
  const ticks = []
  for (let tick = Math.ceil(min / chosen) * chosen; tick <= max; tick += chosen) ticks.push(tick)
  return ticks
}

function compactMoney(value) {
  const abs = Math.abs(value)
  if (abs >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${Math.round(value / 1000)}k`
  return String(Math.round(value))
}

function monthLabel(month) {
  if (!month) return ''
  const date = new Date(`${month.slice(0, 7)}-01T00:00:00Z`)
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function relativeTime(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (Number.isNaN(seconds)) return ''
  if (seconds < 60) return `${Math.max(0, seconds)}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

let resizeTimer = null
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(renderNetWorthChart, 150)
})

boot()
