/**
 * Weekly engineering execution update — the Monday team email.
 *
 * Harry's Monday note is the revenue scoreboard: sales, submissions and
 * invoiced revenue against goal. This is the execution counterpart — what the
 * engineering team actually moved through the funnel, what is blocked, and
 * what has to happen this week. It complements that email rather than
 * restating it, and needs no manually maintained goals.
 *
 * Runs inside the monday.com `execute_code` sandbox (already authenticated).
 * It reads only and prints the finished email; the calling Claude session
 * creates it as an Outlook DRAFT so it is reviewed before it goes anywhere.
 *
 * Output: { weekEnding, subject, body, suggestedTo, stats, warnings }
 */

const API = 'https://api.monday.com/v2';

const BOARD_ICF = '18424932045';   // ICF/HBS Project Tracker
const BOARD_TU  = '1069746645';    // Master TU Tracker
const BOARD_KPI = '1069742731';    // Monthly KPIs — one row per milestone reached
const BOARD_PA_WORK = '9889346356';
const BOARD_CO_WORK = '10030690180';

/* Projections/Actuals boards — grouped by month, one row per project.
   `formula` (Projection) is a formula wrapping a mirror, and unlike the mirror
   itself it reads back fine. `numbers3` is Invoice to Date, `date` is Billed Date. */
const PROJECTION_BOARDS = [
  { id: '8890985846',  label: 'HBS Tune-Up' },
  { id: '8890967835',  label: 'BPTU Phase 1' },
  { id: '8998312167',  label: 'BPTU Phase 2' },
  { id: '18411986072', label: 'BGE Prescriptive TU' },
  { id: '8890989484',  label: 'CGS TU' },
  { id: '8894720068',  label: 'GA' },
  { id: '6953033187',  label: 'Direct Install' },
  { id: '8061555777',  label: 'Building Controls' },
];

/* Who the draft is addressed to. Edit this list — it is a starting point taken
   from the standing engineering meetings, not an authoritative distribution. */
const SUGGESTED_TO = [
  'AUpad@hbssolutionsinc.com',      // Ameya Upadhyay (sender, kept on the thread)
  'HHaywood@hbssolutionsinc.com',   // Harry Haywood
  'MCosta@hbssolutionsinc.com',     // Michael Costa
  'DGoforth@hbssolutionsinc.com',   // Devon Goforth
  'DRodriguez@hbssolutionsinc.com', // David Rodriguez
  'DWilkinson@hbssolutionsinc.com',
  'SAgrawal@hbssolutionsinc.com',
  'VBhirud@hbssolutionsinc.com',
  'DRobinson@hbssolutionsinc.com',
  'AHerzer@hbssolutionsinc.com',
  'JRizzotti@hbssolutionsinc.com',
  'PLawson@hbssolutionsinc.com',
  'AWhite@hbssolutionsinc.com',
  'ACatterton@hbssolutionsinc.com',
  'KGuerra@hbssolutionsinc.com',
  'TSams@hbssolutionsinc.com',
  'MPalli@hbssolutionsinc.com',
  'AEspinoza@hbssolutionsinc.com',
  'DSimons@hbssolutionsinc.com',
  'SWinther@hbssolutionsinc.com',
];

/* ------------------------------------------------------------------ api */
async function gql(query, variables) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-Version': '2024-10' },
    body: JSON.stringify({ query, variables }),
  });
  const b = await r.json();
  if (b.errors) throw new Error('monday GraphQL: ' + JSON.stringify(b.errors).slice(0, 800));
  if (!b.data) throw new Error('monday returned no data');
  return b.data;
}

/* Formula columns return an empty `text` over the raw API — their value is in
   `display_value`, so both are requested and display_value wins. Without this
   the aging and days-in-phase columns silently read as blank on every project. */
const PAGE = `query($id: ID!, $cursor: String, $cols: [String!]) {
  boards(ids: [$id]) { items_page(limit: 250, cursor: $cursor) { cursor items {
    id name group { title }
    column_values(ids: $cols) {
      id text
      ... on FormulaValue { display_value }
      ... on BoardRelationValue { linked_item_ids } } } } } }`;

async function fetchBoard(id, cols, maxPages = 40) {
  const items = []; let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const d = await gql(PAGE, { id, cursor, cols });
    const page = d.boards[0].items_page;
    items.push(...page.items);
    cursor = page.cursor;
    if (!cursor) break;
  }
  return items;
}

