/**
 * Weekly per-engineer digest builder.
 *
 * Runs inside the monday.com `execute_code` sandbox (which is already
 * authenticated against the account) and prints a JSON envelope describing
 * exactly which emails should be sent. It sends nothing itself — the calling
 * Claude session does the sending through Outlook, so every outgoing message
 * is visible in the transcript.
 *
 * Output shape:
 *   { generatedAt, weekOf, perEngineer: [{ to, name, org, subject, body, counts }],
 *     rollup: { to: [...], subject, body }, unroutable: [...], warnings: [...] }
 *
 * Keep the stage and action rules here in step with tracker/pipeline-dashboard.html.
 */

const API = 'https://api.monday.com/v2';
const BOARD_ICF = '18424932045';   // ICF/HBS Project Tracker
const BOARD_TU  = '1069746645';    // Master TU Tracker

/* ------------------------------------------------------------------ config */

/* Roll-up recipients — the all-engineers summary. */
const ROLLUP_TO = [
  'aupad@hbssolutionsinc.com',        // Ameya Upadhyay
  'dgoforth@hbssolutionsinc.com',     // Devon Goforth
  'mcosta@hbssolutionsinc.com',       // Michael Costa
  'drodriguez@hbssolutionsinc.com',   // David Rodriguez
  'hhaywood@hbssolutionsinc.com',     // Harry Haywood
];

/**
 * ICF engineers appear on the board as a dropdown of first names, so they
 * cannot be resolved to an address automatically. Only names listed here are
 * emailed directly; every other ICF name still appears in the roll-up.
 * Leave a name out rather than guessing — a wrong match sends one engineer's
 * project list to a different company.
 */
/* Addresses for the reviewers named on the board's ICF Engineer dropdown.
   They span three outside companies — ICF, ESAI and MD Energy Advisors — so the
   name is historical; every one of them is external, and the same restriction
   applies to all: a digest bound for any of these may use only the shared
   ICF/HBS board, never the HBS-internal boards, notes, chatter or commercials.

   Confirmed by Ameya, 2026-08-24. Never add an address from a first-name
   guess — only from a confirmed source. */
const ICF_EMAILS = {
  // icf.com
  'Jason':     'jason.frazier@icf.com',
  'Jose':      'josemaria.navarronava@icf.com',
  'Nail':      'nail.rachidi@icf.com',
  'Darren':    'darren.gest@icf.com',
  'Victoria':  'victoria.browning@icf.com',

  // esai.technology
  'Ven':       'ven@esai.technology',
  'Kirti':     'kirti@esai.technology',
  'Devashis':  'dev@esai.technology',

  // mdenergyadvisors.com
  'Daniel':    'dyoo@mdenergyadvisors.com',
  'Devin':     'drohan@mdenergyadvisors.com',
  'Priscille': 'petoughe@mdenergyadvisors.com',
};

/* Some dropdown values name a group rather than a person. Expand them to the
   people who actually do the work, so those projects reach someone. */
const ICF_GROUPS = {
  'ESAI Team':               ['Devashis', 'Ven', 'Kirti'],
  'Centralized Engineering': ['Jason'],   // no address of their own; Jason covers it
};

/* Values that mean "no reviewer yet" rather than naming anyone. Projects
   carrying these are counted as unassigned and reported to management, never
   emailed to a reviewer. */
const ICF_UNASSIGNED = new Set(['TBD']);

/* Named, with an address, but not on the board's dropdown — so no project maps
   to them and no digest can be addressed to them. Held here, not used. Add them
   to the ICF Engineer dropdown and assign work before enabling. */
const UNMAPPED_REVIEWERS = {
  'Justin': 'justin.lee@icf.com',
  'Junior': 'junior.myrie@icf.com',
};

/* Expand a project's ICF Engineer value into real people, and say whether it
   was left unassigned. Returns { names, unassigned }. */
function expandReviewers(names) {
  const out = [];
  let unassigned = false;
  for (const n of names) {
    if (!n) continue;
    if (ICF_UNASSIGNED.has(n)) { unassigned = true; continue; }
    const group = ICF_GROUPS[n];
    if (group) { out.push(...group); continue; }
    out.push(n);
  }
  return { names: [...new Set(out)], unassigned: unassigned || out.length === 0 };
}



/* Board labels that are placeholders, not people. Never addressed, never greeted. */
/* Values that name nobody. The group labels are expanded upstream by
   expandReviewers, so they never reach here. */
