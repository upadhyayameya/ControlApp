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
/* The two boards where the work actually sits on someone's desk. Grouped by
   person, so the group title is the assignment. */
const BOARD_PA_WORK = '9889346356';   // Preapproval Workload
const BOARD_CO_WORK = '10030690180';  // Closeout Workload

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

/* ICF leads who do not review projects themselves, so they are not on the
   board's Engineer dropdown and no per-project digest can be addressed to
   them. Confirmed by Ameya: they do not need to be on the dropdown -- they
   get one portfolio summary from us instead. That summary is built from the
   shared board only, exactly like a reviewer's digest. */
const ICF_SUMMARY_TO = [
  'justin.lee@icf.com',      // Justin
  'junior.myrie@icf.com',    // Junior
];

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



/* ---------------------------------------------------------------------------
   The HBS engineering roster, confirmed by Ameya on 2026-08-25.

   The boards name far more people than the engineering team — deal owners,
   subcontracted auditors, project managers — and none of them should receive
   an engineer's weekly digest. Anyone not on this roster who still holds live
   projects is reported to management in the roll-up instead of being emailed.
--------------------------------------------------------------------------- */
const HBS_ROSTER = {
  'Soumya Agrawal':     { job: 'engineer' },
  'Vaidehi Bhirud':     { job: 'engineer' },
  'David Wilkinson':    { job: 'engineer' },
  'Andrew White':       { job: 'engineer' },
  'Patrick Lawson':     { job: 'engineer' },
  'Alex Catterton':     { job: 'engineer' },
  'Mili Nikitha':       { job: 'engineer' },
  'Ameya Upadhyay':     { job: 'engineer' },
  'Alejandro Espinoza': { job: 'engineer' },
  'Sebastian Winther':  { job: 'engineer' },
  'Kevin Guerra':       { job: 'engineer' },
  'Devin Simons':       { job: 'engineer' },

  'Tremayne Sams':      { job: 'auditor', title: 'Auditor' },

  /* Not engineering. They hold projects as owners, so their work is counted
     and reported, but only Steve is sent a weekly project list -- he manages
     the projects. Operations and sales have never received one and do not
     start receiving one by being named here. */
  'Steve Weaver':       { job: 'other', title: 'Project manager', digest: true },
  'Michael Costa':      { job: 'other', title: 'Operations director' },
  'David Rodriguez':    { job: 'other', title: 'Operations manager' },
  'John Rizzotti':      { job: 'other', title: 'Sales' },

  /* Has left HBS. Never emailed; her remaining projects are reported to
     management as needing a new owner rather than quietly disappearing. */
  'Allee Williams':     { job: 'engineer', left: true },
};
const onRoster   = n => Object.prototype.hasOwnProperty.call(HBS_ROSTER, n);
const hasLeft    = n => !!(HBS_ROSTER[n] && HBS_ROSTER[n].left);
const jobOf      = n => (HBS_ROSTER[n] && HBS_ROSTER[n].job) || '';
const jobTitle   = n => (HBS_ROSTER[n] && HBS_ROSTER[n].title) || '';
const isEngineer = n => jobOf(n) === 'engineer' && !hasLeft(n);
const isAuditor  = n => jobOf(n) === 'auditor' && !hasLeft(n);
/* Who a weekly project list is actually for. Gating on the roster alone would
   mean that recording somebody's job title started emailing them. */
const getsDigest = n => isEngineer(n) || isAuditor(n) || !!(HBS_ROSTER[n] && HBS_ROSTER[n].digest);

/* Devashis moved from HBS to ESAI, which reviews for ICF. He is one person and
   is emailed once, on the ICF side, at the ESAI address already in ICF_EMAILS.
   His older HBS auditor and PA-lead rows must not also generate an HBS digest.

   Devin is deliberately absent: Devin Rohan (MD Energy Advisors, reviewing for
   ICF) and Devin Simons (HBS) are two different people who share a first name.
   Confirmed by Ameya, 2026-08-25. */
const NOW_ICF_SIDE = new Set(['Devashis Shrestha', 'Devashis']);

/* Names the boards spell short. Kept identical to the dashboard's map so the
   two never disagree about who a person is. */
const NAME_ALIASES = { 'Devashis': 'Devashis Shrestha' };
const alias = n => NAME_ALIASES[String(n || '').trim()] || String(n || '').trim();

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
  /* The workload boards carry these only as mirrors; this is where they live. */
  source: 'dropdown', company: 'text_mkxpkdex', utility: 'text', type: 'type',
};

/* Both workload boards carry the same columns under different ids, so both
   are requested and whichever answers is used. */
const W = {
  dueDate: 'date4', due2: 'date_mkv5afd3', due3: 'date_mkv59n4q', done: 'date_mkv5c7c0',
  status: 'color_mkve3fp3', hours: 'numeric_mkwc48vb', rel: 'board_relation_mkv5tqg7',
};
const W_ADDED_PA = 'date_mm5w9q0r', W_ADDED_CO = 'date_mm5wyvbx';
const W_WAIT_PA  = 'formula_mm6jpnrw', W_WAIT_CO = 'formula_mm6jpkjk';

/* The columns the engineer actually reads on these boards -- Company, Utility,
   Type, Status, Source -- are mirrors of the project tracker behind each row.
   Over the raw API a mirror resolves through display_value, so they are read
   here directly rather than joined.

   That matters because the workload boards span three project trackers, not
   one: 33 of the open rows link to the BGE BPTU Tracker or Potomac Edison BTU
   rather than the Master TU Tracker, and a join to the TU tracker alone leaves
   exactly those rows blank. */
const M = {
  source:    'lookup_mkv5mm0j',
  companyPA: 'lookup_mkxpx9ek', companyCO: 'lookup_mm4j28m1',
  utility:   'lookup_mkv5hrrr',
  type:      'lookup_mkv5czwd',
  status:    'lookup_mkveq0p9',
  leadPA:    'lookup_mkve9p6e', leadCO: 'lookup_mkw54ks1',
};
const WORK_DONE_GROUPS = new Set(['Completed', 'Cancelled']);
const RFI_GROUP = "RFI's to Answer";

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

