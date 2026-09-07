/**
 * Log an engineer's reply to the weekly digest back onto the projects.
 *
 * When someone replies to their Monday digest saying what a project needs, that
 * information currently lives only in a mailbox. This takes the reply, works out
 * which projects it is talking about, and posts the relevant part of it as an
 * update on those monday items — so it lands where the next person to open the
 * project will see it.
 *
 * It posts **updates** (the item's comment thread), never column edits. Nothing
 * existing is overwritten, every entry is attributed and dated, and the whole
 * thing is reversible by deleting the update.
 *
 * Matching is per paragraph, not per email: a reply covering three projects
 * posts three different excerpts rather than the whole message three times.
 *
 * Usage (monday.com `execute_code`):
 *   vars: { "FROM": "Soumya Agrawal", "REPLY": "<the reply body, quoted text stripped>" }
 *   vars: { "FROM": "...", "REPLY": "...", "APPLY": "true" }   // to actually post
 */

const API = 'https://api.monday.com/v2';
const BOARD_ICF = '18424932045';
const BOARD_TU  = '1069746645';
const ICF_PROJECT_ID = 'text_mm5wf2g3';
const TU_PROJECT_ID  = 'text8';

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
    id name url column_values(ids: $cols) { id text } } } } }`;

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

/* Strip the quoted original so only what the engineer actually wrote is logged. */
function stripQuoted(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*(-{2,}\s*)?Original Message/i.test(line)) break;
    if (/^\s*From:\s.+@/i.test(line)) break;
    if (/^\s*On .+ wrote:\s*$/i.test(line)) break;
    if (/^\s*_{5,}\s*$/.test(line)) break;
    if (/Sent automatically from the ICF/i.test(line)) break;
    if (/This is an automated weekly update/i.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/* Same matcher the dashboard uses: the distinctive halves of a project name,
   plus adjacent word pairs, plus the utility project number if quoted. */
const STOP = new Set(['the', 'and', 'for', 'with', 'project', 'projects', 'building', 'center', 'centre', 'llc', 'inc', 'apartments', 'at']);
function matchKeys(name) {
  const keys = [];
  for (const part of String(name).split(/\s+-\s+/)) {
    const clean = part.trim();
    if (clean.length >= 6) keys.push(clean.toLowerCase());
  }
  const words = String(name).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length >= 5 && !STOP.has(w));
  for (let i = 0; i < words.length - 1; i++) keys.push(words[i] + ' ' + words[i + 1]);
  return [...new Set(keys)];
}

const from = (process.env.FROM || '').trim();
const replyRaw = process.env.REPLY || '';
const apply = String(process.env.APPLY || '').toLowerCase() === 'true';

if (!replyRaw.trim() || !from) {
  console.log(JSON.stringify({ error: 'Both FROM (the engineer) and REPLY (the message body) are required.' }, null, 1));
} else {
  const body = stripQuoted(replyRaw);
  /* Greetings and sign-offs are not project information; dropping them keeps
     the "could not place" list to things that genuinely need filing. */
  const NOISE = [
    /^(hi|hey|hello|good (morning|afternoon|evening))\b[^.!?]{0,40}$/i,
    /^(thanks|thank you|cheers|regards|best|kind regards|many thanks|br)\b[\s,!.-]*$/i,
    /^(thanks|thank you|cheers|regards|best)[\s,!.-]*\n\s*\w[\w .'-]{0,40}$/i,
    /^sent from my \w+/i,
    /^[\w .'-]{2,40}$/,          // a bare name on its own line
  ];
  const isNoise = t => NOISE.some(re => re.test(t.trim()));

  const paragraphs = body.split(/\n\s*\n|\n(?=\s*[-*•]\s)/)
    .map(p => p.trim()).filter(p => p.length > 3 && !isNoise(p));

  const [icf, tu] = await Promise.all([
    fetchBoard(BOARD_ICF, [ICF_PROJECT_ID]),
    fetchBoard(BOARD_TU, [TU_PROJECT_ID]),
  ]);

  /* Prefer the ICF board — it is the shared one and the dashboard links to it. */
  const index = [];
  for (const it of icf) index.push({ board: 'ICF', id: it.id, name: it.name, url: it.url, pid: cell(it, ICF_PROJECT_ID).toUpperCase(), keys: matchKeys(it.name) });
  const icfNames = new Set(icf.map(i => i.name.toLowerCase()));
  for (const it of tu) {
    if (icfNames.has(it.name.toLowerCase())) continue;
    index.push({ board: 'TU', id: it.id, name: it.name, url: it.url, pid: cell(it, TU_PROJECT_ID).toUpperCase(), keys: matchKeys(it.name) });
  }

  const perItem = new Map();
  const unmatched = [];

  for (const para of paragraphs) {
    const hay = para.toLowerCase();
    const hayUpper = para.toUpperCase();
    const hits = index.filter(e =>
      (e.pid && e.pid.length >= 8 && hayUpper.includes(e.pid)) ||
      e.keys.some(k => hay.includes(k)));

    if (!hits.length) { unmatched.push(para); continue; }
    /* A paragraph naming one project is a strong signal; naming five is not. */
    if (hits.length > 3) { unmatched.push(para); continue; }
    for (const h of hits) {
      if (!perItem.has(h.id)) perItem.set(h.id, { ...h, paras: [] });
      perItem.get(h.id).paras.push(para);
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const planned = [...perItem.values()].map(e => ({
    board: e.board, itemId: e.id, name: e.name, url: e.url,
    update: `<b>${from}</b> replied to the weekly project update on ${stamp}:<br><br>` +
            e.paras.map(p => p.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>')).join('<br><br>'),
    excerpt: e.paras.join('\n\n'),
  }));

  let posted = [], postError = null;
  if (apply && planned.length) {
    try {
      for (const p of planned) {
        const m = `mutation($item: ID!, $body: String!) {
          create_update(item_id: $item, body: $body) { id } }`;
        const res = await gql(m, { item: String(p.itemId), body: p.update });
        posted.push({ itemId: p.itemId, name: p.name, updateId: res.create_update.id });
      }
    } catch (e) {
      postError = String(e.message).slice(0, 300);
    }
  }

  const out = {
    mode: apply ? 'POSTED' : 'DRY RUN — nothing was posted',
    from,
    paragraphsRead: paragraphs.length,
    matchedProjects: planned.length,
    planned,
    /* Anything that did not clearly name a project. It is never posted to a
       guessed item — it comes back here so a person can place it. */
    unmatched,
    posted,
    postError,
  };

  if ((process.env.LOG_MODE || '') === 'summary') {
    console.log(`from                 ${out.from}`);
    console.log(`paragraphs read      ${out.paragraphsRead}`);
    console.log(`matched projects     ${out.matchedProjects}   (${out.mode})`);
    console.log(`unplaced paragraphs  ${out.unmatched.length}`);
    for (const p of out.planned) {
      console.log(`\n  -> ${p.name}  [${p.board} ${p.itemId}]`);
      console.log(`     ${p.excerpt.replace(/\n/g, '\n     ').slice(0, 300)}`);
    }
    if (out.unmatched.length) {
      console.log('\nCOULD NOT PLACE (needs a person to file these):');
      for (const u of out.unmatched) console.log(`  * ${u.slice(0, 160)}`);
    }
  } else {
    console.log(JSON.stringify(out, null, 1));
  }
}