const NOT_A_PERSON = new Set(['TBD', 'N/A', 'NONE', 'None', '---']);

/* ------------------------------------------------------------------ columns */
const C = {
  projectId: 'text_mm5wf2g3', icfEng: 'dropdown_mm5wqe1v', hbsEng: 'multiple_person_mm5x8h0r',
  utility: 'dropdown_mm5w3gg4', type: 'color_mm5wrty9', phase: 'color_mm5wyfg2', status: 'status',
  dSubPA: 'date_mm5wscn8', dPAd: 'date_mm5wndmw', dSubCO: 'date_mm5wsmw5', dCOd: 'date_mm5w35b6',
  dNextAct: 'date_mm5yw32z', notes: 'long_text_mm5wn8nj', aging: 'formula_mm6c5jr1', daysPhase: 'formula_mm6cpemz',
};
const T = {
  status: 'status', sowStatus: 'color_mm47r8nd', dAudit: 'date_mkrvfahg', dImpl: 'date_mm4b5x2',
  dSowClient: 'date_mm5rd9h7', dSowRahls: 'date_mm5r3pk9', dSowSigned: 'date73', dSignedPA: 'date1',
  auditor: 'person', paLead: 'people', coLead: 'people__1', dealOwner: 'multiple_person_mkwfm19x',
  reviewEng: 'dropdown_mm4bc2hd', adminNotes: 'long_text', aiSummary: 'text_mm4jb8gz', rel: 'board_relation_mm5xccpb',
};

const STAGES = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'audited',   label: 'Audited' },
  { key: 'preapp',    label: 'Pre-approved' },
  { key: 'sowSent',   label: 'SOW sent' },
  { key: 'sowSigned', label: 'SOW signed' },
  { key: 'impl',      label: 'Implementation scheduled' },
  { key: 'coSched',   label: 'Closeout scheduled' },
  { key: 'coDone',    label: 'Closeout completed' },
  { key: 'payment',   label: 'Payment' },
];