/* ------------------------------------------------------------------ helpers */
const get = (it, id) => {
  const c = it.column_values.find(v => v.id === id);
  const raw = c ? (c.display_value != null && c.display_value !== '' ? c.display_value : c.text) : '';
  const t = raw ? String(raw).trim() : '';
  return (!t || t === 'null' || t === 'Column value type is not supported') ? '' : t;
};
const listOf = (it, id) => { const s = get(it, id); return s ? s.split(',').map(x => x.trim()).filter(Boolean) : []; };
const numOf = (it, id) => { const n = parseFloat(String(get(it, id)).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
function dparse(s) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s || '')) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
const inR = (d, a, b) => !!d && d >= a && d < b;
const money = n => {
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Math.round(n));
  return sign + '$' + a.toLocaleString('en-US');
};
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

/* week just ended (Mon..Sun), and the week before it */
const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const dow = (today.getDay() + 6) % 7;
const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - dow);
const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
const weekEnd = new Date(thisMonday);                       // exclusive end of the week just ended
const prevWeekStart = new Date(lastMonday); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
const weekEnding = new Date(thisMonday); weekEnding.setDate(weekEnding.getDate() - 1);

const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
const monthEndEx = new Date(today.getFullYear(), today.getMonth() + 1, 1);
const daysInMonth = Math.round((monthEndEx - monthStart) / 86400000);
const dayOfMonth = today.getDate();
const pacePct = Math.round((dayOfMonth / daysInMonth) * 100);
const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const prevMonthSamePoint = new Date(today.getFullYear(), today.getMonth() - 1, Math.min(dayOfMonth, 28) + 1);

/* ------------------------------------------------------------------ KPIs */
const KPI = { utility: 'text', engineer: 'person', date: 'date4',
              incentive: 'numbers_2', hbsShare: 'dup__of_incentive', savings: 'numbers5' };

const kpiItems = await fetchBoard(BOARD_KPI, Object.values(KPI));
const kpis = kpiItems.map(it => ({
  milestone: it.group.title,
  utility: get(it, KPI.utility),
  engineers: listOf(it, KPI.engineer),
  when: dparse(get(it, KPI.date)),
  incentive: numOf(it, KPI.incentive),
  hbsShare: numOf(it, KPI.hbsShare),
  savings: numOf(it, KPI.savings),
})).filter(k => k.when);

const MILESTONES = ['Audits Performed', 'Preapprovals Submitted', 'Preapprovals Received',
  'Implementations Scheduled', 'Closeouts Submitted', 'Closeouts Received'];

const sum = rows => rows.reduce((a, k) => ({
  n: a.n + 1, incentive: a.incentive + k.incentive, hbsShare: a.hbsShare + k.hbsShare, savings: a.savings + k.savings,
}), { n: 0, incentive: 0, hbsShare: 0, savings: 0 });

const lastWeek = kpis.filter(k => inR(k.when, lastMonday, weekEnd));
const weekBefore = kpis.filter(k => inR(k.when, prevWeekStart, lastMonday));
const mtd = kpis.filter(k => inR(k.when, monthStart, monthEndEx));
const lastMtd = kpis.filter(k => inR(k.when, prevMonthStart, prevMonthSamePoint));

/* ------------------------------------------------------------------ blockers */
const C = { icfEng: 'dropdown_mm5wqe1v', hbsEng: 'multiple_person_mm5x8h0r', phase: 'color_mm5wyfg2',
            status: 'status', aging: 'formula_mm6c5jr1', daysPhase: 'formula_mm6cpemz',
            utility: 'dropdown_mm5w3gg4', notes: 'long_text_mm5wn8nj' };
const T = { status: 'status', rel: 'board_relation_mm5xccpb', paLead: 'people', coLead: 'people__1',
            auditor: 'person', adminNotes: 'long_text' };

const icfItems = await fetchBoard(BOARD_ICF, Object.values(C));
const tuItems = await fetchBoard(BOARD_TU, Object.values(T));

const tuByIcf = new Map();
for (const t of tuItems) {
  const rel = t.column_values.find(v => v.id === T.rel);
  const ids = rel && Array.isArray(rel.linked_item_ids) ? rel.linked_item_ids.map(String) : [];
  for (const id of ids) if (!tuByIcf.has(id)) tuByIcf.set(id, t);
}

