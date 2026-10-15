/**
 * Utility portal reconciliation.
 *
 * The utility portals (Pepco RCx, BGE, Delmarva, SMECO, Washington Gas …) each
 * expose a "My Applications" list with an **Export CSV** button. That export
 * carries the portal's own Status per application — including Flawed, which
 * today is only discovered by someone opening the portal and looking.
 *
 * This script takes one such CSV and reconciles it against monday.com:
 *
 *   - projects the portal calls Flawed (or otherwise rejected) that monday
 *     does not have flagged  <- the case that currently goes unnoticed
 *   - every other status disagreement between portal and board
 *   - portal applications with no matching project on either board
 *   - board projects for that utility that the export does not contain
 *
 * It matches on the utility Project Number, which is already on both boards:
 * `text_mm5wf2g3` on the ICF/HBS Project Tracker (78% populated) and `text8`
 * on the Master TU Tracker (71%). The prefix identifies the programme —
 * BGRCVA/BGPTPS = BGE, PCRCVA = Pepco, DPRCVA = Delmarva, SMRCVA = SMECO,
 * WGCPPS = Washington Gas.
 *
 * READ-ONLY BY DEFAULT. It proposes changes and writes nothing unless
 * APPLY=true is passed, and even then it only touches the ICF board's status
 * column on rows where the portal and the board actually disagree.
 *
 * Usage (monday.com `execute_code`):
 *   vars: { "CSV": "<paste the exported file contents>" }
 *   vars: { "CSV": "...", "APPLY": "true" }   // to write the statuses back
 */

const API = 'https://api.monday.com/v2';
const BOARD_ICF = '18424932045';
const BOARD_TU  = '1069746645';
const ICF_PROJECT_ID = 'text_mm5wf2g3';
const ICF_STATUS     = 'status';
const ICF_PHASE      = 'color_mm5wyfg2';
const TU_PROJECT_ID  = 'text8';
const TU_STATUS      = 'status';

/* Portal status wording that means "this application is rejected and needs
   rework". These are the ones worth waking someone up for. */
const PORTAL_BAD = [/flaw/i, /reject/i, /denied/i, /cancel/i, /withdraw/i, /incomplete/i, /on hold/i];

/* Portal status -> the ICF board's own label, where the wording differs.
   Anything not listed is compared verbatim; the board's vocabulary was built
   from the portal's, so most values match exactly. */
const STATUS_ALIASES = {
  'technical review': 'Technical Review',
  'post-technical review': 'Post-Tech Review',
  'post technical review': 'Post-Tech Review',
  'post-tech review': 'Post-Tech Review',
  'install': 'Install',
  'installation': 'Install',
  'application complete': 'App Complete',
  'app complete': 'App Complete',
  'arc': 'ARC',
  'flawed': 'Flawed',
  'flawed arc': 'Flawed ARC',
  'payment processing': 'Payment Processing',
  'payment ready': 'Payment Ready',
  'invoice sent': 'Invoice Sent',
  'pre-approval': 'Pre-approval',
  'preapproval': 'Pre-approval',
  'site inspection pending': 'Site Inspection Pending',
  'site inspection scheduled': 'Site Inspection Scheduled',
  'site inspection completed': 'Site Inspection Completed',
  'final project approval': 'Final Project Approval',
  'on hold': 'On Hold',
};