const TU_ACTIONS = {
  'Not Started': { need: 'Kick the project off — nothing has started yet', role: 'hbs' },
  'Audit Ready to Schedule': { need: 'Schedule the site audit with the customer', role: 'auditor' },
  'Scheduled': { need: 'Carry out the scheduled site audit', role: 'auditor' },
  'Re-Audit Needed': { need: 'Re-audit the site — the first audit was not sufficient', role: 'auditor', sev: 'serious' },
  'Audit Phase Complete': { need: 'Build and submit the pre-approval application', role: 'paLead' },
  'PA Submitted': { need: 'Waiting on ICF pre-approval review', role: 'icf' },
  'PA Received': { need: 'Pre-approval in hand — schedule implementation', role: 'hbs' },
  'Signed PA/RA Needed': { need: 'Get the signed PA/RA back from the customer', role: 'hbs', sev: 'warning' },
  'Signed SOW Received': { need: 'SOW signed — move into implementation scheduling', role: 'hbs' },
  'Sent for Review/QAQC': { need: 'Internal QA/QC review before submission', role: 'paLead' },
  'Review sent back for corrections': { need: 'Apply the QA/QC corrections and resubmit', role: 'paLead', sev: 'warning' },
  'Implementation Ready to Schedule': { need: 'Schedule the implementation crew', role: 'hbs' },
  'Implementation & MV Complete': { need: 'Assemble and submit the closeout package', role: 'coLead' },
  'CD to Submit': { need: 'Submit the closeout documentation', role: 'coLead' },
  'CO Submitted': { need: 'Waiting on ICF closeout review', role: 'icf' },
  'CO Received': { need: 'Closeout approved — raise the invoice', role: 'hbs' },
  'CO Processed/Need Signed PA/RA': { need: 'Closeout processed, but the signed PA/RA is still outstanding', role: 'hbs', sev: 'warning' },
  'Ready for Invoice': { need: 'Raise the invoice', role: 'hbs' },
  'Invoiced': { need: 'Waiting on payment', role: 'hbs' },
  'Complete/Paid': { need: 'Complete and paid', role: null, sev: 'good' },
  'TRC/ICF RFI Received': { need: 'Respond to the ICF/TRC RFI', role: 'hbs', sev: 'critical' },
  'TRC/ICF RFI Responded': { need: 'RFI answered — waiting on ICF to re-review', role: 'icf' },
  'Waiting on Info/Others': { need: 'Chase the outstanding information', role: 'hbs', sev: 'warning' },
  'Action Needed from HBS': { need: 'HBS action outstanding', role: 'hbs', sev: 'critical' },
  'FLAWED in Portal': { need: 'Application is flawed in the portal — correct and resubmit', role: 'hbs', sev: 'critical' },
  'EC Motors Needed': { need: 'Source EC motors before implementation can proceed', role: 'hbs', sev: 'warning' },
  'Pre/Post Inspecting Pending': { need: 'Schedule the pre/post inspection', role: 'hbs' },
  'Pre/Post Inspecting Scheduled': { need: 'Carry out the scheduled pre/post inspection', role: 'hbs' },
  'Pre/Post Inspection Completed': { need: 'Inspection done — submit the results', role: 'hbs' },
  'In Progress': { need: 'Work in progress', role: 'hbs' },
  'Stuck': { need: 'Blocked — needs unblocking', role: 'hbs', sev: 'critical' },
  'On Hold': { need: 'On hold', role: null },
  'Cancelled': { need: 'Cancelled', role: null },
};
const ICF_ACTIONS = {
  'RFI Sent to HBS': { need: 'ICF has raised an RFI — HBS response owed', role: 'hbs', sev: 'critical' },
  'RFI Respond by HBS': { need: 'RFI response owed back to ICF', role: 'hbs', sev: 'critical' },
  'Technical Review': { need: 'ICF technical review under way', role: 'icf' },
  'Post-Tech Review': { need: 'ICF post-technical review', role: 'icf' },
  'Flawed': { need: 'Flawed — correct the application and resubmit', role: 'hbs', sev: 'critical' },
  'Flawed ARC': { need: 'ARC flawed — correct and resubmit', role: 'hbs', sev: 'critical' },
  'ARC': { need: 'ARC review with ICF', role: 'icf' },
  'Install': { need: 'Installation under way on site', role: 'hbs' },
  'App Complete': { need: 'Application complete', role: 'icf' },
  'Site Inspection Pending': { need: 'Site inspection still needs scheduling', role: 'hbs', sev: 'warning' },
  'Site Inspection Scheduled': { need: 'Site inspection is scheduled', role: 'hbs' },
  'Site Inspection Completed': { need: 'Site inspection done — awaiting ICF', role: 'icf' },
  'Final Project Approval': { need: 'Awaiting final project approval', role: 'icf' },
  'Internal Update Required': { need: 'Internal update required before ICF can proceed', role: 'hbs', sev: 'warning' },
  'Payment Processing': { need: 'Payment processing', role: 'hbs' },
  'Payment Ready': { need: 'Ready for payment', role: 'hbs' },
  'Invoice Sent': { need: 'Invoice sent — awaiting payment', role: 'hbs' },
  'Pre-approval': { need: 'In pre-approval with ICF', role: 'icf' },
  'On Hold': { need: 'On hold', role: null },
};
const PHASE_FALLBACK = {
  'Audit Phase': { need: 'Audit phase — confirm the audit is scheduled', role: 'auditor' },
  'Pre-Approval Phase': { need: 'Pre-approval phase — progress the application', role: 'paLead' },
  'Implementation Phase': { need: 'Implementation phase — progress the install', role: 'hbs' },
  'Closeout Phase': { need: 'Closeout phase — progress the closeout package', role: 'coLead' },
  'Payment Processing': { need: 'Payment processing', role: 'hbs' },
  'Completed Project': { need: 'Complete', role: null, sev: 'good' },
};

const SOW_SENT_LABELS = new Set(['Sent to Client / CGS', "Approved by Rahl's", "Sent to Rahl's", 'SOW Call Scheduled', 'SOW Call Complete']);
const SOW_SIGNED_LABELS = new Set(['Signed SOW received']);
const PAYMENT_STATUS = new Set(['Ready for Invoice', 'Invoiced', 'Complete/Paid']);
const PAYMENT_ICF = new Set(['Payment Processing', 'Payment Ready', 'Invoice Sent']);
const POST_AUDIT = new Set(['Audit Phase Complete','PA Submitted','PA Received','Signed PA/RA Needed','Signed SOW Received',
  'Sent for Review/QAQC','Review sent back for corrections','Implementation Ready to Schedule','Implementation & MV Complete',
  'CD to Submit','CO Submitted','CO Received','CO Processed/Need Signed PA/RA','Ready for Invoice','Invoiced','Complete/Paid',
  'TRC/ICF RFI Received','TRC/ICF RFI Responded']);
