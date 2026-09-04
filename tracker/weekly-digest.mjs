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
/* Monthly KPIs -- one row per milestone reached, carrying the engineer who
   reached it, the date, and the incentive on it. This is the only board that
   attaches money to a person, so it is the only possible source for "how am I
   doing" and for any comparison between engineers. */
const BOARD_KPI = '1069742731';
const K = { engineer: 'person', status: 'status', date: 'date4', incentive: 'numbers_2' };
/* The board's own status labels. A row's status IS the milestone. */
const KPI_AUDIT  = 'Audit Phase Complete';
const KPI_PA_SUB = 'PA Submitted';
const KPI_PA_RCV = 'PA Received';
const KPI_CO_SUB = 'CO Submitted';
const KPI_CO_RCV = 'CO Received';
/* Implementations Scheduled is deliberately absent: scheduling the crew is not
   the engineer's work, and Ameya asked for it out of their email entirely. */

/* The monthly goals, as Ameya set them: $1m of incentive for each of the four
   milestones the team is measured on. They are TEAM goals and a whole month's
   worth, so the email shows progress against the share due by today and, for
   an individual, against an even split across the people on the board that
   month -- the split is a yardstick, not a quota anybody agreed to, and the
   email says so.

   There is no goal column on any monday board, so this is the only place they
   live. Changing one is a one-line edit here. A null goal means "not set": the
   figure and the comparison still show, and no progress bar is drawn. */
const GOALS = {
  paSubmitted:     1000000,   // applications submitted to ICF
  paReceived:      1000000,   // pre-approvals granted by ICF
  implementations: 1000000,   // implementations scheduled
  coReceived:      1000000,   // closeouts paid
};

const BOARD_ICF = '18424932045';   // ICF/HBS Project Tracker
/* TRC is a second reviewer, doing for their utilities what ICF does for
   theirs. They are a different company with different people, and Ameya's
   rule is absolute: no TRC project may appear in anything sent to ICF, and no
   ICF project in anything sent to TRC. Each side is built from its own board
   and nothing else -- the same whitelist that already keeps HBS-internal
   material away from both.

   The two boards are structurally identical, down to the column ids, so one
   column map serves both and the API simply omits the handful of columns the
   TRC board does not carry. */
const BOARD_TRC = '18428455111';   // TRC/HBS Project Tracker
const BOARD_TU  = '1069746645';    // Master TU Tracker
/* The second work tracker. A project's audit date, implementation date, PA and
   CO leads and auditor live on whichever work tracker carries it, and 227 of
   the reviewed projects are carried here rather than on the Master TU Tracker.
   Reading only the master left every one of them with no leads, no dates and
   no status -- which, among other things, dropped them out of the cycle-time
   averages and pushed those averages well above what the dashboard shows for
   the same engineers, because BPTU phase 1 is a short audit-and-pre-approval
   and it was the part being left out. */
const BOARD_BPTU = '6530139050';   // BGE BPTU Tracker

/* The BPTU board holds the same facts under different column ids. Translating
   them to the master's ids on the way in means everything downstream reads one
   shape and neither knows nor cares which tracker a project came off. */
const BPTU_TO_TU = {
  'text__1': 'text_mkxpkdex',                     // Company
  'text_mkpea39n': 'text',                        // Utility
  'multiple_person_mkwfcjvn': 'multiple_person_mkwfm19x',  // Deal owner
  'dropdown_mm4cy96d': 'dropdown_mm4bc2hd',       // Review engineer
  'date_mkrv8cn5': 'date_mkrvfahg',               // Audit date
  'date_mm0whh86': 'date_mm4b5x2',                // Implementation date
  'color_mm4ff52g': 'color_mm47r8nd',             // SOW status
  'date_mm5r4s7c': 'date_mm5r3pk9',               // Sent to Rahl's
  'date_mm5rc5cc': 'date_mm5rd9h7',               // Sent to client / CGS
  'board_relation_mm5xs2ff': 'board_relation_mm5xccpb',    // link to the review tracker
  /* status, type, dropdown (Source), person (Auditor), people (PA lead),
     people__1 (CO lead), date73, date1 and long_text share ids already. */
};
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

/* TRC reviewers, from their board's Engineer dropdown: Arya, Max, Brian,
   Elonna, Peter and Carson.

   NOT ONE ADDRESS IS KNOWN. Guessing one from a first name is exactly the
   mistake that would send a company's project list to a stranger, so this
   stays empty until Ameya supplies them. Their digests are still built and
   counted -- they come back as unroutable with the reason, so the gap is
   visible every week instead of being silently absent. */
const TRC_EMAILS = {
};

/* The TRC leads, who get the portfolio summary rather than a project queue --
   the same arrangement as Justin and Junior on the ICF side. Named by Ameya;
   still no addresses, so the summary is built and cannot be sent. */
const TRC_SUMMARY_NAMES = ['Peter', 'Max'];

/* Reviewers who have left, per side. Their name stays on the board long after
   they go, so their projects do not become unassigned on their own -- they
   simply stop reaching anybody, and mailing the departed address is worse
   than useless because the queue looks covered while nobody reads it. The
   queue goes to that side's leads instead, who are the only people who can
   name a replacement.

   Deliberately not deleted from the address book: leaving the name on record
   is what stops it being re-added from a stale board export. */
const TRC_DEPARTED_NAMES = ['Arya'];

/* Reviewer sides. Each names the board it may read and the addresses it may
   reach, and nothing crosses between them. */
const REVIEW_SIDES = {
  ICF: {
    board: BOARD_ICF,
    emails: () => ICF_EMAILS,
    departed: () => ICF_DEPARTED,
    summaryTo: () => ICF_SUMMARY_TO,
  },
  TRC: {
    board: BOARD_TRC,
    emails: () => TRC_EMAILS,
    /* Built from the lead list, so a departed TRC reviewer's queue follows the
       same route as a departed ICF one the moment an address exists. */
    departed: () => Object.fromEntries(TRC_DEPARTED_NAMES.map(n =>
      [n, { left: '2026-09-01', to: TRC_SUMMARY_NAMES.map(x => TRC_EMAILS[x]).filter(Boolean) }])),
    summaryTo: () => TRC_SUMMARY_NAMES.map(n => TRC_EMAILS[n]).filter(Boolean),
  },
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

/* Reviewers who have left ICF.

   Their name stays on the shared board long after they go, so the projects do
   not become unassigned on their own -- they simply stop reaching anybody.
   Mailing the departed address is worse than useless: the queue looks covered
   while nobody is reading it.

   So the queue goes to the ICF leads instead. They are the only people who can
   name a replacement, and it is the same fact the summary already raises under
   NO ICF REVIEWER NAMED, just arriving a week earlier and with the project
   list attached. Deliberately NOT deleted from ICF_EMAILS: leaving the address
   here on record is what stops it being re-added from a stale board export.

   Confirmed by Ameya, 2026-09-01. */
const ICF_DEPARTED = {
  'Victoria': { left: '2026-09-01', to: ICF_SUMMARY_TO },
  'Darren':   { left: '2026-09-01', to: ICF_SUMMARY_TO },
};

/* HBS management. They already receive the operational roll-up; this is the
   position at a glance, in the shape the ICF leads get, but drawn from every
   board rather than the shared one. Internal, so nothing is withheld.
   Confirmed by Ameya, 2026-09-01. */
const HBS_SUMMARY_TO = [
  'mcosta@hbssolutionsinc.com',       // Michael Costa, operations director
  'hhaywood@hbssolutionsinc.com',     // Harry Haywood
  'dgoforth@hbssolutionsinc.com',     // Devon Goforth
  'drodriguez@hbssolutionsinc.com',   // David Rodriguez, operations manager
];

/* Expand a project's ICF Engineer value into real people, and say whether it
   was left unassigned. Returns { names, unassigned }. */
/* Rewrite an action written for ICF so it names the reviewer that project
   actually has. "the ICF/TRC RFI" becomes "the TRC RFI" on a TRC project and
   "the ICF RFI" on an ICF one, and a bare "ICF" becomes the right company. */
function sideWording(text, side) {
  return String(text)
    .replace(/\bICF\s*\/\s*TRC\b/g, side)
    .replace(/\bTRC\s*\/\s*ICF\b/g, side)
    .replace(/\bICF\b/g, side);
}

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
/* Mirrored project statuses that mean the row is finished, whichever tracker
   it came from. "Phase 1 Invoiced" and "Invoiced" are BPTU: that phase has
   been delivered and billed. "Complete/Paid" and "Cancelled" speak for
   themselves. Nothing here is a state anyone still has to act on. */
const WORK_FINISHED_STATUS = new Set(['Complete/Paid', 'Cancelled', 'Phase 1 Invoiced', 'Invoiced']);
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
  /* These three were on neither map, so 42 projects reached a reviewer's
     email reading "NO OPEN ACTION" -- 27 of them ones we had already answered.
     "Responed" is the board's own spelling and is the ONLY one that occurs;
     the corrected spelling is mapped too so fixing the typo upstream cannot
     silently un-map them again. */
  'RFI Responed by HBS': { need: 'HBS has answered the RFI — awaiting your re-review', role: 'icf' },
  'RFI Responded by HBS': { need: 'HBS has answered the RFI — awaiting your re-review', role: 'icf' },
  'Flawed Tech Review': { need: 'Flawed at technical review — correct and resubmit', role: 'hbs', sev: 'critical' },
  'Flawed Post Tech Review': { need: 'Flawed at post-technical review — correct and resubmit', role: 'hbs', sev: 'critical' },
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
/* ONE week, Monday to Sunday. It used to run from last Monday to today, which
   is eight to fourteen days -- so "this week" quietly counted part of the week
   before it, and the subject line named a Monday up to a fortnight back.

   The digest goes out twice, Monday and Friday, and the two runs want
   different weeks:

     Monday   -- the week that just ENDED, Mon to Sun, complete. A week that is
                 half a day old has nothing in it, and an email of zeros on a
                 Monday morning is worse than no email.
     Any other day -- the week in flight, Monday to today.

   Then the month rule Ameya asked for: "once a new month starts the week is
   updated to start from 0". A week that straddles a month boundary is cut at
   the 1st, so no part of last month is ever counted into this month's week.
   The month taken is the one the LAST reported day falls in -- for the Monday
   run that is the Sunday just gone, not today. */
function weekRange(now) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const isMonday = d.getDay() === 1;
  const dow = (d.getDay() + 6) % 7;
  const thisMonday = new Date(d); thisMonday.setDate(d.getDate() - dow);

  let start, end;
  if (isMonday) {
    /* Last week, whole: Mon 00:00 through Sun 23:59, end exclusive. */
    start = new Date(thisMonday); start.setDate(start.getDate() - 7);
    end = new Date(thisMonday);
  } else {
    start = new Date(thisMonday);
    end = new Date(d); end.setDate(end.getDate() + 1);
  }

  /* The last day actually covered, which is what decides the month. */
  const lastDay = new Date(end); lastDay.setDate(lastDay.getDate() - 1);
  const monthStart = new Date(lastDay.getFullYear(), lastDay.getMonth(), 1);
  const clipped = monthStart > start;
  if (clipped) start = monthStart;

  const prevEnd = new Date(start);
  const prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
  return { start, end, prevStart, prevEnd, lastDay, clipped, full: !clipped };
}
/* "Mon 31 Aug - Sun 6 Sep". The window is stated rather than implied: a reader
   who cannot see which days a number covers cannot check it. */