/* ------------------------------------------------------------------ csv */
/* A tolerant RFC4180 parser: quoted fields, escaped quotes, embedded newlines. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

/* Header names differ between utility portals, so match on meaning. */
function findColumn(headers, patterns) {
  for (const p of patterns) {
    const i = headers.findIndex(h => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ monday */
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

const PAGE = `query($id: ID!, $cursor: String, $cols: [String!]) {
  boards(ids: [$id]) { items_page(limit: 250, cursor: $cursor) { cursor items {
    id name url group { title } column_values(ids: $cols) { id text } } } } }`;

async function fetchBoard(id, cols) {
  const items = []; let cursor = null;
  for (let i = 0; i < 20; i++) {
    const d = await gql(PAGE, { id, cursor, cols });
    const p = d.boards[0].items_page;
    items.push(...p.items);
    cursor = p.cursor;
    if (!cursor) break;
  }
  return items;
}
const cell = (it, id) => {
  const c = it.column_values.find(v => v.id === id);
  const t = c && c.text ? String(c.text).trim() : '';
  return (t === 'null' || t === 'Column value type is not supported') ? '' : t;
};

/* ------------------------------------------------------------------ run */
const csvText = process.env.CSV || '';
const apply = String(process.env.APPLY || '').toLowerCase() === 'true';

if (!csvText.trim()) {
  console.log(JSON.stringify({
    error: 'No CSV supplied.',
    how: 'Open the utility portal, press "Export CSV" on My Applications, and pass the file contents as the CSV variable.',
  }, null, 1));
} else {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV had no data rows');
  const headers = rows[0].map(h => String(h).trim());
  const iId = findColumn(headers, [/project\s*(number|no|id)/i, /application\s*(number|no|id)/i, /^id$/i]);
  const iStatus = findColumn(headers, [/^status$/i, /application\s*status/i, /current\s*status/i]);
  const iName = findColumn(headers, [/project\s*name/i, /site|address|premise/i, /^name$/i]);
  const iProgram = findColumn(headers, [/program/i]);
  const iCreated = findColumn(headers, [/created|submitted|date/i]);
  const iTasks = findColumn(headers, [/to-?do|task/i]);

  if (iId < 0 || iStatus < 0) {
    console.log(JSON.stringify({
      error: 'Could not find the project-number and status columns in this export.',
      headersSeen: headers,
      note: 'Send one export back and the header patterns will be pinned to it.',
    }, null, 1));
  } else {
    const portal = rows.slice(1).map(r => ({
      id: String(r[iId] || '').trim().toUpperCase(),
      status: String(r[iStatus] || '').trim(),
      name: iName >= 0 ? String(r[iName] || '').trim() : '',
      program: iProgram >= 0 ? String(r[iProgram] || '').trim() : '',
      created: iCreated >= 0 ? String(r[iCreated] || '').trim() : '',
      tasks: iTasks >= 0 ? String(r[iTasks] || '').trim() : '',
    })).filter(p => p.id);

    const [icf, tu] = await Promise.all([
      fetchBoard(BOARD_ICF, [ICF_PROJECT_ID, ICF_STATUS, ICF_PHASE]),
      fetchBoard(BOARD_TU, [TU_PROJECT_ID, TU_STATUS]),
    ]);
    const icfById = new Map();
    for (const it of icf) { const k = cell(it, ICF_PROJECT_ID).toUpperCase(); if (k) icfById.set(k, it); }
    const tuById = new Map();
    for (const it of tu) { const k = cell(it, TU_PROJECT_ID).toUpperCase(); if (k) tuById.set(k, it); }

    const norm = s => {
      const k = String(s).trim().toLowerCase();
      return STATUS_ALIASES[k] || String(s).trim();
    };
    const isBad = s => PORTAL_BAD.some(re => re.test(String(s)));

    /* which prefixes this export covers, so "missing from the export" is
       scoped to the same programme rather than the whole book */
    const prefixes = new Set(portal.map(p => (p.id.match(/^[A-Z]+/) || [''])[0]).filter(Boolean));

    const flaggedInPortalOnly = [];
    const statusMismatch = [];
    const notOnBoards = [];
    const matched = [];
    const updates = [];

    for (const p of portal) {
      const it = icfById.get(p.id);
      const tuIt = tuById.get(p.id);
      if (!it && !tuIt) { notOnBoards.push(p); continue; }
      const boardStatus = it ? cell(it, ICF_STATUS) : '';
      const want = norm(p.status);
      matched.push(p);

      if (isBad(p.status) && !isBad(boardStatus)) {
        flaggedInPortalOnly.push({
          projectId: p.id, name: (it || tuIt).name, url: (it || tuIt).url,
          portalStatus: p.status, boardStatus: boardStatus || '(blank)',
          tuStatus: tuIt ? cell(tuIt, TU_STATUS) : '',
          phase: it ? cell(it, ICF_PHASE) : '',
        });
      } else if (it && boardStatus && want && boardStatus.toLowerCase() !== want.toLowerCase()) {
        statusMismatch.push({
          projectId: p.id, name: it.name, url: it.url,
          portalStatus: p.status, boardStatus, proposed: want,
        });
      } else if (it && !boardStatus && want) {
        statusMismatch.push({
          projectId: p.id, name: it.name, url: it.url,
          portalStatus: p.status, boardStatus: '(blank)', proposed: want,
        });
      }

      if (it && want) {
        const same = boardStatus && boardStatus.toLowerCase() === want.toLowerCase();
        if (!same) updates.push({ itemId: Number(it.id), name: it.name, from: boardStatus || '(blank)', to: want });
      }
    }

    const portalIds = new Set(portal.map(p => p.id));
    const missingFromExport = [];
    for (const [k, it] of icfById) {
      const pre = (k.match(/^[A-Z]+/) || [''])[0];
      if (!pre || !prefixes.has(pre)) continue;
      if (!portalIds.has(k)) {
        missingFromExport.push({ projectId: k, name: it.name, url: it.url, boardStatus: cell(it, ICF_STATUS) || '(blank)' });
      }
    }

    /* ---------------- optional write-back ---------------- */
    let applied = [];
    let applyError = null;
    if (apply && updates.length) {
      try {
        for (const u of updates) {
          const m = `mutation($board: ID!, $item: ID!, $vals: JSON!) {
            change_multiple_column_values(board_id: $board, item_id: $item, column_values: $vals) { id } }`;
          await gql(m, {
            board: BOARD_ICF, item: String(u.itemId),
            vals: JSON.stringify({ [ICF_STATUS]: { label: u.to } }),
          });
          applied.push(u);
        }
      } catch (e) {
        applyError = String(e.message).slice(0, 300);
      }
    }

    const out = {
      mode: apply ? 'APPLIED' : 'DRY RUN — nothing was written',
      exportRows: portal.length,
      programmePrefixes: [...prefixes],
      matchedToBoards: matched.length,
      headersSeen: headers,

      /* the headline: rejected in the portal, not flagged on the board */
      flawedInPortalNotOnBoard: flaggedInPortalOnly,

      statusMismatches: statusMismatch,
      inPortalNotOnBoards: notOnBoards.map(p => ({ projectId: p.id, name: p.name, status: p.status, program: p.program })),
      onBoardNotInExport: missingFromExport,

      proposedStatusUpdates: updates,
      appliedStatusUpdates: applied,
      applyError,
    };

    if ((process.env.RECONCILE_MODE || '') === 'summary') {
      console.log(`export rows          ${out.exportRows}`);
      console.log(`matched to boards    ${out.matchedToBoards}`);
      console.log(`FLAWED, not flagged  ${out.flawedInPortalNotOnBoard.length}`);
      console.log(`status mismatches    ${out.statusMismatches.length}`);
      console.log(`in portal only       ${out.inPortalNotOnBoards.length}`);
      console.log(`on board only        ${out.onBoardNotInExport.length}`);
      console.log(`proposed updates     ${out.proposedStatusUpdates.length}  (${out.mode})`);
      if (out.flawedInPortalNotOnBoard.length) {
        console.log('\nFLAGGED IN THE PORTAL BUT NOT ON THE BOARD:');
        for (const f of out.flawedInPortalNotOnBoard) {
          console.log(`  * ${f.projectId}  ${f.name}`);
          console.log(`      portal: ${f.portalStatus}   board: ${f.boardStatus}   phase: ${f.phase}`);
        }
      }
    } else {
      console.log(JSON.stringify(out, null, 1));
    }
  }
}