const POST_AUDIT_PHASES = ['Pre-Approval Phase','Implementation Phase','Closeout Phase','Payment Processing','Completed Project'];

/* ------------------------------------------------------------------ fetch */
async function gql(query, variables) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'API-Version': '2024-10' },
    body: JSON.stringify({ query, variables }),
  });
  const b = await r.json();
  if (b.errors) throw new Error('monday GraphQL: ' + JSON.stringify(b.errors).slice(0, 900));
  if (!b.data) throw new Error('monday returned no data');
  return b.data;
}

const Q = `query($id: ID!, $cursor: String, $cols: [String!]) {
  boards(ids: [$id]) { items_page(limit: 250, cursor: $cursor) { cursor items {
    id name url group { title }
    column_values(ids: $cols) { id text ... on BoardRelationValue { linked_item_ids } } } } } }`;

async function fetchBoard(id, cols) {
  const items = []; let cursor = null;
  for (let i = 0; i < 20; i++) {
    const d = await gql(Q, { id, cursor, cols });
    const page = d.boards[0].items_page;
    items.push(...page.items);
    cursor = page.cursor;
    if (!cursor) break;
  }
  return items;
}

/* ------------------------------------------------------------------ helpers */
const cv = (it, id) => { const c = it.column_values.find(v => v.id === id); return c ? c : null; };
function txt(it, id) {
  const c = cv(it, id);
  const t = c && c.text ? String(c.text).trim() : '';
  return (!t || t === 'null' || t === 'Column value type is not supported') ? '' : t;
}
const list = (it, id) => { const s = txt(it, id); return s ? s.split(',').map(x => x.trim()).filter(Boolean) : []; };
function dparse(s) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(s || '')) return null;
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function latestNote(text) {
  if (!text) return '';
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length) return '';
  return lines.find(l => /^\d{1,2}[\/\-]\d{1,2}\b/.test(l)) || lines[0];
}
function weekRange(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7;
  const start = new Date(d); start.setDate(d.getDate() - dow);
  const end = new Date(d); end.setDate(end.getDate() + 1);
  const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
  return { start, end, prevStart, prevEnd: new Date(start) };
}
const inRange = (dt, a, b) => !!dt && dt >= a && dt < b;

/* ------------------------------------------------------------------ build */
const icfItems = await fetchBoard(BOARD_ICF, Object.values(C));
const tuItems  = await fetchBoard(BOARD_TU, Object.values(T));

const tuByIcf = new Map();
for (const t of tuItems) {
  const rel = cv(t, T.rel);
  const ids = rel && Array.isArray(rel.linked_item_ids) ? rel.linked_item_ids.map(String) : [];
  for (const id of ids) if (!tuByIcf.has(id)) tuByIcf.set(id, t);
}

const today = new Date(); today.setHours(0, 0, 0, 0);
const wk = weekRange(new Date());

