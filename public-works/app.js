/* Mumbai Public Works — dashboard logic. Plain JS, no build step.
 * Reads window.PUBLIC_WORKS_DATA (data/projects.js). See README.md for the schema. */
(function () {
  "use strict";

  var DATA = window.PUBLIC_WORKS_DATA || { meta: {}, mlas: [], projects: [] };
  var META = DATA.meta || {};
  var PROJECTS = DATA.projects || [];
  var MLAS = DATA.mlas || [];
  var OFFICIALS = DATA.officials || [];

  var STATUSES = [
    { key: "Completed", css: "--st-completed" },
    { key: "Partially open", css: "--st-partial" },
    { key: "In progress", css: "--st-progress" },
    { key: "Delayed", css: "--st-delayed" },
    { key: "Stalled", css: "--st-stalled" },
    { key: "Not started", css: "--st-notstarted" },
  ];

  var mlaByConst = {};
  MLAS.forEach(function (m) { mlaByConst[m.constituency] = m; });

  var state = { q: "", status: "", sector: "", agency: "", constituency: "", funderType: "" };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function statusColor(s) {
    var st = STATUSES.find(function (x) { return x.key === s; });
    return "var(" + (st ? st.css : "--st-notstarted") + ")";
  }
  function cost(p) { return p.cost ? (p.cost.revised != null ? p.cost.revised : p.cost.original) : null; }
  function crore(n) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 100000) return "₹" + (n / 100000).toFixed(2) + " lakh cr";
    return "₹" + Math.round(n).toLocaleString("en-IN") + " cr";
  }
  function fmtDate(d) {
    if (!d) return "—";
    var parts = String(d).split("-");
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    if (parts.length === 1) return parts[0];
    var m = months[parseInt(parts[1], 10) - 1] || "";
    return (parts[2] ? parseInt(parts[2], 10) + " " : "") + m + " " + parts[0];
  }
  function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))).sort(); }
  function badge(s) {
    return '<span class="badge" style="color:' + statusColor(s) + '"><span class="dot" style="background:' + statusColor(s) + '"></span>' + esc(s) + "</span>";
  }
  function progressBar(p) {
    var v = p.progress;
    if (v == null) return "";
    return '<div class="progress" title="' + v + '% physical progress"><span style="width:' + Math.max(0, Math.min(100, v)) + "%;background:" + statusColor(p.status) + '"></span></div>';
  }
  function mlasFor(p) {
    return (p.constituencies || []).map(function (c) { return mlaByConst[c] || { constituency: c }; });
  }

  // ---------- filtering ----------
  function matches(p) {
    if (state.status && p.status !== state.status) return false;
    if (state.sector && p.sector !== state.sector) return false;
    if (state.agency && p.agency !== state.agency) return false;
    if (state.constituency && (p.constituencies || []).indexOf(state.constituency) === -1) return false;
    if (state.funderType && !(p.funders || []).some(function (f) { return f.type === state.funderType; })) return false;
    if (state.q) {
      var hay = [p.name, p.summary, p.agency, p.contractor, p.sector, (p.areas || []).join(" "), (p.constituencies || []).join(" "),
        mlasFor(p).map(function (m) { return m.name || ""; }).join(" "), (p.funders || []).map(function (f) { return f.name; }).join(" ")]
        .join(" ").toLowerCase();
      var terms = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.every(function (t) { return hay.indexOf(t) !== -1; })) return false;
    }
    return true;
  }
  function filtered() { return PROJECTS.filter(matches); }

  // ---------- views ----------
  var app = document.getElementById("app");

  function kpis(list) {
    var total = list.reduce(function (s, p) { return s + (cost(p) || 0); }, 0);
    var counts = {};
    list.forEach(function (p) { counts[p.status] = (counts[p.status] || 0) + 1; });
    var late = list.filter(function (p) { return p.status === "Delayed" || p.status === "Stalled"; }).length;
    var overrun = list.filter(function (p) { return p.cost && p.cost.revised != null && p.cost.original != null && p.cost.revised > p.cost.original; });
    var overrunAmt = overrun.reduce(function (s, p) { return s + (p.cost.revised - p.cost.original); }, 0);

    var segs = STATUSES.map(function (s) {
      var n = counts[s.key] || 0;
      return n ? '<span style="width:' + (100 * n / list.length) + "%;background:var(" + s.css + ')" title="' + esc(s.key) + ": " + n + '"></span>' : "";
    }).join("");
    var legend = STATUSES.map(function (s) {
      var n = counts[s.key] || 0;
      return '<button type="button" data-status="' + esc(s.key) + '" aria-pressed="' + (state.status === s.key) + '"><span class="dot" style="background:var(' + s.css + ')"></span>' + esc(s.key) + " · " + n + "</button>";
    }).join("");

    return '<div class="kpis">' +
      '<div class="kpi"><div class="label">Projects</div><div class="value">' + list.length + '</div><div class="sub">matching filters</div></div>' +
      '<div class="kpi"><div class="label">Total value</div><div class="value">' + crore(total) + '</div><div class="sub">latest sanctioned / revised cost</div></div>' +
      '<div class="kpi"><div class="label">Delayed or stalled</div><div class="value">' + late + '</div><div class="sub">' + (list.length ? Math.round(100 * late / list.length) : 0) + '% of projects</div></div>' +
      '<div class="kpi"><div class="label">Cost overruns</div><div class="value">' + crore(overrunAmt) + '</div><div class="sub">across ' + overrun.length + " project" + (overrun.length === 1 ? "" : "s") + " with revised costs</div></div>" +
      "</div>" +
      '<div class="panel"><h2>Status</h2><div class="statusbar">' + segs + '</div><div class="legend" id="legend">' + legend + "</div></div>";
  }

  function filterBar() {
    function opts(values, current, all) {
      return '<option value="">' + esc(all) + "</option>" + values.map(function (v) {
        return '<option value="' + esc(v) + '"' + (v === current ? " selected" : "") + ">" + esc(v) + "</option>";
      }).join("");
    }
    var consts = uniq(PROJECTS.flatMap(function (p) { return p.constituencies || []; }));
    var constOpts = '<option value="">All constituencies</option>' + consts.map(function (c) {
      var m = mlaByConst[c];
      return '<option value="' + esc(c) + '"' + (c === state.constituency ? " selected" : "") + ">" + esc(c) + (m && m.name ? " — " + esc(m.name) : "") + "</option>";
    }).join("");
    return '<div class="filters">' +
      '<input class="search" type="search" id="f-q" placeholder="Search project, area, MLA, contractor, funder…" value="' + esc(state.q) + '" aria-label="Search" />' +
      '<select id="f-status" aria-label="Status">' + opts(STATUSES.map(function (s) { return s.key; }), state.status, "All statuses") + "</select>" +
      '<select id="f-sector" aria-label="Sector">' + opts(uniq(PROJECTS.map(function (p) { return p.sector; })), state.sector, "All sectors") + "</select>" +
      '<select id="f-agency" aria-label="Agency">' + opts(uniq(PROJECTS.map(function (p) { return p.agency; })), state.agency, "All agencies") + "</select>" +
      '<select id="f-const" aria-label="Constituency">' + constOpts + "</select>" +
      "</div>";
  }

  function card(p) {
    var ms = mlasFor(p).filter(function (m) { return m.name; });
    var mlaLine = ms.length ? ms.slice(0, 3).map(function (m) { return esc(m.name); }).join(", ") + (ms.length > 3 ? " +" + (ms.length - 3) + " more" : "") : "—";
    var target = p.completedDate ? "Completed " + fmtDate(p.completedDate) : "Target " + fmtDate(p.revisedTargetDate || p.targetDate);
    return '<button type="button" class="card" data-id="' + esc(p.id) + '">' +
      '<div class="row" style="align-items:flex-start"><h3>' + esc(p.name) + "</h3>" + badge(p.status) + "</div>" +
      '<div class="meta">' + esc(p.sector) + " · " + esc(p.agency) + "</div>" +
      progressBar(p) +
      '<div class="row"><span>Cost</span><b>' + crore(cost(p)) + (p.cost && p.cost.revised != null && p.cost.original != null && p.cost.revised > p.cost.original ? ' <span style="color:var(--st-delayed)" title="Revised up from ' + crore(p.cost.original) + '">▲</span>' : "") + "</b></div>" +
      '<div class="row"><span>Funded by</span><span style="text-align:right">' + esc((p.funders || []).map(function (f) { return f.name; }).join(", ") || "—") + "</span></div>" +
      '<div class="row"><span>Area MLA' + (ms.length === 1 ? "" : "s") + '</span><span style="text-align:right">' + mlaLine + "</span></div>" +
      '<div class="meta">' + esc(target) + (p.progress != null ? " · " + p.progress + "% done" : "") + "</div>" +
      "</button>";
  }

  function viewProjects() {
    var list = filtered();
    app.innerHTML = kpis(list) + '<div class="panel">' + filterBar() +
      '<div class="toolbar"><span>' + list.length + " of " + PROJECTS.length + ' projects</span><span><button class="btn" id="reset">Clear filters</button> <button class="btn" id="csv">Download CSV</button></span></div>' +
      (list.length ? '<div class="cards">' + list.map(card).join("") + "</div>" : '<div class="empty">No projects match these filters.</div>') +
      "</div>";
    bindFilters(viewProjects);
  }

  function bindFilters(rerender) {
    var map = { "f-status": "status", "f-sector": "sector", "f-agency": "agency", "f-const": "constituency" };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", function () { state[map[id]] = el.value; rerender(); });
    });
    var q = document.getElementById("f-q");
    if (q) {
      q.addEventListener("input", debounce(function () {
        state.q = q.value; var pos = q.selectionStart; rerender();
        var nq = document.getElementById("f-q"); if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
      }, 200));
    }
    var reset = document.getElementById("reset");
    if (reset) reset.addEventListener("click", function () { Object.keys(state).forEach(function (k) { state[k] = ""; }); rerender(); });
    var csv = document.getElementById("csv");
    if (csv) csv.addEventListener("click", downloadCsv);
    var legend = document.getElementById("legend");
    if (legend) legend.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-status]"); if (!b) return;
      state.status = state.status === b.dataset.status ? "" : b.dataset.status; rerender();
    });
  }

  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function viewMlas() {
    var rows = MLAS.map(function (m) {
      var ps = PROJECTS.filter(function (p) { return (p.constituencies || []).indexOf(m.constituency) !== -1; });
      var val = ps.reduce(function (s, p) { return s + (cost(p) || 0); }, 0);
      var late = ps.filter(function (p) { return p.status === "Delayed" || p.status === "Stalled"; }).length;
      return { m: m, ps: ps, val: val, late: late };
    });
    rows.sort(function (a, b) { return b.ps.length - a.ps.length || (a.m.no || 0) - (b.m.no || 0); });
    var q = state.q.toLowerCase();
    var shown = rows.filter(function (r) {
      return !q || [r.m.name, r.m.constituency, r.m.party, r.m.district].join(" ").toLowerCase().indexOf(q) !== -1;
    });

    var officials = OFFICIALS.length ? '<div class="panel"><h2>Who is accountable at the state level</h2><p class="hint">Large projects are run by state agencies (MMRDA, MSRDC, MHADA, MMRCL) or the BMC, not by individual MLAs. These office-holders oversee them.</p><table class="data"><tbody>' +
      OFFICIALS.map(function (o) { return "<tr><td>" + esc(o.role) + "</td><td><b>" + esc(o.name) + "</b></td></tr>"; }).join("") + "</tbody></table></div>" : "";

    app.innerHTML = officials + '<div class="panel"><h2>MLAs by constituency</h2>' +
      '<p class="hint">Every Mumbai assembly constituency and its elected MLA, with the tracked projects that run through it. An MLA represents the area and can raise a project in the Assembly; the implementing agency is responsible for delivery. Click a row to see that constituency’s projects.</p>' +
      '<div class="filters" style="grid-template-columns:1fr"><input type="search" id="mla-q" placeholder="Search MLA, constituency or party…" value="' + esc(state.q) + '" /></div>' +
      '<div class="table-scroll"><table class="data"><thead><tr><th>#</th><th>Constituency</th><th>MLA</th><th>Party</th><th class="num">Projects</th><th class="num">Value</th><th class="num">Delayed</th></tr></thead><tbody>' +
      shown.map(function (r) {
        return '<tr class="click" data-const="' + esc(r.m.constituency) + '"><td>' + esc(r.m.no || "") + "</td><td>" + esc(r.m.constituency) + '<div class="meta" style="color:var(--muted);font-size:12px">' + esc(r.m.district || "") + "</div></td><td><b>" + esc(r.m.name || "—") + "</b></td><td>" + esc(r.m.party || "—") +
          '</td><td class="num">' + r.ps.length + '</td><td class="num">' + (r.ps.length ? crore(r.val) : "—") + '</td><td class="num">' + (r.late || "—") + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";

    var q2 = document.getElementById("mla-q");
    q2.addEventListener("input", debounce(function () {
      state.q = q2.value; var pos = q2.selectionStart; viewMlas();
      var n = document.getElementById("mla-q"); n.focus(); n.setSelectionRange(pos, pos);
    }, 200));
    app.querySelectorAll("tr[data-const]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        Object.keys(state).forEach(function (k) { state[k] = ""; });
        state.constituency = tr.dataset.const;
        location.hash = "#/projects";
      });
    });
  }

  function viewFunders() {
    var byFunder = {}, byType = {};
    var unknown = 0;
    PROJECTS.forEach(function (p) {
      (p.funders || []).forEach(function (f) {
        var k = f.name;
        byFunder[k] = byFunder[k] || { name: f.name, type: f.type, amount: 0, unknownAmt: 0, projects: [] };
        if (f.amount != null) { byFunder[k].amount += f.amount; byType[f.type] = (byType[f.type] || 0) + f.amount; }
        else { byFunder[k].unknownAmt++; unknown++; }
        byFunder[k].projects.push(p);
      });
    });
    var funders = Object.values(byFunder).sort(function (a, b) { return b.amount - a.amount || b.projects.length - a.projects.length; });
    var maxF = Math.max.apply(null, funders.map(function (f) { return f.amount; }).concat([1]));
    var types = Object.keys(byType).map(function (t) { return { t: t, v: byType[t] }; }).sort(function (a, b) { return b.v - a.v; });
    var maxT = Math.max.apply(null, types.map(function (x) { return x.v; }).concat([1]));

    app.innerHTML = '<div class="panel"><h2>Money by source type</h2><p class="hint">Only funding commitments with a published amount are summed. ' + unknown + ' commitments have no public figure and are counted by project below.</p><div class="bars">' +
      types.map(function (x) { return '<div class="bar-row"><span>' + esc(x.t) + '</span><div class="bar-track"><div class="bar-fill" style="width:' + (100 * x.v / maxT) + '%"></div></div><span class="bar-val">' + crore(x.v) + "</span></div>"; }).join("") +
      '</div></div><div class="panel"><h2>Every funder</h2><p class="hint">Who has put money into which project. Click a project to see details.</p><div class="table-scroll"><table class="data"><thead><tr><th>Funder</th><th>Type</th><th class="num">Known amount</th><th>Projects</th></tr></thead><tbody>' +
      funders.map(function (f) {
        return "<tr><td><b>" + esc(f.name) + "</b>" + '<div class="bar-track" style="margin-top:6px;height:6px;background:var(--surface-2);border-radius:4px;overflow:hidden"><div class="bar-fill" style="height:100%;background:var(--accent);width:' + (100 * f.amount / maxF) + '%"></div></div></td><td>' + esc(f.type) + '</td><td class="num">' + (f.amount ? crore(f.amount) : "not disclosed") + (f.amount && f.unknownAmt ? '<div style="font-size:12px;color:var(--muted)">+' + f.unknownAmt + " undisclosed</div>" : "") + "</td><td>" +
          f.projects.map(function (p) { return '<a href="#/project/' + encodeURIComponent(p.id) + '">' + esc(p.shortName || p.name) + "</a>"; }).join(", ") + "</td></tr>";
      }).join("") + "</tbody></table></div></div>";
  }

  var leafletMap = null;
  function viewMap() {
    var list = filtered();
    app.innerHTML = '<div class="panel">' + filterBar() + '<p class="hint">Pins mark an approximate point on each project (a station, a portal, or the middle of a corridor), not its full route. ' + list.filter(function (p) { return p.location; }).length + " of " + list.length + ' projects mapped.</p><div id="map"></div><div class="legend" style="margin-top:10px">' +
      STATUSES.map(function (s) { return '<span style="display:inline-flex;gap:6px;align-items:center"><span class="dot" style="background:var(' + s.css + ')"></span>' + esc(s.key) + "</span>"; }).join("") + "</div></div>";
    bindFilters(viewMap);
    if (!window.L) { document.getElementById("map").innerHTML = '<div class="empty">The map library could not load. The project list still works.</div>'; return; }
    if (leafletMap) { leafletMap.remove(); leafletMap = null; }
    leafletMap = L.map("map", { scrollWheelZoom: false }).setView([19.07, 72.88], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(leafletMap);
    list.forEach(function (p) {
      if (!p.location) return;
      var st = STATUSES.find(function (x) { return x.key === p.status; });
      var color = cssVar(st ? st.css : "--st-notstarted");
      var m = L.circleMarker([p.location.lat, p.location.lng], { radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 }).addTo(leafletMap);
      m.bindPopup("<b>" + esc(p.name) + "</b><br>" + esc(p.status) + " · " + crore(cost(p)) + '<br><a href="#/project/' + encodeURIComponent(p.id) + '">Details →</a>');
    });
  }

  function viewAbout() {
    var srcs = (META.sources || []).map(function (s) {
      var u = safeUrl(s.url);
      return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a>" : esc(s.name)) + (s.note ? " — " + esc(s.note) : "") + "</li>";
    }).join("");
    app.innerHTML = '<div class="panel"><h2>About this data</h2>' +
      "<p>" + esc(META.sourceNote || "") + "</p>" +
      "<p><b>Last updated:</b> " + fmtDate(META.lastUpdated) + "</p>" +
      "<h3 style=\"font-size:15px;margin:18px 0 6px\">How to read it</h3><ul>" +
      "<li><b>Status</b> is the latest reported state from the cited source. Each project shows the date of the report it is based on.</li>" +
      "<li><b>Cost</b> is the latest sanctioned or revised estimate in ₹ crore. A ▲ means the cost has been revised upward from the original.</li>" +
      "<li><b>Funded by</b> lists every source of money we could find: central and state government, the BMC, multilateral lenders (JICA, World Bank, ADB, AIIB) and private developers. “Not disclosed” means the source is known but its share is not public.</li>" +
      "<li><b>Area MLAs</b> are the elected members for the assembly constituencies a project passes through. They represent the area; the implementing agency is responsible for building it.</li>" +
      "</ul>" +
      (srcs ? '<h3 style="font-size:15px;margin:18px 0 6px">Main sources</h3><ul>' + srcs + "</ul>" : "") +
      '<h3 style="font-size:15px;margin:18px 0 6px">Something wrong or missing?</h3><p>Every number here should trace to a public document. If you have a newer progress report, an RTI reply, or a correction, send it with the source link and the record will be updated.</p>' +
      "</div>";
  }

  // ---------- detail drawer ----------
  var drawer = document.getElementById("drawer");
  var overlay = document.getElementById("overlay");
  var lastHash = "#/projects";

  function openProject(id) {
    var p = PROJECTS.find(function (x) { return x.id === id; });
    if (!p) { closeDrawer(); return; }
    var mls = mlasFor(p);
    var facts = [
      ["Status", badge(p.status) + (p.progress != null ? " &nbsp;" + p.progress + "% physical progress" : "")],
      ["Implementing agency", esc(p.agency)],
      ["Sector", esc(p.sector)],
      ["Contractor / developer", esc(p.contractor || "—")],
      ["Original cost", crore(p.cost && p.cost.original)],
      ["Revised cost", p.cost && p.cost.revised != null ? crore(p.cost.revised) + (p.cost.original ? " (" + (p.cost.revised >= p.cost.original ? "+" : "") + Math.round(100 * (p.cost.revised - p.cost.original) / p.cost.original) + "%)" : "") : "—"],
      ["Started", fmtDate(p.startDate)],
      ["Original target", fmtDate(p.targetDate)],
      ["Revised target", fmtDate(p.revisedTargetDate)],
      ["Completed / opened", fmtDate(p.completedDate)],
      ["Areas", esc((p.areas || []).join(", ") || "—")],
    ];
    var funders = (p.funders || []).length ? '<table class="data"><tbody>' + p.funders.map(function (f) {
      return "<tr><td><b>" + esc(f.name) + '</b><div style="font-size:12px;color:var(--muted)">' + esc(f.type) + (f.note ? " · " + esc(f.note) : "") + '</div></td><td class="num">' + (f.amount != null ? crore(f.amount) : "not disclosed") + "</td></tr>";
    }).join("") + "</tbody></table>" : '<p class="hint">No funding breakdown published.</p>';
    var mlaHtml = mls.length ? mls.map(function (m) {
      return '<div class="mla-card"><div class="name">' + esc(m.name || "MLA not on file") + '</div><div style="color:var(--muted)">' + esc(m.constituency) + (m.no ? " (No. " + esc(m.no) + ")" : "") + (m.party ? " · " + esc(m.party) : "") + "</div></div>";
    }).join("") : '<p class="hint">Not mapped to a constituency yet.</p>';
    var sources = (p.sources || []).map(function (s) {
      var u = safeUrl(s.url);
      return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.title || u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) + "</a>" : esc(s.title || "")) + (s.date ? " · " + fmtDate(s.date) : "") + (s.claim ? '<div style="color:var(--muted)">' + esc(s.claim) + "</div>" : "") + "</li>";
    }).join("");

    drawer.innerHTML = '<div class="drawer-head"><h2 id="drawer-title">' + esc(p.name) + '</h2><button class="close" id="close" aria-label="Close">×</button></div><div class="drawer-body">' +
      (p.summary ? "<p>" + esc(p.summary) + "</p>" : "") +
      progressBar(p) +
      (p.delayReason ? '<div class="delay"><b>Why it’s late:</b> ' + esc(p.delayReason) + "</div>" : "") +
      "<h3>Key facts</h3><dl class=\"facts\">" + facts.map(function (f) { return "<dt>" + f[0] + "</dt><dd>" + f[1] + "</dd>"; }).join("") + "</dl>" +
      "<h3>Who's funding it</h3>" + funders +
      "<h3>Elected MLAs for this area</h3>" + mlaHtml +
      "<h3>Sources</h3>" + (sources ? '<ul class="sources">' + sources + "</ul>" : '<p class="hint">No source on file.</p>') +
      (p.lastVerified ? '<p class="hint" style="margin-top:16px">Status last checked: ' + fmtDate(p.lastVerified) + "</p>" : "") +
      "</div>";
    drawer.classList.add("open"); overlay.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
    document.getElementById("close").addEventListener("click", closeDrawer);
    document.getElementById("close").focus();
  }
  function closeDrawer() {
    drawer.classList.remove("open"); overlay.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
    if (/^#\/project\//.test(location.hash)) location.hash = lastHash;
  }
  overlay.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer(); });
  app.addEventListener("click", function (e) {
    var c = e.target.closest(".card[data-id]");
    if (c) location.hash = "#/project/" + encodeURIComponent(c.dataset.id);
  });

  // ---------- CSV ----------
  function downloadCsv() {
    var cols = ["id", "name", "status", "progress", "sector", "agency", "contractor", "original_cost_cr", "revised_cost_cr", "funders", "constituencies", "mlas", "start", "target", "revised_target", "completed", "delay_reason", "sources"];
    var rows = filtered().map(function (p) {
      return [p.id, p.name, p.status, p.progress, p.sector, p.agency, p.contractor, p.cost && p.cost.original, p.cost && p.cost.revised,
        (p.funders || []).map(function (f) { return f.name + (f.amount != null ? " (" + f.amount + ")" : ""); }).join("; "),
        (p.constituencies || []).join("; "), mlasFor(p).map(function (m) { return m.name || ""; }).join("; "),
        p.startDate, p.targetDate, p.revisedTargetDate, p.completedDate, p.delayReason, (p.sources || []).map(function (s) { return s.url; }).join(" ")];
    });
    var csv = [cols].concat(rows).map(function (r) {
      return r.map(function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",");
    }).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = "mumbai-public-works.csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- router ----------
  function route() {
    var h = location.hash || "#/projects";
    var m = h.match(/^#\/project\/(.+)$/);
    if (m) {
      if (!app.innerHTML) render(lastHash);
      openProject(decodeURIComponent(m[1]));
      return;
    }
    if (drawer.classList.contains("open")) { drawer.classList.remove("open"); overlay.classList.remove("open"); }
    lastHash = h;
    render(h);
  }
  function render(h) {
    var tab = (h.match(/^#\/(\w+)/) || [])[1] || "projects";
    document.querySelectorAll("nav.tabs a").forEach(function (a) { a.classList.toggle("active", a.dataset.tab === tab); });
    if (tab !== "map" && leafletMap) { leafletMap.remove(); leafletMap = null; }
    ({ projects: viewProjects, map: viewMap, mlas: viewMlas, funders: viewFunders, about: viewAbout }[tab] || viewProjects)();
  }

  // ---------- boot ----------
  if (META.title) { document.getElementById("site-title").textContent = META.title; document.title = META.title; }
  if (META.subtitle) document.getElementById("site-sub").textContent = META.subtitle;
  var notice = document.getElementById("notice");
  if (META.notice) { notice.hidden = false; notice.textContent = META.notice; }
  document.getElementById("footer").innerHTML = "Data last updated " + fmtDate(META.lastUpdated) + ". Figures in ₹ crore. Built from public sources; see <a href=\"#/about\">About the data</a>.";
  window.addEventListener("hashchange", route);
  route();
})();