function weekLabel(w) {
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const f = dt => `${DAY[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
  return `${f(w.start)} \u2013 ${f(w.lastDay)}`;
}
const inRange = (dt, a, b) => !!dt && dt >= a && dt < b;

/* ------------------------------------------------------------------ build */
const wCols = [...Object.values(W), W_ADDED_PA, W_ADDED_CO, W_WAIT_PA, W_WAIT_CO, ...Object.values(M)];
const bptuCols = Object.values(T).map(id => {
  const back = Object.entries(BPTU_TO_TU).find(([, tuId]) => tuId === id);
  return back ? back[0] : id;
});
const [icfItems, trcItems, tuMaster, bptuRaw, paWorkItems, coWorkItems, kpiItems] = await Promise.all([
  fetchBoard(BOARD_ICF, Object.values(C)),
  fetchBoard(BOARD_TRC, Object.values(C)),
  fetchBoard(BOARD_TU, Object.values(T)),
  fetchBoard(BOARD_BPTU, bptuCols),
  fetchBoard(BOARD_PA_WORK, wCols),
  fetchBoard(BOARD_CO_WORK, wCols),
  fetchBoard(BOARD_KPI, Object.values(K)),
]);
/* Rewritten to the master's column ids, so a BPTU project is indistinguishable
   from a TU one everywhere below this line. */
const bptuItems = bptuRaw.map(it => ({
  ...it,
  column_values: it.column_values.map(c => (BPTU_TO_TU[c.id] ? { ...c, id: BPTU_TO_TU[c.id] } : c)),
}));
const tuItems = [...tuMaster, ...bptuItems];
/* Which board a project came off IS its reviewer side, and it is the only
   thing that decides who may be told about it. Carried on every project from
   here on, and checked again before anything is addressed to a reviewer. */
const reviewItems = [
  ...icfItems.map(it => ({ it, side: 'ICF' })),
  ...trcItems.map(it => ({ it, side: 'TRC' })),
];

const tuByIcf = new Map();
for (const t of tuItems) {
  const rel = cv(t, T.rel);
  const ids = rel && Array.isArray(rel.linked_item_ids) ? rel.linked_item_ids.map(String) : [];
  for (const id of ids) if (!tuByIcf.has(id)) tuByIcf.set(id, t);
}

const today = new Date(); today.setHours(0, 0, 0, 0);
const wk = weekRange(new Date());

const allProjects = reviewItems.map(({ it, side }) => {
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
    /* The date the application went in. Not a funnel stage of its own -- the
       funnel counts the moment ICF answered -- but it is one end of the leg
       the engineer actually controls, so it has to be carried. */
    subPA: dparse(txt(it, C.dSubPA)),
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
    name: it.name, url: it.url, phase, icfStatus, tuStatus, side,
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
    paLeadNames: paLead, coLeadNames: coLead,
    /* The action rules were written when ICF was the only reviewer, so they
       name ICF outright. On a TRC project that is simply wrong: it sends an
       engineer to chase the wrong company. The reviewer's name is substituted
       from the board the project came off, and the "ICF/TRC RFI" wording -- a
       label both companies use on the shared statuses -- collapses to whoever
       actually has it. */
    need: rule ? sideWording(rule.need, side) : 'No status recorded — set a status on the board',
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
   Automatic priority — the same scorer the dashboard's ASAP tab runs.

   Ported from pipeline-dashboard.html deliberately rather than reinvented: an
   email that ranked projects differently from the board people work off would
   be a second opinion nobody asked for, and the first argument would be about
   which one is right.

   Every input is something the boards already record, so the ranking needs no
   judgement from anyone: what the status says is owed, how long it has sat,
   whether a due date has passed, and whether anyone owns it at all.

   sharedOnly drops every term read off the Master TU tracker. A reviewer's
   email may be built from the shared board and nothing else, so their ranking
   has to be computable from the shared board alone -- scoring on a column they
   cannot see would leak it through the ordering.
--------------------------------------------------------------------------- */
function scoreProject(p, { sharedOnly = false } = {}) {
  const why = [];
  let n = 0;
  const tu = sharedOnly ? '' : (p.tuStatus || '');
  /* One RFI is one fact. These were two separate tests -- the TU tracker's
     "RFI Received" and any shared-board status containing "RFI" -- and on a
     project where both were true the same single RFI scored 90, floating it
     above everything else on the list. Worse, the second test also matched
     "RFI Responed by HBS", so an RFI we had already ANSWERED scored 45 as
     though it were outstanding.

     rfiSide already knows which way an RFI points, and answered beats
     outstanding there, so ask it once. Under sharedOnly it is asked without
     the TU tracker, exactly as the rest of this function is. */
  const rfi = rfiSide(sharedOnly ? { ...p, tuStatus: '' } : p);
  if (rfi === 'hbs') { n += 45; why.push('RFI open — response owed by us'); }
  if (/Flawed|FLAWED/.test(`${tu} ${p.icfStatus}`)) { n += 40; why.push('flawed in portal'); }
  if (tu === 'Action Needed from HBS') { n += 35; why.push('action needed from HBS'); }
  if (tu === 'Stuck') { n += 30; why.push('marked stuck'); }
  if (tu === 'CD to Submit') { n += 25; why.push('closeout docs to submit'); }
  if (tu === 'Implementation & MV Complete') { n += 22; why.push('implementation complete, closeout owed'); }
  if (tu === 'Waiting on Info/Others') { n += 15; why.push('waiting on outside info'); }
  if (p.aging === 'Critical') { n += 30; why.push('60+ days without movement'); }
  else if (p.aging === 'Watch') { n += 12; why.push('30+ days without movement'); }
  if (p.daysInPhase != null && p.daysInPhase > 120) { n += 12; why.push(`${p.daysInPhase} days in phase`); }
  if (!p.ownerNames.length && p.sev !== 'good') { n += 20; why.push('no owner on the next step'); }
  const nx = dparse(p.icfDates && p.icfDates.nextAction);
  if (nx && nx < today) { n += 18; why.push('next-action date has passed'); }
  if (p.sev === 'good') n = Math.max(0, n - 40);
  return { score: n, why };
}
const priorityBand = n => (n >= 60 ? 'critical' : n >= 35 ? 'serious' : n >= 18 ? 'warning' : 'none');

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

/* ---------------------------------------------------------------------------
   The scoreboard.

   One KPI row is one milestone reached by one person on one date, with the
   incentive on it. Everything an engineer is measured on -- audits, pre-
   approvals, closeouts, money -- is a count or a sum over these rows, sliced
   by person and by period. Nothing here comes from the pipeline: a project
   sitting in a phase is not an achievement, and counting it as one is what
   made the old email a wall of numbers nobody read.

   A row can name more than one person. It is credited to each of them rather
   than split, because the question being answered is "did you do this", not
   "how do we divide the money".
--------------------------------------------------------------------------- */
/* Taken from the real today, never from wk.end. Two reasons: the week window
   is exclusive at the top, so deriving today from it lands on yesterday and on
   the last day of a month MONTH_START jumps forward and every month-to-date
   number collapses to zero; and the Monday run's window now ENDS on Sunday, so
   wk.end would put the whole month a week behind. */
const TODAY = new Date(today);
/* Exclusive upper bound for anything measured "as of now" -- month-to-date in
   particular, which must include today even when the week window stops on
   Sunday. */
const NOW_END = new Date(TODAY); NOW_END.setDate(NOW_END.getDate() + 1);
const MONTH_START = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
const PREV_MONTH_START = new Date(MONTH_START.getFullYear(), MONTH_START.getMonth() - 1, 1);
/* Calendar months, named. Ameya asked for the month rather than a rolling
   window: people think in "August" and "September", the goals are set per
   month, and a window that slides is a window nobody can check against their
   own memory of the month. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAME = MONTH_NAMES[MONTH_START.getMonth()];
const PREV_MONTH_NAME = MONTH_NAMES[PREV_MONTH_START.getMonth()];
/* Days gone and days in the month, so a month-to-date figure can be judged
   against the share of the goal due by today rather than the whole month's --
   $80k on the 3rd is not "8% of target", it is ahead of pace. */
const MONTH_ELAPSED = TODAY.getDate();
const MONTH_LENGTH = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0).getDate();
const MONTH_PACE = MONTH_ELAPSED / MONTH_LENGTH;

/* The milestone is the ROW'S GROUP, not its status. The status column carries
   the wording of the moment -- "Scheduled", "Phase 1 Invoiced" -- and the same
   word appears under different groups, while the group says what the row is
   for. Reading the status was what made every count come out zero. */
const G_AUDIT = 'Audits Performed';
const G_PA_SUB = 'Preapprovals Submitted';
const G_PA_RCV = 'Preapprovals Received';
const G_IMPL = 'Implementations Scheduled';
const G_CO_SUB = 'Closeouts Submitted';
const G_CO_RCV = 'Closeouts Received';

const kpiRows = kpiItems.map(it => ({
  name: (it.name || '(untitled)').trim(),
  people: list(it, K.engineer).map(canonName).filter(Boolean),
  milestone: (it.group && it.group.title) || '',
  date: dparse(txt(it, K.date)),
  money: (() => { const n = Number(String(txt(it, K.incentive)).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; })(),
})).filter(r => r.date && r.milestone);

const inWeek = r => inRange(r.date, wk.start, wk.end);
const inMonth = r => inRange(r.date, MONTH_START, NOW_END);
const inPrevMonth = r => inRange(r.date, PREV_MONTH_START, MONTH_START);

/* Count and value one person's milestones over one period. Passing null for
   the person totals the whole team, which is what the comparison rows use. */
function score(person, within) {
  const mine = kpiRows.filter(r => within(r) && (person === null || r.people.includes(person)));
  const of = m => mine.filter(r => r.milestone === m);
  const sum = m => of(m).reduce((a, r) => a + r.money, 0);
  return {
    audits: of(G_AUDIT).length,
    paSubmitted: of(G_PA_SUB).length,
    paReceived: of(G_PA_RCV).length,
    implementations: of(G_IMPL).length,
    coSubmitted: of(G_CO_SUB).length,
    coReceived: of(G_CO_RCV).length,
    money: mine.reduce((a, r) => a + r.money, 0),
    /* Per-milestone money, because the goals are set per milestone: a single
       total cannot say whether the $1m of pre-approvals was met. */
    $paSubmitted: sum(G_PA_SUB), $paReceived: sum(G_PA_RCV),
    $implementations: sum(G_IMPL), $coReceived: sum(G_CO_RCV),
    /* Named, so the email can say WHICH ones -- a count alone tells an
       engineer nothing they can act on or feel good about. */
    paReceivedNames: of(G_PA_RCV).map(r => r.name),
    coReceivedNames: of(G_CO_RCV).map(r => r.name),
  };
}

/* Everyone who reached anything this month or last, so an engineer can see
   where they sit without us hard-coding a roster into the comparison. Two
   months rather than one, or on the 1st the board is empty.

   getsDigest, not isEngineer: the auditors are on this board too, they are the
   ones the audit rows belong to, and a board that leaves them out is one they
   cannot find themselves in. */
const kpiPeople = [...new Set(kpiRows.filter(r => inMonth(r) || inPrevMonth(r)).flatMap(r => r.people))]
  .filter(n => getsDigest(n));

/* Team totals count only what is credited to somebody still here. A third of
   this board's rows carry no assignee or a deleted one, and counting those in
   the total makes every engineer look like a rounding error against it. */
function teamScore(within) {
  const set = new Set(kpiPeople);
  return score(null, r => within(r) && r.people.some(n => set.has(n)));
}

/* ---------------------------------------------------------------------------
   Turnaround: how long ICF sat on it.

   A project reaches "Preapprovals Submitted" on one date and "Preapprovals
   Received" on another; the gap is the wait. Pairing is by project name, on
   the earliest date on each leg, so a resubmission after an RFI does not
   restart the clock and make a slow project look quick.

   Attributed to the window the application came BACK in, not the one it went
   out in -- the question the number answers is "what came back this month and
   how long did it take", which is the only version an engineer can act on.
--------------------------------------------------------------------------- */
function legPairs(subGroup, rcvGroup) {
  const first = new Map();
  for (const r of kpiRows) {
    if (r.milestone !== subGroup && r.milestone !== rcvGroup) continue;
    let e = first.get(r.name);
    if (!e) { e = { sub: null, rcv: null, people: new Set() }; first.set(r.name, e); }
    const k = r.milestone === subGroup ? 'sub' : 'rcv';
    if (!e[k] || r.date < e[k]) e[k] = r.date;
    for (const n of r.people) e.people.add(n);
  }
  const out = [];
  for (const [name, e] of first) {
    if (!e.sub || !e.rcv) continue;
    const days = Math.round((e.rcv - e.sub) / 86400000);
    if (days < 0) continue;   /* backdated data entry, not a real turnaround */
    out.push({ name, days, back: e.rcv, people: [...e.people] });
  }
  return out;
}
/* ---------------------------------------------------------------------------
   The legs HBS controls.

   The turnaround above measures the reviewer: submitted, then approved, with
   nothing HBS does in between. These two are the opposite -- they measure us.

     PA   audit finished        -> application submitted
     CO   implementation done   -> closeout package submitted

   Same definitions the dashboard uses, so the email and the dashboard cannot
   disagree. Averaged, not medianed, because that is what the dashboard shows
   and two different numbers under the same words is worse than either.

   A negative gap is a data-entry order problem, not a fast engineer, and
   anything past two years is a stale date rather than a project; both are
   dropped rather than allowed to move an average nobody could explain.
--------------------------------------------------------------------------- */
const gapDays = (a, b) => (a && b) ? Math.round((b - a) / 86400000) : null;
const sane = d => Number.isFinite(d) && d >= 0 && d <= 720;
const mean = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/* Built once over every project, then sliced by person. Each leg is credited
   to whoever held that end of it -- the PA lead for the application, the CO
   lead for the closeout -- plus the named HBS engineers, matching the
   dashboard's attribution exactly. */
const HBS_LEGS = { pa: [], co: [], impl: [] };
/* Active projects only, which is the set the dashboard measures. Pooling in
   the completed ones as well doubles some engineers' figures, and an email
   that disagrees with the dashboard the same person is looking at is worse
   than either number on its own. */
for (const p of projects) {
  const paD = gapDays(p.ev.scheduled, p.ev.subPA);
  const coD = gapDays(p.ev.impl, p.ev.coSched);
  /* Approval in hand to crew on site. Ameya: this one is not the engineer's,
     it is the operations manager's, so it is reported to management only. */
  const implD = gapDays(p.ev.preapp, p.ev.impl);
  if (sane(paD)) HBS_LEGS.pa.push({ days: paD, who: [...new Set([...p.paLeadNames, ...p.hbsEngs])] });
  if (sane(coD)) HBS_LEGS.co.push({ days: coD, who: [...new Set([...p.coLeadNames, ...p.hbsEngs])] });
  if (sane(implD)) HBS_LEGS.impl.push({ days: implD, who: [] });
}
/* person === null totals the team. */
function legAvg(key, person) {
  const hit = HBS_LEGS[key].filter(l => person === null || l.who.includes(person));
  return { days: mean(hit.map(l => l.days)), n: hit.length };
}

const PA_LEGS = legPairs(G_PA_SUB, G_PA_RCV);
const CO_LEGS = legPairs(G_CO_SUB, G_CO_RCV);

/* The median, not the mean: one project stuck for a year would drag an average
   somewhere no actual project has ever been. */
const median = xs => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
};
function turnaround(legs, person, within) {
  const hit = legs.filter(l => within({ date: l.back }) && (person === null || l.people.includes(person)));
  return { days: median(hit.map(l => l.days)), n: hit.length };
}

const money = n => n >= 1000000 ? `$${(n / 1000000).toFixed(1)}m`
  : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;

/* Email clients strip CSS, so a real chart is out. A bar drawn in block
   characters inside a <pre> renders identically in Outlook, Gmail and on a
   phone, which a styled div does not. */
/* The bars only line up in a monospace font, and Outlook renders a plain-text
   mail in whatever proportional font the reader has set -- which turns every
   chart into ragged noise. So an engineer's mail goes as HTML wrapped in a
   single <pre>: the one tag that guarantees monospace and preserved spacing,
   and one of the few the mail sanitiser allows through. */
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function bar(value, max, width = 14) {
  if (!(max > 0)) return '\u2591'.repeat(width);
  const n = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  return '\u2588'.repeat(n) + '\u2591'.repeat(width - n);
}

/* ---------------------------------------------------------------------------
   One description, two renderings.

   Ameya asked for the lists as tables. A table is the right shape for them --
   a project, its company, how long it has waited and when it is due are four
   facts about one row, and reading them off a run-on line is work. But the
   envelope also carries a plain-text copy for the transcript and for anyone
   whose client refuses HTML, so every section is described once and rendered
   twice: as real <table> markup, and as padded monospace columns.

   The bars survive both. A run of the same block character lines up in any
   font, proportional or not, because every glyph in it is the same width --
   which is why the charts can leave <pre> and live in table cells.
--------------------------------------------------------------------------- */
function doc() {
  const H = [], L = [];
  const cell = (v) => (v == null ? '' : String(v));
  return {
    text: () => L.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    html: () => H.join('\n'),
    p(t) { H.push(`<p>${esc(t)}</p>`); L.push(t, ''); },
    h(t) { H.push(`<h3>${esc(t)}</h3>`); L.push('', t.toUpperCase()); },
    note(t) { H.push(`<p><i>${esc(t)}</i></p>`); L.push(t, ''); },
    bullets(items) {
      H.push('<ul>' + items.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>');
      for (const t of items) L.push(`  \u2713 ${t}`);
      L.push('');
    },
    /* cols: [{h, align, w}] -- w caps the text rendering only, so one long
       project name cannot push every other column off the screen. */
    table(cols, rows, mark = () => false) {
      /* The mail sanitiser keeps the table tags and drops every attribute on
         them -- border, cellpadding and cellspacing all go -- so a table
         arrives with no gridlines and its columns touching. Verified by
         sending one and reading it back out of Sent Items.

         Padding cannot be an attribute, so it is content: a non-breaking
         space either side of every cell. It survives sanitising because it is
         text, and it gives the columns the gutter the stylesheet cannot. */
      const pad = html => `&nbsp;${html}&nbsp;`;
      H.push('<table>');
      H.push('<thead><tr>' + cols.map(c => `<th>${pad(`<b>${esc(c.h)}</b>`)}</th>`).join('') + '</tr></thead><tbody>');
      for (const r of rows) {
        const on = mark(r);
        H.push('<tr>' + r.map(v => `<td>${pad(on ? `<b>${esc(cell(v))}</b>` : esc(cell(v)))}</td>`).join('') + '</tr>');
      }
      H.push('</tbody></table>');

      const clip = (v, w) => { const t = cell(v); return w && t.length > w ? t.slice(0, w - 1) + '\u2026' : t; };
      const wide = cols.map((c, i) => Math.max(c.h.length, ...rows.map(r => clip(r[i], c.w).length)));
      const lay = (vals, pad) => '  ' + vals.map((v, i) =>
        cols[i].align === 'r' ? String(v).padStart(wide[i]) : String(v).padEnd(wide[i])).join('  ').replace(/\s+$/, '');
      L.push(lay(cols.map(c => c.h)));
      L.push('  ' + wide.map(w => '\u2500'.repeat(w)).join('  '));
      for (const r of rows) {
        const line = lay(r.map((v, i) => clip(v, cols[i].w)));
        L.push(mark(r) ? '>' + line.slice(1) : line);
      }
      L.push('');
    },
  };
}

const workTasks = [];
for (const [items, kind] of [[paWorkItems, 'Pre-approval'], [coWorkItems, 'Closeout']]) {
  for (const it of items) {
    const group = (it.group && it.group.title) || '';
    const st = txt(it, W.status);
    /* Finished and cancelled rows are not somebody's week. */
    if (WORK_DONE_GROUPS.has(group) || txt(it, W.done) || st === 'Done' || st === 'Cancelled') continue;
    /* The workload board's own status column is empty on every row, so the
       only usable status is the one mirrored from the project tracker behind
       it -- and that is where a finished BPTU phase shows up. A row reading
       "Phase 1 Invoiced" has been done and billed; leaving it on a to-do list
       is asking someone to redo paid work. */
    if (WORK_FINISHED_STATUS.has(txt(it, M.status))) continue;

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
const ICF_RFI_STATES = new Set(['', 'RFI Sent to HBS', 'RFI Respond by HBS', 'Flawed', 'Flawed ARC',
  'Flawed Tech Review', 'Flawed Post Tech Review']);

/* "With HBS" was covering two different things. Of the 28 on Devashis's list,
   22 were installations under way, invoices out and payments processing --
   work moving through HBS that ICF is not waiting on and cannot act on.
   Filing those under "we owe you a response" overstated our debt to a
   reviewer by a factor of four and buried the six that were real.

   Owed means the project is stopped until HBS does something the reviewer is
   waiting for. Everything else is simply in progress. */
const ICF_OWED_STATES = new Set(['RFI Sent to HBS', 'RFI Respond by HBS', 'Flawed', 'Flawed ARC',
  'Flawed Tech Review', 'Flawed Post Tech Review',
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
/* Scored here rather than beside scoreProject: the scorer reads rfiSide, which
   is defined just above, and running the loop earlier would hit it in its
   temporal dead zone. Nothing between the two points reads p.priority. */
for (const p of projects) {
  const sc = scoreProject(p);
  p.priority = sc.score; p.priorityWhy = sc.why; p.band = priorityBand(sc.score);
  /* Scored a second time with the TU tracker withheld, so a reviewer's list can
     be ordered without any column they are not entitled to see. */
  const shared = scoreProject(p, { sharedOnly: true });
  p.priorityShared = shared.score; p.priorityWhyShared = shared.why;
}

function rfiRule(p) {
  if (!ICF_RFI_STATES.has(p.icfStatus || '')) return null;
  if (p.tuStatus === 'TRC/ICF RFI Responded')
    return { need: 'HBS has answered the RFI \u2014 awaiting your re-review', role: 'icf' };
  if (p.tuStatus === 'TRC/ICF RFI Received')
    return { need: 'RFI with HBS \u2014 response owed to you', role: 'hbs' };
  return null;
}

function reviewDigestBody(name, side, mine, departed) {
  /* THE WHITELIST. Every fact a reviewer is allowed to see is copied out here,
     and nothing below this projection may touch `p` again. It is what keeps a
     redesign from quietly widening what leaves the building: to add a column
     to their email you have to add it here, deliberately, and every field here
     is one already on the board we share with them.

     The one deliberate exception is `rule`, which may consult the TU tracker
     to decide who holds an RFI -- see below. One fact crosses over, never the
     note or anything else on that board. */
  const rows = mine.map(p => ({
    name: p.name, projectId: p.projectId, utility: p.utility, type: p.type,
    phase: p.phase, status: p.icfStatus, d: p.icfDates,
    /* Who holds an RFI is decided by the TU tracker, not by the shared board.

       The shared board's status lags: of the 21 projects HBS has answered an
       RFI on, 12 still read "RFI Respond by HBS" there. Taking that at face
       value told the reviewer we owed them a response on work we had already
       returned -- the exact opposite of the truth, on the one status where
       being wrong costs a week. The TU tracker is the board an engineer
       actually updates when they answer, so it wins. */
    rule: rfiRule(p) || ICF_ACTIONS[p.icfStatus] || null,
    owed: owedToIcf(p),
    /* Shared-board columns, all of them visible to this reader already. */
    days: p.daysInPhase, aging: p.aging,
    next: (p.icfDates && p.icfDates.nextAction || '').slice(0, 10),
    /* Scored WITHOUT the TU tracker, so the ORDER of their list cannot leak a
       column they are not entitled to see. */
    pri: p.priorityShared, priWhy: p.priorityWhyShared,
  }));

  const onIcf   = rows.filter(r => r.rule && r.rule.role !== 'hbs');
  const onHbs   = rows.filter(r => r.rule && r.rule.role === 'hbs' && r.owed);
  const running = rows.filter(r => r.rule && r.rule.role === 'hbs' && !r.owed);
  const quiet   = rows.filter(r => !r.rule);

  /* One ranked order across everything of theirs, so "which of these first"
     has an answer. Only the ones actually waiting on them: a reviewer's
     priority list full of projects sitting at HBS is our to-do list. */
  const ranked = onIcf.filter(r => r.pri >= 18)
    .sort((a, b) => b.pri - a.pri || (b.days || 0) - (a.days || 0) || a.name.localeCompare(b.name));
  const priority = ranked.slice(0, 12);

  const D = doc();
  /* A departed reviewer's queue is not "your project update" -- it is a
     handover, read by someone who has never seen these projects. Address it
     to the leads and say up front why it has arrived, or the first line
     greets a person who no longer works there. */
  if (departed) {
    D.p('Hello,');
    D.p(`${name} is no longer at ${side}, but ${rows.length} HBS project${rows.length === 1 ? ' is' : 's are'} `
      + `still assigned to ${name} on the shared tracker, so they currently reach no reviewer. `
      + `Below is where each one stands as of ${new Date().toDateString()}, so they can be reassigned.`);
  } else {
    const first = /\s/.test(name) ? name.split(' ')[0] : name;
    D.p(`Hi ${first},`);
    D.p(`Here is the current state of the ${rows.length} HBS project${rows.length === 1 ? '' : 's'} `
      + `assigned to you, as of ${new Date().toDateString()}.`);
  }

  /* ---- whose turn it is. The first question a reviewer actually has is how
     much of this pile is theirs, and it is the one number the old email made
     them count for themselves. ---- */
  const turn = [
    [`With you at ${side}`, onIcf.length],
    ['With HBS — we owe you a response', onHbs.length],
    ['Moving at HBS — nothing needed from you', running.length],
  ].filter(t => t[1]);
  if (turn.length) {
    const top = Math.max(1, ...turn.map(t => t[1]));
    D.h('Whose turn it is');
    D.table(
      [{ h: 'Side', w: 40 }, { h: 'Projects', align: 'r' }, { h: 'Share' }, { h: '%', align: 'r' }],
      turn.map(([l, n]) => [l, n, bar(n, top), `${Math.round((n / Math.max(1, rows.length)) * 100)}%`]));
  }

  const idCell = r => r.name + (r.projectId ? ` (${r.projectId})` : '');

  if (priority.length) {
    D.h(`Your priority list — start at the top (${priority.length})`);
    const top = Math.max(1, ...priority.map(r => r.pri));
    D.table(
      [{ h: '#', align: 'r' }, { h: 'Project', w: 42 }, { h: 'What it needs', w: 40 },
       { h: 'Why it is ranked here', w: 38 }, { h: 'Score' },
       { h: 'In phase', align: 'r' }, { h: 'Next action due' }],
      priority.map((r, i) => [i + 1, idCell(r), r.rule.need, r.priWhy.join(', '),
        `${bar(r.pri, top)} ${r.pri}`, r.days == null ? '' : `${r.days}d`, r.next]),
      row => row[0] <= 3);
    D.note('Ranked automatically from the shared tracker: how long each has sat without movement, '
      + 'whether its next-action date has passed, and whether a reviewer is named on it. '
      + 'The reason is printed so you can see why each one sits where it does. Top three in bold.');
    if (ranked.length > priority.length)
      D.note(`Showing the top ${priority.length} of ${ranked.length} that scored.`);
  }

  const listCols = [
    { h: 'Project', w: 42 }, { h: 'Status', w: 26 }, { h: 'What it needs', w: 42 },
    { h: 'In phase', align: 'r' }, { h: 'Next action due' },
  ];
  const listRow = r => [idCell(r), r.status || r.phase, r.rule ? r.rule.need : '',
    r.days == null ? '' : `${r.days}d`, r.next];
  const byAge = (a, b) => (b.days || 0) - (a.days || 0);

  if (onIcf.length) {
    D.h(`With ${side} (${onIcf.length})`);
    D.table(listCols, [...onIcf].sort(byAge).map(listRow));
  }
  if (onHbs.length) {
    D.h(`With HBS — we owe you a response (${onHbs.length})`);
    D.table(listCols, [...onHbs].sort(byAge).map(listRow));
  }
  if (running.length) {
    D.h(`Moving at HBS — nothing needed from you (${running.length})`);
    D.table(listCols, [...running].sort(byAge).map(listRow));
  }
  if (quiet.length) {
    D.h(`No status recorded (${quiet.length})`);
    D.table(
      [{ h: 'Project', w: 42 }, { h: 'Phase', w: 26 }, { h: 'In phase', align: 'r' }],
      [...quiet].sort(byAge).map(r => [idCell(r), r.phase, r.days == null ? '' : `${r.days}d`]));
    D.note('These carry no status on the shared tracker, so neither side can see what they are '
      + 'waiting on. Setting a status on them is the fastest thing on this email.');
  }

  const dated = rows.filter(r => r.d.submittedPA || r.d.paDate || r.d.submittedCO || r.d.coDate);
  if (dated.length) {
    D.h(`Dates on record (${dated.length})`);
    D.table(
      [{ h: 'Project', w: 42 }, { h: 'PA submitted' }, { h: 'PA approved' },
       { h: 'CO submitted' }, { h: 'CO paid' }],
      dated.map(r => [idCell(r), r.d.submittedPA || '', r.d.paDate || '',
        r.d.submittedCO || '', r.d.coDate || '']));
  }

  D.note(`Automated from the shared ${side}/HBS Project Tracker.`);
  return { text: D.text(), html: D.html(),
    counts: { active: rows.length, yours: onIcf.length, ageing: 0, moved: 0 } };
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

function digestBody(name, org, mine, work = [], phaseByTu = new Map(), departed = null) {
  /* Both reviewer sides get the reviewer body. Falling through to the HBS one
     because the org happened not to be the string 'ICF' would put internal
     workload boards, admin notes and the team scoreboard in front of an
     outside company. */
  if (org === 'ICF' || org === 'TRC') return reviewDigestBody(name, org, mine, departed);

  /* Implementation is the crew's job, not the engineer's. Ameya asked for it
     out of this email entirely, so it is dropped before anything is counted --
     not hidden in a section further down where it still pads every total. */
  const IMPL_PHASE = 'Implementation Phase';
  const book = mine.filter(p => p.phase !== IMPL_PHASE);

  const owns = p => !p.ownerNames.length || p.ownerNames.includes(name);
  const yours   = book.filter(p => (p.sev === 'critical' || p.sev === 'serious') && owns(p));
  const ageing  = book.filter(p => p.aging === 'Critical' && !yours.includes(p));

  const D = doc();
  const first = /\s/.test(name) ? name.split(' ')[0] : name;
  const phaseOf = p => p.phase || 'no phase set';
  /* BPTU projects are carried as two rows, "(Phase 1)" and "(Phase 2)", on the
     BGE BPTU Tracker rather than the Master TU Tracker -- so the phase map,
     which is built from the TU tracker, has nothing for them and they used to
     print with no phase at all. The phase is in the project's own name.

     Phase 1 is the audit AND the pre-approval documents -- our report and our
     calculations -- which is why an RFI can land on a phase 1 row. Calling it
     just "audit" would tell an engineer an RFI on it was somebody else's.
     Phase 2 is the implementation. */
  const bptuPhase = nm => {
    const m = /\(Phase ([12])\)\s*$/.exec(nm || '');
    return m ? (m[1] === '1' ? 'BPTU phase 1 — audit + pre-approval' : 'BPTU phase 2 — implementation') : '';
  };
  const workPhase = t => (t.tuIds || []).map(id => phaseByTu.get(id)).find(Boolean) || bptuPhase(t.name);

  const rfis   = work.filter(t => t.rfi);
  const paWork = work.filter(t => !t.rfi && t.kind === 'Pre-approval');
  const coWork = work.filter(t => !t.rfi && t.kind === 'Closeout');

  const wkMe = score(name, inWeek);
  const moMe = score(name, inMonth), moPrev = score(name, inPrevMonth);
  const moTeam = teamScore(inMonth), prevTeam = teamScore(inPrevMonth);
  const heads = Math.max(1, kpiPeople.length);

  const MONTH_SO_FAR = `${MONTH_NAME} so far`;
  /* Ameya: "Tre is only doing audits so no other data for him. Just his audits
     and team screenshots. Also the RFIs for projects he audited."

     An auditor never builds a pre-approval or a closeout, so every PA and CO
     row on their email is a guaranteed zero and every board list below is
     somebody else's queue. Showing them is not neutral -- it buries the one
     number that is theirs under eight that never move. So an audit-only
     digest is the audit line, the team picture, and the RFIs that came back
     on projects they audited: the only desk work an audit is ever the cause
     of, and already routed to them because the RFI owner list reads the TU
     tracker's auditor column. */
  const auditOnly = isAuditor(name) && !isEngineer(name);
  D.p(`Hi ${first},`);

  /* ---- the snapshot, first, because it is the only part that answers "how am
     I doing" -- everything below it is a task list, and a task list at the top
     is what made this email something people scrolled past. ---- */
  D.h(`Your scorecard — week ${WEEK_COL}, ${MONTH_NAME} (${MONTH_ELAPSED} of ${MONTH_LENGTH} days), ${PREV_MONTH_NAME}`);
  const paMe = turnaround(PA_LEGS, name, inMonth), coMe = turnaround(CO_LEGS, name, inMonth);
  const paMePrev = turnaround(PA_LEGS, name, inPrevMonth), coMePrev = turnaround(CO_LEGS, name, inPrevMonth);
  /* A median over one or two projects is not a turnaround, it is one project.
     The sample size travels with the number so nobody reads a single slow
     application as a trend, and below three it is not shown at all. */
  const days = t => (t.days == null || t.n < 3 ? (t.n ? `— (${t.n})` : '—') : `${t.days}d (${t.n})`);
  const scoreRows = auditOnly
    ? [['Audits', wkMe.audits, moMe.audits, moPrev.audits]]
    : [
      ['Audits',                    wkMe.audits,          moMe.audits,          moPrev.audits],
      ['PAs submitted',             wkMe.paSubmitted,     moMe.paSubmitted,     moPrev.paSubmitted],
      ['PAs approved by ICF',       wkMe.paReceived,      moMe.paReceived,      moPrev.paReceived],
      ['Implementations scheduled', wkMe.implementations, moMe.implementations, moPrev.implementations],
      ['COs submitted',             wkMe.coSubmitted,     moMe.coSubmitted,     moPrev.coSubmitted],
      ['COs paid',                  wkMe.coReceived,      moMe.coReceived,      moPrev.coReceived],
      ['Incentive',                 money(wkMe.money),    money(moMe.money),    money(moPrev.money)],
      /* Turnaround is a median over what came back in that window, so a week
         rarely holds enough of them to mean anything -- hence months only. */
      ['PA turnaround (median)',    '',                   days(paMe),           days(paMePrev)],
      ['CO turnaround (median)',    '',                   days(coMe),           days(coMePrev)],
    ];
  D.table(
    [{ h: 'Metric', w: 26 }, { h: WEEK_COL, align: 'r' },
     { h: MONTH_SO_FAR, align: 'r' }, { h: PREV_MONTH_NAME, align: 'r' }],
    scoreRows);
  D.note(WEEK_NOTE);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const yourLine = (s, label) => auditOnly
    ? `Your ${label}: ${plural(s.audits, 'audit', 'audits')}`
    : `Your ${label}: ${plural(s.audits, 'audit', 'audits')} · `
      + `${plural(s.paSubmitted, 'PA', 'PAs')} · ${plural(s.implementations, 'implementation', 'implementations')} · `
      + `${plural(s.coSubmitted, 'CO', 'COs')} · ${money(s.money)}`;
  D.note(yourLine(moMe, MONTH_SO_FAR));
  D.note(yourLine(moPrev, PREV_MONTH_NAME));

  /* ---- the goals. They are team goals for a whole month, so the honest
     comparison is against the share due by today, and an individual's share is
     shown as an even split with that said out loud rather than implied. ---- */
  const goalRows = [
    ['PAs submitted to ICF', GOALS.paSubmitted,     moTeam.$paSubmitted,     moMe.$paSubmitted],
    ['PAs approved by ICF',  GOALS.paReceived,      moTeam.$paReceived,      moMe.$paReceived],
    ['Implementations',      GOALS.implementations, moTeam.$implementations, moMe.$implementations],
    ['Closeouts paid',       GOALS.coReceived,      moTeam.$coReceived,      moMe.$coReceived],
  ].filter(r => r[1]);
  if (goalRows.length) {
    D.h(`Team goals — ${MONTH_NAME}`);
    D.table(
      [{ h: 'Goal', w: 24 }, { h: 'Team so far', align: 'r' }, { h: 'Goal', align: 'r' },
       { h: 'Progress' }, { h: 'Against pace', w: 22 }, { h: 'Yours', align: 'r' }],
      goalRows.map(([label, goal, team, mineOf]) => {
        const due = goal * MONTH_PACE;
        const pace = team >= goal ? 'goal met'
          : team >= due ? `on pace, ${money(goal - team)} to go`
          : `behind by ${money(due - team)}`;
        return [label, money(team), money(goal), `${bar(team, goal)} ${Math.round((team / goal) * 100)}%`,
          pace, money(mineOf)];
      }));
    /* Ameya: "$1m is a milestone for the entire team. I do not have per
       engineer goals." So the goal is never divided by head. The "Yours"
       column is what this person put into the team's number, which is a
       contribution, not a target they are being measured against. */
    D.note('These are milestones for the whole team over the whole month — there are no '
      + 'per-engineer goals. "Yours" is what you have contributed to the team number so far.');
  }

  /* ---- where you sit. Ranked, because "who is doing better" was the ask, and
     a rank you can see yourself in is the whole reason to read on. ---- */
  if (kpiPeople.length > 1) {
    const rank = kpiPeople
      .map(n => ({ n, s: score(n, inMonth), prev: score(n, inPrevMonth) }))
      .map(r => ({ ...r, done: r.s.audits + r.s.paSubmitted + r.s.coSubmitted }))
      .sort((a, b) => b.done - a.done || b.s.money - a.s.money);
    const top = Math.max(1, ...rank.map(r => r.done));
    const mineAt = rank.findIndex(r => r.n === name);
    D.h(`Team board — ${MONTH_NAME}${mineAt >= 0 ? `, you are ${mineAt + 1} of ${rank.length}` : ''}`);
    /* The three counts are shown beside the bar, not folded into it, because an
       auditor's 13 audits and an engineer's 13 pre-approvals are not the same
       work and a single ranked number would quietly claim they were. */
    D.table(
      [{ h: 'Engineer', w: 18 }, { h: `${MONTH_NAME} — audits + PAs + COs` },
       { h: 'Aud', align: 'r' }, { h: 'PA', align: 'r' }, { h: 'CO', align: 'r' }, { h: 'Incentive', align: 'r' },
       { h: `${PREV_MONTH_NAME} aud`, align: 'r' }, { h: 'PA', align: 'r' }, { h: 'CO', align: 'r' },
       { h: 'Incentive', align: 'r' }],
      rank.map(r => [r.n === name ? `${r.n.split(' ')[0]} (you)` : r.n.split(' ')[0],
        `${bar(r.done, top)} ${r.done}`,
        r.s.audits, r.s.paSubmitted, r.s.coSubmitted, money(r.s.money),
        r.prev.audits, r.prev.paSubmitted, r.prev.coSubmitted, money(r.prev.money)]),
      row => String(row[0]).endsWith('(you)'));
    const teamLine = (s, label) => `Team, ${label}: ${plural(s.audits, 'audit', 'audits')} · `
      + `${plural(s.paSubmitted, 'PA', 'PAs')} · ${plural(s.implementations, 'implementation', 'implementations')} · `
      + `${plural(s.coSubmitted, 'CO', 'COs')} · ${money(s.money)}`
      + `  (per head: ${(s.audits / heads).toFixed(1)} · ${(s.paSubmitted / heads).toFixed(1)} · `
      + `${(s.coSubmitted / heads).toFixed(1)} · ${money(s.money / heads)})`;
    D.note(teamLine(moTeam, MONTH_SO_FAR));
    D.note(teamLine(prevTeam, PREV_MONTH_NAME));

    /* Two different things, kept apart on purpose. One measures us and can be
       worked on; the other measures the reviewer and cannot. Putting them in
       one table under one heading was how "days" stopped meaning anything. */
    const avg = t => (t.days == null ? '—' : `${t.days}d (${t.n})`);
    D.h('Days you control');
    D.table(
      [{ h: 'Leg', w: 34 }, { h: 'You', align: 'r' }, { h: 'Team', align: 'r' }],
      [['Audit finished → PA submitted',  avg(legAvg('pa', name)), avg(legAvg('pa', null))],
       ['Implementation → CO submitted',  avg(legAvg('co', name)), avg(legAvg('co', null))]]);
    D.note('Average days with the number of projects behind it in brackets, over every project '
      + 'with both dates on the board. This is the part of the calendar that is ours: the time '
      + 'between the work being finished and the paperwork going in.');

    const paT = turnaround(PA_LEGS, null, inMonth), coT = turnaround(CO_LEGS, null, inMonth);
    const paTPrev = turnaround(PA_LEGS, null, inPrevMonth), coTPrev = turnaround(CO_LEGS, null, inPrevMonth);
    D.h('Days the reviewer controls');
    D.table(
      [{ h: 'Leg', w: 30 }, { h: `You, ${MONTH_NAME}`, align: 'r' }, { h: `Team, ${MONTH_NAME}`, align: 'r' },
       { h: `You, ${PREV_MONTH_NAME}`, align: 'r' }, { h: `Team, ${PREV_MONTH_NAME}`, align: 'r' }],
      [['PA submitted → approved', days(paMe), days(paT), days(paMePrev), days(paTPrev)],
       ['CO submitted → paid',     days(coMe), days(coT), days(coMePrev), days(coTPrev)]]);
    D.note(`Median days with the number of projects behind it in brackets, counted on what came `
      + `back in the month rather than what went out. Nothing we do moves these. Team-wide this `
      + `month: ${plural(paT.n, 'pre-approval', 'pre-approvals')} and `
      + `${plural(coT.n, 'closeout', 'closeouts')} back.`);
  }

  /* ---- the good news, named. A number in a scoreboard is abstract; the
     address of the building you got approved is not. ---- */
  if (wkMe.paReceivedNames.length) {
    D.h(`Pre-approved by ICF this week (${wkMe.paReceivedNames.length})`);
    D.bullets(wkMe.paReceivedNames);
  }
  if (wkMe.coReceivedNames.length) {
    D.h(`Closed out — payment received this week (${wkMe.coReceivedNames.length})`);
    D.bullets(wkMe.coReceivedNames);
  }

  /* ---- now the work. Ameya asked for a due date on every row, so each list is
     a table: the project, who it is for, where it stands, how long it has sat
     and when it is owed. ---- */
  const deskCols = [
    { h: 'Waiting', align: 'r' }, { h: 'Due' }, { h: 'Project', w: 46 }, { h: 'Company', w: 24 },
    { h: 'Utility', w: 16 }, { h: 'Status', w: 26 }, { h: 'Phase', w: 22 },
  ];
  const deskRow = t => [
    t.waiting == null ? '' : `${t.waiting}d`,
    t.due || '',
    t.name,
    t.company + (t.source && t.source !== 'HBS' ? ` (via ${t.source})` : ''),
    [t.utility, t.projType].filter(Boolean).join(' '),
    workStatus(t),
    workPhase(t),
  ];
  const byAge = (a, b) => (b.waiting || 0) - (a.waiting || 0);

  /* ---- the priority list: one ranked order across the whole book, so the
     answer to "what do I do first" is a number and not a judgement call.

     Scored by the same rules the dashboard's ASAP tab uses, and the reason is
     printed beside the rank -- a ranking nobody can see the working of is one
     nobody trusts, and the reason is also the fix.

     Only projects where the next step is theirs, or where nobody is named at
     all: ranking someone else's queue into a person's to-do list is how a
     priority list stops being read. An auditor has no project book to rank --
     they audit and hand over -- so theirs stays out. ---- */
  const ranked = auditOnly ? [] : book
    .filter(p => owns(p) && p.band !== 'none')
    .sort((a, b) => b.priority - a.priority
      || (b.daysInPhase || 0) - (a.daysInPhase || 0)
      || a.name.localeCompare(b.name));
  const priorityList = ranked.slice(0, 12);
  if (priorityList.length) {
    const top = Math.max(1, ...priorityList.map(p => p.priority));
    D.h(`Your priority list — start at the top (${priorityList.length})`);
    D.table(
      [{ h: '#', align: 'r' }, { h: 'Project', w: 40 }, { h: 'What it needs', w: 40 },
       { h: 'Why it is ranked here', w: 40 }, { h: 'Score' },
       { h: 'In phase', align: 'r' }, { h: 'Due' }],
      priorityList.map((p, i) => [
        i + 1, p.name, p.need, p.priorityWhy.join(', '),
        `${bar(p.priority, top)} ${p.priority}`,
        p.daysInPhase == null ? '' : `${p.daysInPhase}d`,
        (p.icfDates && p.icfDates.nextAction || '').slice(0, 10),
      ]),
      row => row[0] <= 3);
    D.note('Ranked by the same automatic score the dashboard uses: an open RFI, a flawed '
      + 'application, days without movement, a passed next-action date, nobody named on the '
      + 'next step. Nothing here is a judgement about you — it is what the boards say is '
      + 'waiting longest and costing most. The top three are in bold.');
    /* The denominator is the projects that SCORED, not the whole book. "Top 12
       of 300" would read as though 288 more were waiting on this person when
       most of them are running perfectly well. */
    if (ranked.length > priorityList.length)
      D.note(`Showing the top ${priorityList.length} of ${ranked.length} that scored; `
        + `the rest of your book has nothing flagged against it.`);
  }

  if (rfis.length) {
    D.h(auditOnly
      ? `⚠ RFIs on projects you audited — answer these first (${rfis.length})`
      : `⚠ RFIs pending — answer these first (${rfis.length})`);
    D.table(deskCols, [...rfis].sort(byAge).map(deskRow));
  }
  if (!auditOnly && paWork.length) {
    D.h(`Pre-approval board (${paWork.length})`);
    D.table(deskCols, [...paWork].sort(byAge).map(deskRow));
  }
  if (!auditOnly && coWork.length) {
    D.h(`Closeout board (${coWork.length})`);
    D.table(deskCols, [...coWork].sort(byAge).map(deskRow));
  }
  if (!auditOnly && !work.length) D.p('Nothing queued on the pre-approval or closeout boards.');
  if (auditOnly && !rfis.length) D.p('No RFIs open on anything you audited.');
  /* The due date is a real column on both workload boards, it is simply empty
     on most rows. Saying so turns a blank column from something that looks
     broken into something somebody can go and fill in. */
  const undated = work.filter(t => !t.due).length;
  if (!auditOnly && work.length && undated) {
    D.note(`${undated} of your ${work.length} board row${work.length === 1 ? '' : 's'} `
      + `${undated === 1 ? 'has' : 'have'} no due date set on monday. `
      + `A row with no date cannot be chased or prioritised — set one and it shows up here.`);
  }

  /* ---- anything else that is genuinely stuck. Uncapped now that it is a
     table: the cap existed because a run of long lines became a wall, and
     eleven table rows do not. ---- */
  const stuck = auditOnly ? [] : [...new Set([...yours, ...ageing])]
    .sort((a, b) => (b.daysInPhase || 0) - (a.daysInPhase || 0));
  if (stuck.length) {
    D.h(`Also needs you (${stuck.length})`);
    D.table(
      [{ h: 'In phase', align: 'r' }, { h: 'Next action due' }, { h: 'Project', w: 46 },
       { h: 'Phase', w: 22 }, { h: 'What it needs', w: 46 }],
      stuck.map(p => [p.daysInPhase == null ? '' : `${p.daysInPhase}d`,
        (p.icfDates && p.icfDates.nextAction || '').slice(0, 10),
        p.name, phaseOf(p), p.need]));
  }

  /* "Projects in hand" counts a book an auditor does not carry -- they audit a
     site and hand it on -- so it would be a number they cannot act on. */
  if (!auditOnly) {
    D.p(`You have ${book.length} project${book.length === 1 ? '' : 's'} in hand, implementation excluded.`);
  }
  D.note('This is an automated weekly update built from the monday.com trackers. '
    + 'Reply to Ameya if anything here looks wrong.');

  return { text: D.text(), html: D.html(), counts: {
    active: book.length, yours: yours.length, ageing: ageing.length,
    work: work.length, rfis: rfis.length, pa: paWork.length, co: coWork.length,
    wkAudits: wkMe.audits, wkPa: wkMe.paSubmitted, wkCo: wkMe.coSubmitted, wkMoney: wkMe.money } };
}

/* ---------------------------------------------------------------------------
   The portfolio summary for HBS management.

   Mike, Harry, Devon and David already get the roll-up, which is the
   operational detail -- every project with an action owed, the per-engineer
   table, the board hygiene. This is the other half: where the portfolio
   actually stands, short enough to read on a phone.

   Unlike the ICF summary this one is internal, so it is not restricted to the
   shared board. It reads the Master TU and BPTU trackers and the two workload
   boards as well, which is the only way to answer "whose turn is it" across
   the whole book of work.
--------------------------------------------------------------------------- */
function hbsSummaryBody() {
  const ruleOf = p => TU_ACTIONS[p.tuStatus] || ICF_ACTIONS[p.icfStatus]
                   || PHASE_FALLBACK[p.phase] || null;
  const roleOf = p => { const r = ruleOf(p); return r && r.role ? r.role : null; };
  const HBS_ROLES = new Set(['hbs', 'auditor', 'paLead', 'coLead']);

  const onHbs = projects.filter(p => HBS_ROLES.has(roleOf(p)));
  const onIcf = projects.filter(p => roleOf(p) === 'icf');
  const idle  = projects.filter(p => !roleOf(p));

  /* Same builder the engineers' mail uses, for the same reason: management
     asked for the charts they saw on that one. Every section is described
     once and comes out twice -- as real tables for the HTML body, and as
     padded monospace columns for the plain-text copy. */
  const D = doc();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const icfSide = projects.filter(p => p.side === 'ICF');
  const trcSide = projects.filter(p => p.side === 'TRC');

  D.p(`${projects.length} active projects across the Master TU, BPTU and both reviewer trackers.`);
  D.note(WEEK_NOTE);

  /* ---- whose turn it is, first: it is the one number that says whether the
     portfolio is blocked on us or on somebody else. ---- */
  const turnRows = [
    ['Ours to move',            onHbs.length],
    ['With a reviewer',         onIcf.length],
    ['No status to act on',     idle.length],
  ];
  const turnTop = Math.max(1, ...turnRows.map(r => r[1]));
  D.h('Whose turn it is');
  D.table(
    [{ h: 'Side', w: 22 }, { h: 'Projects', align: 'r' }, { h: 'Share' }, { h: '%', align: 'r' }],
    turnRows.map(([l, n]) => [l, n, bar(n, turnTop),
      `${Math.round((n / Math.max(1, projects.length)) * 100)}%`]));
  const trcOwed = trcSide.filter(p => HBS_ROLES.has(roleOf(p))).length;
  D.note(`Reviewed by ${icfSide.length} ICF · ${trcSide.length} TRC`
    + (trcSide.length ? ` (${trcOwed} of the TRC ones on us)` : '') + '. '
    + 'The third row is board hygiene, not work — those projects carry no status anyone can act on.');

  /* ---- the goals. Team milestones over a whole month, so the honest read is
     against the share due by today, not against the full month on day one. ---- */
  const moTeam = teamScore(inMonth), prevTeam = teamScore(inPrevMonth);
  const goalRows = [
    ['PAs submitted to ICF', GOALS.paSubmitted,     moTeam.$paSubmitted,     prevTeam.$paSubmitted],
    ['PAs approved by ICF',  GOALS.paReceived,      moTeam.$paReceived,      prevTeam.$paReceived],
    ['Implementations',      GOALS.implementations, moTeam.$implementations, prevTeam.$implementations],
    ['Closeouts paid',       GOALS.coReceived,      moTeam.$coReceived,      prevTeam.$coReceived],
  ].filter(r => r[1]);
  if (goalRows.length) {
    D.h(`Team goals — ${MONTH_NAME} (${MONTH_ELAPSED} of ${MONTH_LENGTH} days gone)`);
    D.table(
      [{ h: 'Milestone', w: 24 }, { h: 'So far', align: 'r' }, { h: 'Goal', align: 'r' },
       { h: 'Progress' }, { h: 'Against pace', w: 24 }, { h: PREV_MONTH_NAME, align: 'r' }],
      goalRows.map(([label, goal, team, prev]) => {
        const due = goal * MONTH_PACE;
        const pace = team >= goal ? 'goal met'
          : team >= due ? `on pace, ${money(goal - team)} to go`
          : `behind by ${money(due - team)}`;
        return [label, money(team), money(goal), `${bar(team, goal)} ${Math.round((team / goal) * 100)}%`,
          pace, money(prev)];
      }));
    D.note(`Each milestone is $1m for the whole team over the whole month — there are no per-engineer `
      + `goals. "Against pace" compares what is in against the ${Math.round(MONTH_PACE * 100)}% of the `
      + `month that has gone.`);
  }

  /* ---- who is doing the work. The same board the engineers see, so nobody is
     being measured on a number they were never shown. ---- */
  if (kpiPeople.length > 1) {
    const rank = kpiPeople
      .map(n => ({ n, s: score(n, inMonth), prev: score(n, inPrevMonth) }))
      .map(r => ({ ...r, done: r.s.audits + r.s.paSubmitted + r.s.coSubmitted }))
      .sort((a, b) => b.done - a.done || b.s.money - a.s.money);
    const top = Math.max(1, ...rank.map(r => r.done));
    D.h(`Team board — ${MONTH_NAME}`);
    D.table(
      [{ h: 'Engineer', w: 18 }, { h: `${MONTH_NAME} — audits + PAs + COs` },
       { h: 'Aud', align: 'r' }, { h: 'PA', align: 'r' }, { h: 'CO', align: 'r' }, { h: 'Incentive', align: 'r' },
       { h: `${PREV_MONTH_NAME} aud`, align: 'r' }, { h: 'PA', align: 'r' }, { h: 'CO', align: 'r' },
       { h: 'Incentive', align: 'r' }],
      rank.map(r => [r.n.split(' ')[0], `${bar(r.done, top)} ${r.done}`,
        r.s.audits, r.s.paSubmitted, r.s.coSubmitted, money(r.s.money),
        r.prev.audits, r.prev.paSubmitted, r.prev.coSubmitted, money(r.prev.money)]));
    const teamLine = (s, label) => `Team, ${label}: ${plural(s.audits, 'audit', 'audits')} · `
      + `${plural(s.paSubmitted, 'PA', 'PAs')} · ${plural(s.implementations, 'implementation', 'implementations')} · `
      + `${plural(s.coSubmitted, 'CO', 'COs')} · ${money(s.money)}`;
    D.note(teamLine(moTeam, `${MONTH_NAME} so far`));
    D.note(teamLine(prevTeam, PREV_MONTH_NAME));
  }

  /* ---- the three spans we own, and who owns each. The implementation leg is
     here and not in an engineer's email because, as Ameya put it, it is not on
     the engineer -- it is on the operations manager. Putting it in front of
     the wrong person is how a number gets ignored by everybody. ---- */
  const legs = [
    ['Audit finished → PA submitted',  'Engineers',            legAvg('pa', null)],
    ['PA approved → implementation',   'Operations (David R)', legAvg('impl', null)],
    ['Implementation → CO submitted',  'Engineers',            legAvg('co', null)],
  ];
  const legTop = Math.max(1, ...legs.map(l => l[2].days || 0));
  D.h('Average days per leg — ours');
  D.table(
    [{ h: 'Leg', w: 32 }, { h: 'Owner', w: 20 }, { h: 'Avg days', align: 'r' },
     { h: 'Length' }, { h: 'Projects', align: 'r' }],
    legs.map(([label, owner, t]) => [label, owner, t.days == null ? '—' : `${t.days}d`,
      bar(t.days || 0, legTop), t.n]));
  D.note('Every active project carrying both dates. A longer bar is a longer wait — '
    + 'this is the part of the calendar that is ours.');

  /* Kept in a separate table on purpose. One measures us and can be worked on;
     the other measures the reviewer and cannot. */
  const rt = t => (t.days == null || t.n < 3 ? (t.n ? `— (${t.n})` : '—') : `${t.days}d`);
  const paT = turnaround(PA_LEGS, null, inMonth), coT = turnaround(CO_LEGS, null, inMonth);
  const paTPrev = turnaround(PA_LEGS, null, inPrevMonth), coTPrev = turnaround(CO_LEGS, null, inPrevMonth);
  const revTop = Math.max(1, paT.days || 0, coT.days || 0, paTPrev.days || 0, coTPrev.days || 0);
  /* A bar beside a figure we have just refused to print would put the number
     back on the page in picture form -- and a one-project median drawn full
     width is the most confident-looking thing in the mail. Empty until the
     sample is big enough to mean something. */
  const rbar = t => (t.days == null || t.n < 3 ? bar(0, revTop) : bar(t.days, revTop));
  D.h('Average days per leg — the reviewer');
  D.table(
    [{ h: 'Leg', w: 32 }, { h: MONTH_NAME, align: 'r' }, { h: 'Length' },
     { h: 'Back', align: 'r' }, { h: PREV_MONTH_NAME, align: 'r' }, { h: 'Back', align: 'r' }],
    [['PA submitted → approved', rt(paT), rbar(paT), paT.n, rt(paTPrev), paTPrev.n],
     ['CO submitted → paid',     rt(coT), rbar(coT), coT.n, rt(coTPrev), coTPrev.n]]);
  D.note('Median over what actually came back in the month, counted in the month it returned. '
    + 'Under three projects the figure is not shown — that is one project, not a trend.');

  /* ---- the shape of the book. ---- */
  const byPhase = new Map();
  for (const p of projects) if (p.phase) byPhase.set(p.phase, (byPhase.get(p.phase) || 0) + 1);
  if (byPhase.size) {
    const rows = [...byPhase].sort((a, b) => b[1] - a[1]);
    const phTop = Math.max(1, ...rows.map(r => r[1]));
    D.h('Where the work sits');
    D.table(
      [{ h: 'Phase', w: 30 }, { h: 'Projects', align: 'r' }, { h: 'Share' }, { h: '%', align: 'r' }],
      rows.map(([ph, n]) => [ph, n, bar(n, phTop),
        `${Math.round((n / Math.max(1, projects.length)) * 100)}%`]));
  }

  /* What actually moved. Only the stages that saw movement, so an empty week
     reads as empty rather than as a wall of zeros. */
  const moved = STAGES
    .map(st => [st.label, projects.filter(p => inRange(p.ev[st.key], wk.start, wk.end)).length])
    .filter(([, n]) => n);
  D.h('Moved last week');
  if (moved.length) {
    const mvTop = Math.max(1, ...moved.map(m => m[1]));
    D.table(
      [{ h: 'Stage', w: 30 }, { h: 'Projects', align: 'r' }, { h: 'Week' }],
      moved.map(([l, n]) => [l, n, bar(n, mvTop)]));
  } else {
    D.p('Nothing reached a new stage.');
  }

  /* ---- what is stopped. ---- */
  const owed     = projects.filter(p => p.sev === 'critical');
  const ageing   = projects.filter(p => p.aging === 'Critical');
  const noOwner  = projects.filter(p => !p.ownerNames.length && p.sev !== 'good');
  const owedNoOwner = owed.filter(p => !p.ownerNames.length).length;
  const stopTop = Math.max(1, owed.length, ageing.length, noOwner.length);
  D.h('What is stopped');
  D.table(
    [{ h: 'Problem', w: 34 }, { h: 'Projects', align: 'r' }, { h: 'Size' }],
    [['Need an action now', owed.length, bar(owed.length, stopTop)],
     ['Nobody named on that action', owedNoOwner, bar(owedNoOwner, stopTop)],
     ['Not moved in 60 days', ageing.length, bar(ageing.length, stopTop)],
     ['No owner on the next step at all', noOwner.length, bar(noOwner.length, stopTop)]]);
  const oldest = [...owed].sort((a, b) => (b.daysInPhase || 0) - (a.daysInPhase || 0)).slice(0, 8);
  if (oldest.length) {
    D.h('Longest waiting');
    D.table(
      [{ h: 'Project', w: 36 }, { h: 'Needs', w: 34 }, { h: 'Owner', w: 18 }, { h: 'Waiting', align: 'r' }],
      oldest.map(p => [p.name, p.need, p.ownerNames.length ? p.ownerNames.join(', ') : 'NOBODY ASSIGNED',
        p.daysInPhase ? `${p.daysInPhase}d` : '—']),
      row => row[2] === 'NOBODY ASSIGNED');
  }

  /* ---- the two boards the engineers actually work from. ---- */
  const rfis = workTasks.filter(t => t.rfi);
  const byPerson = new Map();
  for (const t of workTasks) {
    for (const n of t.rfi ? t.owners : [t.person]) {
      if (!n) continue;
      byPerson.set(n, (byPerson.get(n) || 0) + 1);
    }
  }
  const busiest = [...byPerson].sort((a, b) => b[1] - a[1]).slice(0, 8);
  D.h('On the desks');
  D.p(`${workTasks.length} open items on the pre-approval and closeout boards, ${rfis.length} of them RFIs.`);
  if (busiest.length) {
    const dTop = Math.max(1, ...busiest.map(b => b[1]));
    D.table(
      [{ h: 'Engineer', w: 20 }, { h: 'Open items', align: 'r' }, { h: 'Load' }],
      busiest.map(([n, c]) => [n.split(' ')[0], c, bar(c, dTop)]));
  }

  const rfiUs = projects.filter(p => rfiSide(p) === 'hbs').length;
  const rfiThem = projects.filter(p => rfiSide(p) === 'icf').length;
  const rfiTop = Math.max(1, rfiUs, rfiThem);
  D.h('RFIs');
  D.table(
    [{ h: 'Held by', w: 38 }, { h: 'Projects', align: 'r' }, { h: 'Share' }],
    [['Waiting on an answer from us', rfiUs, bar(rfiUs, rfiTop)],
     ['Answered and back with the reviewer', rfiThem, bar(rfiThem, rfiTop)]]);

  /* ---- the gaps only management can close. ---- */
  const noReviewer = projects.filter(p => p.icfUnassigned);
  const departed = [...Object.keys(HBS_ROSTER)].filter(hasLeft)
    .map(n => [n, projects.filter(p => p.hbsAll.includes(n)).length]).filter(([, c]) => c);
  const decisions = [];
  if (noReviewer.length)
    decisions.push(`${noReviewer.length} projects carry no ICF reviewer. They reach nobody at ICF until `
      + 'one is named, and we raise it with Justin and Junior weekly.');
  for (const [n, c] of departed)
    decisions.push(`${n} has left HBS and still holds ${c} project${c === 1 ? ' that needs' : 's that need'} a new owner.`);
  for (const [n] of Object.entries(ICF_DEPARTED)) {
    const c = projects.filter(p => p.icfEngs.includes(n)).length;
    if (c) decisions.push(`${n} has left ICF and still holds ${c} project${c === 1 ? '' : 's'}; `
      + 'their queue goes to the ICF leads.');
  }
  /* This is the internal summary, so it may hold both sides at once -- it is
     the only thing here that may. Nothing addressed to either reviewer does.

     The TRC projects themselves stay: they are live work sitting on our own
     engineers, and management should see them counted. What is NOT raised here
     any more is the missing TRC reviewer addresses. Ameya has put emailing TRC
     into a later phase, and a decision list that asks every Monday for
     something deliberately deferred trains people to skim the list. */
  if (decisions.length) {
    /* Not a bulleted checklist: doc()'s bullets render with a tick in the
       text copy, and a tick beside an unresolved decision reads as done. */
    D.h('Needs a decision from you');
    for (const t of decisions) D.p(t);
  }

  D.note('The roll-up sent alongside this has the project-by-project detail. '
    + 'Automated from the monday.com trackers and workload boards.');
  return { text: D.text(), html: D.html() };
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
   internal trackers, the workload boards, the notes or the commercials -- and
   nothing off the TRC board, which is a different company's work and the one
   thing that must never appear in an envelope addressed to ICF.
--------------------------------------------------------------------------- */
function icfSummaryBody() {
  const icfOnly = projects.filter(p => p.side === 'ICF');
  const rows = icfOnly.map(p => ({
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
  L.push(`ICF \u00d7 HBS portfolio \u2014 ${weekOf}`, '');
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

const hbsNames = new Set(), offRoster = new Set();
/* Reviewer names are collected per side and never merged. Two companies can
   easily use the same first name, and a single set would route one of them to
   the other's inbox. */
const reviewNames = { ICF: new Set(), TRC: new Set() };
for (const p of projects) {
  for (const n of p.hbsAll) {
    if (NOT_A_PERSON.has(n) || NOW_ICF_SIDE.has(n)) continue;
    if (getsDigest(n) || hasLeft(n)) hbsNames.add(n); else offRoster.add(n);
  }
  for (const n of p.icfEngs) if (!NOT_A_PERSON.has(n)) reviewNames[p.side].add(n);
}
const icfNames = reviewNames.ICF;
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
/* The window itself, not a bare Monday. It used to print wk.prevStart, which
   is why a mail sent on 4 September was headed "week of Mon Aug 24". */
const weekOf = weekLabel(wk);
/* Compact form for a table column header, where the long one would push every
   other column off a phone screen: "1-4 Sep", or "28 Aug - 3 Sep" if the
   window spans two months (which only a full, unclipped week can). */
const WEEK_COL = (() => {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const a = wk.start, b = wk.lastDay;
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}\u2013${b.getDate()} ${MON[b.getMonth()]}`
    : `${a.getDate()} ${MON[a.getMonth()]} \u2013 ${b.getDate()} ${MON[b.getMonth()]}`;
})();
/* Said out loud wherever the week is shown. A number covering four days is not
   a week, and a reader who is not told cannot tell. */