const projects = icfItems.map(it => {
  const tu = tuByIcf.get(String(it.id)) || null;
  const g = id => (tu ? txt(tu, id) : '');
  const gl = id => (tu ? list(tu, id) : []);

  const phase = txt(it, C.phase), icfStatus = txt(it, C.status);
  const tuStatus = g(T.status), sowStatus = g(T.sowStatus);

  /* Group values expand to the people behind them; "TBD" means nobody yet. */
  const icfRaw = list(it, C.icfEng);
  const { names: icfEngs, unassigned: icfUnassigned } = expandReviewers(icfRaw);
  const hbsEngs = list(it, C.hbsEng);
  const auditor = gl(T.auditor), paLead = gl(T.paLead), coLead = gl(T.coLead), owner = gl(T.dealOwner);
  const revEng = gl(T.reviewEng).map(s => s.replace(/^ICF\s*-\s*/, '').replace(/^TRC\s*-\s*/, ''));

  const dAudit = dparse(g(T.dAudit));
  const dImpl = dparse(g(T.dImpl));
  const dPAd = dparse(txt(it, C.dPAd)) || dparse(g(T.dSignedPA));
  const dSubCO = dparse(txt(it, C.dSubCO));
  const dCOd = dparse(txt(it, C.dCOd));
  const dSowSent = dparse(g(T.dSowClient)) || dparse(g(T.dSowRahls));
  const dSowSign = dparse(g(T.dSowSigned));

  const paidNow = PAYMENT_STATUS.has(tuStatus) || PAYMENT_ICF.has(icfStatus) || phase === 'Payment Processing' || phase === 'Completed Project';
  const auditedNow = (dAudit && dAudit <= today) || POST_AUDIT.has(tuStatus) || POST_AUDIT_PHASES.includes(phase);

  const ev = {
    scheduled: dAudit, audited: auditedNow ? dAudit : null, preapp: dPAd,
    sowSent: dSowSent, sowSigned: dSowSign, impl: dImpl,
    coSched: dSubCO, coDone: dCOd, payment: paidNow ? dCOd : null,
  };

  let current = null;
  if (paidNow) current = 'payment';
  else if (dCOd || tuStatus === 'CO Received') current = 'coDone';
  else if (dSubCO || tuStatus === 'CO Submitted' || phase === 'Closeout Phase') current = 'coSched';
  else if (dImpl || phase === 'Implementation Phase' || icfStatus === 'Install' ||
           ['Implementation Ready to Schedule','Implementation & MV Complete','CD to Submit'].includes(tuStatus)) current = 'impl';
  else if (dSowSign || SOW_SIGNED_LABELS.has(sowStatus) || tuStatus === 'Signed SOW Received') current = 'sowSigned';
  else if (dSowSent || SOW_SENT_LABELS.has(sowStatus)) current = 'sowSent';
  else if (dPAd || tuStatus === 'PA Received' || phase === 'Pre-Approval Phase') current = 'preapp';
  else if (auditedNow) current = 'audited';
  else if (dAudit) current = 'scheduled';

  const rule = TU_ACTIONS[tuStatus] || ICF_ACTIONS[icfStatus] || PHASE_FALLBACK[phase] || null;
  const roleOwners = {
    auditor: auditor.length ? auditor : (hbsEngs.length ? hbsEngs : owner),
    paLead:  paLead.length  ? paLead  : (hbsEngs.length ? hbsEngs : owner),
    coLead:  coLead.length  ? coLead  : (hbsEngs.length ? hbsEngs : owner),
    hbs:     hbsEngs.length ? hbsEngs : (owner.length ? owner : paLead),
    icf:     icfEngs.length ? icfEngs : revEng,
  };
  const ownerNames = rule && rule.role ? (roleOwners[rule.role] || []) : [];

  const aging = txt(it, C.aging);
  const dip = parseFloat(txt(it, C.daysPhase));
  let sev = (rule && rule.sev) || null;
  if (!sev) sev = aging === 'Critical' ? 'serious' : aging === 'Watch' ? 'warning' : 'none';

  return {
    name: it.name, url: it.url, phase, icfStatus, tuStatus,
    projectId: txt(it, C.projectId), utility: txt(it, C.utility), type: txt(it, C.type),
    icfDates: {
      submittedPA: txt(it, C.dSubPA), paDate: txt(it, C.dPAd),
      submittedCO: txt(it, C.dSubCO), coDate: txt(it, C.dCOd),
      nextAction: txt(it, C.dNextAct),
    },
    icfEngs, icfRaw, icfUnassigned, hbsEngs, ev, current,
    need: rule ? rule.need : 'No status recorded — set a status on the board',
    ownerNames, sev, aging,
    daysInPhase: Number.isFinite(dip) ? dip : null,
    evidence: latestNote(g(T.adminNotes)) || latestNote(txt(it, C.notes)) || '',
    aiSummary: g(T.aiSummary),
  };
});