const projects = icfItems.map(it => {
  const tu = tuByIcf.get(String(it.id)) || null;
  const tuStatus = tu ? get(tu, T.status) : '';
  const icfStatus = get(it, C.status);
  const dip = parseFloat(get(it, C.daysPhase));
  return {
    name: it.name,
    phase: get(it, C.phase),
    utility: get(it, C.utility),
    icfStatus, tuStatus,
    aging: get(it, C.aging),
    daysInPhase: Number.isFinite(dip) ? dip : null,
    hbsEngs: listOf(it, C.hbsEng),
    icfEngs: listOf(it, C.icfEng),
    leads: tu ? [...listOf(tu, T.paLead), ...listOf(tu, T.coLead), ...listOf(tu, T.auditor)] : [],
    note: tu ? (get(tu, T.adminNotes).split(/\r?\n/).map(x => x.trim()).filter(Boolean)[0] || '') : '',
  };
});

const rfis = projects.filter(p => p.tuStatus === 'TRC/ICF RFI Received' ||
  p.icfStatus === 'RFI Sent to HBS' || p.icfStatus === 'RFI Respond by HBS');
const flawed = projects.filter(p => /Flawed|FLAWED/.test(p.tuStatus + ' ' + p.icfStatus));
const cdToSubmit = projects.filter(p => p.tuStatus === 'CD to Submit');
const implDone = projects.filter(p => p.tuStatus === 'Implementation & MV Complete');
const ageing = projects.filter(p => p.aging === 'Critical');
const noOwner = projects.filter(p => !p.hbsEngs.length && p.phase !== 'Completed Project');

/* ------------------------------------------------------------------ workload */
const W = { due: 'date4', done: 'date_mkv5c7c0', status: 'color_mkve3fp3' };
const [paWork, coWork] = await Promise.all([
  fetchBoard(BOARD_PA_WORK, Object.values(W)),
  fetchBoard(BOARD_CO_WORK, Object.values(W)),
]);
const openTodos = [];
for (const [items, kind] of [[paWork, 'Pre-approval'], [coWork, 'Closeout']]) {
  for (const it of items) {
    const g = it.group.title;
    if (g === 'Completed' || g === 'Cancelled') continue;
    if (get(it, W.done)) continue;
    const st = get(it, W.status);
    if (st === 'Done' || st === 'Cancelled') continue;
    const due = dparse(get(it, W.due));
    openTodos.push({ name: it.name, person: g === "RFI's to Answer" ? 'RFI queue' : g, kind, due, overdue: !!(due && due < today) });
  }
}
const overdue = openTodos.filter(t => t.overdue);

/* ------------------------------------------------------------------ projections */
const projectionRows = [];
const monthLabel = monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' });
const monthLabelAlt = monthStart.toLocaleString('en-US', { month: 'short', year: 'numeric' });
for (const b of PROJECTION_BOARDS) {
  try {
    const items = await fetchBoard(b.id, ['formula', 'numbers3', 'date', 'status'], 12);
    const thisMonth = items.filter(it => {
      const g = (it.group.title || '').toLowerCase();
      return g === monthLabel.toLowerCase() || g === monthLabelAlt.toLowerCase() ||
             g.startsWith(monthStart.toLocaleString('en-US', { month: 'long' }).toLowerCase() + ' ' + monthStart.getFullYear());
    });
    const projected = thisMonth.reduce((a, it) => a + numOf(it, 'formula'), 0);
    const billed = items.reduce((a, it) => {
      const d = dparse(get(it, 'date'));
      return inR(d, monthStart, monthEndEx) ? a + numOf(it, 'numbers3') : a;
    }, 0);
    projectionRows.push({ label: b.label, count: thisMonth.length, projected, billed });
  } catch (e) {
    projectionRows.push({ label: b.label, error: String(e.message).slice(0, 90) });
  }
}

/* ------------------------------------------------------------------ compose */
const L = [];
const wkEnding = weekEnding.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

L.push('HBS Engineering - Weekly Execution Update');
L.push(`Week Ending ${wkEnding}`);
L.push('');
L.push('Team,');
L.push('');
L.push(`We are ${dayOfMonth} days into a ${daysInMonth}-day month - about ${pacePct}% of ${monthStart.toLocaleString('en-US', { month: 'long' })} has passed.`);
L.push('This is the execution side of the scoreboard: what actually moved through the');
L.push('funnel, what is blocked, and what has to happen this week.');
L.push('');