/* Formula columns return an empty `text` over the raw API — their value is in
   `display_value`, so both are requested and display_value wins. Without this
   the aging and days-in-phase columns silently read as blank on every project. */
const Q = `query($id: ID!, $cursor: String, $cols: [String!]) {
  boards(ids: [$id]) { items_page(limit: 250, cursor: $cursor) { cursor items {
    id name url group { title }
    column_values(ids: $cols) {
      id text
      ... on FormulaValue { display_value }
      ... on MirrorValue { display_value }
      ... on BoardRelationValue { linked_item_ids } } } } } }`;

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
  const raw = c ? (c.display_value != null && c.display_value !== '' ? c.display_value : c.text) : '';
  const t = raw ? String(raw).trim() : '';
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
const wCols = [...Object.values(W), W_ADDED_PA, W_ADDED_CO, W_WAIT_PA, W_WAIT_CO, ...Object.values(M)];
const [icfItems, tuItems, paWorkItems, coWorkItems] = await Promise.all([
  fetchBoard(BOARD_ICF, Object.values(C)),
  fetchBoard(BOARD_TU, Object.values(T)),
  fetchBoard(BOARD_PA_WORK, wCols),
  fetchBoard(BOARD_CO_WORK, wCols),
]);

const tuByIcf = new Map();
for (const t of tuItems) {
  const rel = cv(t, T.rel);
  const ids = rel && Array.isArray(rel.linked_item_ids) ? rel.linked_item_ids.map(String) : [];
  for (const id of ids) if (!tuByIcf.has(id)) tuByIcf.set(id, t);
}

const today = new Date(); today.setHours(0, 0, 0, 0);
const wk = weekRange(new Date());

const allProjects = icfItems.map(it => {
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
    group: (it.group && it.group.title) || '', tuGroup: (tu && tu.group && tu.group.title) || '',
    tuId: tu ? String(tu.id) : '',
    /* Someone can hold a project as its auditor, PA lead, CO lead or deal
       owner without ever appearing in the ICF board's HBS Engineer column.
       Digesting on that column alone left real work uncovered — Ameya and
       Tremayne between them lead hundreds of projects and received nothing. */
    hbsAll: [...new Set([...hbsEngs, ...auditor, ...paLead, ...coLead, ...owner])].filter(n => n && !NOT_A_PERSON.has(n)),
    icfEngs, icfRaw, icfUnassigned, hbsEngs, ev, current,
    need: rule ? rule.need : 'No status recorded — set a status on the board',
    ownerNames, sev, aging,
    daysInPhase: Number.isFinite(dip) ? dip : null,
    evidence: latestNote(g(T.adminNotes)) || latestNote(txt(it, C.notes)) || '',
    aiSummary: g(T.aiSummary),
  };
});

/* ---------------------------------------------------------------------------
   Cancelled and completed projects leave the digest.

   Same rule as the dashboard (pipeline-dashboard.html): a project nobody can
   act on is noise in someone's Monday inbox, and counting it inflates every
   "active" figure in the roll-up. Both boards can retire a project — the TU
   status, the ICF phase, or either board's group — so all of them are checked.
--------------------------------------------------------------------------- */
function lifecycle(p) {
  if (p.tuStatus === 'Cancelled' || p.group === 'Cancelled Projects' || p.tuGroup === 'Cancelled Projects') return 'cancelled';
  if (p.phase === 'Completed Project' || p.group === 'Completed Projects' ||
      p.tuGroup === 'Completed Projects' || p.tuStatus === 'Complete/Paid') return 'completed';
  return 'active';
}
const retired = { cancelled: 0, completed: 0 };
for (const p of allProjects) { const l = lifecycle(p); if (l !== 'active') retired[l]++; }
const projects = allProjects.filter(p => lifecycle(p) === 'active');

/* ---------------------------------------------------------------------------
   The workload boards: what is actually on someone's desk this week.

   The pipeline boards say where a project has got to. They do not say who is
   sitting with the work right now — that lives on the Preapproval and Closeout
   Workload boards, where the group title IS the assignment. A digest built
   from the pipeline alone tells an engineer about projects while staying
   silent on the queue they are judged by, so both go in.

   Group titles there are first names ("Soumya"), while the pipeline boards
   carry full names ("Soumya Agrawal"). Resolving one to the other is what
   stops the same person being emailed as two people. A first name is only
   resolved when it lands on exactly one full name, preferring the roster —
   an ambiguous first name is left as it is rather than guessed at.
--------------------------------------------------------------------------- */
let canonMap = null;
function buildCanonMap() {
  const full = new Set();
  for (const p of allProjects) for (const n of p.hbsAll) if (/\s/.test(n)) full.add(n);
  const byFirst = new Map();
  for (const n of full) {
    const k = n.split(/\s+/)[0].toLowerCase();
    if (!byFirst.has(k)) byFirst.set(k, []);
    byFirst.get(k).push(n);
  }
  const m = new Map();
  for (const [k, names] of byFirst) {
    /* Narrowest true answer wins. "David" is David Wilkinson and David
       Rodriguez, but only one of them does the work these boards track, so
       preferring the people who do it resolves the name instead of giving up
       on it. Still ambiguous after that: left alone rather than guessed. */
    let pick = names.length === 1 ? names[0] : null;
    for (const pool of [names.filter(n => isEngineer(n) || isAuditor(n)), names.filter(onRoster)]) {
      if (pick) break;
      if (pool.length === 1) pick = pool[0];
    }
    if (pick) m.set(k, pick);
  }
  return m;
}
function canonName(raw) {
  const name = alias(String(raw || '').trim());
  if (!name || /\s/.test(name)) return name;
  if (!canonMap) canonMap = buildCanonMap();
  return canonMap.get(name.toLowerCase()) || name;
}