const WEEK_NOTE = wk.clipped
  ? `Week runs ${weekOf} \u2014 cut short because ${MONTH_NAME} started mid-week, so the week counts from the 1st.`
  : (wk.full && wk.lastDay < TODAY
    ? `Week runs ${weekOf} \u2014 the full Monday-to-Sunday week just finished.`
    : `Week runs ${weekOf} \u2014 Monday to today; the week is not over yet.`);

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
  const rec = { to, name, org: 'HBS', subject: `Your week - ${weekOf}`,
    body: d.html, bodyType: 'html', plain: d.text, counts: d.counts };
  if (to) perEngineer.push(rec); else { unroutable.push({ name, org: 'HBS', reason: 'no monday user record with an email' }); }
}
for (const side of ['ICF', 'TRC']) {
  const cfg = REVIEW_SIDES[side];
  for (const name of [...reviewNames[side]].sort()) {
    /* Filtered on the side FIRST, so a reviewer's list can only ever contain
       projects off their own company's board. */
    const mine = projects.filter(p => p.side === side && p.icfEngs.includes(name));
    /* And checked again, because the filter above is one line and the cost of
       it being wrong is a competitor's project list in the wrong inbox. A
       digest that fails this is not sent at all. */
    const strays = mine.filter(p => p.side !== side);
    if (strays.length) {
      warnings.push(`BLOCKED: ${side} digest for ${name} contained ${strays.length} project(s) `
        + `from the other reviewer's board. Not sent. This is a bug - do not send anything to `
        + `${side} until it is fixed.`);
      continue;
    }
    /* A reviewer who has left is never mailed at their old address. Their
       queue is handed to that side's leads, who are the only people who can
       reassign it. */
    const gone = cfg.departed()[name] || null;
    /* An empty address list is not an address. A departed reviewer whose side
       has no leads on file must fall through to unroutable, not be pushed as a
       record addressed to nobody. */
    const goneTo = gone && Array.isArray(gone.to) && gone.to.length ? gone.to : null;
    const to = gone ? goneTo : (cfg.emails()[name] || null);
    const d = digestBody(name, side, mine, [], new Map(), gone);
    /* HTML now, like the engineers' mail: this digest is tables and bar charts,
       and sending it as text would deliver the markup verbatim. The plain
       rendering still travels alongside for any client that refuses HTML. */
    const rec = gone
      ? { to, name, org: side, forwardedFor: name,
          subject: `${name} has left ${side} - ${mine.length} project${mine.length === 1 ? '' : 's'} to reassign`,
          body: d.html, bodyType: 'html', plain: d.text, counts: d.counts }
      : { to, name, org: side, subject: `Your project update - ${weekOf}`,
          body: d.html, bodyType: 'html', plain: d.text, counts: d.counts };
    if (to) perEngineer.push(rec);
    else unroutable.push({ name, org: side,
      reason: side === 'TRC'
        ? (gone
            ? `has left TRC - queue needs handing to the TRC leads, but no address is on file for ${TRC_SUMMARY_NAMES.join(' or ')}`
            : 'no TRC address on file - nobody at TRC can be emailed until Ameya supplies one')
        : (gone
            ? 'has left ICF - queue goes to the ICF leads'
            : 'no address in ICF_EMAILS - included in the roll-up only'),
      active: mine.length });
  }
}