/* ------------------------------------------------------------------ digests */
/* ---------------------------------------------------------------------------
   ICF isolation.

   The ICF/HBS Project Tracker is the board ICF already shares with us. The
   Master TU Tracker is HBS-internal: SOW commercials (Rahl's, the client, CGS),
   internal QA/QC states, deal owners and a running admin-notes log. So an
   ICF-bound digest is built from the shared board ONLY — a whitelist, so a
   column added to the TU board later cannot leak by default.
--------------------------------------------------------------------------- */
function icfDigestBody(name, mine) {
  const rows = mine.map(p => ({
    name: p.name, projectId: p.projectId, utility: p.utility, type: p.type,
    phase: p.phase, status: p.icfStatus, d: p.icfDates,
    rule: ICF_ACTIONS[p.icfStatus] || null,
  }));
  const onIcf = rows.filter(r => r.rule && r.rule.role !== 'hbs');
  const onHbs = rows.filter(r => r.rule && r.rule.role === 'hbs');
  const quiet = rows.filter(r => !r.rule);

  const L = [];
  const first = /\s/.test(name) ? name.split(' ')[0] : name;
  L.push(`Hi ${first},`, '');
  L.push(`Here is the current state of the HBS projects assigned to you, as of ${new Date().toDateString()}.`, '');
  L.push(`${rows.length} project${rows.length === 1 ? '' : 's'}.`);
  const line = r => `  * ${r.name}${r.projectId ? ` (${r.projectId})` : ''} - ${r.status || r.phase}`;
  if (onIcf.length) {
    L.push('', `WITH ICF (${onIcf.length})`);
    for (const r of onIcf) { L.push(line(r)); L.push(`      ${r.rule.need}`); }
  }
  if (onHbs.length) {
    L.push('', `WITH HBS - WE OWE YOU A RESPONSE (${onHbs.length})`);
    for (const r of onHbs) { L.push(line(r)); L.push(`      ${r.rule.need}`); }
  }
  if (quiet.length) {
    L.push('', `NO OPEN ACTION (${quiet.length})`);
    for (const r of quiet) L.push(line(r));
  }
  const dated = rows.filter(r => r.d.submittedPA || r.d.paDate || r.d.submittedCO || r.d.coDate);
  if (dated.length) {
    L.push('', 'DATES ON RECORD');
    for (const r of dated) {
      const bits = [];
      if (r.d.submittedPA) bits.push(`PA submitted ${r.d.submittedPA}`);
      if (r.d.paDate) bits.push(`PA'd ${r.d.paDate}`);
      if (r.d.submittedCO) bits.push(`CO submitted ${r.d.submittedCO}`);
      if (r.d.coDate) bits.push(`CO'd ${r.d.coDate}`);
      L.push(`  * ${r.name} - ${bits.join(', ')}`);
    }
  }
  L.push('', 'Automated from the shared ICF/HBS Project Tracker.');
  return { text: L.join('\n'), counts: { active: rows.length, yours: onIcf.length, ageing: 0, moved: 0 } };
}

function digestBody(name, org, mine) {
  if (org === 'ICF') return icfDigestBody(name, mine);
  const owns = p => !p.ownerNames.length || p.ownerNames.includes(name);
  const moved = mine.filter(p => STAGES.some(s => inRange(p.ev[s.key], wk.prevStart, wk.end)));
  const yours = mine.filter(p => (p.sev === 'critical' || p.sev === 'serious') && owns(p));
  const waiting = mine.filter(p => p.sev === 'critical' && !owns(p));
  const ageing = mine.filter(p => p.aging === 'Critical' && !yours.includes(p));
  const rest = mine.filter(p => !yours.includes(p) && !waiting.includes(p) && !ageing.includes(p));

  const L = [];
  const first = /\s/.test(name) ? name.split(' ')[0] : name;
  L.push(`Hi ${first},`, '');
  L.push(`Here is where your ${org} tune-up projects stand as of ${new Date().toDateString()}.`, '');
  L.push(`You have ${mine.length} active project${mine.length === 1 ? '' : 's'}.`);

  const byStage = new Map();
  for (const p of mine) if (p.current) byStage.set(p.current, (byStage.get(p.current) || 0) + 1);
  if (byStage.size) {
    L.push('', 'WHERE THEY SIT');
    for (const s of STAGES) if (byStage.get(s.key)) L.push(`  ${s.label}: ${byStage.get(s.key)}`);
  }
  if (moved.length) {
    L.push('', `MOVED IN THE LAST WEEK (${moved.length})`);
    for (const p of moved) {
      const hit = STAGES.filter(s => inRange(p.ev[s.key], wk.prevStart, wk.end)).map(s => s.label).join(', ');
      L.push(`  * ${p.name} - ${hit}`);
    }
  }
  if (yours.length) {
    L.push('', `NEEDS YOUR ACTION (${yours.length})`);
    for (const p of yours) {
      L.push(`  * ${p.name}`, `      ${p.need}`);
      if (p.evidence) L.push(`      Latest: ${p.evidence.slice(0, 160)}`);
    }
  }
  if (waiting.length) {
    L.push('', `WAITING ON SOMEONE ELSE (${waiting.length})`);
    for (const p of waiting) L.push(`  * ${p.name} - ${p.need} (with ${p.ownerNames.join(', ')})`);
  }
  if (ageing.length) {
    L.push('', `AGEING PAST 60 DAYS (${ageing.length})`);
    for (const p of ageing) L.push(`  * ${p.name} - ${p.daysInPhase == null ? '?' : p.daysInPhase} days in ${p.phase} - ${p.need}`);
  }
  if (rest.length) {
    L.push('', `EVERYTHING ELSE (${rest.length})`);
    for (const p of rest) L.push(`  * ${p.name} - ${p.need}`);
  }
  L.push('', 'This is an automated weekly update built from the monday.com trackers.');
  L.push('Reply to Ameya if anything here looks wrong.');
  return { text: L.join('\n'), counts: { active: mine.length, yours: yours.length, ageing: ageing.length, moved: moved.length } };
}