L.push('WHAT MOVED LAST WEEK');
L.push('');
L.push(`  ${pad('Milestone', 30)}${rpad('Last wk', 9)}${rpad('Prior wk', 10)}${rpad('Change', 9)}${rpad('MTD', 8)}`);
L.push('  ' + '-'.repeat(66));
for (const m of MILESTONES) {
  const a = lastWeek.filter(k => k.milestone === m).length;
  const b = weekBefore.filter(k => k.milestone === m).length;
  const c = mtd.filter(k => k.milestone === m).length;
  const d = a - b;
  L.push(`  ${pad(m, 30)}${rpad(a, 9)}${rpad(b, 10)}${rpad(d > 0 ? '+' + d : d === 0 ? '-' : d, 9)}${rpad(c, 8)}`);
}
const wkAll = sum(lastWeek), pwAll = sum(weekBefore), mAll = sum(mtd), lmAll = sum(lastMtd);
L.push('  ' + '-'.repeat(66));
L.push(`  ${pad('TOTAL', 30)}${rpad(wkAll.n, 9)}${rpad(pwAll.n, 10)}${rpad(wkAll.n - pwAll.n > 0 ? '+' + (wkAll.n - pwAll.n) : (wkAll.n - pwAll.n) || '-', 9)}${rpad(mAll.n, 8)}`);
L.push('');

L.push('VALUE BANKED');
L.push('');
L.push(`  Last week      ${money(wkAll.incentive)} incentive - ${money(wkAll.hbsShare)} HBS share - ${Math.round(wkAll.savings).toLocaleString('en-US')} kWh/therms`);
L.push(`  Month to date  ${money(mAll.incentive)} incentive - ${money(mAll.hbsShare)} HBS share - ${Math.round(mAll.savings).toLocaleString('en-US')} kWh/therms`);
L.push(`  Same point last month  ${money(lmAll.incentive)} incentive across ${lmAll.n} milestones`);
const mDelta = mAll.incentive - lmAll.incentive;
L.push(`  Month on month  ${mDelta >= 0 ? '+' : ''}${money(mDelta)}`);
L.push('');

if (projectionRows.some(r => !r.error)) {
  L.push(`CLOSEOUT PROJECTIONS - ${monthLabel}`);
  L.push('');
  L.push(`  ${pad('Programme', 24)}${rpad('Projects', 10)}${rpad('Projected', 14)}${rpad('Invoiced MTD', 15)}`);
  L.push('  ' + '-'.repeat(63));
  let tp = 0, tb = 0, tc = 0;
  for (const r of projectionRows) {
    if (r.error) { L.push(`  ${pad(r.label, 24)}${rpad('unreadable', 10)}`); continue; }
    tp += r.projected; tb += r.billed; tc += r.count;
    L.push(`  ${pad(r.label, 24)}${rpad(r.count, 10)}${rpad(money(r.projected), 14)}${rpad(money(r.billed), 15)}`);
  }
  L.push('  ' + '-'.repeat(63));
  L.push(`  ${pad('TOTAL', 24)}${rpad(tc, 10)}${rpad(money(tp), 14)}${rpad(money(tb), 15)}`);
  L.push('');
  L.push('  Projected is this month\'s group on each Projections/Actuals board.');
  L.push('  Invoiced MTD is Invoice to Date where the Billed Date falls this month.');
  L.push('');
}

L.push('WHAT IS BLOCKING US');
L.push('');
L.push(`  RFIs outstanding with HBS         ${rfis.length}`);
L.push(`  Flawed in portal                  ${flawed.length}`);
L.push(`  Implementation done, closeout owed ${implDone.length}`);
L.push(`  Closeout docs ready to submit      ${cdToSubmit.length}`);
L.push(`  Ageing past 60 days                ${ageing.length}`);
L.push(`  No HBS engineer assigned           ${noOwner.length}`);
L.push(`  Overdue workload items             ${overdue.length} of ${openTodos.length} open`);
L.push('');

if (rfis.length) {
  L.push(`RFIs TO CLEAR (${rfis.length})`);
  for (const p of rfis.slice(0, 15)) {
    L.push(`  * ${p.name}${p.utility ? ` (${p.utility})` : ''} - ${p.hbsEngs.join(', ') || p.leads[0] || 'UNASSIGNED'}`);
  }
  if (rfis.length > 15) L.push(`  ... and ${rfis.length - 15} more`);
  L.push('');
}

