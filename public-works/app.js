/* Mumbai Public Works — dashboard logic. Plain JS, no build step.
 * Reads window.PUBLIC_WORKS_DATA (+ ROUTES, WARDS, TENDERS) from data/*.js. Schema: README.md.
 * Views route on plain hashes: #overview #map #wards #ward-G-S #tenders #mlas #funding #about #p-MUM-004 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- data
  var DATA = window.PUBLIC_WORKS_DATA || { meta: {}, mlas: [], projects: [] };
  var META = DATA.meta || {};
  var PROJECTS = DATA.projects || [];
  var MLAS = DATA.mlas || [];
  var OFFICIALS = DATA.officials || [];
  var AGENCY_HEADS = DATA.agencyHeads || [];
  var TENDERS = window.PUBLIC_WORKS_TENDERS || { items: [] };
  var ROUTES = window.PUBLIC_WORKS_ROUTES || {};
  var WARD_GEO = (window.PUBLIC_WORKS_WARDS || { features: [] }).features;
  var EMBED = !!window.PW_EMBED;

  var STATUSES = [
    { key: "Completed", css: "--st-completed", icon: '<circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.4 6.2l1.8 1.8 3.4-3.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' },
    { key: "Partially open", css: "--st-partial", icon: '<circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 1v10A5 5 0 0 1 6 1z" fill="currentColor"/>' },
    { key: "In progress", css: "--st-progress", icon: '<circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.8 3.6l3 2.4-3 2.4z" fill="currentColor"/>' },
    { key: "Delayed", css: "--st-delayed", icon: '<path d="M6 1.2l5 9H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 4.6v2.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="6" cy="8.7" r="0.8" fill="currentColor"/>' },
    { key: "Stalled", css: "--st-stalled", icon: '<path d="M4 1h4l3 3v4l-3 3H4L1 8V4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4.2 6h3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' },
    { key: "Not started", css: "--st-notstarted", icon: '<circle cx="6" cy="6" r="5.25" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 1.6"/>' },
  ];
  var STATUS_RANK = { "Stalled": 0, "Delayed": 1, "Not started": 2, "In progress": 3, "Partially open": 4, "Completed": 5 };
  // Funding source types keep a fixed colour (categorical slots, never cycled).
  var FUND_TYPES = [
    { key: "Central Govt", color: "#2a78d6", dark: "#3987e5" },
    { key: "State Govt", color: "#eb6834", dark: "#d95926" },
    { key: "Municipal", color: "#1baf7a", dark: "#199e70" },
    { key: "Multilateral", color: "#6250d6", dark: "#9085e9" },
    { key: "Private / PPP", color: "#e87ba4", dark: "#d55181" },
  ];

  var mlaByConst = {};
  MLAS.forEach(function (m) { mlaByConst[m.constituency] = m; });
  var WARD_INFO = {};
  (DATA.wardInfo || []).forEach(function (w) { WARD_INFO[w.ward] = w; });
  var WARD_ORDER = ["A", "B", "C", "D", "E", "F/S", "F/N", "G/S", "G/N", "H/E", "H/W", "K/E", "K/W", "P/S", "P/N", "R/S", "R/C", "R/N", "L", "M/E", "M/W", "N", "S", "T"];
  var WARD_NAMES = WARD_GEO.map(function (f) { return f.properties.ward; })
    .sort(function (a, b) { return WARD_ORDER.indexOf(a) - WARD_ORDER.indexOf(b); });
  var WARD_FEATURE = {};
  WARD_GEO.forEach(function (f) { WARD_FEATURE[f.properties.ward] = f; });
  var WARD_LONG = { N: "North", S: "South", E: "East", W: "West", C: "Central" };
  function wardTitle(w) { var p = w.split("/"); return "Ward " + p[0] + (p[1] ? "/" + WARD_LONG[p[1]] : ""); }
  function wardSlug(w) { return w.replace("/", "-"); }
  function wardFromSlug(s) { return s.replace("-", "/"); }

  // ---------------------------------------------------------------- geometry: which ward is each point in?
  function inRing(x, y, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function segDistKm(lat, lng, a, b) {
    var kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
    var px = lng * kx, py = lat * ky, ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky;
    var dx = bx - ax, dy = by - ay, t = dx || dy ? ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy) : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  // Points just offshore (coastal road, sea links) snap to the nearest ward within 1.2 km.
  function wardAt(lat, lng) {
    var best = null, bestD = 1.2;
    for (var i = 0; i < WARD_GEO.length; i++) {
      var polys = WARD_GEO[i].geometry.coordinates;
      for (var k = 0; k < polys.length; k++) {
        if (inRing(lng, lat, polys[k][0]) && !polys[k].slice(1).some(function (h) { return inRing(lng, lat, h); })) return WARD_GEO[i].properties.ward;
        var r = polys[k][0];
        for (var s = 1; s < r.length; s++) {
          var d = segDistKm(lat, lng, r[s - 1], r[s]);
          if (d < bestD) { bestD = d; best = WARD_GEO[i].properties.ward; }
        }
      }
    }
    return best;
  }
  var WARD_PARTS = {}; // project id -> { ward: [part names] } (+ "outside")
  var POINT_WARD = {}; // "lat,lng" -> ward
  PROJECTS.forEach(function (p) {
    var parts = {};
    (ROUTES[p.id] || []).forEach(function (path) {
      path.forEach(function (pt) {
        var key = pt[0] + "," + pt[1];
        var w = POINT_WARD[key] !== undefined ? POINT_WARD[key] : (POINT_WARD[key] = wardAt(pt[0], pt[1]));
        (parts[w || "outside"] = parts[w || "outside"] || []).push(pt[2]);
      });
    });
    WARD_PARTS[p.id] = parts;
  });
  function wardsOf(p) { return Object.keys(WARD_PARTS[p.id] || {}).filter(function (w) { return w !== "outside"; }).sort(function (a, b) { return WARD_ORDER.indexOf(a) - WARD_ORDER.indexOf(b); }); }

  var WARD_PARENT = { "K/N": "K/E", "K/S": "K/E", "P/E": "P/N" }; // newer wards inside older map wards
  function tenderMapWard(t) { return t.ward ? WARD_PARENT[t.ward] || t.ward : null; }
  var OPEN_TENDERS = TENDERS.items.filter(function (t) { return t.status === "Open"; });

  function headsFor(p) { return AGENCY_HEADS.filter(function (h) { return (p.agency || "").indexOf(h.agency) !== -1; }); }
  function mlasFor(p) { return (p.constituencies || []).map(function (c) { return mlaByConst[c] || { constituency: c }; }); }

  // ---------------------------------------------------------------- formatting
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : ""; }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function isDark() { return getComputedStyle(document.documentElement).colorScheme.indexOf("dark") !== -1; }
  function statusOf(key) { return STATUSES.find(function (s) { return s.key === key; }) || STATUSES[5]; }
  function statusColor(key) { return "var(" + statusOf(key).css + ")"; }
  function fundColor(type) { var f = FUND_TYPES.find(function (x) { return x.key === type; }); return f ? (isDark() ? f.dark : f.color) : cssVar("--ink-3"); }
  function cost(p) { return p.cost ? (p.cost.revised != null ? p.cost.revised : p.cost.original) : null; }
  function overrun(p) { return p.cost && p.cost.original && p.cost.revised && p.cost.revised > p.cost.original ? p.cost.revised - p.cost.original : 0; }
  function overrunPct(p) { return overrun(p) ? Math.round(100 * overrun(p) / p.cost.original) : 0; }
  function isLate(p) { return p.status === "Delayed" || p.status === "Stalled"; }
  function crore(n, opts) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 100000 && !(opts && opts.plain)) return "₹" + (n / 100000).toFixed(n >= 1000000 ? 1 : 2) + " lakh cr";
    if (n < 10) return "₹" + n.toFixed(1).replace(/\.0$/, "") + " cr";
    return "₹" + Math.round(n).toLocaleString("en-IN") + " cr";
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d) {
    if (!d) return "—";
    var p = String(d).split("-");
    if (p.length === 1) return p[0];
    return (p[2] ? parseInt(p[2], 10) + " " : "") + (MONTHS[parseInt(p[1], 10) - 1] || "") + " " + p[0];
  }
  function fmtDT(s) { if (!s) return "—"; return fmtDate(s.slice(0, 10)) + (s.length > 10 ? ", " + s.slice(11, 16) : ""); }
  function toTime(d, end) { // YYYY -> mid-year, YYYY-MM -> mid-month
    if (!d) return null;
    var p = String(d).split("-").map(Number);
    if (p.length === 1) return Date.UTC(p[0], end ? 11 : 6, end ? 31 : 1);
    return Date.UTC(p[0], p[1] - 1, p[2] || 15);
  }
  var TODAY = Date.now();
  function uniq(arr) { return Array.from(new Set(arr.filter(Boolean))).sort(); }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function pill(s) {
    var st = statusOf(s);
    return '<span class="pill" style="color:' + statusColor(s) + '"><svg viewBox="0 0 12 12" aria-hidden="true">' + st.icon + "</svg>" + esc(s) + "</span>";
  }
  function wcode(w) { return '<span class="wcode">' + esc(w) + "</span>"; }
  var ICON_SEARCH = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  // ---------------------------------------------------------------- tooltip
  var tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
  document.addEventListener("pointermove", function (e) {
    var t = e.target.closest && e.target.closest("[data-tip]");
    if (!t) { tip.hidden = true; return; }
    tip.innerHTML = t.getAttribute("data-tip");
    tip.hidden = false;
    var x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
    var y = e.clientY + 18 + tip.offsetHeight > window.innerHeight ? e.clientY - tip.offsetHeight - 12 : e.clientY + 18;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  });
  document.addEventListener("scroll", function () { tip.hidden = true; }, true);

  // ---------------------------------------------------------------- filtering
  var state = { q: "", status: "", sector: "", agency: "", constituency: "", ward: "" };
  var ui = { view: "cards", sort: "value", limit: 48 };
  try { var saved = JSON.parse(localStorage.getItem("pw-ui") || "{}"); if (saved.view) ui.view = saved.view; if (saved.sort) ui.sort = saved.sort; } catch (e) {}
  function saveUi() { try { localStorage.setItem("pw-ui", JSON.stringify({ view: ui.view, sort: ui.sort })); } catch (e) {} }
  function clearFilters() { Object.keys(state).forEach(function (k) { state[k] = ""; }); }

  function matches(p) {
    if (state.status && p.status !== state.status) return false;
    if (state.sector && p.sector !== state.sector) return false;
    if (state.agency && p.agency !== state.agency) return false;
    if (state.constituency && (p.constituencies || []).indexOf(state.constituency) === -1) return false;
    if (state.ward && !(p.citywide || wardsOf(p).indexOf(state.ward) !== -1)) return false;
    if (state.q) {
      var hay = [p.name, p.shortName, p.summary, p.agency, p.contractor, p.sector, (p.areas || []).join(" "), (p.constituencies || []).join(" "),
        wardsOf(p).map(function (w) { return "ward " + w + " " + ((WARD_INFO[w] || {}).assistantCommissioner || ""); }).join(" "),
        headsFor(p).map(function (h) { return h.name; }).join(" "),
        mlasFor(p).map(function (m) { return m.name || ""; }).join(" "), (p.funders || []).map(function (f) { return f.name; }).join(" ")].join(" ").toLowerCase();
      if (!state.q.toLowerCase().split(/\s+/).filter(Boolean).every(function (t) { return hay.indexOf(t) !== -1; })) return false;
    }
    return true;
  }
  function sortList(list) {
    var by = {
      value: function (a, b) { return (cost(b) || 0) - (cost(a) || 0); },
      late: function (a, b) { return STATUS_RANK[a.status] - STATUS_RANK[b.status] || (cost(b) || 0) - (cost(a) || 0); },
      overrun: function (a, b) { return overrunPct(b) - overrunPct(a) || (cost(b) || 0) - (cost(a) || 0); },
      name: function (a, b) { return (a.shortName || a.name).localeCompare(b.shortName || b.name); },
    }[ui.sort] || function () { return 0; };
    return list.slice().sort(by);
  }

  // ---------------------------------------------------------------- shared pieces
  var app = document.getElementById("app");

  function hbars(rows, opts) {
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }).concat([1]));
    return '<div class="hbars">' + rows.map(function (r) {
      return '<div class="hbar' + (r.attrs ? " click" : "") + '"' + (r.attrs || "") + (r.tip ? ' data-tip="' + esc(r.tip) + '"' : "") + ' role="' + (r.attrs ? "button" : "listitem") + '"' + (r.attrs ? ' tabindex="0"' : "") + ">" +
        '<span class="name">' + esc(r.label) + '</span><span class="track"><span class="fill" style="width:' + Math.max(0.6, 100 * r.value / max) + "%" + (r.color ? ";background:" + r.color : "") + '"></span></span><span class="val">' + r.display + "</span></div>";
    }).join("") + "</div>" + (opts && opts.note ? '<div class="axis-note">' + opts.note + "</div>" : "");
  }
  function bindClicks(root, sel, fn) {
    root.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener("click", function (e) { fn(el, e); });
      el.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && el.tagName !== "BUTTON" && el.tagName !== "A") { e.preventDefault(); fn(el, e); } });
    });
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

  // ---------------------------------------------------------------- overview
  function viewOverview() {
    var total = PROJECTS.reduce(function (s, p) { return s + (cost(p) || 0); }, 0);
    var late = PROJECTS.filter(isLate);
    var over = PROJECTS.filter(overrun);
    var overAmt = over.reduce(function (s, p) { return s + overrun(p); }, 0);
    var counts = {};
    PROJECTS.forEach(function (p) { counts[p.status] = (counts[p.status] || 0) + 1; });
    var agencies = {};
    PROJECTS.forEach(function (p) {
      var a = agencies[p.agency] = agencies[p.agency] || { name: p.agency, value: 0, n: 0, late: 0 };
      a.value += cost(p) || 0; a.n++; if (isLate(p)) a.late++;
    });
    var topAg = Object.values(agencies).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    var topOver = PROJECTS.filter(function (p) { return overrunPct(p) >= 5; }).sort(function (a, b) { return overrunPct(b) - overrunPct(a); }).slice(0, 8);

    app.innerHTML =
      '<section class="lead"><div class="eyebrow">Mumbai · ' + esc(fmtDate(META.lastUpdated)) + '</div>' +
      "<h2>" + PROJECTS.length + " government projects worth " + crore(total) + ". <em>" + late.length + " are delayed or stalled.</em></h2>" +
      "<p>Every major BMC, state and central government work in the city: what it costs, who pays, who runs it, which ward it is in and who the local MLA is. Each project links to the reports it is based on.</p></section>" +

      '<section class="stats" aria-label="Summary">' +
      '<div class="stat"><span class="label">Total value</span><span class="value">' + (total / 100000).toFixed(2) + '<small>lakh cr</small></span><span class="sub">latest sanctioned or revised cost</span></div>' +
      '<div class="stat alert"><span class="label">Delayed or stalled</span><span class="value">' + late.length + "<small>of " + PROJECTS.length + '</small></span><span class="sub">' + (counts.Stalled || 0) + " stalled outright</span></div>" +
      '<div class="stat"><span class="label">Added by cost overruns</span><span class="value">' + Math.round(overAmt).toLocaleString("en-IN") + '<small>cr</small></span><span class="sub">across ' + plural(over.length, "project") + " with a revised cost</span></div>" +
      '<div class="stat"><span class="label">Open tenders today</span><span class="value">' + OPEN_TENDERS.length + '</span><span class="sub"><a href="#tenders">BMC, BEST, MMRDA, PWD →</a></span></div>' +
      "</section>" +

      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Status</div><h3>Where every project stands</h3></div><p>Tap a status to filter the list below.</p></div>' +
      '<div class="statusbar" role="img" aria-label="Projects by status">' + STATUSES.map(function (s) {
        var n = counts[s.key] || 0;
        return n ? '<span style="flex:' + n + ";background:var(" + s.css + ')" data-tip="<b>' + esc(s.key) + "</b><br>" + plural(n, "project") + '"></span>' : "";
      }).join("") + '</div><div class="legend" id="status-chips"></div></section>' +

      '<div class="grid-2">' +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Cost overruns</div><h3>Biggest increases over the original cost</h3></div></div>' +
      hbars(topOver.map(function (p) {
        return { label: p.shortName || p.name, value: overrunPct(p), display: "+" + overrunPct(p) + "%", color: "var(--st-stalled)", attrs: ' data-open="' + esc(p.id) + '"',
          tip: "<b>" + esc(p.shortName || p.name) + "</b><br>" + crore(p.cost.original) + " → " + crore(p.cost.revised) + "<br>+" + crore(overrun(p)) };
      }), { note: "Percentage rise from first sanctioned cost to latest revised cost. Tap a bar for the project." }) + "</section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Who builds it</div><h3>Project value by implementing agency</h3></div></div>' +
      hbars(topAg.map(function (a) {
        return { label: a.name, value: a.value, display: crore(a.value), attrs: ' data-agency="' + esc(a.name) + '"',
          tip: "<b>" + esc(a.name) + "</b><br>" + plural(a.n, "project") + ", " + a.late + " delayed or stalled<br>" + crore(a.value) };
      }), { note: "Latest cost of the projects each agency runs. The bullet train counts its whole ₹1.08 lakh crore corridor." }) + "</section>" +
      "</div>" +

      '<section class="panel" id="explorer"><div class="section-head"><div><div class="eyebrow">All projects</div><h3>Find a project</h3></div><p>Search by name, area, ward, MLA, contractor or funder.</p></div><div id="filters"></div><div id="results"></div></section>';

    bindClicks(app, "[data-open]", function (el) { go("#p-" + el.dataset.open); });
    bindClicks(app, "[data-agency]", function (el) { clearFilters(); state.agency = el.dataset.agency; renderExplorer(true); });
    renderStatusChips(counts);
    renderFilters();
    renderExplorer();
  }

  function renderStatusChips(counts) {
    var box = document.getElementById("status-chips"); if (!box) return;
    box.innerHTML = STATUSES.map(function (s) {
      return '<button type="button" class="chip" data-status="' + esc(s.key) + '" aria-pressed="' + (state.status === s.key) + '"><span class="swatch" style="background:var(' + s.css + ')"></span>' + esc(s.key) + " <b>" + (counts[s.key] || 0) + "</b></button>";
    }).join("");
    bindClicks(box, "[data-status]", function (el) { state.status = state.status === el.dataset.status ? "" : el.dataset.status; renderStatusChips(counts); renderFilters(); renderExplorer(true); });
  }

  function select(id, label, current, options) {
    return '<div class="field"><select id="' + id + '" aria-label="' + esc(label) + '"' + (current ? ' class="on"' : "") + ">" + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === current ? " selected" : "") + ">" + esc(o[1]) + "</option>";
    }).join("") + "</select></div>";
  }
  function renderFilters() {
    var box = document.getElementById("filters"); if (!box) return;
    var consts = uniq(PROJECTS.flatMap(function (p) { return p.constituencies || []; }));
    box.innerHTML = '<div class="filters">' +
      '<div class="field search">' + ICON_SEARCH + '<input type="search" id="f-q" placeholder="Search projects" aria-label="Search projects" value="' + esc(state.q) + '"></div>' +
      select("f-status", "Status", state.status, [["", "Any status"]].concat(STATUSES.map(function (s) { return [s.key, s.key]; }))) +
      select("f-sector", "Sector", state.sector, [["", "Any sector"]].concat(uniq(PROJECTS.map(function (p) { return p.sector; })).map(function (s) { return [s, s]; }))) +
      select("f-agency", "Agency", state.agency, [["", "Any agency"]].concat(uniq(PROJECTS.map(function (p) { return p.agency; })).map(function (s) { return [s, s]; }))) +
      select("f-ward", "BMC ward", state.ward, [["", "Any ward"]].concat(WARD_NAMES.map(function (w) { return [w, wardTitle(w)]; }))) +
      select("f-const", "Constituency", state.constituency, [["", "Any constituency"]].concat(consts.map(function (c) { var m = mlaByConst[c]; return [c, c + (m && m.name ? " · " + m.name : "")]; }))) +
      "</div>";
    var map = { "f-status": "status", "f-sector": "sector", "f-agency": "agency", "f-ward": "ward", "f-const": "constituency" };
    Object.keys(map).forEach(function (id) {
      document.getElementById(id).addEventListener("change", function (e) { state[map[id]] = e.target.value; e.target.classList.toggle("on", !!e.target.value); refreshChips(); renderExplorer(); });
    });
    document.getElementById("f-q").addEventListener("input", debounce(function (e) { state.q = e.target.value; renderExplorer(); }, 180));
  }
  function refreshChips() {
    document.querySelectorAll("#status-chips [data-status]").forEach(function (b) { b.setAttribute("aria-pressed", String(state.status === b.dataset.status)); });
  }

  function card(p) {
    var ws = wardsOf(p), ms = mlasFor(p).filter(function (m) { return m.name; });
    var due = p.completedDate ? ["Opened", fmtDate(p.completedDate)] : ["Due", fmtDate(p.revisedTargetDate || p.targetDate)];
    var pct = overrunPct(p);
    var meter = p.progress != null
      ? '<div class="meter"><div class="bar"><span style="width:' + Math.max(1, Math.min(100, p.progress)) + "%;background:" + statusColor(p.status) + '"></span></div><div class="cap"><span>' + p.progress + "% built</span><span>" + (p.revisedTargetDate && p.targetDate && !p.completedDate ? "was due " + fmtDate(p.targetDate) : "") + "</span></div></div>"
      : '<div class="meter"><div class="cap"><span>' + (p.status === "Completed" ? "Finished" : "Progress not published") + "</span><span>" + (p.revisedTargetDate && p.targetDate && !p.completedDate ? "was due " + fmtDate(p.targetDate) : "") + "</span></div></div>";
    return '<button type="button" class="card" data-open="' + esc(p.id) + '">' +
      '<div class="top"><span class="eyebrow">' + esc(p.sector) + "</span>" + pill(p.status) + "</div>" +
      "<h4>" + esc(p.shortName || p.name) + "</h4>" +
      '<div class="where">' + esc(p.agency) + (p.citywide ? " · citywide" : ws.length ? " · ward" + (ws.length > 1 ? "s " : " ") + esc(ws.slice(0, 6).join(", ")) + (ws.length > 6 ? " +" + (ws.length - 6) : "") : "") + "</div>" +
      meter +
      '<dl class="facts"><div><dt>Cost</dt><dd>' + crore(cost(p)) + (pct ? ' <span class="up">+' + pct + "%</span>" : "") + "</dd></div><div><dt>" + due[0] + "</dt><dd>" + esc(due[1]) + "</dd></div><div><dt>Area MLA" + (ms.length === 1 ? "" : "s") + "</dt><dd>" + (ms.length ? esc(ms.length === 1 ? ms[0].name : ms.length + " MLAs") : "—") + "</dd></div></dl>" +
      "</button>";
  }
  function table(list) {
    return '<div class="table-scroll"><table class="data"><thead><tr><th>Project</th><th>Status</th><th class="num">Built</th><th class="num">Cost</th><th>Agency</th><th>Wards</th></tr></thead><tbody>' +
      list.map(function (p) {
        var pct = overrunPct(p);
        return '<tr class="click" data-open="' + esc(p.id) + '" tabindex="0"><td><b>' + esc(p.shortName || p.name) + '</b><div class="sub">' + esc(p.sector) + "</div></td><td>" + pill(p.status) + '</td><td class="num">' + (p.progress != null ? p.progress + "%" : "—") + '</td><td class="num">' + crore(cost(p)) + (pct ? '<div class="up">+' + pct + "%</div>" : "") + "</td><td>" + esc(p.agency) + '</td><td class="sub">' + (p.citywide ? "Citywide" : esc(wardsOf(p).join(", ")) || "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  function renderExplorer(scroll) {
    var box = document.getElementById("results"); if (!box) return;
    var list = sortList(PROJECTS.filter(matches));
    var shown = list.slice(0, ui.limit);
    var active = Object.keys(state).some(function (k) { return state[k]; });
    box.innerHTML = '<div class="toolbar"><span><b class="tnum">' + list.length + "</b> of " + PROJECTS.length + " projects" + (active ? ' · <button type="button" class="btn quiet" id="reset">Clear filters</button>' : "") + "</span>" +
      '<span class="actions"><select id="sort" class="btn" aria-label="Sort projects"><option value="value">Biggest first</option><option value="late">Stalled and delayed first</option><option value="overrun">Biggest cost overrun</option><option value="name">A to Z</option></select>' +
      '<span class="seg" role="group" aria-label="Layout"><button type="button" data-view="cards" aria-pressed="' + (ui.view === "cards") + '">Cards</button><button type="button" data-view="table" aria-pressed="' + (ui.view === "table") + '">Table</button></span>' +
      '<button type="button" class="btn" id="csv">' + (EMBED ? "Copy CSV" : "Download CSV") + "</button></span></div>" +
      (list.length ? (ui.view === "table" ? table(shown) : '<div class="cards">' + shown.map(card).join("") + "</div>") : '<div class="empty">No projects match. Try fewer filters.</div>') +
      (list.length > shown.length ? '<div class="more"><button type="button" class="btn" id="more">Show ' + Math.min(48, list.length - shown.length) + " more</button></div>" : "");
    document.getElementById("sort").value = ui.sort;
    document.getElementById("sort").addEventListener("change", function (e) { ui.sort = e.target.value; saveUi(); renderExplorer(); });
    bindClicks(box, "[data-view]", function (el) { ui.view = el.dataset.view; saveUi(); renderExplorer(); });
    bindClicks(box, "[data-open]", function (el) { go("#p-" + el.dataset.open); });
    var reset = document.getElementById("reset");
    if (reset) reset.addEventListener("click", function () { clearFilters(); renderFilters(); refreshChips(); renderExplorer(); });
    var more = document.getElementById("more");
    if (more) more.addEventListener("click", function () { ui.limit += 48; renderExplorer(); });
    document.getElementById("csv").addEventListener("click", function (e) { exportCsv(list, e.currentTarget); });
    if (scroll) { renderFilters(); document.getElementById("explorer").scrollIntoView({ behavior: "smooth", block: "start" }); }
  }

  // ---------------------------------------------------------------- map
  var leafletMap = null;
  function viewMap() {
    app.innerHTML = '<section class="lead"><div class="eyebrow">Map</div><h2>Where the work is happening</h2><p>Lines follow each project’s stations, sites and junctions over the BMC ward boundaries. Points are approximate, within a few hundred metres. Tap a line or a ward for details.</p></section>' +
      '<div class="map-layout"><div id="map" role="region" aria-label="Map of projects"></div><aside class="map-side">' +
      '<div class="panel"><div class="eyebrow" style="margin-bottom:8px">Show</div><div class="legend" id="map-status"></div></div>' +
      '<div class="panel"><div class="field search" style="margin-bottom:8px">' + ICON_SEARCH + '<input type="search" id="map-q" placeholder="Find on map" aria-label="Find a project on the map" value="' + esc(state.q) + '"></div><div class="list" id="map-list"></div></div>' +
      "</aside></div>";
    if (!window.L) { document.getElementById("map").innerHTML = '<div class="empty">The map library didn’t load. The other tabs still work.</div>'; return; }
    if (leafletMap) { leafletMap.remove(); leafletMap = null; }
    leafletMap = L.map("map", { scrollWheelZoom: false, zoomSnap: 0.25, attributionControl: true });
    leafletMap.attributionControl.setPrefix(false).addAttribution("Ward boundaries: BMC · Leaflet");
    var surface = cssVar("--surface"), line = cssVar("--line"), ink3 = cssVar("--ink-3"), accent = cssVar("--accent");
    var wl = L.geoJSON({ type: "FeatureCollection", features: WARD_GEO }, {
      style: function () { return { color: line, weight: 1.2, fillColor: surface, fillOpacity: 1 }; },
      onEachFeature: function (f, layer) {
        var w = f.properties.ward, info = WARD_INFO[w] || {};
        var n = PROJECTS.filter(function (p) { return !p.citywide && WARD_PARTS[p.id][w]; }).length;
        layer.bindTooltip(w, { permanent: true, direction: "center", className: "ward-label" });
        layer.bindPopup('<span class="wcode">' + esc(w) + "</span> <b>" + esc(wardTitle(w)) + "</b><br>" + (info.assistantCommissioner ? "Ward officer: " + esc(info.assistantCommissioner) + "<br>" : "") + plural(n, "project") + " · " + plural(OPEN_TENDERS.filter(function (t) { return tenderMapWard(t) === w; }).length, "open tender") + '<br><a href="#ward-' + wardSlug(w) + '">Open ward →</a>');
        layer.on("mouseover", function () { layer.setStyle({ color: accent, weight: 2 }); layer.bringToBack(); });
        layer.on("mouseout", function () { wl.resetStyle(layer); });
      },
    }).addTo(leafletMap);
    leafletMap.fitBounds(wl.getBounds(), { padding: [8, 8] });
    var layers = [];
    var mapState = { hide: {} };
    function draw() {
      layers.forEach(function (l) { leafletMap.removeLayer(l); }); layers = [];
      var q = (document.getElementById("map-q").value || "").toLowerCase();
      var list = PROJECTS.filter(function (p) {
        return ROUTES[p.id] && !mapState.hide[p.status] && (!q || [p.name, p.shortName, p.agency, (p.areas || []).join(" ")].join(" ").toLowerCase().indexOf(q) !== -1);
      }).sort(function (a, b) { return (cost(b) || 0) - (cost(a) || 0); });
      list.slice().reverse().forEach(function (p) {
        var color = cssVar(statusOf(p.status).css);
        var popup = pill(p.status) + "<br><b>" + esc(p.name) + "</b><br>" + esc(p.agency) + " · " + crore(cost(p)) + '<br><a href="#p-' + esc(p.id) + '">Project details →</a>';
        ROUTES[p.id].forEach(function (path) {
          if (path.length > 1) {
            var pl = L.polyline(path.map(function (pt) { return [pt[0], pt[1]]; }), { color: color, weight: 4, opacity: 0.9, lineCap: "round", lineJoin: "round" }).bindPopup(popup).addTo(leafletMap);
            layers.push(pl);
          }
          path.forEach(function (pt) {
            var single = path.length === 1;
            var m = L.circleMarker([pt[0], pt[1]], { radius: single ? 7 : 3.5, color: surface, weight: single ? 2 : 1.5, fillColor: color, fillOpacity: 1 })
              .bindPopup(popup + '<div style="margin-top:6px;color:' + ink3 + '">' + esc(pt[2]) + " · " + (POINT_WARD[pt[0] + "," + pt[1]] ? "ward " + esc(POINT_WARD[pt[0] + "," + pt[1]]) : "outside BMC limits") + "</div>").addTo(leafletMap);
            layers.push(m);
          });
        });
      });
      document.getElementById("map-list").innerHTML = list.map(function (p) {
        return '<button type="button" data-fly="' + esc(p.id) + '"><span class="swatch" style="background:' + statusColor(p.status) + '"></span><span>' + esc(p.shortName || p.name) + "</span></button>";
      }).join("") || '<div class="empty">Nothing matches.</div>';
      bindClicks(document.getElementById("map-list"), "[data-fly]", function (el) {
        var pts = [].concat.apply([], ROUTES[el.dataset.fly]).map(function (pt) { return [pt[0], pt[1]]; });
        leafletMap.fitBounds(L.latLngBounds(pts).pad(0.4), { maxZoom: 15 });
        document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
    var counts = {};
    PROJECTS.forEach(function (p) { if (ROUTES[p.id]) counts[p.status] = (counts[p.status] || 0) + 1; });
    var chips = document.getElementById("map-status");
    chips.innerHTML = STATUSES.map(function (s) {
      return '<button type="button" class="chip" data-st="' + esc(s.key) + '" aria-pressed="true"><span class="swatch" style="background:var(' + s.css + ')"></span>' + esc(s.key) + " <b>" + (counts[s.key] || 0) + "</b></button>";
    }).join("");
    bindClicks(chips, "[data-st]", function (el) { var k = el.dataset.st; mapState.hide[k] = !mapState.hide[k]; el.setAttribute("aria-pressed", String(!mapState.hide[k])); draw(); });
    document.getElementById("map-q").addEventListener("input", debounce(draw, 180));
    draw();
  }

  // ---------------------------------------------------------------- wards
  var selectedWard = null;
  function wardStats(w) {
    var ps = PROJECTS.filter(function (p) { return !p.citywide && WARD_PARTS[p.id][w]; });
    return { ps: ps, tenders: OPEN_TENDERS.filter(function (t) { return tenderMapWard(t) === w; }), late: ps.filter(isLate).length };
  }
  function wardShape(w, ps) {
    var f = WARD_FEATURE[w]; if (!f) return "";
    var pts = [].concat.apply([], f.geometry.coordinates.map(function (poly) { return poly[0]; }));
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (c) { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); });
    var kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180), W = (maxX - minX) * kx, H = maxY - minY, S = 160 / Math.max(W, H);
    var w0 = W * S, h0 = H * S, ox = (170 - w0) / 2, oy = (170 - h0) / 2;
    function xy(lng, lat) { return [(ox + (lng - minX) * kx * S).toFixed(1), (oy + (maxY - lat) * S).toFixed(1)]; }
    var d = f.geometry.coordinates.map(function (poly) { return poly.map(function (ring) { return "M" + ring.map(function (c) { return xy(c[0], c[1]).join(","); }).join("L") + "Z"; }).join(""); }).join("");
    var dots = "";
    ps.forEach(function (p) {
      (ROUTES[p.id] || []).forEach(function (path) {
        path.forEach(function (pt) {
          if (POINT_WARD[pt[0] + "," + pt[1]] !== w) return;
          var c = xy(pt[1], pt[0]);
          dots += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="4" fill="' + statusColor(p.status) + '" stroke="var(--surface)" stroke-width="1.5"><title>' + esc((p.shortName || p.name) + ": " + pt[2]) + "</title></circle>";
        });
      });
    });
    return '<svg viewBox="0 0 170 170" role="img" aria-label="Outline of ' + esc(wardTitle(w)) + ' with project sites"><path d="' + d + '" fill="var(--surface-2)" stroke="var(--ink-3)" stroke-width="1.2" fill-rule="evenodd"/>' + dots + "</svg>";
  }
  function viewWards(w) {
    if (w && WARD_NAMES.indexOf(w) !== -1) selectedWard = w;
    if (!selectedWard) {
      selectedWard = WARD_NAMES.slice().sort(function (a, b) { return wardStats(b).ps.length - wardStats(a).ps.length; })[0];
    }
    app.innerHTML = '<section class="lead"><div class="eyebrow">BMC wards</div><h2>What’s being built in your ward, and who to ask</h2><p>BMC runs the city through administrative wards grouped into seven zones. Each ward has an Assistant Commissioner, the ward officer, who handles civic issues around a site: roads, drains, encroachments, complaints. The agency named on each project is responsible for building it.</p></section>' +
      '<div class="ward-layout"><section class="panel"><div class="eyebrow" style="margin-bottom:10px">Pick a ward</div><div class="ward-picker" id="picker">' +
      WARD_NAMES.map(function (x) {
        var s = wardStats(x);
        return '<button type="button" data-ward="' + esc(x) + '" aria-pressed="' + (x === selectedWard) + '">' + wcode(x) + '<span class="wp-meta">' + plural(s.ps.length, "project") + "</span>" + '<span class="wp-meta">' + plural(s.tenders.length, "tender") + "</span></button>";
      }).join("") + '</div><p class="axis-note">Newer wards K/North, K/South and P/East are shown inside K/East and P/North, the wards they were carved from.</p></section>' +
      '<section class="panel" id="ward-detail"></section></div>';
    bindClicks(document.getElementById("picker"), "[data-ward]", function (el) { go("#ward-" + wardSlug(el.dataset.ward)); });
    renderWard(selectedWard);
  }
  function renderWard(w) {
    var box = document.getElementById("ward-detail"); if (!box) return;
    var info = WARD_INFO[w] || {}, s = wardStats(w);
    var value = s.ps.reduce(function (a, p) { return a + (cost(p) || 0); }, 0);
    var citywide = PROJECTS.filter(function (p) { return p.citywide; });
    var unconfirmed = info.confidence === "low" ? '<span class="flag">unconfirmed</span>' : "";
    box.innerHTML = '<div class="ward-hero"><div><h2>' + wcode(w) + esc(wardTitle(w)) + "</h2>" +
      (info.localities ? '<p class="muted" style="margin:6px 0 0">' + esc(info.localities.join(", ")) + "</p>" : "") +
      '<div class="mini-stats"><span><b>' + s.ps.length + "</b>projects</span><span><b>" + s.late + "</b>delayed or stalled</span><span><b>" + s.tenders.length + "</b>open tenders</span></div></div>" +
      '<div class="ward-shape">' + wardShape(w, s.ps) + "</div></div>" +
      '<div class="people"><div class="person"><div class="role">Ward officer</div><div class="name">' + esc(info.assistantCommissioner || "Not on file") + unconfirmed + '</div><div class="detail">Assistant Commissioner' + (info.asOf ? ", as of " + fmtDate(info.asOf) : "") + "</div></div>" +
      '<div class="person"><div class="role">Zone ' + esc(info.zone || "") + " deputy commissioner</div>" + '<div class="name">' + esc(info.zonalDmc || "Not on file") + '</div><div class="detail">Oversees the zone’s wards</div></div></div>' +
      (info.office ? '<p class="muted" style="font-size:.85rem;margin:10px 0 0">Ward office: ' + esc(info.office) + (info.phone ? ' · <span class="tnum">' + esc(info.phone) + "</span>" : "") + "</p>" : "") +
      (info.note ? '<div class="note">' + esc(info.note) + "</div>" : "") +
      '<div class="section-head" style="margin-top:22px"><div><h3>Projects with a part in this ward</h3><p>' + (value ? "Combined project value " + crore(value) + " (whole projects, not just this ward’s share)" : "") + "</p></div></div>" +
      (s.ps.length ? '<div class="table-scroll"><table class="data"><thead><tr><th>Project and the part here</th><th>Status</th><th>Run by</th></tr></thead><tbody>' + s.ps.sort(function (a, b) { return STATUS_RANK[a.status] - STATUS_RANK[b.status]; }).map(function (p) {
        var hs = headsFor(p);
        return '<tr class="click" data-open="' + esc(p.id) + '" tabindex="0"><td><b>' + esc(p.shortName || p.name) + '</b><div class="sub">' + esc(WARD_PARTS[p.id][w].join(", ")) + "</div></td><td>" + pill(p.status) + "</td><td>" + esc(p.agency) + (hs.length ? '<div class="sub">' + esc(hs.map(function (h) { return h.name; }).join(", ")) + "</div>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="muted">No mapped projects in this ward yet.</p>') +
      '<div class="section-head" style="margin-top:22px"><div><h3>Open tenders</h3><p>Works the ward and BMC departments have put out to bid right now.</p></div>' + (s.tenders.length ? '<a href="#tenders" data-tw="' + esc(w) + '" class="btn">All tenders for this ward</a>' : "") + "</div>" +
      (s.tenders.length ? '<ul class="tenders">' + s.tenders.slice(0, 8).map(function (t) {
        return "<li><span>" + esc(t.title) + '</span><span class="closes">closes ' + esc(fmtDT(t.closing)) + '</span><span class="meta">' + esc(t.dept || t.org) + (t.ward !== w ? " · ward " + esc(t.ward) : "") + ' · <span class="mono">' + esc(t.id) + "</span></span></li>";
      }).join("") + "</ul>" + (s.tenders.length > 8 ? '<p class="axis-note">+' + (s.tenders.length - 8) + " more on the Tenders tab</p>" : "") : '<p class="muted">No open tenders tagged to this ward today.</p>') +
      '<p class="axis-note" style="margin-top:18px">Also in every ward: ' + citywide.map(function (p) { return '<a href="#p-' + esc(p.id) + '">' + esc(p.shortName || p.name) + "</a>"; }).join(", ") + ".</p>";
    bindClicks(box, "[data-open]", function (el) { go("#p-" + el.dataset.open); });
    var tw = box.querySelector("[data-tw]");
    if (tw) tw.addEventListener("click", function () { tstate.ward = w; tstate.status = "Open"; tstate.q = ""; tstate.org = ""; });
  }

  // ---------------------------------------------------------------- tenders
  var tstate = { q: "", org: "", ward: "", status: "Open" };
  var tlimit = 60;
  function viewTenders() {
    var byOrg = {}, byWard = {};
    OPEN_TENDERS.forEach(function (t) {
      byOrg[t.org] = (byOrg[t.org] || 0) + 1;
      var w = tenderMapWard(t); if (w) byWard[w] = (byWard[w] || 0) + 1;
    });
    var orgs = Object.keys(byOrg).sort(function (a, b) { return byOrg[b] - byOrg[a]; });
    var wardRows = Object.keys(byWard).sort(function (a, b) { return byWard[b] - byWard[a]; }).slice(0, 10);
    var untagged = OPEN_TENDERS.filter(function (t) { return !t.ward; }).length;
    app.innerHTML = '<section class="lead"><div class="eyebrow">Tenders · fetched ' + esc(fmtDT((TENDERS.fetchedAt || "").replace("Z", ""))) + ' UTC</div><h2>' + OPEN_TENDERS.length + " works are out to bid right now</h2><p>Every tender BMC, BEST, MMRDA and Mumbai PWD publish on the state e-tender portal: road maintenance beats, repairs, hospital supplies, drains. These are the day-to-day works behind the big projects. Closed tenders stay here as history.</p></section>" +
      '<section class="stats">' + orgs.slice(0, 4).map(function (o) { return '<div class="stat"><span class="label">' + esc(o) + '</span><span class="value">' + byOrg[o] + '</span><span class="sub">open tenders</span></div>'; }).join("") + "</section>" +
      '<div class="grid-2"><section class="panel"><div class="section-head"><div><div class="eyebrow">By ward</div><h3>Wards with the most open tenders</h3></div></div>' +
      hbars(wardRows.map(function (w) { return { label: wardTitle(w), value: byWard[w], display: String(byWard[w]), attrs: ' data-tward="' + esc(w) + '"', tip: "<b>" + esc(wardTitle(w)) + "</b><br>" + plural(byWard[w], "open tender") }; }),
        { note: untagged + " open tenders belong to citywide departments (water works, waste transport, hospitals) and have no ward." }) + "</section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">How to read a tender</div><h3>What the portal tells us, and what it hides</h3></div></div>' +
      '<dl class="facts-list"><dt>Published</dt><dd>When the work was put out to bid.</dd><dt>Closes</dt><dd>Last date for contractors to bid.</dd><dt>Ward and department</dt><dd>Which BMC ward or department wants the work done.</dd><dt>Tender ID</dt><dd>Search it on <a href="' + esc(safeUrl(TENDERS.searchUrl)) + '" target="_blank" rel="noopener">Mahatenders</a> to read the full documents.</dd><dt>Not shown</dt><dd>Who won and for how much. The portal hides award results behind a captcha.</dd></dl></section></div>' +
      '<section class="panel"><div class="filters" style="grid-template-columns:minmax(0,2fr) repeat(3,minmax(0,1fr))">' +
      '<div class="field search">' + ICON_SEARCH + '<input type="search" id="t-q" placeholder="Search work, department or tender ID" aria-label="Search tenders" value="' + esc(tstate.q) + '"></div>' +
      select("t-status", "Open or closed", tstate.status, [["Open", "Open now"], ["Closed", "Closed (history)"], ["", "Open and closed"]]) +
      select("t-org", "Body", tstate.org, [["", "All bodies"]].concat(orgs.map(function (o) { return [o, o]; }))) +
      select("t-ward", "Ward", tstate.ward, [["", "All wards"], ["_none", "Citywide departments"]].concat(WARD_NAMES.map(function (w) { return [w, wardTitle(w)]; }))) +
      '</div><div id="t-results"></div></section>';
    bindClicks(app, "[data-tward]", function (el) { tstate.ward = el.dataset.tward; document.getElementById("t-ward").value = tstate.ward; renderTenders(); document.getElementById("t-results").scrollIntoView({ behavior: "smooth", block: "start" }); });
    document.getElementById("t-q").addEventListener("input", debounce(function (e) { tstate.q = e.target.value; tlimit = 60; renderTenders(); }, 180));
    ["status", "org", "ward"].forEach(function (k) { document.getElementById("t-" + k).addEventListener("change", function (e) { tstate[k] = e.target.value; tlimit = 60; renderTenders(); }); });
    renderTenders();
  }
  function renderTenders() {
    var list = TENDERS.items.filter(function (t) {
      if (tstate.status && t.status !== tstate.status) return false;
      if (tstate.org && t.org !== tstate.org) return false;
      if (tstate.ward === "_none" ? !!t.ward : tstate.ward && tenderMapWard(t) !== tstate.ward) return false;
      if (tstate.q) {
        var hay = [t.title, t.ref, t.id, t.dept, t.unit, t.org, t.ward].join(" ").toLowerCase();
        if (!tstate.q.toLowerCase().split(/\s+/).filter(Boolean).every(function (x) { return hay.indexOf(x) !== -1; })) return false;
      }
      return true;
    });
    var shown = list.slice(0, tlimit);
    var box = document.getElementById("t-results");
    box.innerHTML = '<div class="toolbar"><span><b class="tnum">' + list.length + "</b> tenders</span></div>" +
      (list.length ? '<div class="table-scroll"><table class="data"><thead><tr><th>Work</th><th>Body and department</th><th>Ward</th><th>Closes</th></tr></thead><tbody>' + shown.map(function (t) {
        return "<tr><td><b>" + esc(t.title) + '</b><div class="sub"><span class="mono">' + esc(t.id) + "</span>" + (t.ref ? " · " + esc(t.ref) : "") + " · published " + esc(fmtDT(t.published)) + (t.status === "Closed" ? " · closed, last seen " + fmtDate(t.lastSeen) : "") + "</div></td><td>" + esc(t.org) + '<div class="sub">' + esc(t.unit || "") + "</div></td><td>" + (t.ward ? wcode(t.ward) : '<span class="muted">—</span>') + '</td><td class="num" style="text-align:left">' + esc(fmtDT(t.closing)) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<div class="empty">No tenders match.</div>') +
      (list.length > shown.length ? '<div class="more"><button type="button" class="btn" id="t-more">Show more</button></div>' : "");
    var more = document.getElementById("t-more"); if (more) more.addEventListener("click", function () { tlimit += 60; renderTenders(); });
  }

  // ---------------------------------------------------------------- MLAs
  var mq = "";
  function viewMlas() {
    app.innerHTML = '<section class="lead"><div class="eyebrow">Elected representatives</div><h2>Your MLA, and the projects in their constituency</h2><p>All 36 Mumbai assembly seats from the November 2024 election. An MLA represents the area and can raise a project in the Assembly; the implementing agency is responsible for delivering it.</p></section>' +
      (OFFICIALS.length ? '<section class="panel"><div class="section-head"><div><div class="eyebrow">Accountable at the top</div><h3>Who oversees the big projects</h3></div></div><div class="people" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin:0">' +
        OFFICIALS.map(function (o) { return '<div class="person"><div class="role">' + esc(o.role) + '</div><div class="name">' + esc(o.name) + "</div></div>"; }).join("") + "</div></section>" : "") +
      '<section class="panel"><div class="filters" style="grid-template-columns:1fr;margin-bottom:6px"><div class="field search">' + ICON_SEARCH + '<input type="search" id="m-q" placeholder="Search MLA, constituency or party" aria-label="Search MLAs" value="' + esc(mq) + '"></div></div><div id="m-results"></div></section>';
    document.getElementById("m-q").addEventListener("input", debounce(function (e) { mq = e.target.value; renderMlas(); }, 150));
    renderMlas();
  }
  function renderMlas() {
    var rows = MLAS.map(function (m) {
      var ps = PROJECTS.filter(function (p) { return (p.constituencies || []).indexOf(m.constituency) !== -1; });
      return { m: m, n: ps.length, val: ps.reduce(function (s, p) { return s + (cost(p) || 0); }, 0), late: ps.filter(isLate).length };
    }).filter(function (r) { return !mq || [r.m.name, r.m.constituency, r.m.party, r.m.district].join(" ").toLowerCase().indexOf(mq.toLowerCase()) !== -1; })
      .sort(function (a, b) { return a.m.no - b.m.no; });
    var maxN = Math.max.apply(null, rows.map(function (r) { return r.n; }).concat([1]));
    document.getElementById("m-results").innerHTML = '<div class="table-scroll"><table class="data"><thead><tr><th class="num">No.</th><th>Constituency</th><th>MLA</th><th>Party</th><th>Projects</th><th class="num">Delayed</th><th class="num" data-tip="Pending criminal cases the MLA declared in the 2024 election affidavit">Declared cases</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="click" data-no="' + esc(r.m.no) + '" tabindex="0"><td class="num muted">' + esc(r.m.no) + "</td><td><b>" + esc(r.m.constituency) + '</b><div class="sub">' + esc(r.m.district) + "</div></td><td><b>" + esc(r.m.name) + "</b></td><td>" + esc(r.m.party) +
          '</td><td style="min-width:150px"><div class="hbar" style="grid-template-columns:28px 1fr"><span class="val" style="text-align:left">' + r.n + '</span><span class="track"><span class="fill" style="width:' + (r.n ? Math.max(2, 100 * r.n / maxN) : 0) + '%"></span></span></div></td><td class="num">' + (r.late || '<span class="muted">0</span>') + '</td><td class="num">' + (function () { var a = ((MLA_DATA.profiles || {})[r.m.no] || {}).affidavit; return a && a.pendingCases != null ? a.pendingCases : '<span class="muted">—</span>'; })() + "</td></tr>";
      }).join("") + "</tbody></table></div>" + (rows.length ? "" : '<div class="empty">No MLA matches.</div>');
    bindClicks(document.getElementById("m-results"), "[data-no]", function (el) { go("#mla-" + el.dataset.no); });
  }

  // ---------------------------------------------------------------- shared: documented events (cases, penalties, findings)
  var CONTRACTS = window.PUBLIC_WORKS_CONTRACTS || { companies: [], agencies: [] };
  var MLA_DATA = window.PUBLIC_WORKS_MLA || { profiles: {} };
  var DELAYS = window.PUBLIC_WORKS_DELAYS || {};
  var YOJANAS = window.PUBLIC_WORKS_YOJANAS || [];
  // Kind -> severity. Colour always comes with the label; "Allegation" is explicitly marked not proven.
  var KINDS = {
    "Conviction": { sev: "--st-stalled", note: "Court convicted" },
    "Court finding": { sev: "--st-stalled", note: "A court ruled against them" },
    "Chargesheet filed": { sev: "--st-stalled", note: "Police or agency filed charges; not a conviction" },
    "Blacklisted / debarred": { sev: "--st-stalled", note: "Barred from bidding by a public body" },
    "Contract terminated": { sev: "--st-delayed", note: "The awarding body ended the contract" },
    "Penalty": { sev: "--st-delayed", note: "Fine or damages imposed by the awarding body" },
    "Investigation": { sev: "--st-delayed", note: "An FIR or official inquiry was opened; nothing proven" },
    "Show-cause notice": { sev: "--st-delayed", note: "Asked to explain; no penalty yet" },
    "Audit finding": { sev: "--st-delayed", note: "A government auditor (CAG or Accountant General) flagged it; not a criminal finding" },
    "Allegation": { sev: "--st-notstarted", note: "Raised publicly; not formally acted on, not proven" },
    "Cleared": { sev: "--st-completed", note: "Acquitted, quashed, lifted or closed" },
  };
  var KIND_ORDER = Object.keys(KINDS);
  function kindPill(k) {
    var c = KINDS[k] || KINDS.Allegation;
    return '<span class="pill" style="color:var(' + c.sev + ')" data-tip="' + esc(c.note) + '">' + esc(k) + "</span>";
  }
  function srcLinks(list) {
    return (list || []).filter(function (s) { return s && safeUrl(s.url); }).map(function (s) {
      return '<a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener">' + esc(s.title || s.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) + "</a>" + (s.date ? ' <span class="muted">' + esc(fmtDate(s.date)) + "</span>" : "");
    }).join(" · ");
  }
  function eventList(events) {
    if (!events || !events.length) return '<p class="muted" style="margin:0">No documented penalties, cases or findings found in the sources searched.</p>';
    return '<ol class="events">' + events.slice().sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }).map(function (e) {
      return '<li><div class="ev-head">' + kindPill(e.kind) + '<span class="ev-date">' + esc(fmtDate(e.date)) + "</span>" + (e.scope ? '<span class="muted">' + esc(e.scope) + "</span>" : "") + (e.status ? '<span class="muted">· status: ' + esc(e.status) + "</span>" : "") + "</div>" +
        "<div>" + esc(e.summary) + (e.by ? ' <span class="muted">(' + esc(e.by) + ")</span>" : "") + "</div>" +
        (e.people && e.people.length ? '<div class="sub">Named: ' + esc(e.people.join("; ")) + "</div>" : "") +
        '<div class="sub">' + srcLinks(e.sources) + (e.verified ? ' · <span title="A second reviewer re-read the source">source re-checked ' + esc(fmtDate(e.verified)) + "</span>" : "") + "</div></li>";
    }).join("") + "</ol>";
  }
  function kindCounts(events) {
    var c = {};
    (events || []).forEach(function (e) { c[e.kind] = (c[e.kind] || 0) + 1; });
    return KIND_ORDER.filter(function (k) { return c[k]; }).map(function (k) { return '<span class="kc" style="color:var(' + KINDS[k].sev + ')">' + c[k] + " " + esc(k.toLowerCase()) + "</span>"; }).join("");
  }
  function slug(s) { return String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  // ---------------------------------------------------------------- contracts
  var COMPANY_BY_SLUG = {};
  CONTRACTS.companies.forEach(function (c) { c.slug = slug(c.name); COMPANY_BY_SLUG[c.slug] = c; });
  function companyProjects(c) { // our projects whose contractor text mentions any alias, plus explicit links
    var ids = {};
    (c.mumbaiContracts || []).forEach(function (k) { if (k.projectId) ids[k.projectId] = true; });
    var names = [c.name].concat(c.aliases || []).filter(function (a) { return a && a.length > 2; }).map(function (a) { return a.toLowerCase(); });
    PROJECTS.forEach(function (p) {
      var t = (p.contractor || "").toLowerCase();
      if (names.some(function (a) { return t.indexOf(a) !== -1; })) ids[p.id] = true;
    });
    return PROJECTS.filter(function (p) { return ids[p.id]; });
  }
  function contractAgency(k) { return (k.agency || "").split(/[ (/]/)[0]; }
  function viewContracts() {
    var cos = CONTRACTS.companies;
    if (!cos.length) { app.innerHTML = '<section class="lead"><div class="eyebrow">Contracts</div><h2>Contractor records are being compiled</h2><p>This tab will list the companies that win Mumbai’s government contracts, which bodies award them, how the projects went, and documented penalties and cases.</p></section>'; return; }
    var all = [];
    cos.forEach(function (c) { (c.mumbaiContracts || []).forEach(function (k) { all.push({ c: c, k: k }); }); });
    var agencies = {};
    all.forEach(function (x) { var a = contractAgency(x.k); if (a) agencies[a] = (agencies[a] || 0) + 1; });
    var agCols = Object.keys(agencies).sort(function (a, b) { return agencies[b] - agencies[a]; }).slice(0, 8);
    var withEvents = cos.filter(function (c) { return (c.events || []).some(function (e) { return e.kind !== "Allegation" && e.kind !== "Cleared"; }); }).length;
    var value = all.reduce(function (s, x) { return s + (x.k.amount || 0); }, 0);
    var rows = cos.slice().sort(function (a, b) { return (b.mumbaiContracts || []).length - (a.mumbaiContracts || []).length; });
    var maxCell = 1;
    rows.forEach(function (c) { agCols.forEach(function (a) { var n = (c.mumbaiContracts || []).filter(function (k) { return contractAgency(k) === a; }).length; if (n > maxCell) maxCell = n; }); });
    function cell(n) {
      if (!n) return '<td class="hm"><span class="hm0">·</span></td>';
      var t = n / maxCell, l = Math.round(85 - t * 50);
      return '<td class="hm"><span class="hmc" style="background:hsl(205 65% ' + l + '%);color:' + (l < 58 ? "#fff" : "#0f1419") + '">' + n + "</span></td>";
    }
    app.innerHTML = '<section class="lead"><div class="eyebrow">Contracts</div><h2>Who wins Mumbai’s contracts, and how it went</h2><p>The companies behind the city’s big works, the public bodies that award them, how their projects turned out, and every documented penalty, termination, blacklisting, investigation or court finding. Each entry is labelled by what it is: an allegation is not a finding, and an investigation is not a conviction.</p></section>' +
      '<section class="stats"><div class="stat"><span class="label">Companies tracked</span><span class="value">' + cos.length + '</span><span class="sub">holding Mumbai government contracts</span></div>' +
      '<div class="stat"><span class="label">Contracts listed</span><span class="value">' + all.length + '</span><span class="sub">since 2015, from orders and reports</span></div>' +
      '<div class="stat"><span class="label">Value with a published figure</span><span class="value">' + Math.round(value).toLocaleString("en-IN") + '<small>cr</small></span><span class="sub">award amounts as reported</span></div>' +
      '<div class="stat alert"><span class="label">Companies with formal action</span><span class="value">' + withEvents + "<small>of " + cos.length + '</small></span><span class="sub">penalty, notice, termination, ban, audit, case or ruling</span></div></section>' +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Repeat relationships</div><h3>Which body awards to which company</h3></div><p>Number of contracts each company holds from each body. Darker means more. Tap a company to see its record.</p></div>' +
      '<div class="table-scroll"><table class="data heat"><thead><tr><th>Company</th>' + agCols.map(function (a) { return '<th class="num">' + esc(a) + "</th>"; }).join("") + '<th class="num">Total</th><th>Formal actions</th></tr></thead><tbody>' +
      rows.map(function (c) {
        var ks = c.mumbaiContracts || [];
        return '<tr class="click" data-co="' + esc(c.slug) + '" tabindex="0"><td><b>' + esc(c.name) + "</b></td>" + agCols.map(function (a) { return cell(ks.filter(function (k) { return contractAgency(k) === a; }).length); }).join("") + '<td class="num"><b>' + ks.length + '</b></td><td class="kcs">' + (kindCounts(c.events) || '<span class="muted">none found</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div></section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Awarding bodies</div><h3>Who passes the tenders</h3></div><p>How each body approves contracts, which companies it has awarded repeatedly, and audits or probes into its tendering.</p></div><div class="agency-grid">' +
      (CONTRACTS.agencies || []).map(function (a) {
        return '<article class="agency"><header><h4>' + esc(a.agency) + '</h4><span class="muted">' + esc(a.fullName || "") + "</span></header>" +
          (a.howAwardsWork ? '<p style="margin:6px 0 10px;font-size:.9rem">' + esc(a.howAwardsWork) + "</p>" : "") +
          ((a.approvers || []).length ? '<div class="sub" style="margin-bottom:8px">Approves: ' + a.approvers.map(function (x) { return esc(x.body) + (x.chair ? " (chair " + esc(x.chair) + ")" : ""); }).join("; ") + "</div>" : "") +
          ((a.repeatWinners || []).length ? '<div class="sub" style="margin-bottom:8px">Repeat winners reported: ' + a.repeatWinners.map(function (r) { return esc(r.company) + (r.count ? " (" + r.count + ")" : "") + (r.period ? " " + esc(r.period) : ""); }).join("; ") + "</div>" : "") +
          '<details><summary>' + plural((a.events || []).length, "documented event") + (kindCounts(a.events) ? " · " : "") + kindCounts(a.events) + "</summary>" + eventList(a.events) + "</details></article>";
      }).join("") + "</div></section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Reading the labels</div><h3>What each label means</h3></div></div><div class="legend">' +
      KIND_ORDER.map(function (k) { return '<span class="chip" style="cursor:default">' + kindPill(k) + '<span class="muted">' + esc(KINDS[k].note) + "</span></span>"; }).join("") + "</div></section>";
    bindClicks(app, "[data-co]", function (el) { go("#co-" + el.dataset.co); });
  }
  function viewCompany(s) {
    var c = COMPANY_BY_SLUG[s];
    if (!c) { viewContracts(); return; }
    var ks = (c.mumbaiContracts || []).slice().sort(function (a, b) { return (b.year || 0) - (a.year || 0); });
    var outcomes = {};
    ks.forEach(function (k) { var o = (k.outcome || "Unknown").replace(/,.*/, "").trim(); outcomes[k.outcome || "Unknown"] = (outcomes[k.outcome || "Unknown"] || 0) + 1; });
    var ps = companyProjects(c);
    var OUT_COLOR = { "Completed on time": "--st-completed", "Completed late": "--st-partial", "Ongoing": "--st-progress", "Ongoing, delayed": "--st-delayed", "Terminated": "--st-stalled", "Not started": "--st-notstarted" };
    app.innerHTML = '<p style="margin:0"><a href="#contracts">← All contractors</a></p>' +
      '<section class="lead"><div class="eyebrow">Contractor' + (c.listed ? " · " + esc(c.listed) : "") + (c.hq ? " · " + esc(c.hq) : "") + "</div><h2>" + esc(c.name) + "</h2>" +
      (c.website && safeUrl(c.website) ? '<p><a href="' + esc(safeUrl(c.website)) + '" target="_blank" rel="noopener">' + esc(c.website.replace(/^https?:\/\//, "")) + "</a></p>" : "") + "</section>" +
      '<section class="stats"><div class="stat"><span class="label">Mumbai contracts listed</span><span class="value">' + ks.length + '</span><span class="sub">government, 2015 onwards</span></div>' +
      '<div class="stat"><span class="label">Value with a figure</span><span class="value">' + Math.round(ks.reduce(function (s2, k) { return s2 + (k.amount || 0); }, 0)).toLocaleString("en-IN") + '<small>cr</small></span><span class="sub">as reported at award</span></div>' +
      '<div class="stat"><span class="label">Delivered late or delayed</span><span class="value">' + ks.filter(function (k) { return /late|delayed/i.test(k.outcome || ""); }).length + '</span><span class="sub">of ' + ks.length + '</span></div>' +
      '<div class="stat' + ((c.events || []).some(function (e) { return e.kind !== "Allegation" && e.kind !== "Cleared"; }) ? " alert" : "") + '"><span class="label">Documented events</span><span class="value">' + (c.events || []).length + '</span><span class="sub">' + (kindCounts(c.events) || "none found") + "</span></div></section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Track record</div><h3>Mumbai government contracts</h3></div></div>' +
      '<div class="legend" style="margin-bottom:10px">' + Object.keys(outcomes).map(function (o) { return '<span class="chip" style="cursor:default"><span class="swatch" style="background:var(' + (OUT_COLOR[o] || "--st-notstarted") + ')"></span>' + esc(o) + " <b>" + outcomes[o] + "</b></span>"; }).join("") + "</div>" +
      (ks.length ? '<div class="table-scroll"><table class="data"><thead><tr><th>Year</th><th>Project and role</th><th>Awarded by</th><th class="num">Amount</th><th>How it went</th></tr></thead><tbody>' + ks.map(function (k) {
        var linked = k.projectId && PROJECTS.find(function (p) { return p.id === k.projectId; });
        return '<tr><td class="num" style="text-align:left">' + esc(k.year || "—") + "</td><td><b>" + (linked ? '<a href="#p-' + esc(k.projectId) + '">' + esc(k.project) + "</a>" : esc(k.project)) + '</b><div class="sub">' + esc(k.role || "") + (k.note ? " · " + esc(k.note) : "") + (k.source && safeUrl(k.source) ? ' · <a href="' + esc(safeUrl(k.source)) + '" target="_blank" rel="noopener">source</a>' : "") + "</div></td><td>" + esc(k.agency || "") + (k.awardedBy ? '<div class="sub">' + esc(k.awardedBy) + "</div>" : "") + '</td><td class="num">' + (k.amount != null ? crore(k.amount) : '<span class="muted">—</span>') + '</td><td><span class="pill" style="color:var(' + (OUT_COLOR[k.outcome] || "--st-notstarted") + ')">' + esc(k.outcome || "Unknown") + "</span></td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="muted">No contracts listed.</p>') + "</section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">In public records</div><h3>Penalties, cases and findings</h3></div><p>Only events in official orders, court records or reputable news, each with its source. Allegations are shown as allegations; outcomes such as acquittals are included.</p></div>' + eventList(c.events) + "</section>" +
      (ps.length ? '<section class="panel"><div class="section-head"><div><h3>Projects on this dashboard</h3></div></div><div class="cards">' + ps.map(card).join("") + "</div></section>" : "");
    bindClicks(app, "[data-open]", function (el) { go("#p-" + el.dataset.open); });
  }

  // ---------------------------------------------------------------- MLA profile
  function viewMla(no) {
    var m = MLAS.find(function (x) { return String(x.no) === String(no); });
    if (!m) { viewMlas(); return; }
    var prof = (MLA_DATA.profiles || {})[m.no] || {};
    var aff = prof.affidavit || null, fund = prof.funds || null;
    var ps = PROJECTS.filter(function (p) { return (p.constituencies || []).indexOf(m.constituency) !== -1; });
    var late = ps.filter(isLate);
    var scheme = MLA_DATA.scheme || null;
    function statBox(label, value, sub, cls) { return '<div class="stat' + (cls ? " " + cls : "") + '"><span class="label">' + label + '</span><span class="value">' + value + '</span><span class="sub">' + sub + "</span></div>"; }
    var band = fund && fund.fundUtilisationBand ? fund.fundUtilisationBand.replace(/\s*\(.*\)$/, "") : null;
    var fundVal = band ? (band.match(/^(\d+)/) ? "≥" + band.match(/^(\d+)/)[1] + "<small>% used</small>" : esc(band)) : '<span class="muted" style="font-size:1.1rem">not published</span>';
    var fundSub = band ? "Praja report card band, Nov 2024 to Mar 2026" : fund && fund.notEvaluatedReason ? "not rated: " + esc(fund.notEvaluatedReason) : "no per-MLA figure published";
    app.innerHTML = '<p style="margin:0"><a href="#mlas">← All MLAs</a></p>' +
      '<section class="lead"><div class="eyebrow">' + esc(m.constituency) + " · constituency " + esc(m.no) + " · " + esc(m.district) + "</div><h2>" + esc(m.name) + '</h2><p style="margin-top:6px">' + esc(m.party) + " · MLA since " + esc(m.since) + ((prof.roles || []).length ? " · " + esc(prof.roles.join("; ")) : "") + "</p></section>" +
      '<section class="stats">' +
      statBox("Projects in the constituency", ps.length, late.length + " delayed or stalled") +
      statBox("MLA fund used", fundVal, (scheme && scheme.annualAllocationCr ? crore(scheme.annualAllocationCr) + " a year per MLA. " : "") + fundSub) +
      statBox("Cases declared pending", aff && aff.pendingCases != null ? aff.pendingCases + (aff.convictedCases ? '<small>+' + aff.convictedCases + " conviction</small>" : "") : '<span class="muted" style="font-size:1.2rem">—</span>', "sworn in the 2024 election affidavit; not convictions") +
      statBox("Praja report card", fund && fund.score != null ? fund.score.toFixed(1) + '<small>/100 · rank ' + fund.rank + " of 33</small>" : '<span class="muted" style="font-size:1.1rem">not rated</span>', fund && fund.score != null ? "attendance, questions, fund use, record" : fund && fund.notEvaluatedReason ? esc(fund.notEvaluatedReason) : "no published score") +
      "</section>" +
      ((prof.work || []).length + (prof.news || []).length < 4 ? '<div class="note">Coverage for this MLA is incomplete. Several English news sites block automated reading and Marathi newspapers are not yet covered, so few items have been found and checked. An empty list does not mean nothing was done.</div>' : "") +
      '<div class="grid-2"><section class="panel"><div class="section-head"><div><div class="eyebrow">On record</div><h3>What they have done for the area</h3></div><p>Works the MLA inaugurated, announced, funded or raised, as reported. Each item links its source.</p></div>' +
      ((prof.work || []).length ? '<ol class="events">' + prof.work.slice().sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }).map(function (w) {
        return '<li><div class="ev-head"><span class="pill" style="color:var(--accent)">' + esc(w.kind || "Reported") + '</span><span class="ev-date">' + esc(fmtDate(w.date)) + "</span></div><div>" + esc(w.what) + (w.projectId && PROJECTS.some(function (q) { return q.id === w.projectId; }) ? ' <a href="#p-' + esc(w.projectId) + '">project →</a>' : "") + '</div><div class="sub">' + srcLinks([w.source]) + (w.verified ? " · source re-checked " + esc(fmtDate(w.verified)) : "") + "</div></li>";
      }).join("") + "</ol>" : '<p class="muted" style="margin:0">Nothing found and checked yet.</p>') + "</section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">In the news</div><h3>Recent coverage</h3></div><p>Summaries in our words; follow the link for the full report.</p></div>' +
      ((prof.news || []).length ? '<ol class="events">' + prof.news.slice().sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }).map(function (n) {
        return '<li><div class="ev-head"><span class="ev-date">' + esc(fmtDate(n.date)) + "</span></div><div>" + esc(n.headline) + '</div><div class="sub">' + srcLinks([n.source]) + (n.verified ? " · source re-checked " + esc(fmtDate(n.verified)) : "") + "</div></li>";
      }).join("") + "</ol>" : '<p class="muted" style="margin:0">Nothing found and checked yet.</p>') + "</section></div>" +
      '<div class="grid-2"><section class="panel"><div class="section-head"><div><div class="eyebrow">Money</div><h3>MLA local development fund</h3></div></div>' +
      (scheme ? '<p style="margin:0 0 10px;font-size:.92rem">Every Maharashtra MLA gets ' + (scheme.annualAllocationCr ? crore(scheme.annualAllocationCr) + " a year" : "an annual allocation") + " for local works. The MLA recommends works; the district Collector approves them and gets them built. Unspent money lapses at the end of the year. The state does not publish spending per MLA.</p>" : "") +
      (fund && fund.evaluated ? '<dl class="facts-list"><dt>Fund use</dt><dd>' + esc(band || "—") + " of the sanctioned amount</dd><dt>Attendance</dt><dd>" + esc((fund.attendanceBand || "—").replace(/\s*\(.*\)$/, "")) + "</dd>" +
        (fund.parts ? "<dt>Questions asked</dt><dd>" + fund.parts.questions[0] + " of " + fund.parts.questions[1] + " marks (compared with other MLAs)</dd><dt>Quality of questions</dt><dd>" + fund.parts.quality[0] + " of " + fund.parts.quality[1] + " marks</dd>" : "") +
        "<dt>Period</dt><dd>Assembly sessions Winter 2024 to Monsoon 2025; fund Nov 2024 to Mar 2026</dd><dt>Source</dt><dd>" + srcLinks(fund.sources) + "</dd></dl>"
        : '<p class="muted" style="margin:0">' + (fund && fund.notEvaluatedReason ? "Praja did not rate this MLA: " + esc(fund.notEvaluatedReason) : "No per-MLA spending figure has been published.") + "</p>") +
      (MLA_DATA.bmcWorks ? '<p class="axis-note">' + esc(MLA_DATA.bmcWorks.summary) + " " + srcLinks(MLA_DATA.bmcWorks.sources) + "</p>" : "") + "</section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Election affidavit, 2024</div><h3>Declared cases and assets</h3></div></div>' +
      '<p style="margin:0 0 10px;font-size:.88rem" class="muted">What the candidate declared under oath (Form 26) when filing nomination, as compiled by ADR on MyNeta. A pending case is an accusation a court has not decided. Some entries are writ petitions or other proceedings, not police cases; the detail below lists them as ADR does.</p>' +
      (aff ? '<dl class="facts-list"><dt>Cases declared pending</dt><dd>' + (aff.pendingCases != null ? aff.pendingCases : "—") + "</dd><dt>Convictions declared</dt><dd>" + (aff.convictedCases != null ? aff.convictedCases : "—") + "</dd><dt>Total assets</dt><dd>" + (aff.totalAssetsCr != null ? crore(aff.totalAssetsCr) : "—") + "</dd><dt>Liabilities</dt><dd>" + (aff.liabilitiesCr != null ? crore(aff.liabilitiesCr) : "—") + "</dd>" + (aff.age ? "<dt>Age at election</dt><dd>" + aff.age + "</dd>" : "") + (aff.education ? "<dt>Education</dt><dd>" + esc(aff.education) + "</dd>" : "") + "<dt>Source</dt><dd>" + (safeUrl(aff.mynetaUrl) ? '<a href="' + esc(safeUrl(aff.mynetaUrl)) + '" target="_blank" rel="noopener">MyNeta affidavit summary (ADR)</a>' : "—") + "</dd></dl>" +
        (aff.sections || aff.detail ? "<details><summary>Case detail as listed by ADR</summary>" + (aff.sections ? '<p style="font-size:.85rem;margin:6px 0">' + esc(aff.sections) + "</p>" : "") + (aff.detail ? '<p style="font-size:.85rem;margin:6px 0">' + esc(aff.detail) + "</p>" : "") + "</details>" : "") +
        '<p class="axis-note">Cases filed after the November 2024 election are not yet covered here.</p>'
        : '<p class="muted" style="margin:0">Affidavit data not loaded.</p>') + "</section></div>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">In ' + esc(m.constituency) + '</div><h3>Projects in this constituency</h3></div><p>The MLA represents the area; the agency on each project builds it.</p></div>' +
      (ps.length ? '<div class="cards">' + sortList(ps).map(card).join("") + "</div>" : '<p class="muted" style="margin:0">No mapped projects yet.</p>') + "</section>";
    bindClicks(app, "[data-open]", function (el) { go("#p-" + el.dataset.open); });
  }

  // ---------------------------------------------------------------- schemes (yojanas)
  var yq = "", ylevel = "";
  function viewSchemes() {
    if (!YOJANAS.length) { app.innerHTML = '<section class="lead"><div class="eyebrow">Schemes</div><h2>Scheme records are being compiled</h2></section>'; return; }
    var levels = uniq(YOJANAS.map(function (y) { return y.level; }));
    app.innerHTML = '<section class="lead"><div class="eyebrow">Government schemes · yojana</div><h2>The schemes that reach Mumbai, and where each one stands</h2><p>Central, state and BMC schemes: what they give, who qualifies, how many people in Mumbai they reach where that is published, what changed recently, and how to apply.</p></section>' +
      '<section class="panel"><div class="filters" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);margin-bottom:14px"><div class="field search">' + ICON_SEARCH + '<input type="search" id="y-q" placeholder="Search schemes" aria-label="Search schemes" value="' + esc(yq) + '"></div>' +
      select("y-level", "Level", ylevel, [["", "Central, state and BMC"]].concat(levels.map(function (l) { return [l, l]; }))) + '</div><div id="y-list" class="scheme-list"></div></section>';
    document.getElementById("y-q").addEventListener("input", debounce(function (e) { yq = e.target.value; renderSchemes(); }, 150));
    document.getElementById("y-level").addEventListener("change", function (e) { ylevel = e.target.value; renderSchemes(); });
    renderSchemes();
  }
  function schemeStatusColor(s) { s = (s || "").toLowerCase(); return /paus|wound|stop|closed|suspend/.test(s) ? "--st-stalled" : /review|delay|trouble/.test(s) ? "--st-delayed" : /new|launch/.test(s) ? "--st-progress" : /active|running|ongoing/.test(s) ? "--st-completed" : "--st-notstarted"; }
  function renderSchemes() {
    var list = YOJANAS.filter(function (y) {
      if (ylevel && y.level !== ylevel) return false;
      return !yq || [y.name, y.nameLocal, y.gives, y.ministry, y.eligibility].join(" ").toLowerCase().indexOf(yq.toLowerCase()) !== -1;
    });
    document.getElementById("y-list").innerHTML = list.map(function (y) {
      return '<article class="scheme"><header><div><div class="eyebrow">' + esc(y.level) + (y.launched ? " · since " + esc(y.launched) : "") + "</div><h4>" + esc(y.name) + "</h4>" + (y.nameLocal ? '<div class="local" lang="mr">' + esc(y.nameLocal) + "</div>" : "") + '</div><span class="pill" style="color:var(' + schemeStatusColor(y.status) + ')">' + esc(y.status || "Status unknown") + "</span></header>" +
        '<p class="gives">' + esc(y.gives || "") + "</p>" +
        (y.eligibility ? '<p class="sub" style="margin:0 0 10px">Who qualifies: ' + esc(y.eligibility) + "</p>" : "") +
        ((y.mumbai || []).length ? '<div class="ynums">' + y.mumbai.map(function (n) { return '<div data-tip="' + esc((n.source && n.source.title ? n.source.title + ", " : "") + fmtDate(n.asOf)) + '"><span class="v">' + esc(typeof n.value === "number" ? n.value.toLocaleString("en-IN") : n.value) + '</span><span class="u">' + esc(n.unit || "") + '</span><span class="l">' + esc(n.metric) + (n.asOf ? " · " + esc(fmtDate(n.asOf)) : "") + "</span></div>"; }).join("") + "</div>" : '<p class="sub" style="margin:0 0 10px">No Mumbai-specific figure published.</p>') +
        (y.budget && y.budget.amountCr ? '<p class="sub" style="margin:0 0 10px">Budget: ' + crore(y.budget.amountCr) + " (" + esc(y.budget.scope || "") + (y.budget.period ? ", " + esc(y.budget.period) : "") + ") · " + srcLinks([y.budget.source]) + "</p>" : "") +
        ((y.recent || []).length || (y.issues || []).length ? "<details><summary>Recent changes" + ((y.issues || []).length ? " and issues" : "") + " (" + ((y.recent || []).length + (y.issues || []).length) + ")</summary>" +
          '<ol class="events">' + (y.recent || []).map(function (r) { return '<li><div class="ev-head"><span class="pill" style="color:var(--accent)">Update</span><span class="ev-date">' + esc(fmtDate(r.date)) + "</span></div><div>" + esc(r.what) + '</div><div class="sub">' + srcLinks([r.source]) + "</div></li>"; }).join("") +
          (y.issues || []).map(function (r) { return '<li><div class="ev-head"><span class="pill" style="color:var(--st-delayed)">Issue</span><span class="ev-date">' + esc(fmtDate(r.date)) + "</span></div><div>" + esc(r.what) + '</div><div class="sub">' + srcLinks([r.source]) + "</div></li>"; }).join("") + "</ol></details>" : "") +
        (y.apply && (y.apply.how || y.apply.url) ? '<p class="apply">How to apply: ' + esc(y.apply.how || "") + (safeUrl(y.apply.url) ? ' <a href="' + esc(safeUrl(y.apply.url)) + '" target="_blank" rel="noopener">' + esc(y.apply.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) + "</a>" : "") + "</p>" : "") +
        "</article>";
    }).join("") || '<div class="empty">No scheme matches.</div>';
  }

  // ---------------------------------------------------------------- delayed project: what's blocking it, what waiting costs
  function delayPanel(p) {
    var d = DELAYS[p.id];
    if (!isLate(p) && !d) return "";
    if (!d) return "";
    var monthsLate = p.targetDate ? Math.max(0, Math.round((TODAY - toTime(p.targetDate, true)) / (30.44 * 864e5))) : null;
    var over = overrun(p);
    return '<section class="panel stuck"><h3>What’s holding it up</h3>' +
      (d.blocker ? '<p style="margin:0 0 4px;font-weight:600">' + esc(d.blocker) + "</p>" : "") +
      (d.pendingWith ? '<p class="sub" style="margin:0 0 12px">Waiting on: ' + esc(d.pendingWith) + "</p>" : "") +
      '<dl class="kv"><div><dt>Spent so far</dt><dd>' + (d.spentCr != null ? crore(d.spentCr) : '<span class="muted" style="font-size:1rem">not published</span>') + "<small>" + (d.spentAsOf ? "as of " + esc(fmtDate(d.spentAsOf)) : "&nbsp;") + "</small></dd></div>" +
      "<div><dt>Cost rise so far</dt><dd>" + (over ? "+" + crore(over) : '<span class="muted" style="font-size:1rem">none published</span>') + "<small>" + (over ? "since the first estimate of " + crore(p.cost.original) + "; not all due to delay" : "&nbsp;") + "</small></dd></div>" +
      "<div><dt>Past original deadline</dt><dd>" + (monthsLate != null ? plural(monthsLate, "month") : "—") + "<small>" + (p.targetDate ? "due " + esc(fmtDate(p.targetDate)) : "&nbsp;") + "</small></dd></div></dl>" +
      ((d.delayCost || []).length ? '<h4 style="margin:14px 0 6px;font-size:.9rem">Documented cost of delay</h4><ul class="sources">' + d.delayCost.map(function (c) { return "<li><b>" + (c.amountCr != null ? crore(c.amountCr) : "") + "</b> " + esc(c.measures) + ' <span class="sub">' + srcLinks([c.source]) + "</span></li>"; }).join("") + "</ul>" : "") +
      (d.latest ? '<p class="axis-note">Latest: ' + esc(d.latest.what) + " (" + esc(fmtDate(d.latest.date)) + ") " + srcLinks([d.latest.source]) + "</p>" : "") +
      (d.spentSource ? '<p class="axis-note">Spending source: ' + srcLinks([d.spentSource]) + "</p>" : "") +
      "</section>";
  }

  // ---------------------------------------------------------------- funding
  function viewFunding() {
    var byFunder = {}, byType = {}, undisclosed = 0;
    PROJECTS.forEach(function (p) {
      (p.funders || []).forEach(function (f) {
        var k = f.name;
        var r = byFunder[k] = byFunder[k] || { name: f.name, type: f.type, amount: 0, unknown: 0, projects: [] };
        if (f.amount != null) { r.amount += f.amount; byType[f.type] = (byType[f.type] || 0) + f.amount; } else { r.unknown++; undisclosed++; }
        r.projects.push(p);
      });
    });
    var funders = Object.values(byFunder).sort(function (a, b) { return b.amount - a.amount || b.projects.length - a.projects.length; });
    var types = FUND_TYPES.filter(function (t) { return byType[t.key]; });
    var known = types.reduce(function (s, t) { return s + byType[t.key]; }, 0);
    app.innerHTML = '<section class="lead"><div class="eyebrow">Money</div><h2>Who is paying for it</h2><p>Every funder named in a project’s sources: central and state government, the BMC, international lenders and private developers. Only commitments with a published amount are added up; ' + plural(undisclosed, "commitment") + " have no public figure.</p></section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Disclosed amounts</div><h3>' + crore(known) + " with a published figure, by source</h3></div></div>" +
      '<div class="fundbar" style="height:18px" role="img" aria-label="Disclosed funding by source type">' + types.map(function (t) { return '<span style="flex:' + byType[t.key] + ";background:" + fundColor(t.key) + '" data-tip="<b>' + esc(t.key) + "</b><br>" + crore(byType[t.key]) + " (" + Math.round(100 * byType[t.key] / known) + '%)"></span>'; }).join("") + "</div>" +
      '<div class="legend">' + types.map(function (t) { return '<span class="chip" style="cursor:default"><span class="swatch" style="background:' + fundColor(t.key) + '"></span>' + esc(t.key) + " <b>" + crore(byType[t.key]) + "</b></span>"; }).join("") + "</div></section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Every funder</div><h3>Who has put money into what</h3></div></div><div class="table-scroll"><table class="data"><thead><tr><th>Funder</th><th class="num">Disclosed</th><th>Projects</th></tr></thead><tbody>' +
      funders.map(function (f) {
        return '<tr><td style="min-width:200px"><b>' + esc(f.name) + '</b><div class="sub"><span class="swatch" style="display:inline-block;vertical-align:-1px;margin-right:5px;background:' + fundColor(f.type) + '"></span>' + esc(f.type) + '</div></td><td class="num">' + (f.amount ? crore(f.amount) : '<span class="muted">not disclosed</span>') + (f.amount && f.unknown ? '<div class="sub">+' + f.unknown + " undisclosed</div>" : "") + '</td><td style="font-size:.85rem">' +
          f.projects.map(function (p) { return '<a href="#p-' + esc(p.id) + '">' + esc(p.shortName || p.name) + "</a>"; }).join(", ") + "</td></tr>";
      }).join("") + "</tbody></table></div></section>";
  }

  // ---------------------------------------------------------------- about
  function viewAbout() {
    var srcs = (META.sources || []).map(function (s) {
      var u = safeUrl(s.url);
      return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a>" : esc(s.name)) + (s.note ? ' <span class="muted">· ' + esc(s.note) + "</span>" : "") + "</li>";
    }).join("");
    app.innerHTML = '<section class="lead"><div class="eyebrow">About</div><h2>Where this data comes from</h2><p>' + esc(META.sourceNote || "") + "</p></section>" +
      '<div class="grid-2"><section class="panel"><h3 class="eyebrow" style="margin:0 0 10px">How to read it</h3><dl class="facts-list">' +
      "<dt>Status</dt><dd>The latest reported state from the cited source. Each project shows the date of the report it rests on.</dd>" +
      "<dt>Cost</dt><dd>Latest sanctioned or revised estimate in ₹ crore (1 crore = 10 million). A red +% is the rise over the original cost.</dd>" +
      "<dt>Funders</dt><dd>Every source of money we found. “Not disclosed” means the funder is known but its share is not public.</dd>" +
      "<dt>Wards</dt><dd>Each project’s stations and sites are placed on the BMC ward map. Points are approximate.</dd>" +
      "<dt>MLAs</dt><dd>The elected members for the constituencies a project runs through. They represent the area; the agency builds it.</dd>" +
      "<dt>Tenders</dt><dd>Pulled from the state e-tender portal. Award amounts and winners are not public there.</dd></dl></section>" +
      '<section class="panel" style="grid-column:1/-1"><h3 class="eyebrow" style="margin:0 0 10px">How we check</h3><dl class="facts-list">' +
      "<dt>Two passes</dt><dd>One researcher collects each fact from a source they opened. A second reviewer then re-opens every source for anything about a named person or company (cases, penalties, findings, news, work claimed) and confirms, corrects or removes it. Items that pass show \u201csource re-checked\u201d with a date.</dd>" +
      "<dt>Legal wording</dt><dd>We say exactly what happened: an FIR, a chargesheet, a conviction, an acquittal, a suspended conviction. Being named in an FIR is not being charged, and bail is not acquittal. Allegations are labelled as allegations.</dd>" +
      "<dt>Affidavits</dt><dd>MLA case counts are what each candidate declared under oath in their 2024 nomination affidavit, as compiled by ADR. Some entries are writ petitions or election matters, not police cases.</dd>" +
      "<dt>Fairness</dt><dd>Cases filed after the 2024 election are not shown for anyone until they have been checked for all 36 MLAs. People are named only when formally charged, arrested, convicted or named in an official order.</dd>" +
      "<dt>What we don\u2019t do</dt><dd>We don\u2019t estimate missing numbers, treat delay as wrongdoing, or attribute cases to an MLA\u2019s associates without a report that formally links them.</dd></dl></section>" +
      '<section class="panel"><h3 class="eyebrow" style="margin:0 0 10px">Main sources</h3><ul class="sources">' + srcs + '</ul><h3 class="eyebrow" style="margin:18px 0 8px">Something wrong or missing?</h3><p style="margin:0;font-size:.9rem">Every figure should trace to a public document. If you have a newer progress report, an RTI reply or a correction, send it with the source link and the record will be updated.</p></section></div>';
  }

  // ---------------------------------------------------------------- project drawer
  var drawer = document.getElementById("drawer");
  var overlay = document.getElementById("overlay");
  var lastHash = "#overview";
  var lastFocus = null;

  function timeline(p) {
    var S = toTime(p.startDate), T0 = toTime(p.targetDate, true), T1 = toTime(p.revisedTargetDate, true), C = toTime(p.completedDate);
    var pts = [S, T0, T1, C].filter(function (x) { return x != null; });
    if (pts.length < 2 && !(pts.length === 1 && S)) return "";
    var lo = Math.min.apply(null, pts.concat([TODAY])), hi = Math.max.apply(null, pts.concat([TODAY]));
    var y0 = new Date(lo).getUTCFullYear(), y1 = new Date(hi).getUTCFullYear() + 1;
    lo = Date.UTC(y0, 0, 1); hi = Date.UTC(y1, 0, 1);
    var W = 600, L = 8, R = 8, X = function (t) { return L + (W - L - R) * (t - lo) / (hi - lo); };
    var step = y1 - y0 > 12 ? 3 : y1 - y0 > 6 ? 2 : 1;
    var ticks = "";
    for (var y = y0; y <= y1; y += step) {
      var tx = X(Date.UTC(y, 0, 1));
      ticks += '<line x1="' + tx + '" x2="' + tx + '" y1="30" y2="62" stroke="var(--line)" stroke-width="1"/><text x="' + tx + '" y="78" font-size="11" text-anchor="' + (y === y0 ? "start" : y === y1 ? "end" : "middle") + '" fill="var(--ink-3)">' + y + "</text>";
    }
    var end = C || T1 || (T0 && TODAY > T0 && p.status !== "Completed" ? TODAY : null);
    var bars = "";
    if (S && T0) bars += '<rect x="' + X(S) + '" y="40" width="' + Math.max(2, X(T0) - X(S)) + '" height="12" rx="3" fill="var(--ink-3)" opacity="0.45"><title>Planned: ' + esc(fmtDate(p.startDate) + " to " + fmtDate(p.targetDate)) + "</title></rect>";
    else if (S && end) bars += '<rect x="' + X(S) + '" y="40" width="' + Math.max(2, X(end) - X(S)) + '" height="12" rx="3" fill="var(--ink-3)" opacity="0.45"/>';
    if (T0 && end && end > T0) bars += '<rect x="' + X(T0) + '" y="40" width="' + Math.max(2, X(end) - X(T0)) + '" height="12" rx="3" fill="url(#hatch-' + esc(p.id) + ')"><title>Late by ' + Math.round((end - T0) / (30.44 * 864e5)) + " months</title></rect>";
    var marks = [];
    if (S) marks.push([X(S), "Started " + fmtDate(p.startDate), "below"]);
    if (T0) marks.push([X(T0), "Due " + fmtDate(p.targetDate), "above"]);
    if (C) marks.push([X(C), "Opened " + fmtDate(p.completedDate), "above2"]);
    else if (T1) marks.push([X(T1), "Now due " + fmtDate(p.revisedTargetDate), "above2"]);
    var labels = marks.map(function (m) {
      var ly = m[2] === "below" ? 98 : m[2] === "above" ? 22 : 8;
      var anchor = m[0] < 90 ? "start" : m[0] > W - 90 ? "end" : "middle";
      return '<line x1="' + m[0] + '" x2="' + m[0] + '" y1="' + (m[2] === "below" ? 52 : ly + 4) + '" y2="' + (m[2] === "below" ? 86 : 40) + '" stroke="var(--ink-2)" stroke-width="1"/><circle cx="' + m[0] + '" cy="46" r="3.5" fill="var(--surface)" stroke="var(--ink)" stroke-width="1.5"/><text x="' + m[0] + '" y="' + ly + '" font-size="12" font-weight="600" text-anchor="' + anchor + '" fill="var(--ink)">' + esc(m[1]) + "</text>";
    }).join("");
    var today = '<line x1="' + X(TODAY) + '" x2="' + X(TODAY) + '" y1="34" y2="58" stroke="var(--accent)" stroke-width="2"/><text x="' + X(TODAY) + '" y="' + 112 + '" font-size="11" text-anchor="' + (X(TODAY) > W - 60 ? "end" : "middle") + '" fill="var(--accent)">today</text>';
    return '<div class="timeline"><svg viewBox="0 0 ' + W + ' 118" role="img" aria-label="Project timeline"><defs><pattern id="hatch-' + esc(p.id) + '" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="var(--st-delayed-fill)"/><line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" stroke-width="2"/></pattern></defs>' + ticks + bars + today + labels + "</svg></div>" +
      (T0 && end && end > T0 ? '<p class="axis-note" style="margin-top:4px"><span class="swatch" style="display:inline-block;vertical-align:-1px;background:var(--st-delayed-fill)"></span> Hatched: time past the original deadline (' + plural(Math.round((end - T0) / (30.44 * 864e5)), "month") + ")</p>" : "");
  }

  function openProject(id) {
    var p = PROJECTS.find(function (x) { return x.id === id; });
    if (!p) { closeDrawer(); return; }
    lastFocus = document.activeElement;
    var mls = mlasFor(p), heads = headsFor(p), pct = overrunPct(p);
    var wp = WARD_PARTS[p.id] || {};
    var wardKeys = Object.keys(wp).sort(function (a, b) { return WARD_ORDER.indexOf(a) - WARD_ORDER.indexOf(b); });
    var known = (p.funders || []).filter(function (f) { return f.amount != null; });
    var knownSum = known.reduce(function (s, f) { return s + f.amount; }, 0);
    var sources = (p.sources || []).map(function (s) {
      var u = safeUrl(s.url);
      return "<li>" + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(s.title || u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) + "</a>" : esc(s.title || "")) + (s.date ? ' <span class="muted">· ' + fmtDate(s.date) + "</span>" : "") + (s.claim ? '<div class="muted">' + esc(s.claim) + "</div>" : "") + "</li>";
    }).join("");

    drawer.innerHTML = '<div class="d-head"><h2 id="drawer-title">' + esc(p.name) + '</h2><button type="button" class="close" id="close" aria-label="Close">×</button>' +
      '<div class="meta">' + pill(p.status) + "<span>" + esc(p.sector) + "</span><span>·</span><span>" + esc(p.agency) + "</span></div></div>" +
      '<div class="d-body">' +
      (p.summary ? '<p class="d-summary">' + esc(p.summary) + "</p>" : "") +
      (p.delayReason && p.status !== "Completed" ? '<div class="delay"><b>Why it’s late:</b> ' + esc(p.delayReason) + "</div>" : "") +
      '<dl class="kv"><div><dt>Cost now</dt><dd>' + crore(cost(p)) + (pct ? '<small><span class="up">+' + pct + "%</span> from " + crore(p.cost.original) + "</small>" : p.cost && p.cost.note ? "<small>see note below</small>" : "<small>&nbsp;</small>") + "</dd></div>" +
      "<div><dt>Built</dt><dd>" + (p.progress != null ? p.progress + "%" : "—") + "<small>" + (p.progress != null ? "physical progress" : "not published") + "</small></dd></div>" +
      "<div><dt>" + (p.completedDate ? "Opened" : "Due") + "</dt><dd>" + esc(fmtDate(p.completedDate || p.revisedTargetDate || p.targetDate)) + "<small>" + (p.revisedTargetDate && p.targetDate && !p.completedDate ? "originally " + esc(fmtDate(p.targetDate)) : p.completedDate && p.targetDate ? "was due " + esc(fmtDate(p.targetDate)) : "&nbsp;") + "</small></dd></div></dl>" +
      (timeline(p) ? '<section class="panel"><h3>Timeline</h3>' + timeline(p) + "</section>" : "") +
      delayPanel(p) +
      '<section class="panel"><h3>Who’s running it</h3><div class="people" style="margin:0">' +
      '<div class="person"><div class="role">Implementing agency</div><div class="name">' + esc(p.agency) + "</div>" + (heads.length ? heads.map(function (h) { return '<div class="detail">' + esc(h.name) + ", " + esc(h.role) + (h.confidence === "low" ? '<span class="flag">unconfirmed</span>' : "") + "</div>"; }).join("") : '<div class="detail muted">Head not on file</div>') + "</div>" +
      '<div class="person"><div class="role">Builds it</div><div class="name" style="font-weight:600">' + esc(p.contractor || "Not published") + "</div></div></div></section>" +
      '<section class="panel"><h3>Which part is in which ward</h3>' + (p.citywide ? '<p class="muted" style="margin:0">Citywide: covers every ward.</p>' : wardKeys.length ? '<div class="table-scroll"><table class="data"><tbody>' + wardKeys.map(function (w) {
        return "<tr><td style=\"width:1%\">" + (w === "outside" ? '<span class="muted" style="white-space:nowrap">Outside BMC</span>' : '<a href="#ward-' + wardSlug(w) + '" style="text-decoration:none">' + wcode(w) + "</a>") + "</td><td>" + esc(wp[w].join(", ")) + '</td><td class="sub" style="white-space:nowrap">' + (w === "outside" ? "" : esc((WARD_INFO[w] || {}).assistantCommissioner || "")) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="muted" style="margin:0">Not mapped to wards yet.</p>') + "</section>" +
      '<section class="panel"><h3>Who’s paying</h3>' +
      (known.length > 1 ? '<div class="fundbar" role="img" aria-label="Disclosed funding split">' + known.map(function (f) { return '<span style="flex:' + f.amount + ";background:" + fundColor(f.type) + '" data-tip="<b>' + esc(f.name) + "</b><br>" + crore(f.amount) + '"></span>'; }).join("") + "</div>" : "") +
      ((p.funders || []).length ? '<table class="data"><tbody>' + p.funders.map(function (f) {
        return '<tr><td><span class="swatch" style="display:inline-block;vertical-align:-1px;margin-right:7px;background:' + fundColor(f.type) + '"></span><b>' + esc(f.name) + '</b><div class="sub" style="margin-left:17px">' + esc(f.type) + (f.note ? " · " + esc(f.note) : "") + '</div></td><td class="num">' + (f.amount != null ? crore(f.amount) : '<span class="muted">not disclosed</span>') + "</td></tr>";
      }).join("") + "</tbody></table>" : '<p class="muted" style="margin:0">No funding breakdown published.</p>') +
      (p.cost && p.cost.note ? '<p class="axis-note">Cost note: ' + esc(p.cost.note) + "</p>" : "") + "</section>" +
      '<section class="panel"><h3>Elected MLAs for this area</h3>' + (mls.length ? '<div class="mla-list">' + mls.map(function (m) {
        return '<div class="person"><div class="name">' + esc(m.name || "MLA not on file") + '</div><div class="detail">' + esc(m.constituency) + (m.party ? " · " + esc(m.party) : "") + "</div></div>";
      }).join("") + "</div>" : '<p class="muted" style="margin:0">' + (p.citywide ? "Citywide project: every MLA’s area." : "Not mapped to a constituency.") + "</p>") + "</section>" +
      '<section class="panel"><h3>Sources</h3>' + (sources ? '<ul class="sources">' + sources + "</ul>" : '<p class="muted">No source on file.</p>') +
      (p.lastVerified ? '<p class="axis-note">Status last checked ' + fmtDate(p.lastVerified) + ". Areas: " + esc((p.areas || []).join(", ")) + "</p>" : "") + "</section>" +
      "</div>";
    drawer.classList.add("open"); overlay.classList.add("open"); drawer.setAttribute("aria-hidden", "false");
    drawer.scrollTop = 0;
    document.getElementById("close").addEventListener("click", closeDrawer);
    document.getElementById("close").focus({ preventScroll: true });
  }
  function closeDrawer() {
    drawer.classList.remove("open"); overlay.classList.remove("open"); drawer.setAttribute("aria-hidden", "true");
    if (/^#p-/.test(location.hash)) {
      if (history.length > 1 && lastHash) history.replaceState(null, "", lastHash);
      else location.hash = lastHash;
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  overlay.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer(); });

  // ---------------------------------------------------------------- CSV
  function exportCsv(list, btn) {
    var cols = ["id", "name", "status", "progress", "sector", "agency", "contractor", "original_cost_cr", "revised_cost_cr", "funders", "wards", "constituencies", "mlas", "start", "target", "revised_target", "completed", "delay_reason", "sources"];
    var rows = list.map(function (p) {
      return [p.id, p.name, p.status, p.progress, p.sector, p.agency, p.contractor, p.cost && p.cost.original, p.cost && p.cost.revised,
        (p.funders || []).map(function (f) { return f.name + (f.amount != null ? " (" + f.amount + ")" : ""); }).join("; "),
        p.citywide ? "citywide" : wardsOf(p).join("; "), (p.constituencies || []).join("; "), mlasFor(p).map(function (m) { return m.name || ""; }).join("; "),
        p.startDate, p.targetDate, p.revisedTargetDate, p.completedDate, p.delayReason, (p.sources || []).map(function (s) { return s.url; }).join(" ")];
    });
    var csv = [cols].concat(rows).map(function (r) {
      return r.map(function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",");
    }).join("\n");
    if (EMBED) {
      var label = btn.textContent;
      Promise.resolve().then(function () { return navigator.clipboard.writeText(csv); })
        .then(function () { btn.textContent = "Copied " + list.length + " rows"; })
        .catch(function () { btn.textContent = "Copy blocked by browser"; })
        .then(function () { setTimeout(function () { btn.textContent = label; }, 2200); });
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = "mumbai-public-works.csv";
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------------------------------------------------------------- router
  var VIEWS = { overview: viewOverview, map: viewMap, wards: viewWards, tenders: viewTenders, mlas: viewMlas, contracts: viewContracts, schemes: viewSchemes, funding: viewFunding, about: viewAbout };
  function setTab(tab) {
    document.querySelectorAll("nav.tabs a").forEach(function (a) {
      var on = a.dataset.tab === tab;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  function render(hash) {
    var name = (hash || "").replace(/^#\/?/, "");
    if (/^ward-/.test(name)) {
      setTab("wards");
      if (leafletMap) { leafletMap.remove(); leafletMap = null; }
      var w = wardFromSlug(name.slice(5));
      if (document.getElementById("ward-detail") && WARD_NAMES.indexOf(w) !== -1) {
        selectedWard = w;
        document.querySelectorAll("#picker [data-ward]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.ward === w)); });
        renderWard(w);
        document.getElementById("ward-detail").scrollIntoView({ behavior: "smooth", block: "start" });
      } else viewWards(w);
      return;
    }
    var sub = name.match(/^(mla|co)-(.+)$/);
    if (sub) {
      setTab(sub[1] === "mla" ? "mlas" : "contracts");
      if (leafletMap) { leafletMap.remove(); leafletMap = null; }
      (sub[1] === "mla" ? viewMla : viewCompany)(sub[2]);
      window.scrollTo(0, 0);
      return;
    }
    var tab = VIEWS[name] ? name : "overview";
    setTab(tab);
    if (tab !== "map" && leafletMap) { leafletMap.remove(); leafletMap = null; }
    ui.limit = 48;
    VIEWS[tab]();
    window.scrollTo(0, 0);
  }
  function route() {
    var h = location.hash;
    var m = h.match(/^#p-(.+)$/);
    if (m) {
      if (!app.innerHTML) render(lastHash);
      openProject(decodeURIComponent(m[1]));
      return;
    }
    if (drawer.classList.contains("open")) { drawer.classList.remove("open"); overlay.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); }
    // old-style links (#/projects, #/project/ID) keep working
    var old = h.match(/^#\/project\/(.+)$/);
    if (old) { location.replace("#p-" + old[1]); return; }
    if (h === "#/projects") h = "#overview";
    if (h === "#/funders") h = "#funding";
    lastHash = h || "#overview";
    render(h);
  }

  // ---------------------------------------------------------------- boot
  if (META.title) document.title = META.title;
  var notice = document.getElementById("notice");
  if (META.notice && notice) { notice.hidden = false; notice.innerHTML = '<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" style="flex:none;transform:translateY(2px)">' + STATUSES[3].icon + "</svg><span>" + esc(META.notice) + "</span>"; }
  var tc = document.querySelector('nav.tabs a[data-tab="tenders"]');
  if (tc) tc.insertAdjacentHTML("beforeend", '<span class="count">' + OPEN_TENDERS.length + "</span>");
  var pc = document.querySelector('nav.tabs a[data-tab="overview"]');
  if (pc) pc.insertAdjacentHTML("beforeend", '<span class="count">' + PROJECTS.length + "</span>");
  document.getElementById("footer").innerHTML = "<span>Data updated " + fmtDate(META.lastUpdated) + ". Costs in ₹ crore (1 crore = 10 million).</span><span>Built from public sources. <a href=\"#about\">About the data</a></span>";
  window.addEventListener("hashchange", route);
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (leafletMap) viewMap(); });
  route();
})();
