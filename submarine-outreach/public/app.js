// Submarine Outreach — single-page UI (no build step).
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (s) => (s ? new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
const num = (n) => Number(n || 0).toLocaleString();

let META = null;
const view = $('#view');

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && path !== '/login') { renderLogin(); throw new Error('login required'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), err ? 6000 : 3000);
}

/** Run an async action from a button, disabling it and surfacing errors. */
async function act(btn, fn, okMsg) {
  if (btn) btn.disabled = true;
  try {
    const r = await fn();
    if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

const segLabel = (k) => META?.segments.find((s) => s.key === k)?.label || k || '—';
const segOptions = (sel = '', blank = 'All segments') =>
  `<option value="">${blank}</option>` + META.segments.map((s) => `<option value="${s.key}" ${s.key === sel ? 'selected' : ''}>P${s.phase} · ${esc(s.label)}</option>`).join('');
const stateOptions = (sel = '', blank = 'All states') =>
  `<option value="">${blank}</option>` + META.states.map((s) => `<option value="${s.code}" ${s.code === sel ? 'selected' : ''}>${s.code} — ${esc(s.name)}</option>`).join('');
const tierChip = (t) => `<span class="chip ${t}">${t}</span>`;
const chip = (s) => (s ? `<span class="chip ${esc(s)}">${esc(String(s).replace(/_/g, ' '))}</span>` : '');

// ---------------- Router ----------------
const routes = { dashboard, discover, leads, campaigns, inbox, outbox, settings };
async function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const page = routes[name] ? name : 'dashboard';
  $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
  closeDrawer();
  try {
    await routes[page](arg);
  } catch (e) {
    if (e.message !== 'login required') view.innerHTML = `<div class="card">Error: ${esc(e.message)}</div>`;
  }
}

async function refreshChrome() {
  META = await api('/meta');
  const live = META.sendMode === 'live';
  $('#mode-pill').innerHTML = `<b>${live ? '● LIVE sending' : '○ Dry-run mode'}</b>${live ? 'Emails go out for real' : 'Emails are recorded, not sent'}`;
  const threads = await api('/threads?status=needs_reply');
  const b = $('#inbox-badge');
  b.textContent = threads.length;
  b.classList.toggle('hidden', !threads.length);
}

function renderLogin() {
  $('.sidebar').classList.add('hidden');
  view.innerHTML = `<div class="card login"><h1>Submarine Outreach</h1><p class="sub">Enter the portal password.</p>
    <form id="login"><input type="password" name="password" autofocus placeholder="Password"><br><br><button class="primary">Sign in</button></form></div>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/login', { body: { password: e.target.password.value } });
      $('.sidebar').classList.remove('hidden');
      await refreshChrome();
      route();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------------- Dashboard ----------------
async function dashboard() {
  const s = await api('/stats');
  const tier = (t) => s.tiers.find((x) => x.tier === t) || { businesses: 0, with_email: 0 };
  const sweepTotals = s.sweep.segments.reduce((a, x) => ({ done: a.done + x.done + x.failed, all: a.all + x.done + x.failed + x.pending }), { done: 0, all: 0 });
  const setup = [];
  if (!META.integrations.places) setup.push('Add <b>GOOGLE_PLACES_API_KEY</b> to discover businesses nationwide (or import a CSV).');
  if (!META.integrations.smtp) setup.push('Add <b>SMTP_*</b> settings so emails can actually be sent.');
  if (!META.integrations.imap) setup.push('Add <b>IMAP_*</b> settings so replies land in the Inbox.');
  view.innerHTML = `
    <h1>Dashboard</h1><p class="sub">Small &amp; mid-size US businesses first; large ones unlock later in Settings.</p>
    ${setup.length ? `<div class="callout"><b>Setup:</b><ul style="margin:6px 0 0 18px;padding:0">${setup.map((x) => `<li>${x}</li>`).join('')}</ul><span class="small-text muted">See README / .env.example.</span></div>` : ''}
    <div class="grid g4">
      ${[['Businesses found', s.businesses], ['Active emails', s.contacts], ['Sent (24h)', `${s.sentToday} / ${s.dailyCap}`], ['Needs reply', s.needsReply],
        ['In sequences', s.activeEnrollments], ['Total sent', s.sentTotal], ['Conversations w/ replies', s.replies], ['Websites to crawl', s.pendingCrawl]]
        .map(([l, n]) => `<div class="card stat"><div class="n">${typeof n === 'number' ? num(n) : n}</div><div class="l">${l}</div></div>`).join('')}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Pipeline by size</h2>
        <table><tr><th>Tier</th><th>Businesses</th><th>With email</th></tr>
        ${['small', 'mid', 'large'].map((t) => `<tr><td>${tierChip(t)}</td><td>${num(tier(t).businesses)}</td><td>${num(tier(t).with_email)}</td></tr>`).join('')}</table>
        <h3>Lead status</h3>
        <div class="row">${s.statuses.map((x) => `<a class="chip" href="#/leads" data-status="${x.status}">${esc(x.status.replace(/_/g, ' '))}: ${num(x.n)}</a>`).join(' ') || '<span class="muted">No leads yet</span>'}</div>
      </div>
      <div class="card"><h2>Nationwide sweep</h2>
        <p>${s.sweep.running ? '<span class="chip active">running</span>' : '<span class="chip">paused</span>'}
          <span class="muted small-text">${num(sweepTotals.done)} of ${num(sweepTotals.all)} city searches done · ${num(s.sweep.today)} today</span></p>
        <div class="bar"><i style="width:${sweepTotals.all ? (100 * sweepTotals.done) / sweepTotals.all : 0}%"></i></div>
        <h3>Top states</h3>
        <div class="row">${s.byState.slice(0, 15).map((x) => `<span class="chip">${x.state} ${num(x.n)}</span>`).join('') || '<span class="muted">—</span>'}</div>
        <p style="margin-top:14px"><a class="btn" href="#/discover">Open discovery →</a></p>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><h2>Getting to your first reply</h2>
      <ol style="margin:0;padding-left:18px;line-height:1.9">
        <li><a href="#/discover">Find businesses</a> — start the nationwide sweep, run a targeted search, or import a CSV.</li>
        <li>The crawler visits each website and collects publicly listed business emails (smallest businesses first).</li>
        <li><a href="#/campaigns">Create a campaign</a> — pick a segment, edit or AI-draft the sequence, preview, enroll leads.</li>
        <li>Review in Dry-run, then switch to Live in <a href="#/settings">Settings</a>.</li>
        <li>Replies land in the <a href="#/inbox">Inbox</a> and stop the sequence automatically; answer them there.</li>
      </ol></div>`;
  $$('[data-status]').forEach((a) => (a.onclick = () => { leadsState.status = a.dataset.status; }));
}

// ---------------- Discover ----------------
async function discover() {
  const sw = await api('/sweep');
  const p = META.integrations.places;
  view.innerHTML = `
    <h1>Find businesses</h1><p class="sub">Gather US businesses and their public contact emails. Resellers and small businesses are prioritised.</p>
    ${p ? '' : '<div class="callout">Google Places key not set — the sweep and search are disabled. You can still import CSVs or paste websites.</div>'}
    <div class="card"><div class="row"><h2 style="margin:0">Nationwide sweep</h2><span class="spacer"></span>
      ${sw.running ? '<span class="chip active">running</span>' : '<span class="chip">paused</span>'}</div>
      <p class="muted small-text">Searches every segment in every state — biggest city in each state first, then deeper — at a daily cap you control.
        Phase 1 = resellers &amp; partners, Phase 2 = small/mid businesses that buy pens as gifts, Phase 3 = large-organisation segments.</p>
      <div class="row">
        <label style="margin:0">Include up to</label>
        <select id="phase">${[1, 2, 3].map((n) => `<option value="${n}" ${sw.phaseMax === n ? 'selected' : ''}>Phase ${n}</option>`).join('')}</select>
        <button class="primary" id="sweep-toggle" ${p ? '' : 'disabled'}>${sw.running ? 'Pause sweep' : 'Start sweep'}</button>
        <button id="sweep-retry">Retry failed</button>
        <span class="muted small-text">${num(sw.today)} searches today</span>
      </div>
      <div class="table-wrap" style="margin-top:12px;max-height:340px"><table>
        <tr><th>Phase</th><th>Segment</th><th>Progress</th><th>New businesses</th><th>Failed</th></tr>
        ${sw.segments.map((s) => {
          const all = s.done + s.failed + s.pending;
          return `<tr><td>P${s.phase}</td><td>${esc(s.label)}</td><td style="min-width:140px"><div class="bar"><i style="width:${all ? (100 * (s.done + s.failed)) / all : 0}%"></i></div>
            <span class="small-text muted">${num(s.done + s.failed)} / ${num(all)}</span></td><td>${num(s.found)}</td><td>${s.failed ? num(s.failed) : ''}</td></tr>`;
        }).join('')}
      </table></div>
      ${sw.next.length ? `<p class="small-text muted">Next up: ${sw.next.map((j) => `${esc(j.query)} — ${esc(j.city)}, ${j.state}`).join(' · ')}</p>` : ''}
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Targeted search</h2>
        <form id="search">
          <label>What</label><input name="query" placeholder="e.g. promotional products distributor" required>
          <div class="row"><div style="flex:1"><label>City</label><input name="city" placeholder="Austin" style="width:100%"></div>
            <div style="flex:1"><label>State</label><select name="state" style="width:100%">${stateOptions('', 'Any')}</select></div></div>
          <label>Tag as segment</label><select name="segment">${segOptions('', '—')}</select><br><br>
          <button class="primary" ${p ? '' : 'disabled'}>Search &amp; add</button>
        </form></div>
      <div class="card"><h2>Import CSV</h2>
        <p class="muted small-text">Columns recognised: company, email, website, first_name, last_name, title, phone, city, state, zip, employees, segment.
          Great for trade-show lists, ASI/PPAI directories or data-vendor exports.</p>
        <input type="file" id="csv-file" accept=".csv,text/csv">
        <label>Tag as segment (if the file has no segment column)</label><select id="csv-seg">${segOptions('', '—')}</select><br><br>
        <button class="primary" id="csv-go">Import</button></div>
      <div class="card"><h2>Add by website</h2>
        <p class="muted small-text">Paste websites (one per line). The crawler will look for public contact emails.</p>
        <form id="sites"><textarea name="websites" placeholder="examplepens.com&#10;https://giftshop.example"></textarea>
          <div class="row"><select name="segment">${segOptions('', 'Segment…')}</select><select name="state">${stateOptions('', 'State…')}</select>
          <button class="primary">Add</button></div></form></div>
    </div>`;
  $('#sweep-toggle').onclick = (e) => act(e.target, () => api('/sweep', { body: { running: !sw.running, phaseMax: Number($('#phase').value) } }), sw.running ? 'Sweep paused' : 'Sweep started').then(discover);
  $('#phase').onchange = (e) => act(null, () => api('/sweep', { body: { phaseMax: Number(e.target.value) } }), 'Saved');
  $('#sweep-retry').onclick = (e) => act(e.target, () => api('/sweep', { body: { retryFailed: true } }), 'Failed searches re-queued').then(discover);
  $('#search').onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    act(e.submitter, () => api('/discover/search', { body: f }), (r) => `Found ${r.found}, added ${r.created} new businesses`);
  };
  $('#sites').onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, () => api('/discover/websites', { body: Object.fromEntries(new FormData(e.target)) }), (r) => `Added ${r.created} of ${r.total}`);
  };
  $('#csv-go').onclick = async (e) => {
    const file = $('#csv-file').files[0];
    if (!file) return toast('Choose a CSV file first', true);
    const csv = await file.text();
    act(e.target, () => api('/import/csv', { body: { csv, segment: $('#csv-seg').value } }), (r) => `Imported ${r.businesses} businesses, ${r.contacts} emails (${r.skipped} skipped)`);
  };
}

// ---------------- Leads ----------------
const leadsState = { q: '', state: '', tier: '', segment: '', status: '', has_email: '', offset: 0 };
async function leads() {
  const qs = new URLSearchParams(Object.entries(leadsState).filter(([, v]) => v !== '' && v != null)).toString();
  const [data, camps] = await Promise.all([api('/leads?' + qs + '&limit=100'), api('/campaigns')]);
  const statuses = ['new', 'enriched', 'no_email', 'no_website', 'contacted', 'replied', 'interested', 'not_interested', 'customer', 'do_not_contact'];
  view.innerHTML = `
    <div class="row"><h1>Leads</h1><span class="spacer"></span>
      <button id="add-lead">+ Add lead</button><a class="btn" href="/api/leads/export.csv?${qs}">Export CSV</a></div>
    <p class="sub">${num(data.total)} businesses · sorted small → mid → large</p>
    <div class="row" style="margin-bottom:12px">
      <input id="f-q" placeholder="Search name, domain, city, email" value="${esc(leadsState.q)}" style="min-width:240px">
      <select id="f-state">${stateOptions(leadsState.state)}</select>
      <select id="f-tier"><option value="">All sizes</option>${['small', 'mid', 'large'].map((t) => `<option ${leadsState.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="f-segment">${segOptions(leadsState.segment)}</select>
      <select id="f-status"><option value="">Any status</option>${statuses.map((s) => `<option value="${s}" ${leadsState.status === s ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>
      <select id="f-email"><option value="">Email: any</option><option value="1" ${leadsState.has_email === '1' ? 'selected' : ''}>Has email</option><option value="0" ${leadsState.has_email === '0' ? 'selected' : ''}>No email</option></select>
    </div>
    <div class="row" style="margin-bottom:10px">
      <span class="muted small-text" id="sel-count">0 selected</span>
      <select id="bulk-camp"><option value="">Add to campaign…</option>${camps.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <button data-bulk="enroll">Enroll</button><button data-bulk="enrich">Re-crawl</button>
      <button data-bulk="dnc" class="danger">Do not contact</button><button data-bulk="delete" class="danger">Delete</button>
    </div>
    <div class="table-wrap"><table>
      <tr><th><input type="checkbox" id="sel-all"></th><th>Business</th><th>Size</th><th>Segment</th><th>Location</th><th>Best email</th><th>Status</th></tr>
      ${data.rows.map((b) => `<tr class="click" data-id="${b.id}">
        <td onclick="event.stopPropagation()"><input type="checkbox" class="sel" value="${b.id}"></td>
        <td><b>${esc(b.name)}</b><div class="small-text muted">${esc(b.domain || b.phone || '')}${b.locations_seen > 1 ? ` · ${b.locations_seen} locations` : ''}</div></td>
        <td>${tierChip(b.size_tier)}${b.employees ? `<div class="small-text muted">${num(b.employees)} staff</div>` : ''}</td>
        <td class="small-text">${esc(segLabel(b.segment))}</td>
        <td class="small-text">${esc([b.city, b.state].filter(Boolean).join(', '))}</td>
        <td class="small-text">${b.best_email ? esc(b.best_email) : b.crawled_at ? '<span class="muted">none found</span>' : b.website ? '<span class="muted">queued…</span>' : '<span class="muted">no website</span>'}</td>
        <td>${chip(b.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No leads match. Try <a href="#/discover">Find businesses</a>.</td></tr>'}
    </table></div>
    <div class="row" style="margin-top:10px"><button id="prev" ${leadsState.offset ? '' : 'disabled'}>← Prev</button>
      <span class="muted small-text">${num(leadsState.offset + 1)}–${num(Math.min(leadsState.offset + 100, data.total))} of ${num(data.total)}</span>
      <button id="next" ${leadsState.offset + 100 < data.total ? '' : 'disabled'}>Next →</button></div>`;

  const setF = (k) => (e) => { leadsState[k] = e.target.value; leadsState.offset = 0; leads(); };
  let tmr;
  $('#f-q').oninput = (e) => { clearTimeout(tmr); tmr = setTimeout(() => { leadsState.q = e.target.value; leadsState.offset = 0; leads().then(() => { const i = $('#f-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
  $('#f-state').onchange = setF('state'); $('#f-tier').onchange = setF('tier'); $('#f-segment').onchange = setF('segment');
  $('#f-status').onchange = setF('status'); $('#f-email').onchange = setF('has_email');
  $('#prev').onclick = () => { leadsState.offset = Math.max(0, leadsState.offset - 100); leads(); };
  $('#next').onclick = () => { leadsState.offset += 100; leads(); };
  $$('tr.click').forEach((tr) => (tr.onclick = () => openLead(tr.dataset.id)));
  const selected = () => $$('.sel:checked').map((c) => Number(c.value));
  const updateCount = () => ($('#sel-count').textContent = `${selected().length} selected`);
  $$('.sel').forEach((c) => (c.onchange = updateCount));
  $('#sel-all').onchange = (e) => { $$('.sel').forEach((c) => (c.checked = e.target.checked)); updateCount(); };
  $$('[data-bulk]').forEach((b) => (b.onclick = async () => {
    const ids = selected();
    if (!ids.length) return toast('Select some leads first', true);
    const kind = b.dataset.bulk;
    if (kind === 'enroll') {
      const cid = $('#bulk-camp').value;
      if (!cid) return toast('Choose a campaign', true);
      return act(b, () => api('/leads/bulk', { body: { ids, action: 'enroll', campaign_id: cid } }), (r) => `Enrolled ${r.enrolled} (leads without an active email or already in a sequence are skipped)`);
    }
    if (kind === 'delete' && !confirm(`Delete ${ids.length} businesses?`)) return;
    const body = kind === 'dnc' ? { ids, action: 'status', status: 'do_not_contact' } : { ids, action: kind };
    await act(b, () => api('/leads/bulk', { body }), 'Done');
    leads();
  }));
  $('#add-lead').onclick = () => openAddLead();
}

function closeDrawer() { $('#drawer').classList.add('hidden'); }
function openDrawer(html) {
  const d = $('#drawer');
  d.innerHTML = `<div class="row"><span class="spacer"></span><button id="close-drawer">✕</button></div>${html}`;
  d.classList.remove('hidden');
  $('#close-drawer').onclick = closeDrawer;
  return d;
}

function openAddLead() {
  const d = openDrawer(`<h2>Add a lead</h2><form id="add">
    <label>Business name</label><input name="name" required>
    <label>Website</label><input name="website" placeholder="example.com">
    <label>Email</label><input name="email" type="email">
    <div class="row"><div style="flex:1"><label>Contact name</label><input name="contact_name"></div><div style="flex:1"><label>Title</label><input name="title"></div></div>
    <div class="row"><div style="flex:1"><label>City</label><input name="city"></div><div style="flex:1"><label>State</label><select name="state">${stateOptions('', '—')}</select></div></div>
    <label>Segment</label><select name="segment">${segOptions('', '—')}</select>
    <label>Employees (optional)</label><input name="employees" type="number" min="1"><br><br>
    <button class="primary">Save</button></form>`);
  $('#add', d).onsubmit = async (e) => {
    e.preventDefault();
    const r = await act(e.submitter, () => api('/leads', { body: Object.fromEntries(new FormData(e.target)) }), 'Lead saved');
    if (r) openLead(r.business.id);
  };
}

async function openLead(id) {
  const { business: b, contacts, threads, enrollments } = await api('/leads/' + id);
  const statuses = ['new', 'enriched', 'no_email', 'no_website', 'contacted', 'replied', 'interested', 'not_interested', 'customer', 'do_not_contact'];
  const d = openDrawer(`
    <h1>${esc(b.name)}</h1>
    <p class="muted">${esc([b.address || [b.city, b.state].filter(Boolean).join(', ')].join(''))}${b.phone ? ' · ' + esc(b.phone) : ''}</p>
    <p>${b.website ? `<a href="${esc(b.website)}" target="_blank" rel="noopener">${esc(b.website)}</a>` : '<span class="muted">No website</span>'}</p>
    <div class="row">${tierChip(b.size_tier)} <span class="small-text muted">sized by ${esc(b.size_source || '—')}${b.rating_count != null ? ` · ${num(b.rating_count)} reviews` : ''}${b.locations_seen > 1 ? ` · ${b.locations_seen} locations` : ''}</span></div>
    <div class="row" style="margin-top:10px">
      <div><label>Status</label><select id="l-status">${statuses.map((s) => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div><label>Size</label><select id="l-tier">${['small', 'mid', 'large'].map((t) => `<option ${t === b.size_tier ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div><label>Employees</label><input id="l-emp" type="number" value="${b.employees ?? ''}" style="width:100px"></div>
      <div><label>Segment</label><select id="l-seg">${segOptions(b.segment, '—')}</select></div>
    </div>
    <label>Notes</label><textarea id="l-notes" style="min-height:70px">${esc(b.notes || '')}</textarea>
    <div class="row" style="margin-top:8px"><button class="primary" id="l-save">Save</button><button id="l-crawl" ${b.website ? '' : 'disabled'}>Re-crawl website</button>
      ${b.crawl_error ? `<span class="small-text muted">Last crawl: ${esc(b.crawl_error)}</span>` : ''}</div>

    <h3>Contacts</h3>
    <table>${contacts.map((c) => `<tr><td><b>${esc(c.email)}</b><div class="small-text muted">${esc([c.name, c.title].filter(Boolean).join(' · '))} ${esc(c.source || '')} · confidence ${c.confidence}</div></td>
      <td>${chip(c.status)}</td><td><button data-compose="${c.id}" ${c.status === 'active' ? '' : 'disabled'}>Email</button> <button class="danger" data-del="${c.id}">✕</button></td></tr>`).join('') || '<tr><td class="muted">No emails yet.</td></tr>'}</table>
    <form id="add-contact" class="row" style="margin-top:8px"><input name="email" type="email" placeholder="email@business.com" required style="flex:2"><input name="name" placeholder="Name" style="flex:1"><button>Add</button></form>

    ${enrollments.length ? `<h3>Sequences</h3>${enrollments.map((e) => `<div class="small-text">${esc(e.campaign)} — ${chip(e.status)} step ${e.current_step}${e.last_error ? ` <span class="muted">(${esc(e.last_error)})</span>` : ''}</div>`).join('')}` : ''}
    <h3>Conversations</h3>
    ${threads.map((t) => `<div><a href="#/inbox/${t.id}">${esc(t.subject || '(no subject)')}</a> ${chip(t.status)} ${chip(t.classification)} <span class="small-text muted">${fmtDate(t.last_message_at)}</span></div>`).join('') || '<p class="muted">None yet.</p>'}
  `);
  $('#l-save', d).onclick = (e) => act(e.target, () => api('/leads/' + id, { method: 'PATCH', body: {
    status: $('#l-status').value, notes: $('#l-notes').value, segment: $('#l-seg').value, employees: $('#l-emp').value,
    ...($('#l-tier').value !== b.size_tier ? { size_tier: $('#l-tier').value } : {}),
  } }), 'Saved');
  $('#l-crawl', d).onclick = (e) => act(e.target, () => api(`/leads/${id}/enrich`, { body: {} }), (r) => `Found ${r.added} new email(s)${r.error ? ' — ' + r.error : ''}`).then(() => openLead(id));
  $('#add-contact', d).onsubmit = (e) => {
    e.preventDefault();
    act(e.submitter, () => api(`/leads/${id}/contacts`, { body: Object.fromEntries(new FormData(e.target)) }), 'Contact added').then(() => openLead(id));
  };
  $$('[data-del]', d).forEach((btn) => (btn.onclick = () => confirm('Remove this contact?') && act(btn, () => api('/contacts/' + btn.dataset.del, { method: 'DELETE' })).then(() => openLead(id))));
  $$('[data-compose]', d).forEach((btn) => (btn.onclick = () => openCompose(contacts.find((c) => c.id === Number(btn.dataset.compose)), b)));
}

function openCompose(contact, business) {
  const d = openDrawer(`<h2>New email to ${esc(contact.email)}</h2><p class="muted small-text">${esc(business.name)} — the compliance footer (address + unsubscribe) is added automatically.</p>
    <label>Subject</label><input id="c-sub">
    <label>Message</label><textarea id="c-body" style="min-height:260px"></textarea><br><br>
    <button class="primary" id="c-send">${META.sendMode === 'live' ? 'Send' : 'Send (dry-run)'}</button>`);
  $('#c-send', d).onclick = async (e) => {
    const r = await act(e.target, () => api('/compose', { body: { contact_id: contact.id, subject: $('#c-sub').value, body: $('#c-body').value } }), (r) => (r.status === 'sent' ? 'Sent' : 'Recorded (dry-run)'));
    if (r) location.hash = '#/inbox/' + r.threadId;
  };
}

// ---------------- Campaigns ----------------
async function campaigns(id) {
  if (id) return campaignDetail(Number(id));
  const list = await api('/campaigns');
  view.innerHTML = `
    <div class="row"><h1>Campaigns</h1><span class="spacer"></span><button class="primary" id="new-camp">+ New campaign</button></div>
    <p class="sub">A campaign is an email sequence (intro + follow-ups). Replies stop the sequence automatically.</p>
    <div class="table-wrap"><table><tr><th>Name</th><th>Status</th><th>Steps</th><th>Active</th><th>Replied</th><th>Completed</th><th>Emails sent</th></tr>
      ${list.map((c) => `<tr class="click" data-id="${c.id}"><td><b>${esc(c.name)}</b></td><td>${chip(c.status)}</td><td>${c.steps.length}</td>
        <td>${num(c.stats.active)}</td><td>${num(c.stats.replied)}</td><td>${num(c.stats.completed)}</td><td>${num(c.sent)}</td></tr>`).join('') ||
        '<tr><td colspan="7" class="muted">No campaigns yet.</td></tr>'}</table></div>`;
  $$('tr.click').forEach((tr) => (tr.onclick = () => (location.hash = '#/campaigns/' + tr.dataset.id)));
  $('#new-camp').onclick = (e) => {
    const name = prompt('Campaign name', 'Promo distributors — intro');
    if (name) act(e.target, () => api('/campaigns', { body: { name } })).then((c) => c && (location.hash = '#/campaigns/' + c.id));
  };
}

async function campaignDetail(id) {
  const c = await api('/campaigns/' + id);
  let steps = c.steps.map((s) => ({ delay_days: s.delay_days, subject: s.subject, body: s.body }));
  const renderSteps = () => $('#steps').innerHTML = steps.map((s, i) => `
    <div class="step" data-i="${i}"><div class="row"><b>Step ${i + 1}</b>
      ${i ? `<span class="muted small-text">send</span><input type="number" min="1" class="s-delay" value="${s.delay_days}" style="width:70px"><span class="muted small-text">days after previous (if no reply)</span>` : '<span class="muted small-text">intro — sent first</span>'}
      <span class="spacer"></span>${steps.length > 1 ? '<button class="danger s-del">Remove</button>' : ''}</div>
      <label>Subject ${i ? '<span class="muted">(“Re:” keeps it in the same thread)</span>' : ''}</label><input class="s-subject" value="${esc(s.subject)}">
      <label>Body</label><textarea class="s-body" style="min-height:170px">${esc(s.body)}</textarea></div>`).join('');
  const collect = () => { steps = $$('.step').map((el, i) => ({ delay_days: i ? Number($('.s-delay', el).value) : 0, subject: $('.s-subject', el).value, body: $('.s-body', el).value })); };

  view.innerHTML = `
    <p><a href="#/campaigns">← Campaigns</a></p>
    <div class="row"><input id="c-name" value="${esc(c.name)}" style="font-size:18px;font-weight:700;max-width:420px">${chip(c.status)}<span class="spacer"></span>
      ${c.status === 'active' ? '<button id="pause">Pause</button>' : `<button class="primary" id="activate">${META.sendMode === 'live' ? 'Activate (LIVE)' : 'Activate (dry-run)'}</button>`}
      <button class="danger" id="del">Delete</button></div>
    ${META.senderName ? '' : '<div class="callout">Set your <b>Sender name</b> in <a href="#/settings">Settings</a> — it fills {{sender_name}} in these emails.</div>'}
    <p class="sub">Active ${num(c.stats.active)} · replied ${num(c.stats.replied)} · completed ${num(c.stats.completed)} · stopped ${num((c.stats.stopped || 0) + (c.stats.bounced || 0))} · ${num(c.sent)} emails sent</p>
    <div class="grid g2">
      <div>
        <div class="card"><div class="row"><h2 style="margin:0">Sequence</h2><span class="spacer"></span>
          ${META.integrations.ai ? '<button id="ai-seq">✨ Draft with AI</button>' : ''}<button id="add-step">+ Step</button><button class="primary" id="save">Save</button></div>
          <p class="muted small-text">Merge fields: {{first_name|there}} {{company}} {{city}} {{state}} {{pitch}} {{segment}} {{sender_name}} — “|text” is the fallback. Footer with your address + unsubscribe link is added automatically.</p>
          <div id="steps"></div></div>
      </div>
      <div>
        <div class="card"><h2>Enroll leads</h2>
          <p class="muted small-text">Picks the best email per business, smallest businesses first. ${'Large businesses are excluded until enabled in Settings.'}</p>
          <div class="row"><select id="e-seg">${segOptions('', 'Any segment')}</select><select id="e-state">${stateOptions('')}</select>
            <select id="e-tier"><option value="">small + mid</option><option>small</option><option>mid</option><option>large</option></select>
            <input id="e-limit" type="number" value="100" style="width:80px"><button class="primary" id="enroll">Enroll</button></div>
          <p class="small-text muted">Or select leads on the <a href="#/leads">Leads</a> page and use “Add to campaign”.</p></div>
        <div class="card" style="margin-top:16px"><div class="row"><h2 style="margin:0">Preview</h2><span class="spacer"></span><button id="preview-btn">Refresh</button></div><div id="preview"></div></div>
        <div class="card" style="margin-top:16px"><h2>Recipients</h2><div id="enrolled" class="table-wrap" style="max-height:360px"></div></div>
      </div>
    </div>`;
  renderSteps();
  const refreshEnrolled = async () => {
    const rows = await api(`/campaigns/${id}/enrollments`);
    $('#enrolled').innerHTML = `<table><tr><th>Business</th><th>Email</th><th>Status</th><th>Next</th></tr>${rows.map((r) => `<tr>
      <td>${esc(r.business)} <span class="small-text muted">${r.state || ''}</span></td><td class="small-text">${esc(r.email)}</td>
      <td>${chip(r.status)} <span class="small-text muted">step ${r.current_step + (r.status === 'active' ? 1 : 0)}</span>${r.last_error ? `<div class="small-text muted">${esc(r.last_error)}</div>` : ''}</td>
      <td class="small-text">${r.status === 'active' ? fmtDate(r.next_send_at) : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nobody enrolled yet.</td></tr>'}</table>`;
  };
  const refreshPreview = async () => {
    collect();
    const p = await api(`/campaigns/${id}/preview`, { body: { steps } });
    $('#preview').innerHTML = `<p class="small-text muted">To: ${esc(p.to)}</p>` + p.steps.map((s, i) => `<b>Step ${i + 1}: ${esc(s.subject)}</b><pre class="preview">${esc(s.body)}</pre>`).join('');
  };
  refreshEnrolled(); refreshPreview().catch(() => {});
  $('#steps').addEventListener('click', (e) => {
    if (e.target.classList.contains('s-del')) { collect(); steps.splice(Number(e.target.closest('.step').dataset.i), 1); renderSteps(); }
  });
  $('#add-step').onclick = () => { collect(); steps.push({ delay_days: 4, subject: 'Re:', body: 'Hi {{first_name|there}},\n\n\n\n{{sender_name}}' }); renderSteps(); };
  $('#save').onclick = (e) => { collect(); act(e.target, () => api('/campaigns/' + id, { method: 'PUT', body: { name: $('#c-name').value, steps } }), 'Saved').then(refreshPreview); };
  $('#preview-btn').onclick = () => refreshPreview().catch((e) => toast(e.message, true));
  $('#ai-seq') && ($('#ai-seq').onclick = async (e) => {
    const segment = $('#e-seg').value || prompt('Segment key to write for (e.g. promo_distributor, gift_shop)', 'promo_distributor');
    const goal = prompt('Anything specific to mention? (optional)', '') ?? '';
    const r = await act(e.target, () => api('/ai/sequence', { body: { segment, goal, steps: 3 } }), 'Draft ready — review and Save');
    if (r?.steps?.length) { steps = r.steps; renderSteps(); refreshPreview(); }
  });
  $('#enroll').onclick = (e) => act(e.target, () => api(`/campaigns/${id}/enroll`, { body: { segment: $('#e-seg').value, state: $('#e-state').value, tier: $('#e-tier').value, limit: $('#e-limit').value } }),
    (r) => `Enrolled ${r.enrolled} contacts`).then(refreshEnrolled);
  const setStatus = (status) => (e) => { collect(); act(e.target, async () => { await api('/campaigns/' + id, { method: 'PUT', body: { name: $('#c-name').value, steps } }); return api('/campaigns/' + id, { method: 'PUT', body: { status } }); }, status === 'active' ? 'Campaign active — sending within business hours' : 'Paused').then((r) => r && campaignDetail(id)); };
  $('#activate') && ($('#activate').onclick = setStatus('active'));
  $('#pause') && ($('#pause').onclick = setStatus('paused'));
  $('#del').onclick = (e) => confirm('Delete this campaign and its enrollments?') && act(e.target, () => api('/campaigns/' + id, { method: 'DELETE' })).then(() => (location.hash = '#/campaigns'));
}

// ---------------- Inbox ----------------
let inboxFilter = 'needs_reply';
async function inbox(threadId) {
  const qs = inboxFilter === 'all' ? '' : inboxFilter === 'replies' ? 'has_reply=1' : `status=${inboxFilter}`;
  const threads = await api('/threads?' + qs);
  view.innerHTML = `
    <div class="row"><h1>Inbox</h1><span class="spacer"></span>
      <select id="i-filter">${[['needs_reply', 'Needs reply'], ['replies', 'All with replies'], ['waiting', 'Waiting on them'], ['closed', 'Closed'], ['all', 'Everything']]
        .map(([v, l]) => `<option value="${v}" ${v === inboxFilter ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button id="poll" ${META.integrations.imap ? '' : 'disabled title="Set IMAP_* env vars"'}>Check mail now</button></div>
    <p class="sub">Replies to outreach are matched automatically; unsubscribes and bounces are suppressed for you.</p>
    <div class="inbox"><div class="card thread-list" style="padding:0">${threads.map((t) => `
      <div class="thread-item ${t.unread ? 'unread' : ''} ${Number(threadId) === t.id ? 'sel' : ''}" data-id="${t.id}">
        <div class="row"><span class="t-name">${esc(t.business || t.email || '')}</span><span class="spacer"></span><span class="small-text muted">${fmtDate(t.last_message_at)}</span></div>
        <div class="small-text">${esc(t.subject || '')}</div>
        <div class="small-text muted">${esc(t.snippet)}</div>
        <div>${chip(t.status)} ${chip(t.classification)} ${t.size_tier ? tierChip(t.size_tier) : ''}</div></div>`).join('') || '<p class="muted" style="padding:14px">Nothing here.</p>'}</div>
      <div id="thread" class="card">${threadId ? '' : '<p class="muted">Select a conversation.</p>'}</div></div>`;
  $('#i-filter').onchange = (e) => { inboxFilter = e.target.value; inbox(threadId); };
  $('#poll').onclick = (e) => act(e.target, () => api('/inbox/poll', { body: {} }), (r) => (r.skipped ? r.reason || 'Already checking' : `${r.handled} new replies`)).then(() => { refreshChrome(); inbox(threadId); });
  $$('.thread-item').forEach((el) => (el.onclick = () => (location.hash = '#/inbox/' + el.dataset.id)));
  if (threadId) await renderThread(Number(threadId));
}

async function renderThread(id) {
  const { thread: t, contact, business, messages } = await api('/threads/' + id);
  refreshChrome();
  const el = $('#thread');
  el.innerHTML = `
    <div class="row"><h2 style="margin:0">${esc(t.subject || '(no subject)')}</h2><span class="spacer"></span>
      <select id="t-status">${['needs_reply', 'waiting', 'open', 'closed'].map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <p class="small-text muted">${business ? `<a href="#" id="t-lead">${esc(business.name)}</a> · ${esc([business.city, business.state].filter(Boolean).join(', '))} · ` : ''}${esc(contact?.email || '')} ${chip(t.classification)}</p>
    ${messages.map((m) => `<div class="msg ${m.direction}"><div class="meta"><b>${m.direction === 'in' ? esc(m.from_addr) : 'You'}</b>${m.direction === 'out' ? ' → ' + esc(m.to_addr) : ''} · ${fmtDate(m.created_at)} ${m.direction === 'out' ? chip(m.status) : ''}${m.error ? ' ' + esc(m.error) : ''}</div>${esc(m.body)}</div>`).join('')}
    <h3>Reply</h3>
    ${META.integrations.ai ? `<div class="row" style="margin-bottom:6px"><input id="ai-hint" placeholder="Optional guidance for AI (e.g. offer 10 free samples, MOQ 250)" style="flex:1"><button id="ai-reply">✨ Draft reply</button></div>` : ''}
    <textarea id="r-body" style="min-height:200px" placeholder="Write your reply…"></textarea>
    <div class="row" style="margin-top:8px"><button class="primary" id="r-send" ${contact && ['active', 'replied'].includes(contact.status) ? '' : 'disabled'}>${META.sendMode === 'live' ? 'Send reply' : 'Send reply (dry-run)'}</button>
      ${contact && !['active', 'replied'].includes(contact.status) ? `<span class="small-text muted">Contact is ${esc(contact.status)} — cannot email.</span>` : ''}
      <span class="spacer"></span>
      ${business ? `<button id="mk-int">Mark interested</button><button id="mk-cust">Mark customer</button>` : ''}</div>`;
  $('#t-status').onchange = (e) => act(null, () => api('/threads/' + id, { method: 'PATCH', body: { status: e.target.value } }), 'Updated');
  $('#t-lead') && ($('#t-lead').onclick = (e) => { e.preventDefault(); openLead(business.id); });
  $('#ai-reply') && ($('#ai-reply').onclick = async (e) => {
    const r = await act(e.target, () => api('/ai/reply', { body: { thread_id: id, instructions: $('#ai-hint').value } }), 'Draft ready — edit before sending');
    if (r) $('#r-body').value = r.body;
  });
  $('#r-send').onclick = async (e) => {
    if (!$('#r-body').value.trim()) return toast('Write a reply first', true);
    const r = await act(e.target, () => api(`/threads/${id}/reply`, { body: { body: $('#r-body').value } }), (r) => (r.status === 'sent' ? 'Reply sent' : 'Reply recorded (dry-run)'));
    if (r) inbox(id);
  };
  const mark = (status) => (e) => act(e.target, () => api('/leads/' + business.id, { method: 'PATCH', body: { status } }), `Marked ${status}`);
  $('#mk-int') && ($('#mk-int').onclick = mark('interested'));
  $('#mk-cust') && ($('#mk-cust').onclick = mark('customer'));
}

// ---------------- Outbox ----------------
async function outbox() {
  const rows = await api('/outbox');
  view.innerHTML = `<h1>Sent</h1><p class="sub">Last 300 outgoing emails.</p>
    <div class="table-wrap"><table><tr><th>When</th><th>To</th><th>Subject</th><th>Campaign</th><th>Status</th></tr>
    ${rows.map((m) => `<tr class="click" data-t="${m.thread_id}"><td class="small-text">${fmtDate(m.created_at)}</td><td>${esc(m.to_addr)}</td><td>${esc(m.subject)}</td>
      <td class="small-text">${esc(m.campaign || 'manual')}${m.step_no != null ? ` · step ${m.step_no + 1}` : ''}</td><td>${chip(m.status)}${m.error ? `<div class="small-text muted">${esc(m.error)}</div>` : ''}</td></tr>`).join('') ||
      '<tr><td colspan="5" class="muted">Nothing sent yet.</td></tr>'}</table></div>`;
  $$('tr.click').forEach((tr) => (tr.onclick = () => (location.hash = '#/inbox/' + tr.dataset.t)));
}

// ---------------- Settings ----------------
async function settings() {
  const [{ settings: s, live, env }, sup] = await Promise.all([api('/settings'), api('/suppressions')]);
  const field = (k, label, type = 'text', help = '') => `<label>${label}</label>${type === 'textarea'
    ? `<textarea name="${k}" style="min-height:110px">${esc(s[k])}</textarea>`
    : `<input name="${k}" type="${type}" value="${esc(s[k])}">`}${help ? `<div class="small-text muted">${help}</div>` : ''}`;
  const ints = META.integrations;
  view.innerHTML = `
    <h1>Settings</h1><p class="sub">Secrets (passwords, API keys) are set as environment variables — see <code>.env.example</code>.</p>
    <form id="settings"><div class="grid g2">
      <div class="card"><h2>Sender &amp; compliance</h2>
        ${field('company_name', 'Company name')}${field('sender_name', 'Sender name', 'text', 'Shown as the From name and in {{sender_name}}.')}
        ${field('from_email', 'From email', 'email', 'Must be an address your SMTP account is allowed to send as.')}
        ${field('reply_to', 'Reply-to (optional)', 'email')}
        ${field('physical_address', 'Physical mailing address', 'text', 'Required by US CAN-SPAM in every commercial email.')}
        ${field('website', 'Website')}
        ${field('company_profile', 'Company profile (used by AI drafting)', 'textarea')}
      </div>
      <div class="card"><h2>Sending</h2>
        <label>Mode</label><select name="send_mode"><option value="dry_run" ${s.send_mode === 'dry_run' ? 'selected' : ''}>Dry-run — record only, don't send</option>
          <option value="live" ${s.send_mode === 'live' ? 'selected' : ''}>LIVE — send real email</option></select>
        ${live.ready ? '<div class="callout ok small-text" style="margin-top:8px">Ready for live sending.</div>' : `<div class="callout small-text" style="margin-top:8px"><b>Before going live:</b><ul style="margin:4px 0 0 16px;padding:0">${live.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`}
        ${field('daily_cap', 'Daily send cap (campaign emails / 24h)', 'number', 'Start around 30–50 per mailbox and raise slowly to protect deliverability.')}
        ${field('min_gap_seconds', 'Minimum seconds between sends', 'number')}
        <div class="row"><div>${field('business_hours_start', 'Local send window from (hour)', 'number')}</div><div>${field('business_hours_end', 'to (hour)', 'number')}</div></div>
        <label>Weekdays only</label><select name="weekdays_only"><option value="true" ${s.weekdays_only === 'true' ? 'selected' : ''}>Yes</option><option value="false" ${s.weekdays_only !== 'true' ? 'selected' : ''}>No</option></select>
        <label>Large businesses (500+ staff / big chains)</label><select name="allow_large"><option value="false" ${s.allow_large !== 'true' ? 'selected' : ''}>Hold for later — don't enroll</option><option value="true" ${s.allow_large === 'true' ? 'selected' : ''}>Allow enrollment</option></select>
        <h2 style="margin-top:20px">Discovery</h2>
        ${field('sweep_daily_limit', 'Max Places searches per day', 'number', 'Each search returns up to 60 businesses. Watch your Google Cloud billing.')}
        ${field('crawl_concurrency', 'Websites crawled in parallel', 'number')}
        <h2 style="margin-top:20px">Connections</h2>
        <table class="small-text">${[['Google Places', ints.places], ['Hunter.io (optional)', ints.hunter], ['SMTP sending', ints.smtp, env.SMTP_USER], ['IMAP replies', ints.imap, env.IMAP_USER], ['Claude AI drafting (optional)', ints.ai, env.ANTHROPIC_MODEL], ['Portal password', env.PORTAL_PASSWORD]]
          .map(([n, ok, extra]) => `<tr><td>${n}</td><td>${ok ? '<span class="chip sent">connected</span>' : '<span class="chip">not set</span>'} <span class="muted">${ok && extra ? esc(extra) : ''}</span></td></tr>`).join('')}
          <tr><td>Public URL</td><td>${esc(env.PUBLIC_URL)}</td></tr></table>
        <button type="button" id="test-smtp" ${ints.smtp ? '' : 'disabled'}>Test SMTP login</button>
      </div>
    </div><br><button class="primary">Save settings</button></form>
    <div class="card" style="margin-top:16px"><h2>Suppression list (${num(sup.length)})</h2>
      <p class="muted small-text">Never emailed again. Unsubscribes, bounces and "remove me" replies are added automatically. Add emails or whole domains.</p>
      <form id="sup" class="row"><input name="values" placeholder="someone@company.com, competitor.com" style="flex:1"><button>Add</button></form>
      <div class="table-wrap" style="margin-top:8px;max-height:260px"><table>${sup.map((x) => `<tr><td>${esc(x.value)}</td><td class="small-text muted">${esc(x.reason || '')}</td><td class="small-text muted">${fmtDate(x.created_at)}</td>
        <td><button class="danger" data-unsup="${esc(x.value)}">Remove</button></td></tr>`).join('')}</table></div></div>`;
  $('#settings').onsubmit = async (e) => {
    e.preventDefault();
    await act(e.submitter, () => api('/settings', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }), 'Settings saved');
    await refreshChrome();
    settings();
  };
  $('#test-smtp').onclick = (e) => act(e.target, () => api('/settings/test-smtp', { body: {} }), 'SMTP login OK');
  $('#sup').onsubmit = (e) => { e.preventDefault(); act(e.submitter, () => api('/suppressions', { body: Object.fromEntries(new FormData(e.target)) }), 'Added').then(settings); };
  $$('[data-unsup]').forEach((b) => (b.onclick = () => confirm('Remove from suppression list? Only do this if they asked to hear from you again.') &&
    act(b, () => api('/suppressions/' + encodeURIComponent(b.dataset.unsup), { method: 'DELETE' })).then(settings)));
}

// ---------------- Boot ----------------
(async () => {
  const me = await fetch('/api/me').then((r) => r.json());
  if (!me.authed) return renderLogin();
  await refreshChrome();
  window.addEventListener('hashchange', route);
  route();
  setInterval(() => refreshChrome().catch(() => {}), 60000);
})();