/* ------------------------------------------------------------------ roll-up */
function rollupBody() {
  const L = [];
  L.push(`ICF x HBS pipeline - ${weekOf}`, '');
  const stageOpen = new Map(), stageWeek = new Map();
  for (const p of projects) {
    if (p.current) stageOpen.set(p.current, (stageOpen.get(p.current) || 0) + 1);
    for (const s of STAGES) if (inRange(p.ev[s.key], wk.start, wk.end)) stageWeek.set(s.key, (stageWeek.get(s.key) || 0) + 1);
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
      L.push(`  ${r.n} - ${r.mine.length} project${r.mine.length === 1 ? ' needs' : 's need'} a new owner:`);
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
const rfiOwedPipeline = projects.filter(p => p.side === 'ICF'
  && (ICF_RFI_OWED.has(p.icfStatus || '') || p.tuStatus === 'TRC/ICF RFI Received')).length;
const rfiOwedSummary = projects.filter(p => p.side === 'ICF' && rfiSide(p) === 'hbs').length;
if (rfiOwedPipeline && !rfiOwedSummary)
  warnings.push(`The portfolio summary counts 0 RFIs owed to ICF but the pipeline finds ${rfiOwedPipeline}. `
    + 'The summary is miscounting - do not send it to ICF.');

/* ---------------------------------------------------------------------------
   The cross-side leak check.

   ICF and TRC are competitors doing the same job for different utilities, and
   Ameya's rule is that neither may see the other's work. The routing already
   filters on which board a project came off, and checks it a second time, but
   both of those reason about objects. This one reads the finished text.

   Every project name from one side is searched for in every body addressed to
   the other. It is the only check that would still catch a leak arriving
   through a path nobody thought about -- a summary, a roll-up quoted into the
   wrong envelope, a future section -- because by then the only thing that
   matters is what the words say.

   A hit is blocking. Nothing goes to that side until it is gone.
--------------------------------------------------------------------------- */
{
  const namesOf = side => [...new Set(projects.filter(p => p.side === side)
    .map(p => (p.name || '').trim()).filter(n => n.length > 8))];
  const outgoing = [
    ...perEngineer.filter(e => e.org === 'ICF' || e.org === 'TRC')
      /* Both renderings, because both are sent: the HTML body and the plain
         alternative. They come off one doc() so a leak could not sit in only
         one -- but this check exists precisely for the case where reasoning
         like that turns out to be wrong. */
      .map(e => ({ side: e.org, what: `${e.org} digest for ${e.name}`, body: `${e.body}\n${e.plain || ''}` })),
    { side: 'ICF', what: 'ICF portfolio summary', body: icfSummaryBody() },
  ];
  for (const o of outgoing) {
    const other = o.side === 'ICF' ? 'TRC' : 'ICF';
    const hits = namesOf(other).filter(n => o.body.includes(n));
    if (hits.length) {
      warnings.push(`BLOCKED: ${o.what} names ${hits.length} project(s) from the ${other} board `
        + `(e.g. "${hits[0]}"). ${o.side} and ${other} must never see each other's work. `
        + `Do not send anything to ${o.side} until this is fixed.`);
    }
  }
}

const envelope = {
  generatedAt: new Date().toISOString(),
  weekOf,
  projectCount: projects.length,
  perEngineer: perEngineer.filter(e => e.to),
  rollup: { to: ROLLUP_TO, subject: `ICF x HBS pipeline roll-up - ${weekOf}`, body: rollupBody() },
  /* "HBS x ICF" was the subject when ICF was the only reviewer; the body now
     covers both sides, so the subject would be telling management the wrong
     thing about what is inside.

     Built with the same doc() builder as an engineer's mail, so it goes as
     real HTML tables rather than a <pre> block of aligned text: management
     asked for the charts they saw on that one. The bars still line up inside
     a table cell because every block glyph is the same width, in any font.
     The plain-text rendering travels alongside for the transcript. */
  hbsSummary: (() => { const s = hbsSummaryBody();
    return { to: HBS_SUMMARY_TO, subject: `HBS portfolio summary - ${weekOf}`,
      body: s.html, bodyType: 'html', plain: s.text }; })(),
  icfSummary: { to: ICF_SUMMARY_TO, subject: `ICF x HBS portfolio summary - ${weekOf}`, body: icfSummaryBody() },
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