const hbsNames = new Set(), icfNames = new Set();
for (const p of projects) {
  for (const n of p.hbsEngs) if (!NOT_A_PERSON.has(n)) hbsNames.add(n);
  for (const n of p.icfEngs) if (!NOT_A_PERSON.has(n)) icfNames.add(n);
}

/* HBS engineers are stored as real monday people, so their address is authoritative. */
const users = (await gql(`query { users(limit: 300) { name email enabled } }`)).users;
const byName = new Map(users.filter(u => u.email).map(u => [u.name.toLowerCase(), u.email]));

const perEngineer = [], unroutable = [], warnings = [];
const weekOf = wk.prevStart.toDateString();

for (const name of [...hbsNames].sort()) {
  const mine = projects.filter(p => p.hbsEngs.includes(name));
  const to = byName.get(name.toLowerCase()) || null;
  const d = digestBody(name, 'HBS', mine);
  const rec = { to, name, org: 'HBS', subject: `Your project update - week of ${weekOf}`, body: d.text, counts: d.counts };
  if (to) perEngineer.push(rec); else { unroutable.push({ name, org: 'HBS', reason: 'no monday user record with an email' }); }
}
for (const name of [...icfNames].sort()) {
  const mine = projects.filter(p => p.icfEngs.includes(name));
  const to = ICF_EMAILS[name] || null;
  const d = digestBody(name, 'ICF', mine);
  const rec = { to, name, org: 'ICF', subject: `Your project update - week of ${weekOf}`, body: d.text, counts: d.counts };
  if (to) perEngineer.push(rec);
  else unroutable.push({ name, org: 'ICF', reason: 'no address in ICF_EMAILS - included in the roll-up only', active: mine.length });
}