if (implDone.length || cdToSubmit.length) {
  const ready = [...implDone, ...cdToSubmit];
  L.push(`CLOSEOUTS READY TO MOVE (${ready.length})`);
  L.push('  These are the fastest path from work done to money invoiced.');
  for (const p of ready.slice(0, 15)) {
    L.push(`  * ${p.name} - ${p.tuStatus} - ${p.hbsEngs.join(', ') || p.leads[0] || 'UNASSIGNED'}`);
  }
  if (ready.length > 15) L.push(`  ... and ${ready.length - 15} more`);
  L.push('');
}

/* per-engineer throughput */
const byEng = new Map();
for (const k of lastWeek) for (const n of (k.engineers.length ? k.engineers : ['Unassigned'])) {
  byEng.set(n, (byEng.get(n) || 0) + 1);
}
const engRows = [...byEng.entries()].sort((a, b) => b[1] - a[1]);
if (engRows.length) {
  L.push('MILESTONES BY ENGINEER - LAST WEEK');
  L.push('');
  for (const [n, c] of engRows) {
    const od = overdue.filter(t => n.startsWith(t.person) || t.person === n.split(' ')[0]).length;
    L.push(`  ${pad(n, 26)}${rpad(c, 4)}${od ? `   (${od} overdue workload item${od > 1 ? 's' : ''})` : ''}`);
  }
  L.push('');
}

if (ageing.length) {
  L.push(`OLDEST STUCK PROJECTS (${ageing.length} past 60 days)`);
  for (const p of ageing.sort((a, b) => (b.daysInPhase || 0) - (a.daysInPhase || 0)).slice(0, 10)) {
    L.push(`  * ${p.name} - ${p.daysInPhase ?? '?'} days in ${p.phase} - ${p.hbsEngs.join(', ') || 'UNASSIGNED'}`);
  }
  L.push('');
}

L.push('THIS WEEK');
L.push('');
const asks = [];
if (rfis.length) asks.push(`Clear the ${rfis.length} outstanding RFI${rfis.length > 1 ? 's' : ''} - ${rfis.length > 1 ? 'they block' : 'it blocks'} ICF review on everything behind ${rfis.length > 1 ? 'them' : 'it'}.`);
if (implDone.length + cdToSubmit.length) {
  const n = implDone.length + cdToSubmit.length;
  asks.push(`Push the ${n} closeout${n > 1 ? 's' : ''} that ${n > 1 ? 'are' : 'is'} ready into the portal.`);
}
if (flawed.length) asks.push(`Correct and resubmit the ${flawed.length} flawed application${flawed.length > 1 ? 's' : ''}.`);
if (noOwner.length) asks.push(`Assign an HBS engineer to the ${noOwner.length} project${noOwner.length > 1 ? 's' : ''} that ${noOwner.length > 1 ? 'have' : 'has'} none.`);
if (overdue.length) asks.push(`Close out or re-date the ${overdue.length} overdue workload item${overdue.length > 1 ? 's' : ''}.`);
if (!asks.length) asks.push('Nothing is flagged as blocked - keep the current work moving.');
asks.forEach((a, i) => L.push(`  ${i + 1}. ${a}`));
L.push('');
L.push('Thanks all,');
L.push('Ameya');
L.push('');
L.push('---');
L.push('Compiled automatically from the monday.com trackers, workload boards,');
L.push('Monthly KPIs and Projections/Actuals boards.');

const warnings = [];
if (!projects.length) warnings.push('No projects read from the ICF/HBS tracker - do not send.');
if (!kpis.length) warnings.push('No KPI rows read - the movement numbers will all be zero.');

const out = {
  weekEnding: wkEnding,
  subject: `HBS Engineering - Weekly Execution Update - week ending ${wkEnding}`,
  suggestedTo: SUGGESTED_TO,
  body: L.join('\n'),
  stats: {
    projects: projects.length, kpiRows: kpis.length,
    lastWeekMilestones: wkAll.n, mtdMilestones: mAll.n,
    rfis: rfis.length, flawed: flawed.length, ageing: ageing.length,
    openTodos: openTodos.length, overdue: overdue.length,
  },
  warnings,
};

if ((process.env.UPDATE_MODE || '') === 'summary') {
  console.log(JSON.stringify(out.stats, null, 1));
  console.log('\nwarnings:', out.warnings.length ? out.warnings.join(' | ') : 'none');
  console.log('\n' + out.body);
} else {
  console.log(JSON.stringify(out, null, 1));
}