const tuById = new Map(tuItems.map(t => [String(t.id), t]));
const numStr = v => {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const workTasks = [];
for (const [items, kind] of [[paWorkItems, 'Pre-approval'], [coWorkItems, 'Closeout']]) {
  for (const it of items) {
    const group = (it.group && it.group.title) || '';
    const st = txt(it, W.status);
    /* Finished and cancelled rows are not somebody's week. */
    if (WORK_DONE_GROUPS.has(group) || txt(it, W.done) || st === 'Done' || st === 'Cancelled') continue;

    const rel = cv(it, W.rel);
    const tuIds = rel && Array.isArray(rel.linked_item_ids) ? rel.linked_item_ids.map(String) : [];
    const wait = numStr(txt(it, W_WAIT_PA) || txt(it, W_WAIT_CO));

    workTasks.push({
      kind, group, name: it.name || '(untitled)', url: it.url || '',
      rfi: group === RFI_GROUP,
      person: group === RFI_GROUP ? '' : canonName(group),
      status: st,
      due: (txt(it, W.dueDate) || txt(it, W.due2) || txt(it, W.due3)).slice(0, 10),
      added: (txt(it, W_ADDED_PA) || txt(it, W_ADDED_CO)).slice(0, 10),
      /* Whole days: the board's formula carries a fraction-of-day tail. */
      waiting: wait == null ? null : Math.floor(wait),
      tuIds,
      /* Filled in below for RFIs, which sit in a shared group with no owner. */
      owners: [],
      company:  txt(it, M.companyPA) || txt(it, M.companyCO),
      utility:  txt(it, M.utility),
      projType: txt(it, M.type),
      source:   txt(it, M.source),
      /* The tracker status, whichever tracker the row belongs to. */
      trackerStatus: txt(it, M.status),
    });
  }
}

/* An RFI in the shared queue belongs to whoever holds the project it is about.
   Following the board link to the TU tracker is the only thing that says who
   that is; an RFI whose link is missing reaches nobody and is reported to
   management rather than quietly dropped. */
for (const t of workTasks) {
  if (!t.rfi) continue;
  const owners = new Set();
  for (const id of t.tuIds) {
    const tu = tuById.get(id);
    if (!tu) continue;
    for (const role of [T.paLead, T.coLead, T.auditor, T.dealOwner]) {
      for (const raw of list(tu, role)) {
        const n = alias(raw);
        if (n && !NOT_A_PERSON.has(n)) owners.add(n);
      }
    }
  }
  t.owners = [...owners];
}
const orphanRfis = workTasks.filter(t => t.rfi && !t.owners.length);

/* The status of the project behind a row. The mirror answers for every row,
   whichever tracker it came from; the TU join is kept only as a fallback for
   a row whose mirror has not resolved. */
const workStatus = t => {
  if (t.trackerStatus) return t.trackerStatus;
  for (const id of t.tuIds) { const tu = tuById.get(id); if (tu) { const st = txt(tu, T.status); if (st) return st; } }
  return '';
};
const workFor = name => workTasks.filter(t => t.rfi ? t.owners.includes(name) : t.person === name);

/* A workload row names a building; its phase comes from the project it links
   to on the TU tracker, looked up across the whole book. */
const phaseByTu = new Map();
for (const p of allProjects) if (p.tuId && p.phase) phaseByTu.set(p.tuId, p.phase);

/* ---------------------------------------------------------------------------
   Duplicate board rows.

   The ICF board carries genuine duplicates — typically an audit-phase row left
   behind when a second row was created for the pre-approval submission. Which
   row is canonical is a judgement for a person, not this script, so nothing is
   dropped: rows are only folded together in the email when the project name AND
   the next step are identical, and the fold is shown as "x2". Anything that
   differs still gets its own line, and the roll-up lists every duplicate name so
   the board can be tidied.
--------------------------------------------------------------------------- */
function fold(items, needOf) {
  const seen = new Map();
  for (const p of items) {
    const k = p.name.trim().toLowerCase() + '\u0000' + (needOf ? needOf(p) : p.need);
    if (seen.has(k)) seen.get(k).n++;
    else seen.set(k, { p, n: 1 });
  }
  return [...seen.values()];
}
const times = n => (n > 1 ? ` [x${n} board rows]` : '');

/* ------------------------------------------------------------------ digests */
/* ---------------------------------------------------------------------------
   ICF isolation.

   The ICF/HBS Project Tracker is the board ICF already shares with us. The
   Master TU Tracker is HBS-internal: SOW commercials (Rahl's, the client, CGS),
   internal QA/QC states, deal owners and a running admin-notes log. So an
   ICF-bound digest is built from the shared board ONLY — a whitelist, so a
   column added to the TU board later cannot leak by default.
--------------------------------------------------------------------------- */
/* Who holds an RFI, when the two boards disagree.

   The shared board's status lags the TU tracker: of the projects HBS has
   answered an RFI on, most still read "RFI Respond by HBS" over there. Taking
   that at face value told the reviewer we owed them a response on work we had
   already returned -- backwards, on the one status where being wrong costs a
   week. So on an RFI, the TU tracker wins.

   But only while both boards are still talking about the RFI. Where the
   shared board has moved PAST it -- post-technical review, invoice sent,
   payment processing -- that is later news, not staler news, and it wins
   instead. Without this an invoiced project that was closed out in July read
   "awaiting your re-review", which is worse than saying nothing.

   One fact crosses over, never the note or anything else on that board. */
const ICF_RFI_STATES = new Set(['', 'RFI Sent to HBS', 'RFI Respond by HBS', 'Flawed', 'Flawed ARC']);

/* "With HBS" was covering two different things. Of the 28 on Devashis's list,
   22 were installations under way, invoices out and payments processing --
   work moving through HBS that ICF is not waiting on and cannot act on.
   Filing those under "we owe you a response" overstated our debt to a
   reviewer by a factor of four and buried the six that were real.

   Owed means the project is stopped until HBS does something the reviewer is
   waiting for. Everything else is simply in progress. */
const ICF_OWED_STATES = new Set(['RFI Sent to HBS', 'RFI Respond by HBS', 'Flawed', 'Flawed ARC',
  'Site Inspection Pending', 'Internal Update Required']);
const owedToIcf = p => ICF_OWED_STATES.has(p.icfStatus || '') || p.tuStatus === 'TRC/ICF RFI Received';

/* Counting RFIs for the portfolio summary.

   The summary is built from the shared board only, so it cannot count RFIs
   the way a reviewer digest does -- off the TU tracker's status. Read on its
   own, tuStatus is empty for every row, and the summary printed "0 awaiting a
   response from HBS" in the same run whose roll-up listed eighteen, some of
   them seventy-five days old. Understating what we owe a client, to that
   client's leadership, is the worst direction for this email to be wrong in.

   So count from the board this email is allowed to read, with the TU fact as
   a second signal rather than the only one. "Responed" is the board's own
   spelling; both are accepted so that correcting the typo upstream does not
   silently zero the figure again. */
const ICF_RFI_OWED = new Set(['RFI Sent to HBS', 'RFI Respond by HBS']);
const ICF_RFI_BACK = new Set(['RFI Responed by HBS', 'RFI Responded by HBS']);
/* Answered beats outstanding: where the board says HBS has replied, the ball
   is with ICF whatever the older status said. */
const rfiSide = p => {
  const s = p.icfStatus || '';
  if (ICF_RFI_BACK.has(s)) return 'icf';
  if (ICF_RFI_STATES.has(s) && p.tuStatus === 'TRC/ICF RFI Responded') return 'icf';
  if (ICF_RFI_OWED.has(s) || p.tuStatus === 'TRC/ICF RFI Received') return 'hbs';
  return '';
};
function rfiRule(p) {
  if (!ICF_RFI_STATES.has(p.icfStatus || '')) return null;
  if (p.tuStatus === 'TRC/ICF RFI Responded')
    return { need: 'HBS has answered the RFI \u2014 awaiting your re-review', role: 'icf' };
  if (p.tuStatus === 'TRC/ICF RFI Received')
    return { need: 'RFI with HBS \u2014 response owed to you', role: 'hbs' };
  return null;
}

function icfDigestBody(name, mine) {
  const rows = mine.map(p => ({
    name: p.name, projectId: p.projectId, utility: p.utility, type: p.type,
    phase: p.phase, status: p.icfStatus, d: p.icfDates,
    /* Who holds an RFI is decided by the TU tracker, not by the shared board.

       The shared board's status lags: of the 21 projects HBS has answered an
       RFI on, 12 still read "RFI Respond by HBS" there. Taking that at face
       value told the reviewer we owed them a response on work we had already
       returned -- the exact opposite of the truth, on the one status where
       being wrong costs a week. The TU tracker is the board an engineer
       actually updates when they answer, so it wins.

       One fact crosses over, never the note or anything else on that board. */
    rule: rfiRule(p) || ICF_ACTIONS[p.icfStatus] || null,
    owed: owedToIcf(p),
  }));
  const onIcf   = rows.filter(r => r.rule && r.rule.role !== 'hbs');
  const onHbs   = rows.filter(r => r.rule && r.rule.role === 'hbs' && r.owed);
  const running = rows.filter(r => r.rule && r.rule.role === 'hbs' && !r.owed);
  const quiet   = rows.filter(r => !r.rule);

  const L = [];
  const first = /\s/.test(name) ? name.split(' ')[0] : name;
  L.push(`Hi ${first},`, '');
  L.push(`Here is the current state of the HBS projects assigned to you, as of ${new Date().toDateString()}.`, '');
  L.push(`${rows.length} project${rows.length === 1 ? '' : 's'}.`);
  const line = r => `  * ${r.name}${r.projectId ? ` (${r.projectId})` : ''} - ${r.status || r.phase}`;
  if (onIcf.length) {
    L.push('', `WITH ICF (${onIcf.length})`);
    for (const { p: r, n } of fold(onIcf, r => r.rule.need)) { L.push(line(r) + times(n)); L.push(`      ${r.rule.need}`); }
  }
  if (onHbs.length) {
    L.push('', `WITH HBS - WE OWE YOU A RESPONSE (${onHbs.length})`);
    for (const { p: r, n } of fold(onHbs, r => r.rule.need)) { L.push(line(r) + times(n)); L.push(`      ${r.rule.need}`); }
  }
  if (running.length) {
    L.push('', `MOVING AT HBS - NOTHING NEEDED FROM YOU (${running.length})`);
    for (const { p: r, n } of fold(running, r => r.rule.need)) L.push(line(r) + times(n) + ` - ${r.rule.need}`);
  }
  if (quiet.length) {
    L.push('', `NO OPEN ACTION (${quiet.length})`);
    for (const { p: r, n } of fold(quiet, () => '')) L.push(line(r) + times(n));
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

/* ---------------------------------------------------------------------------
   One engineer's weekly email.

   Kept deliberately in step with hbsDigestBody() in pipeline-dashboard.html:
   the dashboard's Weekly digest tab is a preview of exactly this, and the two
   drifting apart would make the preview a lie.

   The first version printed every project on its own line with its next step
   and its latest note beneath it. For someone holding a hundred and twenty
   projects that ran to two hundred lines, most of it work that needed nothing
   from them, and the few things actually on fire were somewhere in the middle.
   Length is not thoroughness; it is where thoroughness goes to hide.

   The shape follows what the reader has to do:

     what is queued on your desk   the workload boards, oldest first
     what needs you                grouped by the action, not one line each
     what has stopped              ageing, with how long
     what is on someone else       named, so it can be chased
     everything else               counted by phase, never listed

   Every project line carries its phase, because "which phase" is the first
   question asked of any of these names.
--------------------------------------------------------------------------- */
/* Run a list of names together across as few lines as will hold them. A name
   is never split across two lines. */
function wrapNames(names, width = 96, indent = '    ') {
  const out = [];
  let line = '';
  for (const n of names) {
    if (!line) { line = n; continue; }
    if ((line + '; ' + n).length > width) { out.push(indent + line); line = n; }
    else line += '; ' + n;
  }
  if (line) out.push(indent + line);
  return out;
}

function digestBody(name, org, mine, work = [], phaseByTu = new Map()) {
  if (org === 'ICF') return icfDigestBody(name, mine);

  const owns = p => !p.ownerNames.length || p.ownerNames.includes(name);
  const moved   = mine.filter(p => STAGES.some(s => inRange(p.ev[s.key], wk.prevStart, wk.end)));
  const yours   = mine.filter(p => (p.sev === 'critical' || p.sev === 'serious') && owns(p));
  const waiting = mine.filter(p => p.sev === 'critical' && !owns(p));
  const ageing  = mine.filter(p => p.aging === 'Critical' && !yours.includes(p) && !waiting.includes(p));
  const rest    = mine.filter(p => !yours.includes(p) && !waiting.includes(p) && !ageing.includes(p));

  const L = [];
  const first = /\s/.test(name) ? name.split(' ')[0] : name;
  const phaseOf = p => p.phase || 'no phase set';
  const workPhase = t => (t.tuIds || []).map(id => phaseByTu.get(id)).find(Boolean) || '';

  const rfis   = work.filter(t => t.rfi);
  const paWork = work.filter(t => !t.rfi && t.kind === 'Pre-approval');
  const coWork = work.filter(t => !t.rfi && t.kind === 'Closeout');

  L.push(`Hi ${first},`, '');
  /* The pre-approval and closeout boards are what an engineer works from, so
     they open the email. The pipeline summary follows them rather than
     standing in front of them. */
  L.push(`YOUR BOARDS \u2014 ${new Date().toDateString()}`);
  L.push(work.length
    ? [paWork.length ? `${paWork.length} pre-approval${paWork.length === 1 ? '' : 's'}` : null,
       coWork.length ? `${coWork.length} closeout${coWork.length === 1 ? '' : 's'}` : null,
       rfis.length ? `${rfis.length} RFI${rfis.length === 1 ? '' : 's'} to answer` : null]
      .filter(Boolean).join(' \u00b7 ')
    : 'Nothing queued on the pre-approval or closeout boards.');

  /* ---- the desk: what is queued on you right now ---- */
  const age = t => (t.waiting == null ? '' : `[${t.waiting}d] `);
  /* The columns the engineer sees on the workload board itself: who the
     client is, which programme and measure type it is, what state it is in
     and which phase it has reached. The boards hold most of these as mirrors,
     so they are read from the TU tracker they mirror. "via CGS" only appears
     when the work did not originate with HBS, and the board's own status
     marker only when it says something the tracker status does not. */
  const deskLine = t => `  \u2022 ${age(t)}${t.name}` +
    [t.company + (t.source && t.source !== 'HBS' ? ` (via ${t.source})` : ''),
     [t.utility, t.projType].filter(Boolean).join(' '),
     workStatus(t),
     workPhase(t),
     t.due ? `due ${t.due}` : '',
     t.status && t.status.toLowerCase() !== (workStatus(t) || '').toLowerCase() ? `board: ${t.status}` : '',
    ].filter(Boolean).map(x => ` \u00b7 ${x}`).join('');
  const byAge = (a, b) => (b.waiting || 0) - (a.waiting || 0);

  if (rfis.length) {
    L.push('', `RFIs TO ANSWER (${rfis.length})`);
    for (const t of [...rfis].sort(byAge)) L.push(deskLine(t));
  }
  if (paWork.length) {
    L.push('', `PRE-APPROVALS ON YOUR DESK (${paWork.length})`);
    for (const t of [...paWork].sort(byAge)) L.push(deskLine(t));
  }
  if (coWork.length) {
    L.push('', `CLOSEOUTS ON YOUR DESK (${coWork.length})`);
    for (const t of [...coWork].sort(byAge)) L.push(deskLine(t));
  }

  /* ---- then the project book behind those boards ---- */
  L.push('', '\u2014'.repeat(28));
  L.push('YOUR PROJECTS \u2014 ' + [`${mine.length} active`,
          yours.length ? `${yours.length} need you` : null,
          ageing.length ? `${ageing.length} ageing past 60 days` : null].filter(Boolean).join(' \u00b7 '));
  const byStage = new Map();
  for (const p of mine) if (p.current) byStage.set(p.current, (byStage.get(p.current) || 0) + 1);
  const anyStage = STAGES.filter(s => byStage.get(s.key));
  if (anyStage.length) L.push(anyStage.map(s => `${s.label} ${byStage.get(s.key)}`).join(' \u00b7 '));

  /* ---- what needs you, gathered by the action rather than listed flat ---- */
  if (yours.length) {
    L.push('', `NEEDS YOUR ACTION (${yours.length})`);
    const groups = new Map();
    for (const p of yours) {
      if (!groups.has(p.need)) groups.set(p.need, []);
      groups.get(p.need).push(p);
    }
    const SHOW = 10, NOTES = 3;
    for (const [need, ps] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      L.push('', `  ${need} (${ps.length})`);
      const ranked = ps.sort((a, b) => (b.daysInPhase || 0) - (a.daysInPhase || 0));
      ranked.slice(0, SHOW).forEach((p, i) => {
        L.push(`    \u2022 ${p.name} \u00b7 ${phaseOf(p)}${p.daysInPhase >= 60 ? ` \u00b7 ${p.daysInPhase}d` : ''}`);
        /* The note earns its line on the few that have stalled longest. Past
           that it repeats what the next step already said, on every row. */
        if (i < NOTES && p.evidence && p.daysInPhase >= 60) L.push(`        ${p.evidence.slice(0, 120)}`);
      });
      if (ranked.length > SHOW) L.push(`    \u2026 and ${ranked.length - SHOW} more with the same next step`);
    }
  }

  if (ageing.length) {
    L.push('', `STOPPED \u2014 PAST 60 DAYS (${ageing.length})`);
    for (const p of [...ageing].sort((a, b) => (b.daysInPhase || 0) - (a.daysInPhase || 0)))
      L.push(`  \u2022 [${p.daysInPhase == null ? '?' : p.daysInPhase}d] ${p.name} \u00b7 ${phaseOf(p)} \u00b7 ${p.need}`);
  }

  if (waiting.length) {
    L.push('', `WITH SOMEONE ELSE (${waiting.length})`);
    for (const p of waiting) L.push(`  \u2022 ${p.name} \u00b7 ${phaseOf(p)} \u00b7 ${p.need} \u2014 with ${p.ownerNames.join(', ')}`);
  }

  if (moved.length) {
    L.push('', `MOVED THIS WEEK (${moved.length})`);
    for (const p of moved) {
      const hit = STAGES.filter(s => inRange(p.ev[s.key], wk.prevStart, wk.end)).map(s => s.label).join(', ');
      L.push(`  \u2022 ${p.name} \u00b7 ${hit}`);
    }
  }

  /* ---- the tail: counted, not listed ---- */
  if (rest.length) {
    const byPhase = new Map(), byNeed = new Map(), phaseNames = new Map();
    for (const p of rest) {
      byPhase.set(phaseOf(p), (byPhase.get(phaseOf(p)) || 0) + 1);
      byNeed.set(p.need, (byNeed.get(p.need) || 0) + 1);
      if (!phaseNames.has(phaseOf(p))) phaseNames.set(phaseOf(p), []);
      phaseNames.get(phaseOf(p)).push(p.name);
    }
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(' \u00b7 ');
    L.push('', `NOTHING OWED BY YOU (${rest.length})`);
    L.push(`  Still yours, nothing owed by you this week. Waiting on: ${top(byNeed, 4)}.`);
    /* Named, not just counted -- you cannot check a project is in hand against
       a number. Run together under each phase rather than one line each: the
       names are what you scan for, and eighty of them one to a line is the
       wall this email was rewritten to get rid of. */
    for (const [ph, names] of [...phaseNames].sort((a, b) => b[1].length - a[1].length)) {
      L.push('', `  ${ph} (${names.length})`);
      for (const line of wrapNames(names.sort())) L.push(line);
    }
  }

  L.push('', 'This is an automated weekly update built from the monday.com trackers.');
  L.push('Reply to Ameya if anything here looks wrong.');
  return { text: L.join('\n'), counts: {
    active: mine.length, yours: yours.length, ageing: ageing.length, moved: moved.length,
    work: work.length, rfis: rfis.length, pa: paWork.length, co: coWork.length } };
}

/* ---------------------------------------------------------------------------
   The portfolio summary for ICF leadership.

   Justin and Junior do not review projects, so no per-project digest can be
   addressed to them. They get the position across the whole shared portfolio
   instead: where the work sits, whose turn each part of it is, and the one
   thing only they can fix -- the projects carrying no reviewer.

   That last figure is the point of the email. A project with nobody named on
   the ICF side reaches no reviewer, gets no reviewer digest from us, and ages
   in silence. It is not something HBS can resolve, so it is raised rather
   than absorbed, and every one is listed so it can be actioned.

   Same isolation as a reviewer's digest: the shared ICF/HBS board only, plus
   the one RFI fact the TU tracker is authoritative on. Nothing from the
   internal trackers, the workload boards, the notes or the commercials.
--------------------------------------------------------------------------- */
function icfSummaryBody() {
  const rows = projects.map(p => ({
    name: p.name, projectId: p.projectId, phase: p.phase, status: p.icfStatus,
    reviewers: p.icfEngs, unassigned: p.icfUnassigned, raw: p.icfRaw,
    rule: (p.tuStatus === 'TRC/ICF RFI Responded'
            ? { role: 'icf' }
          : p.tuStatus === 'TRC/ICF RFI Received'
            ? { role: 'hbs' }
          : ICF_ACTIONS[p.icfStatus] || null),
    rfi: rfiSide(p),
  }));

  const withIcf = rows.filter(r => r.rule && r.rule.role === 'icf');
  const withHbs = rows.filter(r => r.rule && r.rule.role === 'hbs');
  const noReviewer = rows.filter(r => r.unassigned);
  const rfiHbs = rows.filter(r => r.rfi === 'hbs');
  const rfiIcf = rows.filter(r => r.rfi === 'icf');

  const L = [];
  L.push(`ICF \u00d7 HBS portfolio \u2014 week of ${weekOf}`, '');
  L.push(`HBS is running ${rows.length} active project${rows.length === 1 ? '' : 's'} on the shared tracker.`);
  L.push(`${withIcf.length} are waiting on ICF, ${withHbs.length} on HBS.`);

  const byPhase = new Map();
  for (const r of rows) if (r.phase) byPhase.set(r.phase, (byPhase.get(r.phase) || 0) + 1);
  if (byPhase.size) {
    L.push('', 'WHERE THEY SIT');
    for (const [ph, n] of [...byPhase].sort((a, b) => b[1] - a[1])) L.push(`  ${ph}: ${n}`);
  }

  L.push('', 'RFIs');
  L.push(`  ${rfiHbs.length} awaiting a response from HBS.`);
  L.push(`  ${rfiIcf.length} answered by HBS and back with ICF for re-review.`);

  /* The reason for the email. */
  if (noReviewer.length) {
    const tbd = noReviewer.filter(r => r.raw.includes('TBD')).length;
    L.push('', `NO ICF REVIEWER NAMED (${noReviewer.length})`);
    L.push(`  ${tbd} marked TBD, ${noReviewer.length - tbd} left blank on the board.`);
    L.push('  These reach no reviewer and get no weekly update from us. Assigning');
    L.push('  someone on the shared tracker is all that is needed.');
    L.push('');
    for (const line of wrapNames(noReviewer.map(r => r.name).sort())) L.push(line);
  } else {
    L.push('', 'Every active project has a reviewer named. Nothing outstanding on that front.');
  }

  L.push('', 'Automated weekly from the shared ICF/HBS Project Tracker.');
  L.push('Reply to Ameya Upadhyay (aupad@hbssolutionsinc.com) with anything that looks wrong.');
  return L.join('\n');
}

const hbsNames = new Set(), icfNames = new Set(), offRoster = new Set();
for (const p of projects) {
  for (const n of p.hbsAll) {
    if (NOT_A_PERSON.has(n) || NOW_ICF_SIDE.has(n)) continue;
    if (getsDigest(n) || hasLeft(n)) hbsNames.add(n); else offRoster.add(n);
  }
  for (const n of p.icfEngs) if (!NOT_A_PERSON.has(n)) icfNames.add(n);
}
/* Somebody can hold a full pre-approval or closeout queue without their name
   appearing on a single ICF board row. Routing on the pipeline alone would
   send them nothing at all. */
for (const t of workTasks) {
  for (const n of t.rfi ? t.owners : [t.person]) {
    if (!n || NOT_A_PERSON.has(n) || NOW_ICF_SIDE.has(n)) continue;
    if (getsDigest(n) || hasLeft(n)) hbsNames.add(n); else offRoster.add(n);
  }
}

/* HBS engineers are stored as real monday people, so their address is authoritative. */
const users = (await gql(`query { users(limit: 300) { name email enabled } }`)).users;
const byName = new Map(users.filter(u => u.email).map(u => [u.name.toLowerCase(), u.email]));

const perEngineer = [], unroutable = [], warnings = [];
const weekOf = wk.prevStart.toDateString();

for (const name of [...hbsNames].sort()) {
  const mine = projects.filter(p => p.hbsAll.includes(name));
  const work = workFor(name);
  /* Someone who has left is never emailed. Their projects still need an owner,
     so they go to management in the roll-up instead. */
  if (hasLeft(name)) {
    unroutable.push({ name, org: 'HBS', reason: 'has left HBS - projects need reassigning', active: mine.length, work: work.length });
    continue;
  }
  const to = byName.get(name.toLowerCase()) || null;
  const d = digestBody(name, 'HBS', mine, work, phaseByTu);
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
  L.push(`${projects.length} active projects.`);
  L.push(`(${retired.completed} completed and ${retired.cancelled} cancelled projects are excluded.)`, '');
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
    for (const p of noReviewer.sort((a, b) => (b.daysInPhase || 0) - (a.daysInPhase || 0)).slice(0, 10)) {
      L.push(`  * ${p.name} - ${p.phase}${p.icfStatus ? ' / ' + p.icfStatus : ''}`);
    }
    if (noReviewer.length > 10) L.push(`  ... and ${noReviewer.length - 10} more`);
  }

  /* Named here rather than merged: picking a winner is a person's call. */
  const byName2 = new Map();
  for (const p of projects) {
    const k = p.name.trim().toLowerCase();
    if (!byName2.has(k)) byName2.set(k, []);
    byName2.get(k).push(p);
  }
  const dupes = [...byName2.values()].filter(v => v.length > 1);
  if (dupes.length) {
    L.push('', `DUPLICATE ROWS ON THE ICF BOARD: ${dupes.length} project names on ${dupes.reduce((a, v) => a + v.length, 0)} rows`);
    L.push('  Usually an audit-phase row left behind when a new row was opened for the');
    L.push('  pre-approval. They inflate every count above until one row is retired.');
    for (const v of dupes.slice(0, 10)) {
      L.push(`  * ${v[0].name}`);
      L.push(`      ${v.map(p => p.phase + (p.projectId ? ' / ' + p.projectId : ' / no project number')).join('  |  ')}`);
    }
    if (dupes.length > 10) L.push(`  ... and ${dupes.length - 10} more`);
  }

  /* People holding live projects who are not on the engineering roster. They
     are not sent a digest, so this is the only place that work is visible. */
  if (offRoster.size) {
    const rows2 = [...offRoster].map(n => ({ n, active: projects.filter(p => p.hbsAll.includes(n)).length }))
      .filter(r => r.active).sort((a, b) => b.active - a.active);
    if (rows2.length) {
      L.push('', `HOLDING WORK BUT NOT SENT A DIGEST: ${rows2.length}`);
      L.push('  Deal owners, operations, sales, subcontracted auditors and reviewers.');
      for (const r of rows2.slice(0, 12)) L.push(`  * ${r.n.padEnd(26)} ${String(r.active).padStart(4)} active${jobTitle(r.n) ? '   ' + jobTitle(r.n) : ''}`);
      if (rows2.length > 12) L.push(`  ... and ${rows2.length - 12} more`);
    }
  }

  const departed = [...Object.keys(HBS_ROSTER)].filter(hasLeft)
    .map(n => ({ n, mine: projects.filter(p => p.hbsAll.includes(n)) })).filter(r => r.mine.length);
  if (departed.length) {
    L.push('', 'STILL ASSIGNED TO SOMEONE WHO HAS LEFT');
    for (const r of departed) {
      L.push(`  ${r.n} - ${r.mine.length} project${r.mine.length === 1 ? '' : 's'} need a new owner:`);
      for (const p of r.mine) L.push(`    * ${p.name} - ${p.phase}${p.icfStatus ? ' / ' + p.icfStatus : ''}`);
    }
  }

  L.push('', 'BY ENGINEER                     active  action owed  ageing   on desk   RFIs');
  const rows = [];
  for (const [set, org] of [[hbsNames, 'HBS'], [icfNames, 'ICF']]) {
    for (const n of [...set].sort()) {
      const mine = projects.filter(p => (org === 'HBS' ? p.hbsAll : p.icfEngs).includes(n));
      const work = org === 'HBS' ? workFor(n) : [];
      rows.push({ n, org, active: mine.length,
        owed: mine.filter(p => p.sev === 'critical').length,
        ageing: mine.filter(p => p.aging === 'Critical').length,
        desk: work.filter(t => !t.rfi).length, rfis: work.filter(t => t.rfi).length });
    }
  }
  rows.sort((a, b) => b.owed - a.owed || b.active - a.active);
  for (const r of rows) L.push(`  ${(r.n + ' (' + r.org + ')').padEnd(30)} ${String(r.active).padStart(5)} ${String(r.owed).padStart(11)} ${String(r.ageing).padStart(7)} ${String(r.desk).padStart(9)} ${String(r.rfis).padStart(6)}`);

  /* The workload boards in one line, and the rows on them that reach nobody. */
  const openWork = workTasks.length, openRfis = workTasks.filter(t => t.rfi).length;
  L.push('', 'WORKLOAD BOARDS');
  L.push(`  ${openWork} open item${openWork === 1 ? '' : 's'} across the pre-approval and closeout boards, ${openRfis} of them RFIs.`);
  const deskNoOwner = workTasks.filter(t => !t.rfi && !t.person);
  if (deskNoOwner.length) L.push(`  ${deskNoOwner.length} sit in a group that names no engineer, so nobody is emailed about them.`);
  /* Without a Date Added the board cannot say how long something has been
     queued, which is the one number these boards exist to produce. */
  const noAge = workTasks.filter(t => t.waiting == null);
  if (noAge.length) L.push(`  ${noAge.length} have no Date Added, so how long they have sat on a desk is unknown.`);
  if (orphanRfis.length) {
    L.push(`  ${orphanRfis.length} RFI${orphanRfis.length === 1 ? ' has' : 's have'} no board link to a project, so ${orphanRfis.length === 1 ? 'it reaches' : 'they reach'} nobody:`);
    for (const t of orphanRfis) L.push(`    * ${t.name}${t.waiting != null ? ` - waiting ${t.waiting} days` : ''}`);
  }

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

/* The portfolio summary once told ICF leadership nothing was owed to them in
   the same run whose roll-up listed eighteen RFIs. It read the count off a
   column its own whitelist does not carry, so it printed zero every week and
   nothing objected. Cross-check the two rather than trust either: if the
   pipeline says HBS owes ICF an RFI response and the summary says none,
   the summary is wrong again and must not go out. */
const rfiOwedPipeline = projects.filter(p => ICF_RFI_OWED.has(p.icfStatus || '')
  || p.tuStatus === 'TRC/ICF RFI Received').length;
const rfiOwedSummary = projects.filter(p => rfiSide(p) === 'hbs').length;
if (rfiOwedPipeline && !rfiOwedSummary)
  warnings.push(`The portfolio summary counts 0 RFIs owed to ICF but the pipeline finds ${rfiOwedPipeline}. `
    + 'The summary is miscounting - do not send it to ICF.');

const envelope = {
  generatedAt: new Date().toISOString(),
  weekOf,
  projectCount: projects.length,
  perEngineer: perEngineer.filter(e => e.to),
  rollup: { to: ROLLUP_TO, subject: `ICF x HBS pipeline roll-up - week of ${weekOf}`, body: rollupBody() },
  icfSummary: { to: ICF_SUMMARY_TO, subject: `ICF x HBS portfolio summary - week of ${weekOf}`, body: icfSummaryBody() },
  unroutable,
  warnings,
};

/* DIGEST_MODE=summary prints a compact preview instead of the full send envelope.
   Use it to sanity-check a run without pulling every digest into the transcript. */
if ((process.env.DIGEST_MODE || '') === 'summary') {
  console.log(`projects=${envelope.projectCount}  week of ${envelope.weekOf}`);
  console.log(`would email ${envelope.perEngineer.length} engineers:`);
  for (const e of envelope.perEngineer) {
    const w = e.counts.work == null ? '' : ` desk=${e.counts.pa}pa/${e.counts.co}co rfi=${e.counts.rfis}`;
    console.log(`  ${e.org}  ${e.name.padEnd(20)} -> ${String(e.to).padEnd(34)} active=${e.counts.active} owed=${e.counts.yours} ageing=${e.counts.ageing} moved=${e.counts.moved}${w} bodyChars=${e.body.length}`);
  }
  console.log(`\nnot routable (${envelope.unroutable.length}):`);
  for (const u of envelope.unroutable) console.log(`  ${u.org} ${u.name} - ${u.reason}${u.active ? ' (' + u.active + ' active)' : ''}`);
  console.log(`\nwarnings: ${envelope.warnings.length ? envelope.warnings.join(' | ') : 'none'}`);
  console.log(`\n--- roll-up to ${envelope.rollup.to.join(', ')} ---`);
  console.log(envelope.rollup.body);
  console.log(`\n--- ICF portfolio summary to ${envelope.icfSummary.to.join(', ')} ---`);
  console.log(envelope.icfSummary.body);
  const sample = envelope.perEngineer.find(e => e.counts.work > 0 && e.counts.yours > 0)
    || envelope.perEngineer.find(e => e.counts.work > 0)
    || envelope.perEngineer.find(e => e.counts.yours > 0) || envelope.perEngineer[0];
  if (sample) {
    console.log(`\n--- sample individual digest: ${sample.name} (${sample.org}) -> ${sample.to} ---`);
    console.log(sample.body.slice(0, 2600));
  }
} else {
  console.log(JSON.stringify(envelope, null, 1));
}