/* ------------------------------------------------------------------ roll-up */
function rollupBody() {
  const L = [];
  L.push(`ICF x HBS pipeline - week of ${weekOf}`, '');
  const stageOpen = new Map(), stageWeek = new Map();
  for (const p of projects) {
    if (p.current) stageOpen.set(p.current, (stageOpen.get(p.current) || 0) + 1);
    for (const s of STAGES) if (inRange(p.ev[s.key], wk.prevStart, wk.end)) stageWeek.set(s.key, (stageWeek.get(s.key) || 0) + 1);
  }
  L.push(`${projects.length} active projects.`, '');
  L.push('FUNNEL                          reached this week / open now');
  for (const s of STAGES) L.push(`  ${s.label.padEnd(28)} ${String(stageWeek.get(s.key) || 0).padStart(4)} / ${String(stageOpen.get(s.key) || 0).padStart(4)}`);

  const critical = projects.filter(p => p.sev === 'critical');
  const ageing = projects.filter(p => p.aging === 'Critical');
  const unassigned = projects.filter(p => !p.ownerNames.length && p.sev !== 'good');
  L.push('', `ACTION OWED: ${critical.length}   AGEING PAST 60 DAYS: ${ageing.length}   NO OWNER ON NEXT STEP: ${unassigned.length}`);

  /* Projects with no named reviewer reach nobody by email, so management is
     the only place they can surface. */
  const noReviewer = projects.filter(p => p.icfUnassigned);
  if (noReviewer.length) {
    const tbd = noReviewer.filter(p => p.icfRaw.includes('TBD')).length;
    L.push('', `NO ICF REVIEWER NAMED: ${noReviewer.length}  (${tbd} marked TBD, ${noReviewer.length - tbd} left blank)`);
    L.push('  These get no reviewer digest until someone is assigned on the board.');
    for (const p of noReviewer.sort((a, b) => b.priority - a.priority).slice(0, 10)) {
      L.push(`  * ${p.name} - ${p.phase}${p.icfStatus ? ' / ' + p.icfStatus : ''}`);
    }
    if (noReviewer.length > 10) L.push(`  ... and ${noReviewer.length - 10} more`);
  }

  L.push('', 'BY ENGINEER                     active  action owed  ageing');
  const rows = [];
  for (const [set, org] of [[hbsNames, 'HBS'], [icfNames, 'ICF']]) {
    for (const n of [...set].sort()) {
      const mine = projects.filter(p => (org === 'HBS' ? p.hbsEngs : p.icfEngs).includes(n));
      rows.push({ n, org, active: mine.length,
        owed: mine.filter(p => p.sev === 'critical').length,
        ageing: mine.filter(p => p.aging === 'Critical').length });
    }
  }
  rows.sort((a, b) => b.owed - a.owed || b.active - a.active);
  for (const r of rows) L.push(`  ${(r.n + ' (' + r.org + ')').padEnd(30)} ${String(r.active).padStart(5)} ${String(r.owed).padStart(11)} ${String(r.ageing).padStart(7)}`);

  if (critical.length) {
    L.push('', 'EVERY PROJECT WITH AN ACTION OWED');
    for (const p of critical.sort((a, b) => (b.daysInPhase || 0) - (a.daysInPhase || 0))) {
      L.push(`  * ${p.name}`);
      L.push(`      ${p.need} - ${p.ownerNames.length ? p.ownerNames.join(', ') : 'NOBODY ASSIGNED'}${p.daysInPhase != null ? ` (${p.daysInPhase}d)` : ''}`);
    }
  }
  const sent = perEngineer.filter(e => e.to).length;
  L.push('', `Individual digests sent to ${sent} engineer${sent === 1 ? '' : 's'}.`);
  if (unroutable.length) {
    L.push(`Not sent directly (no address on file): ${unroutable.map(u => u.name + ' (' + u.org + ')').join(', ')}.`);
  }
  L.push('', 'Automated from the monday.com ICF/HBS Project Tracker and Master TU Tracker.');
  return L.join('\n');
}

if (!projects.length) warnings.push('No projects were read from monday - do not send anything.');
if (perEngineer.some(e => !e.to)) warnings.push('A per-engineer record has no address; skip it.');

const envelope = {
  generatedAt: new Date().toISOString(),
  weekOf,
  projectCount: projects.length,
  perEngineer: perEngineer.filter(e => e.to),
  rollup: { to: ROLLUP_TO, subject: `ICF x HBS pipeline roll-up - week of ${weekOf}`, body: rollupBody() },
  unroutable,
  warnings,
};

/* DIGEST_MODE=summary prints a compact preview instead of the full send envelope.
   Use it to sanity-check a run without pulling every digest into the transcript. */
if ((process.env.DIGEST_MODE || '') === 'summary') {
  console.log(`projects=${envelope.projectCount}  week of ${envelope.weekOf}`);
  console.log(`would email ${envelope.perEngineer.length} engineers:`);
  for (const e of envelope.perEngineer) {
    console.log(`  ${e.org}  ${e.name.padEnd(20)} -> ${String(e.to).padEnd(34)} active=${e.counts.active} owed=${e.counts.yours} ageing=${e.counts.ageing} moved=${e.counts.moved} bodyChars=${e.body.length}`);
  }
  console.log(`\nnot routable (${envelope.unroutable.length}):`);
  for (const u of envelope.unroutable) console.log(`  ${u.org} ${u.name} - ${u.reason}${u.active ? ' (' + u.active + ' active)' : ''}`);
  console.log(`\nwarnings: ${envelope.warnings.length ? envelope.warnings.join(' | ') : 'none'}`);
  console.log(`\n--- roll-up to ${envelope.rollup.to.join(', ')} ---`);
  console.log(envelope.rollup.body);
  const sample = envelope.perEngineer.find(e => e.counts.yours > 0) || envelope.perEngineer[0];
  if (sample) {
    console.log(`\n--- sample individual digest: ${sample.name} (${sample.org}) -> ${sample.to} ---`);
    console.log(sample.body.slice(0, 2600));
  }
} else {
  console.log(JSON.stringify(envelope, null, 1));
}
