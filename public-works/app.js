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
  // BMC electoral wards (227) and their corporators. A point counts toward every electoral ward within 150 m.
  var CORP = window.PUBLIC_WORKS_CORPORATORS || { corporators: [], boundaries: { features: [] }, office: [] };
  var CORP_BY_WARD = {};
  CORP.corporators.forEach(function (c) { CORP_BY_WARD[c.ward] = c; });
  var EWARD_GEO = CORP.boundaries.features;
  function ewardsNear(lat, lng) {
    var hits = [];
    EWARD_GEO.forEach(function (f) {
      var inside = false, near = false;
      f.geometry.coordinates.forEach(function (poly) {
        if (inRing(lng, lat, poly[0])) inside = true;
        for (var s = 1; s < poly[0].length && !near && !inside; s++) if (segDistKm(lat, lng, poly[0][s - 1], poly[0][s]) < 0.15) near = true;
      });
      if (inside || near) hits.push(f.properties.ward);
    });
    return hits;
  }
  var CORP_PARTS = {}; // project id -> { electoral ward no: [part names] }
  if (EWARD_GEO.length) {
    var ewCache = {};
    PROJECTS.forEach(function (p) {
      var parts = {};
      (ROUTES[p.id] || []).forEach(function (path) {
        path.forEach(function (pt) {
          var k = pt[0] + "," + pt[1];
          (ewCache[k] = ewCache[k] || ewardsNear(pt[0], pt[1])).forEach(function (n) { (parts[n] = parts[n] || []).push(pt[2]); });
        });
      });
      CORP_PARTS[p.id] = parts;
    });
  }
  function corpLine(c) {
    if (!c) return "";
    return c.vacant ? '<span class="muted">Seat vacant</span> <span class="flag">' + esc(c.name) + " disqualified</span>" : "<b>" + esc(c.name) + '</b> <span class="muted">· ' + esc(c.party) + "</span>";
  }

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
    return '<span class="pill" style="color:' + statusColor(s) + '"' + (GLOSS[s] ? ' data-tip="' + esc("<b>" + s + "</b><br>" + GLOSS[s]) + '"' : "") + '><svg viewBox="0 0 12 12" aria-hidden="true">' + st.icon + "</svg>" + esc(s) + "</span>";
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


  // ---------------------------------------------------------------- icons (stroke icons, 20px box)
  var IC = {
    pin: '<path d="M10 18s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z"/><circle cx="10" cy="8" r="2.2"/>',
    crane: '<path d="M4 18V3h1.5M4 3l12 3M5.5 3L4 6M12 6v4M10.5 10h3v3h-3zM2 18h8"/>',
    people: '<circle cx="7" cy="7" r="2.6"/><path d="M2.5 16c.6-2.7 2.3-4 4.5-4s3.9 1.3 4.5 4"/><circle cx="14" cy="8" r="2.1"/><path d="M12.6 12.3c.4-.2.9-.3 1.4-.3 1.8 0 3.2 1.1 3.6 3.4"/>',
    rupee: '<path d="M6 4h9M6 7.5h9M6 4h3.5a3.5 3.5 0 0 1 0 7H6l7 6"/>',
    air: '<path d="M2 8h10a2.5 2.5 0 1 0-2.5-2.5M2 12h13a2.5 2.5 0 1 1-2.5 2.5M2 16h6"/>',
    scheme: '<rect x="4" y="2.5" width="12" height="15" rx="1.5"/><path d="M7 7h6M7 10h6M7 13h3.5"/>',
    map: '<path d="M2 5l5-2 6 2 5-2v12l-5 2-6-2-5 2z"/><path d="M7 3v12M13 5v12"/>',
    ward: '<path d="M3 17V8l7-5 7 5v9z"/><path d="M8 17v-5h4v5"/>',
    train: '<rect x="5" y="2.5" width="10" height="12" rx="2.5"/><path d="M5 9h10M8 17.5l1-3M12 17.5l-1-3"/><circle cx="8" cy="12" r=".6"/><circle cx="12" cy="12" r=".6"/>',
    bridge: '<path d="M2 14h16M3 14V9c2.5 0 4-2 7-2s4.5 2 7 2v5M6 14v-4.5M10 14V7M14 14v-4.5"/>',
    drop: '<path d="M10 2.5s5 5.6 5 9a5 5 0 0 1-10 0c0-3.4 5-9 5-9z"/>',
    house: '<path d="M3 9l7-6 7 6M5 8v9h10V8"/><path d="M8.5 17v-4h3v4"/>',
    health: '<rect x="3" y="3" width="14" height="14" rx="3"/><path d="M10 6.5v7M6.5 10h7"/>',
    bin: '<path d="M4 6h12M8 6V4h4v2M5.5 6l1 11h7l1-11"/>',
    pillar: '<path d="M3 17h14M4 7h12M10 3l7 4H3zM6 7v8M10 7v8M14 7v8"/>',
    anchor: '<circle cx="10" cy="4.5" r="1.8"/><path d="M10 6.3V17M6 9h8M3.5 12c.5 3 3.2 5 6.5 5s6-2 6.5-5"/>',
    book: '<path d="M3 4.5C5 3.5 8 3.5 10 5c2-1.5 5-1.5 7-.5V16c-2-1-5-1-7 .5-2-1.5-5-1.5-7-.5z"/><path d="M10 5v11.5"/>',
    bolt: '<path d="M11 2L4 11h5l-1 7 7-9h-5z"/>',
    share: '<circle cx="15" cy="4.5" r="2"/><circle cx="5" cy="10" r="2"/><circle cx="15" cy="15.5" r="2"/><path d="M6.8 9l6.4-3.5M6.8 11l6.4 3.5"/>',
    image: '<rect x="2.5" y="4" width="15" height="12" rx="1.5"/><circle cx="7" cy="8.5" r="1.5"/><path d="M3 15l4.5-4 3 2.5 3-3 4 3.5"/>',
    flag: '<path d="M4 18V3M4 3.5h10l-2 3.5 2 3.5H4"/>',
    clock: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
    compare: '<path d="M4 3v14M16 3v14M4 7h5M4 12h3M16 9h-6M16 14h-4"/>',
    dot: '<circle cx="10" cy="10" r="3"/>',
  };
  function icon(name, size) { return '<svg class="ic" width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + (IC[name] || IC.dot) + "</svg>"; }
  function sectorIcon(sec) {
    sec = sec || "";
    return icon(/rail|metro|train/i.test(sec) ? "train" : /road|bridge/i.test(sec) ? "bridge" : /water|flood|sanit/i.test(sec) ? "drop" : /hous/i.test(sec) ? "house" : /health/i.test(sec) ? "health" : /waste/i.test(sec) ? "bin" : /heritage|public space/i.test(sec) ? "pillar" : /port|water ?front/i.test(sec) ? "anchor" : /educat/i.test(sec) ? "book" : /power|energy/i.test(sec) ? "bolt" : "dot", 15);
  }
  function exploreTiles(data) {
    var worst = (window.PUBLIC_WORKS_AQI || { stations: [] }).stations.slice().sort(function (a, b) { return b.aqi - a.aqi; })[0];
    var tiles = [
      ["#area", "pin", "Your area", "Your corporator, MLA and ward officer, projects within 1.5 km, and the air you breathe.", "Pick a locality"],
      ["#mlas", "people", "Your representatives", "What MLAs, corporators and MPs declared under oath, did, and were criticised for.", MLAS.length + " MLAs · " + CORP.corporators.length + " corporators · " + (window.PUBLIC_WORKS_MPS ? window.PUBLIC_WORKS_MPS.mps.length : 0) + " MPs"],
      ["#explorer", "crane", "Projects", "Status, cost, delays and what is blocking each one.", PROJECTS.length + " projects · " + data.late + " delayed or stalled"],
      ["#contracts", "rupee", "Money", "Who wins contracts, live tenders, and who funds what.", CONTRACTS.companies.length + " companies · " + OPEN_TENDERS.length + " open tenders"],
      ["#map", "air", "Air and map", "Official air-quality stations and every project on the map.", worst ? "Worst now: " + stationName(worst) + ", AQI " + worst.aqi : "Map of all projects"],
      ["#schemes", "scheme", "Schemes", "Government yojanas reaching Mumbai, their status and how to apply.", YOJANAS.length + " schemes"],
      ["#latest", "clock", "Latest", "Everything reported recently: project milestones, representatives, schemes, contractors.", feedItems().filter(function (x) { return String(x.date) >= new Date(TODAY - 30 * 864e5).toISOString().slice(0, 10); }).length + " updates in the last 30 days"],
      ["#services", "ward", "City services", "Complaints and how fast each ward closes them, flooding spots, pumping stations and more.", "By ward, with sources"],
      ["#compare", "compare", "Compare", "Two wards or two MLAs side by side, and a table ranking all 24 wards.", "Wards and MLAs"],
    ];
    return '<section class="explore" aria-label="Explore">' + tiles.map(function (t) {
      return '<a class="tile" href="' + t[0] + '"><span class="tile-ic">' + icon(t[1], 22) + '</span><span class="tile-t">' + esc(t[2]) + '</span><span class="tile-d">' + esc(t[3]) + '</span><span class="tile-m">' + esc(t[4]) + " →</span></a>";
    }).join("") + "</section>";
  }
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
      '<section class="hero"><div class="hero-main"><div class="eyebrow">Mumbai · updated ' + esc(fmtDate(META.lastUpdated)) + '</div>' +
      "<h2>What\u2019s being built in Mumbai, who pays for it, and who answers for it.</h2>" +
      "<p>Every major BMC, state and central project in the city, the people you elect, the contracts they award and the air you breathe, each fact linked to its source.</p>" +
      '<div class="hero-search"><div class="field search">' + ICON_SEARCH + '<input type="search" id="home-q" placeholder="Search a locality, project, MLA, corporator or company" aria-label="Search" autocomplete="off"></div><div class="search-results" id="home-results" hidden></div></div><div class="hero-acts">' + locateBtn() + myAreaLink() + '</div></div>' +
      '<dl class="hero-figs"><div><dt>Projects tracked</dt><dd>' + PROJECTS.length + "<small>worth " + crore(total) + '</small></dd></div><div class="alert"><dt>Delayed or stalled</dt><dd>' + late.length + "<small>" + Math.round(100 * late.length / PROJECTS.length) + "% of all</small></dd></div><div><dt>Added by cost overruns</dt><dd>" + Math.round(overAmt / 1000).toLocaleString("en-IN") + "k<small>crore across " + over.length + " projects</small></dd></div></dl></section>" +
      exploreTiles({ late: late.length }) +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Latest</div><h3>Recently reported</h3>' + (PREV_VISIT ? '<p class="axis-note" style="margin:4px 0 0">' + plural(feedItems().filter(function (x) { return String(x.date) > PREV_VISIT; }).length, "update") + " dated after your last visit on " + esc(fmtDate(PREV_VISIT)) + "</p>" : "") + '</div><a class="btn" href="#latest">All updates</a></div>' + feedList(feedItems().slice(0, 6)) + "</section>" +

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
    mountSearch(document.getElementById("home-q"), document.getElementById("home-results"));
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
      '<div class="top"><span class="eyebrow sector">' + sectorIcon(p.sector) + esc(p.sector) + "</span>" + pill(p.status) + "</div>" +
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
      '<div class="panel"><div class="eyebrow" style="margin-bottom:8px">Show</div><div class="legend" id="map-status"></div>' +
      (AQI.stations.length ? '<div class="legend" style="margin-top:8px"><button type="button" class="chip" id="aq-toggle" aria-pressed="false"><span class="swatch" style="background:#92d050;border-radius:50%"></span>Air quality stations</button></div>' : "") +
      (CONS.sites.length ? '<div class="legend" style="margin-top:8px"><button type="button" class="chip" id="cs-toggle" aria-pressed="false"><span class="swatch" style="background:#7b4fc9;border-radius:50%"></span>Construction sites (' + CONS.sites.length + ')</button></div>' : "") +
      (EWARD_GEO.length ? '<div class="legend" style="margin-top:8px"><button type="button" class="chip" id="ew-toggle" aria-pressed="false"><span class="swatch" style="background:transparent;border:2px dashed var(--accent)"></span>Corporator wards (227)</button></div>' : "") + '</div>' +
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
    var aqLayer = null, aqBtn = document.getElementById("aq-toggle");
    if (aqBtn) aqBtn.addEventListener("click", function () {
      var on = aqBtn.getAttribute("aria-pressed") !== "true";
      aqBtn.setAttribute("aria-pressed", String(on));
      if (aqLayer) { leafletMap.removeLayer(aqLayer); aqLayer = null; }
      if (!on) return;
      aqLayer = L.layerGroup(AQI.stations.map(function (st) {
        return L.circleMarker([st.lat, st.lng], { radius: 11, color: "#fff", weight: 2, fillColor: AQI_COLORS[st.category], fillOpacity: 1 })
          .bindTooltip(String(st.aqi), { permanent: true, direction: "center", className: "aqi-label" })
          .bindPopup("<b>" + esc(stationName(st)) + "</b><br>AQI " + aqiBadge(st) + "<br>PM2.5 " + (st.pm25 != null ? st.pm25 : "—") + " · PM10 " + (st.pm10 != null ? st.pm10 : "—") + " µg/m³<br><span style=\"color:" + ink3 + "\">24-hour average · " + esc(fmtDT((AQI.fetchedAt || "").replace("Z", ""))) + " UTC</span>");
      })).addTo(leafletMap);
    });
    var csLayer = null, csBtn = document.getElementById("cs-toggle");
    if (csBtn) csBtn.addEventListener("click", function () {
      var on = csBtn.getAttribute("aria-pressed") !== "true";
      csBtn.setAttribute("aria-pressed", String(on));
      if (csLayer) { leafletMap.removeLayer(csLayer); csLayer = null; }
      if (!on) return;
      csLayer = L.layerGroup(CONS.sites.map(function (x) {
        var st = consStale(x);
        return L.circleMarker([x.lat, x.lng], { radius: 5, color: "#fff", weight: 1, fillColor: st ? "#b3bcc3" : "#7b4fc9", fillOpacity: 0.95 })
          .bindPopup("<b>" + esc(x.name || (x.kind ? x.kind + " building site" : "Construction site")) + "</b><br>" + (st ? "May be finished: map not updated since " : "Under construction · map updated ") + esc(fmtMonth(x.lastEdited)) + "<br>Ward " + esc(x.ward) + ' · <a href="' + consOsm(x) + '" target="_blank" rel="noopener">OpenStreetMap ↗</a>');
      })).addTo(leafletMap);
      leafletMap.attributionControl.addAttribution("Construction: © OpenStreetMap contributors");
    });
    var ewLayer = null, ewBtn = document.getElementById("ew-toggle");
    if (ewBtn) ewBtn.addEventListener("click", function () {
      var on = ewBtn.getAttribute("aria-pressed") !== "true";
      ewBtn.setAttribute("aria-pressed", String(on));
      if (ewLayer) { leafletMap.removeLayer(ewLayer); ewLayer = null; }
      if (!on) return;
      ewLayer = L.geoJSON({ type: "FeatureCollection", features: EWARD_GEO }, {
        style: function () { return { color: accent, weight: 1, dashArray: "4 3", fill: true, fillOpacity: 0 }; },
        onEachFeature: function (f, layer) {
          var c = CORP_BY_WARD[f.properties.ward] || {};
          layer.bindTooltip("Ward " + f.properties.ward + (c.name ? ": " + c.name : ""), { sticky: true });
          layer.bindPopup("<b>Electoral ward " + esc(f.properties.ward) + "</b>" + (c.area ? "<br>" + esc(c.area) : "") + "<br>Corporator: " + corpLine(c));
        },
      }).addTo(leafletMap);
    });

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
      '<section class="panel" id="ward-detail"></section></div><section class="panel" id="ward-compare"></section>';
    mountWardTable(document.getElementById("ward-compare"));
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
      "</div>" +
      '<div class="ward-shape">' + wardShape(w, s.ps) + "</div></div>" + wardScorecard(w) +
      '<div class="people"><div class="person"><div class="role">Ward officer</div><div class="name">' + esc(info.assistantCommissioner || "Not on file") + unconfirmed + '</div><div class="detail">Assistant Commissioner' + (info.asOf ? ", as of " + fmtDate(info.asOf) : "") + "</div></div>" +
      '<div class="person"><div class="role">Zone ' + esc(info.zone || "") + " deputy commissioner</div>" + '<div class="name">' + esc(info.zonalDmc || "Not on file") + '</div><div class="detail">Oversees the zone’s wards</div></div></div>' +
      (info.office ? '<p class="muted" style="font-size:.85rem;margin:10px 0 0">Ward office: ' + esc(info.office) + (info.phone ? ' · <span class="tnum">' + esc(info.phone) + "</span>" : "") + "</p>" : "") +
      (info.note ? '<div class="note">' + esc(info.note) + "</div>" : "") +
      (function () {
        var cs = CORP.corporators.filter(function (c) { return c.adminWard === w || WARD_PARENT[c.adminWard] === w; });
        if (!cs.length) return "";
        return '<details style="margin-top:16px"><summary>' + plural(cs.length, "corporator") + " elected for this ward (2026)</summary>" + '<div class="table-scroll"><table class="data"><tbody>' + cs.map(function (c) {
          var n = PROJECTS.filter(function (p) { return CORP_PARTS[p.id] && CORP_PARTS[p.id][c.ward]; }).length;
          return '<tr><td class="muted" style="width:1%;white-space:nowrap">Ward ' + esc(c.ward) + "</td><td>" + corpLine(c) + '<div class="sub">' + esc(c.area || "") + (c.vacant ? " · " + esc(c.statusNote) : "") + '</div></td><td class="sub" style="white-space:nowrap">' + (n ? plural(n, "project") : "") + "</td></tr>";
        }).join("") + "</tbody></table></div></details>";
      })() +
      '<div class="section-head" style="margin-top:22px"><div><h3>Projects with a part in this ward</h3><p>' + (value ? "Combined project value " + crore(value) + " (whole projects, not just this ward’s share)" : "") + "</p></div></div>" +
      (s.ps.length ? '<div class="table-scroll"><table class="data"><thead><tr><th>Project and the part here</th><th>Status</th><th>Run by</th></tr></thead><tbody>' + s.ps.sort(function (a, b) { return STATUS_RANK[a.status] - STATUS_RANK[b.status]; }).map(function (p) {
        var hs = headsFor(p);
        return '<tr class="click" data-open="' + esc(p.id) + '" tabindex="0"><td><b>' + esc(p.shortName || p.name) + '</b><div class="sub">' + esc(WARD_PARTS[p.id][w].join(", ")) + "</div></td><td>" + pill(p.status) + "</td><td>" + esc(p.agency) + (hs.length ? '<div class="sub">' + esc(hs.map(function (h) { return h.name; }).join(", ")) + "</div>" : "") + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="muted">No mapped projects in this ward yet.</p>') +
      '<div class="section-head" style="margin-top:22px"><div><h3>Open tenders</h3><p>Works the ward and BMC departments have put out to bid right now.</p></div>' + (s.tenders.length ? '<a href="#tenders" data-tw="' + esc(w) + '" class="btn">All tenders for this ward</a>' : "") + "</div>" +
      (s.tenders.length ? '<ul class="tenders">' + s.tenders.slice(0, 8).map(function (t) {
        return '<li><a href="#t-' + tenderSlug(t.id) + '">' + esc(t.title) + '</a><span class="closes">closes ' + esc(fmtDT(t.closing)) + '</span><span class="meta">' + esc(t.dept || t.org) + (t.ward !== w ? " · ward " + esc(t.ward) : "") + ' · <span class="mono">' + esc(t.id) + "</span></span></li>";
      }).join("") + "</ul>" + (s.tenders.length > 8 ? '<p class="axis-note">+' + (s.tenders.length - 8) + " more on the Tenders tab</p>" : "") : '<p class="muted">No open tenders tagged to this ward today.</p>') +
      (function () { var ws = CONS.sites.filter(function (x) { return x.ward === w; }); if (!CONS.sites.length) return "";
        var live = ws.filter(function (x) { return !consStale(x); });
        return '<div class="section-head" style="margin-top:22px"><div><h3>Construction sites</h3><p>' + plural(ws.length, "site") + ' mapped in this ward, ' + live.length + ' updated in the last 18 months. Most recently updated first.</p></div></div>' +
          (ws.length ? consRows(ws.slice(0, 12), false) + (ws.length > 12 ? '<p class="axis-note">+' + (ws.length - 12) + ' more on the Map tab</p>' : "") : '<p class="muted">None mapped.</p>') + consNote(); })() +
      complaintsBlock(w) + floodBlock(w) + facilitiesPanel(w) + sraPanel(w) +
      '<p class="axis-note" style="margin-top:18px">Also in every ward: ' + citywide.map(function (p) { return '<a href="#p-' + esc(p.id) + '">' + esc(p.shortName || p.name) + "</a>"; }).join(", ") + ".</p>";
    var wf = WARD_FEATURE[w];
    if (wf && AQI.stations.length) {
      var ring = wf.geometry.coordinates.reduce(function (a, p) { return p[0].length > a.length ? p[0] : a; }, []);
      var cx = 0, cy = 0; ring.forEach(function (c) { cx += c[0]; cy += c[1]; });
      box.insertAdjacentHTML("beforeend", '<div style="margin-top:18px">' + aqiCard(cy / ring.length, cx / ring.length).replace('class="panel"', 'class="panel" style="box-shadow:none"') + "</div>");
    }
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
      (list.length ? '<div class="table-scroll"><table class="data"><thead><tr><th>Work</th><th>Body and department</th><th>Ward</th><th class="num">Estimated value</th><th>Closes</th></tr></thead><tbody>' + shown.map(function (t) {
        return '<tr class="click" data-tender="' + esc(tenderSlug(t.id)) + '" tabindex="0"><td><b>' + esc(t.title) + '</b><div class="sub"><span class="mono">' + esc(t.id) + "</span>" + (t.ref ? " · " + esc(t.ref) : "") + " · published " + esc(fmtDT(t.published)) + (t.status === "Closed" ? " · closed, last seen " + fmtDate(t.lastSeen) : "") + "</div></td><td>" + esc(t.org) + '<div class="sub">' + esc(t.unit || "") + "</div></td><td>" + (t.ward ? wcode(t.ward) : '<span class="muted">—</span>') + '</td><td class="num" style="text-align:left">' + esc(fmtDT(t.closing)) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<div class="empty">No tenders match.</div>') +
      (list.length > shown.length ? '<div class="more"><button type="button" class="btn" id="t-more">Show more</button></div>' : "");
    var more = document.getElementById("t-more"); if (more) more.addEventListener("click", function () { tlimit += 60; renderTenders(); });
    bindClicks(box, "[data-tender]", function (el) { go("#t-" + el.dataset.tender); });
  }

  // ---------------------------------------------------------------- MLAs
  var mq = "";
  function viewMlas() {
    app.innerHTML = '<section class="lead"><div class="eyebrow">Elected representatives</div><h2>Your MLA, and the projects in their constituency</h2><p>All 36 Mumbai assembly seats from the November 2024 election. An MLA represents the area and can raise a project in the Assembly; the implementing agency is responsible for delivering it.</p></section>' +
      (OFFICIALS.length ? '<section class="panel"><div class="section-head"><div><div class="eyebrow">Accountable at the top</div><h3>Who oversees the big projects</h3></div></div><div class="people" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr));margin:0">' +
        OFFICIALS.map(function (o) { return '<div class="person"><div class="role">' + esc(o.role) + '</div><div class="name">' + esc(o.name) + "</div></div>"; }).join("") + "</div></section>" : "") +
      ((CORP.office || []).length ? '<section class="panel"><div class="section-head"><div><div class="eyebrow">BMC, elected February 2026</div><h3>Who runs the corporation</h3></div><p>' + esc(CORP.corporators.filter(function (c) { return !c.vacant; }).length) + " sitting corporators across 227 wards; open a ward on the Wards tab to see its corporators.</p></div>" + '<div class="people" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr));margin:0">' +
        CORP.office.map(function (o) { return '<div class="person"><div class="role">' + esc(o.role) + '</div><div class="name">' + esc(o.name) + '</div><div class="detail">' + esc(o.party) + (o.ward ? " · ward " + esc(o.ward) : "") + "</div></div>"; }).join("") + "</div></section>" : "") +
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
  function casePill(k) {
    var red = /^(Conviction|Chargesheet|Arrest)$/i, green = /acquittal|discharge|quashed|set aside|dismissed/i;
    var col = red.test(k) ? "--st-stalled" : green.test(k) ? "--st-completed" : "--st-delayed";
    return '<span class="pill" style="color:var(' + col + ')">' + esc(k) + "</span>";
  }
  function kindPill(k) {
    var c = KINDS[k] || KINDS.Allegation;
    return '<span class="pill" style="color:var(' + c.sev + ')" data-tip="' + esc(c.note) + '">' + esc(k) + "</span>";
  }
  function srcLinks(list) {
    return (list || []).filter(function (s) { return s && safeUrl(s.url); }).map(function (s) {
      return '<a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener"' + (s.language && s.language !== "en" ? ' lang="' + esc(s.language) + '"' : "") + ">" + esc(s.title || s.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) + "</a>" + (s.language === "mr" ? ' <span class="muted">(Marathi)</span>' : s.language === "hi" ? ' <span class="muted">(Hindi)</span>' : "") + (s.date ? ' <span class="muted">' + esc(fmtDate(s.date)) + "</span>" : "");
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
      (function () {
        var oc = {}; all.forEach(function (x) { var o = x.k.outcome || "Not reported"; oc[o] = (oc[o] || 0) + 1; });
        var col = { "Completed": "var(--st-completed)", "Completed on time": "var(--st-completed)", "Completed late": "var(--st-partial)", "Ongoing": "var(--st-progress)", "Ongoing, delayed": "var(--st-delayed)", "Not started": "var(--st-notstarted)", "Terminated": "var(--st-stalled)" };
        return '<section class="panel"><div class="section-head"><div><div class="eyebrow">Outcomes</div><h3>How the listed contracts turned out</h3></div><p>Status of each contract as reported, across all ' + all.length + ' contracts.</p></div>' +
          hbars(Object.keys(oc).sort(function (a, b) { return oc[b] - oc[a]; }).map(function (k) { return { label: k, value: oc[k], display: plural(oc[k], "contract"), color: col[k] || "var(--ink-3)" }; })) + "</section>";
      })() +
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
      recordSection(((prof.work || []).map(function (w) { return { date: w.date, category: itemCategory(w, false), text: w.what, source: w.source, verified: w.verified, projectId: w.projectId }; }))
        .concat((prof.news || []).map(function (n) { return { date: n.date, category: itemCategory(n, true), text: n.headline, source: n.source, verified: n.verified }; }))
        .concat(((aff || {}).laterCases || []).map(function (c) { return { date: c.date, category: "Legal matter", text: c.kind + ": " + c.summary, source: (c.sources || [])[0], verified: c.verified }; })),
        { note: "Work and news were searched the same way for every MLA, in English and Marathi papers, and each item was re-checked against its source." }) +
      electionBlock(m) +
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
        ((aff.caseList || []).length || (aff.convictionList || []).length ? '<h4 style="margin:16px 0 8px">Each case, as declared</h4><div class="table-scroll"><table class="data cases"><thead><tr><th>FIR / case</th><th>Court</th><th>Law and sections</th><th>Charges framed</th></tr></thead><tbody>' +
          (aff.convictionList || []).map(function (c) {
            return '<tr><td><span class="pill" style="color:var(--st-stalled)">Conviction</span><div style="margin-top:4px">' + esc(c.caseNo || "—") + "</div></td><td>" + esc(c.court || "—") + (c.convictedOn ? '<div class="sub">Convicted ' + esc(c.convictedOn) + (c.punishment ? "; " + esc(c.punishment) : "") + "</div>" : "") + "</td><td>" + esc([c.law, c.sections].filter(Boolean).join(" ")) + (c.other ? '<div class="sub">' + esc(c.other) + "</div>" : "") + "</td><td>" + (c.appeal === "Yes" ? '<span class="sub">Appeal: ' + esc(c.appealStatus || "filed") + "</span>" : "—") + "</td></tr>";
          }).join("") +
          (aff.caseList || []).map(function (c) {
            return "<tr><td>" + esc(c.fir || "—") + (c.caseNo ? '<div class="sub">' + esc(c.caseNo) + "</div>" : "") + "</td><td>" + esc(c.court || "—") + "</td><td>" + esc([c.law, c.sections].filter(Boolean).join(" ") || "—") + (c.other ? '<div class="sub">' + esc(c.other) + "</div>" : "") + "</td><td>" + esc(c.chargesFramed || "—") + (c.chargesFramedOn ? '<div class="sub">' + esc(c.chargesFramedOn) + "</div>" : "") + (c.appeal === "Yes" ? '<div class="sub">Appeal: ' + esc(c.appealStatus || "filed") + "</div>" : "") + "</td></tr>";
          }).join("") + '</tbody></table></div><p class="axis-note">Copied from the sworn affidavit as compiled by ADR. Entries in the first column read as the candidate wrote them. A pending case is an accusation a court has not decided.</p>' : "") +
        (aff.laterChecked ? '<h4 style="margin:16px 0 8px">Since the election</h4>' + ((aff.laterCases || []).length ? '<ol class="events">' + aff.laterCases.slice().sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }).map(function (c) {
          return '<li><div class="ev-head">' + casePill(c.kind) + '<span class="ev-date">' + esc(fmtDate(c.date)) + "</span>" + (c.status ? '<span class="muted">· ' + esc(c.status) + "</span>" : "") + "</div><div>" + esc(c.summary) + '</div><div class="sub">' + srcLinks(c.sources) + (c.verified ? " · source re-checked " + esc(fmtDate(c.verified)) : "") + "</div></li>";
        }).join("") + "</ol>" : '<p class="muted" style="margin:0;font-size:.9rem">None found.</p>') +
          '<p class="axis-note">Legal matters involving the MLA personally since 23 Nov 2024 (FIRs naming them, chargesheets, court orders, acquittals, election petitions), searched the same way for all 36 MLAs and re-checked on ' + esc(fmtDate(aff.laterChecked)) + ". An FIR is an accusation, not a finding.</p>"
          : '<p class="axis-note">Cases filed after the November 2024 election are not yet covered here.</p>')
        : '<p class="muted" style="margin:0">Affidavit data not loaded.</p>') + "</section></div>" +
      (function () {
        var WAC = window.PUBLIC_WORKS_WARD_AC || {};
        var cs = CORP.corporators.map(function (c) { var x = (WAC[c.ward] || []).find(function (y) { return y[0] === m.constituency; }); return x ? { c: c, share: x[1] } : null; }).filter(Boolean).sort(function (a, b) { return b.share - a.share; });
        if (!cs.length) return "";
        return '<section class="panel"><div class="section-head"><div><div class="eyebrow">Corporators</div><h3>' + plural(cs.length, "BMC ward") + " in " + esc(m.constituency) + '</h3></div><p>From BMC\u2019s 2026 voter rolls. A ward partly in this constituency shows the share of its voters that live here.</p></div><div class="people people-4">' +
          cs.map(function (x) { return '<a class="person" style="text-decoration:none;color:inherit" href="#cor-' + esc(x.c.ward) + '"><div class="role">Ward ' + esc(x.c.ward) + (x.share < 99 ? " · " + x.share + "% here" : "") + '</div><div class="name">' + (x.c.vacant ? "Vacant" : esc(x.c.name)) + '</div><div class="detail">' + esc(x.c.party) + (x.c.area ? " · " + esc(x.c.area) : "") + "</div></a>"; }).join("") + "</div></section>";
      })() +
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
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Largest funders</div><h3>Top 10 by disclosed amount</h3></div></div>' +
      hbars(funders.filter(function (f) { return f.amount; }).slice(0, 10).map(function (f) { return { label: f.name, value: f.amount, display: crore(f.amount), color: fundColor(f.type), tip: "<b>" + esc(f.name) + "</b><br>" + esc(f.type) + " · " + plural(f.projects.length, "project") + (f.unknown ? " (" + f.unknown + " undisclosed)" : "") }; }), { note: "Only commitments with a published figure. Colour shows the type of funder." }) + "</section>" +
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
      '<section class="panel disclose"><h3 class="eyebrow" style="margin:0 0 10px">How this was compiled</h3><p style="margin:0 0 8px">This portal was compiled with AI assistance from public sources: official documents, court and audit records, and reputable newspapers. No number is estimated; where a figure is not published, it says so. Every item links to its source.</p><p style="margin:0 0 8px">Each fact was collected by one reviewer and then re-checked against its sources by a second, independent reviewer, who confirmed, corrected or removed it. Items show the date they were re-checked and how strong their evidence is: <b>official source</b>, <b>two or more outlets</b>, or a <b>single report</b>.</p><p style="margin:0">Mistakes are still possible. If you find one, use “Suggest a correction” on any page with a source link; every change is listed below under “Changes and corrections”.</p></section>' +
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
      freshnessPanel(false) + historyLog() +
      '<section class="panel" id="glossary"><h3 class="eyebrow" style="margin:0 0 10px">What the words mean</h3><dl class="facts-list">' + Object.keys(GLOSS).map(function (k) { return "<dt>" + esc(k) + "</dt><dd>" + esc(GLOSS[k]) + "</dd>"; }).join("") + "</dl></section>" +
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
      evidenceBadge(p) +
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
        return '<a class="person" style="text-decoration:none;color:inherit" href="#mla-' + esc(m.no) + '"><div class="name">' + esc(m.name || "MLA not on file") + '</div><div class="detail">' + esc(m.constituency) + (m.party ? " · " + esc(m.party) : "") + " · profile →</div></a>";
      }).join("") + "</div>" : '<p class="muted" style="margin:0">' + (p.citywide ? "Citywide project: every MLA’s area." : "Not mapped to a constituency.") + "</p>") + "</section>" +
      (Object.keys(CORP_PARTS[p.id] || {}).length ? '<section class="panel"><h3>Local corporators</h3><p class="axis-note" style="margin:-4px 0 10px">BMC electoral wards (2026) the project\u2019s sites fall in. A site within 150 m of a ward edge lists both wards.</p><div class="table-scroll"><table class="data"><tbody>' +
        Object.keys(CORP_PARTS[p.id]).sort(function (a, b) { return a - b; }).map(function (n) { var c = CORP_BY_WARD[n]; return '<tr><td style="width:1%;white-space:nowrap" class="muted">Ward ' + esc(n) + "</td><td>" + corpLine(c) + (c && c.area ? '<div class="sub">' + esc(c.area) + "</div>" : "") + '</td><td class="sub">' + esc(uniq(CORP_PARTS[p.id][n]).join(", ")) + "</td></tr>"; }).join("") +
        "</tbody></table></div></section>" : "") +
      (auditItems(function (f) { return f.projectId === p.id; }).length ? '<section class="panel"><h3>Audit findings</h3>' + auditList(auditItems(function (f) { return f.projectId === p.id; })) + '<p class="axis-note">An audit finding is the auditor’s observation, not a criminal finding.</p></section>' : "") +
      '<section class="panel"><h3>Change history</h3>' + histList((HIST.projects || {})[p.id], "No change to status, cost, deadlines or progress since it was added.") + "</section>" +
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
    if (/^#(p|t)-/.test(location.hash)) {
      if (history.length > 1 && lastHash) history.replaceState(null, "", lastHash);
      else location.hash = lastHash;
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  overlay.addEventListener("click", function (e) {
    closeDrawer();
    // A click that landed on the header (e.g. the search box) under the overlay goes through.
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el.closest && el.closest("header.site")) { if (el.id === "site-q") el.focus(); else if (el.click) el.click(); }
  });
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

  // ---------------------------------------------------------------- air quality (official stations)
  var AQI = window.PUBLIC_WORKS_AQI || { stations: [] };
  // CPCB National AQI colours; always shown with the category name.
  var AQI_COLORS = { "Good": "#00b050", "Satisfactory": "#92d050", "Moderate": "#e6c700", "Poor": "#ff9900", "Very poor": "#ff0000", "Severe": "#c00000" };
  function kmBetween(a, b, c, d) { var kx = 111.32 * Math.cos(a * Math.PI / 180); return Math.hypot((d - b) * kx, (c - a) * 110.57); }
  function nearestStations(lat, lng, n) {
    return AQI.stations.map(function (s) { return { s: s, km: kmBetween(lat, lng, s.lat, s.lng) }; })
      .sort(function (x, y) { return x.km - y.km; }).slice(0, n || 2);
  }
  function stationName(s) { return s.name.replace(/, Mumbai.*$/, "").replace(/_/g, " "); }
  function aqiBadge(s) {
    return '<span class="aqi-badge"><span class="aqi-dot" style="background:' + AQI_COLORS[s.category] + '"></span><b>' + s.aqi + "</b> " + esc(s.category) + "</span>";
  }
  function aqiCard(lat, lng) {
    if (!AQI.stations.length) return "";
    var near = nearestStations(lat, lng, 2);
    return '<section class="panel"><div class="section-head"><div><div class="eyebrow">Air quality now</div><h3>Nearest official monitoring stations</h3></div><p>AQI on the CPCB scale from the last 24 hours of PM2.5 and PM10.</p></div>' +
      '<div class="aqi-list">' + near.map(function (x) {
        return '<div class="aqi-row"><div><b>' + esc(stationName(x.s)) + '</b><div class="sub">' + esc(x.km.toFixed(1)) + " km away · " + esc((x.s.name.match(/- (\w+)$/) || [])[1] || "") + "</div></div>" + aqiBadge(x.s) +
          '<div class="sub" style="grid-column:1/-1">PM2.5 ' + (x.s.pm25 != null ? x.s.pm25 + " µg/m³" : "—") + " · PM10 " + (x.s.pm10 != null ? x.s.pm10 + " µg/m³" : "—") + " · driven by " + esc(x.s.driver === "pm25" ? "PM2.5" : "PM10") + "</div></div>";
      }).join("") + '</div><p class="axis-note">Updated ' + esc(fmtDT((AQI.fetchedAt || "").replace("Z", ""))) + " UTC. " + esc(AQI.source || "") + '. <a href="' + esc(safeUrl(AQI.sourceUrl)) + '" target="_blank" rel="noopener">Live readings</a></p></section>';
  }

  // ---------------------------------------------------------------- places: everything we can locate by name
  var PLACES = [];
  (function buildPlaces() {
    var seen = {};
    function add(name, lat, lng, kind) {
      if (!name || lat == null) return;
      var key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      PLACES.push({ name: name, lat: lat, lng: lng, kind: kind });
    }
    function centroid(geom) {
      var ring = geom.coordinates.reduce(function (a, p) { return p[0].length > a.length ? p[0] : a; }, []);
      var x = 0, y = 0; ring.forEach(function (c) { x += c[0]; y += c[1]; });
      return [y / ring.length, x / ring.length];
    }
    EWARD_GEO.forEach(function (f) {
      var c = CORP_BY_WARD[f.properties.ward]; if (!c || !c.area) return;
      var ce = centroid(f.geometry);
      c.area.split(/\s*[-,\/]\s*|\s+and\s+/i).forEach(function (part) { if (part.length > 2) add(part.trim(), ce[0], ce[1], "Locality"); });
    });
    PROJECTS.forEach(function (p) { (ROUTES[p.id] || []).forEach(function (path) { path.forEach(function (pt) { if (!/\(/.test(pt[2])) add(pt[2], pt[0], pt[1], "Landmark"); }); }); });
    AQI.stations.forEach(function (s) { add(stationName(s), s.lat, s.lng, "Locality"); });
  })();
  function placeSlug(lat, lng) { return "at-" + Math.round(lat * 10000) + "-" + Math.round(lng * 10000); }

  // ---------------------------------------------------------------- global search
  var searchIndex = null;
  function buildIndex() {
    var items = [];
    PLACES.forEach(function (pl) { items.push({ group: "Areas", label: pl.name, sub: pl.kind, href: "#" + placeSlug(pl.lat, pl.lng) + "-" + slug(pl.name), hay: pl.name }); });
    PROJECTS.forEach(function (p) { items.push({ group: "Projects", label: p.shortName || p.name, sub: p.agency + " · " + p.status, href: "#p-" + p.id, hay: [p.name, p.shortName, p.agency, p.id, p.sector, (p.areas || []).join(" ")].join(" ") }); });
    (window.PUBLIC_WORKS_MPS || { mps: [] }).mps.forEach(function (m) { items.push({ group: "Representatives", label: m.name, sub: "MP · " + m.constituency + " · " + m.party, href: "#" + m.id, hay: m.name + " " + m.nameOnAffidavit + " MP " + m.constituency + " " + m.segments.join(" ") }); });
    MLAS.forEach(function (m) { items.push({ group: "Representatives", label: m.name, sub: "MLA · " + m.constituency + " · " + m.party, href: "#mla-" + m.no, hay: m.name + " MLA " + m.constituency + " " + m.party }); });
    CORP.corporators.forEach(function (c) { items.push({ group: "Representatives", label: c.vacant ? "Ward " + c.ward + " (vacant)" : c.name, sub: "Corporator · ward " + c.ward + " · " + (c.area || "") + " · " + c.party, href: "#cor-" + c.ward, hay: c.name + " corporator " + (c.area || "") + " ward " + c.ward + " " + c.party }); });
    WARD_NAMES.forEach(function (w) { var i = WARD_INFO[w] || {}; items.push({ group: "BMC wards", label: wardTitle(w), sub: (i.localities || []).slice(0, 4).join(", "), href: "#ward-" + wardSlug(w), hay: wardTitle(w) + " " + w + " " + (i.localities || []).join(" ") + " " + (i.assistantCommissioner || "") }); });
    CONTRACTS.companies.forEach(function (c) { items.push({ group: "Companies", label: c.name, sub: plural((c.mumbaiContracts || []).length, "Mumbai contract"), href: "#co-" + c.slug, hay: [c.name].concat(c.aliases || []).join(" ") }); });
    YOJANAS.forEach(function (y) { items.push({ group: "Schemes", label: y.name, sub: y.level, href: "#schemes", hay: y.name + " " + (y.nameLocal || "") }); });
    items.forEach(function (it) { it.h = it.hay.toLowerCase(); });
    return items;
  }
  function searchAll(q) {
    searchIndex = searchIndex || buildIndex();
    q = q.toLowerCase().trim(); if (!q) return [];
    var terms = q.split(/\s+/);
    if (/^\d{4}_[a-z0-9]+_\d+/i.test(q) || /^2\d{3}_/.test(q)) {
      var t = TENDERS.items.find(function (x) { return x.id.toLowerCase() === q; });
      if (t) return [{ group: "Tenders", label: t.title, sub: t.id, href: "#t-" + tenderSlug(t.id) }];
    }
    var hits = searchIndex.filter(function (it) { return terms.every(function (x) { return it.h.indexOf(x) !== -1; }); });
    function rank(it) {
      var l = it.label.toLowerCase();
      if (l === q) return 0;
      if (l.indexOf(q) === 0) return 1;
      if ((" " + it.h + " ").indexOf(" " + q + " ") !== -1) return 1.5;
      if ((" " + l).indexOf(" " + q) !== -1) return 2;
      if (l.indexOf(q) !== -1) return 3;
      if ((" " + it.h).indexOf(" " + q) !== -1) return 4;
      return 5;
    }
    var ORDER = ["Projects", "Representatives", "Areas", "BMC wards", "Companies", "Schemes", "Tenders"];
    hits.forEach(function (it) { it.score = rank(it); });
    var groups = {};
    hits.forEach(function (h) { (groups[h.group] = groups[h.group] || []).push(h); });
    var keys = Object.keys(groups).map(function (g) {
      groups[g].sort(function (a, b) { return a.score - b.score || a.label.length - b.label.length; });
      return { g: g, best: groups[g][0].score, pri: ORDER.indexOf(g) };
    }).sort(function (a, b) { return a.best - b.best || a.pri - b.pri; });
    var out = [];
    keys.forEach(function (k) { out = out.concat(groups[k.g].slice(0, k.g === "Representatives" ? 6 : 5)); });
    return out.slice(0, 24);
  }
  function mountSearch(input, box, onPick) {
    var active = -1, results = [];
    function render() {
      if (!results.length) { box.hidden = !input.value.trim(); box.innerHTML = input.value.trim() ? '<div class="sr-empty">Nothing found. Try a locality, project, MLA or ward.</div>' : ""; return; }
      var html = "", g = null;
      results.forEach(function (r, i) {
        if (r.group !== g) { g = r.group; html += '<div class="sr-group">' + esc(g) + "</div>"; }
        html += '<a class="sr-item' + (i === active ? " on" : "") + '" href="' + esc(r.href) + '" data-i="' + i + '"><span>' + esc(r.label) + '</span><span class="sub">' + esc(r.sub || "") + "</span></a>";
      });
      box.innerHTML = html; box.hidden = false;
    }
    input.addEventListener("input", debounce(function () { results = searchAll(input.value); active = results.length ? 0 : -1; render(); }, 120));
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); render(); e.preventDefault(); }
      else if (e.key === "Enter" && results[active]) { location.hash = results[active].href; close(); e.preventDefault(); }
      else if (e.key === "Escape") { close(); input.blur(); }
    });
    box.addEventListener("click", function (e) { if (e.target.closest(".sr-item")) close(); });
    document.addEventListener("click", function (e) { if (!box.contains(e.target) && e.target !== input) box.hidden = true; });
    function close() { box.hidden = true; input.value = ""; results = []; if (onPick) onPick(); }
  }

  // ---------------------------------------------------------------- your area

  // ---------------------------------------------------------------- construction (OpenStreetMap)
  var CONS = window.PUBLIC_WORKS_CONSTRUCTION || { sites: [] };
  var CONS_STALE = (function () { var d = new Date((CONS.fetchedAt || "2026-01-01") + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 18); return d.toISOString().slice(0, 10); })();
  function consStale(x) { return !x.lastEdited || x.lastEdited < CONS_STALE; }
  function fmtMonth(iso) { var d = new Date(iso + "T00:00:00Z"); return d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" }); }
  function consOsm(x) { return "https://www.openstreetmap.org/" + x.id; }
  function consRows(list, withKm) {
    return '<ul class="cons' + (withKm ? "" : " nokm") + '">' + list.map(function (x) {
      var st = consStale(x);
      return '<li class="' + (st ? "stale" : "") + '">' + (withKm ? '<span class="km">' + (x.km < 0.1 ? "here" : x.km.toFixed(1) + " km") + "</span>" : "") +
        '<span class="cn"><a href="' + consOsm(x) + '" target="_blank" rel="noopener">' + esc(x.name || (x.kind ? x.kind + " building site" : "Unnamed construction site")) + "</a>" +
        '<span class="sub">' + (x.name && x.kind ? esc(x.kind) + " · " : "") + (x.operator ? esc(x.operator) + " · " : "") + (x.ward ? "ward " + esc(x.ward) + " · " : "") + "map last updated " + esc(x.lastEdited ? fmtMonth(x.lastEdited) : "unknown") + "</span></span>" +
        '<span class="cs">' + (st ? '<span class="pill p-unknown">May be finished</span>' : '<span class="pill p-construction">Under construction</span>') + "</span></li>";
    }).join("") + "</ul>";
  }
  function consNote() {
    return '<p class="axis-note">Sites volunteer mappers on <a href="' + esc(CONS.sourceUrl) + '" target="_blank" rel="noopener">OpenStreetMap</a> have tagged as under construction, fetched ' + esc(fmtMonth(CONS.fetchedAt)) + '. This is not an official permit list: some sites are not mapped, and a site whose map entry has not been updated for 18 months (before ' + esc(fmtMonth(CONS_STALE)) + ') may already be finished, so it is marked “May be finished”. Private projects are registered with <a href="https://maharera.maharashtra.gov.in" target="_blank" rel="noopener">MahaRERA</a>, which blocks access from outside India.</p>';
  }

  function viewArea(slugStr) {
    var m = slugStr.match(/^at-(\d+)-(\d+)(?:-(.*))?$/);
    if (!m) { viewAreaPicker(); return; }
    var lat = +m[1] / 10000, lng = +m[2] / 10000;
    var label = m[3] === "here" ? "Your location" : m[3] ? (PLACES.find(function (p) { return slug(p.name) === m[3]; }) || {}).name : null;
    var aw = wardAt(lat, lng), info = WARD_INFO[aw] || {};
    var ews = ewardsNear(lat, lng);
    var nearby = [];
    PROJECTS.forEach(function (p) {
      var best = Infinity, part = "";
      (ROUTES[p.id] || []).forEach(function (path) { path.forEach(function (pt) { var d = kmBetween(lat, lng, pt[0], pt[1]); if (d < best) { best = d; part = pt[2]; } }); });
      if (best <= 1.5) nearby.push({ p: p, km: best, part: part });
    });
    nearby.sort(function (a, b) { return a.km - b.km; });
    var tenders = aw ? OPEN_TENDERS.filter(function (t) { return tenderMapWard(t) === aw; }) : [];
    var WAC = window.PUBLIC_WORKS_WARD_AC || {};
    var acShare = {};
    ews.forEach(function (n) { (WAC[n] || []).forEach(function (x) { acShare[x[0]] = Math.max(acShare[x[0]] || 0, x[1]); }); });
    var mlaConst = Object.keys(acShare).filter(function (k) { return acShare[k] >= 5; }).sort(function (a, b) { return acShare[b] - acShare[a]; });
    var splitNote = mlaConst.length > 1;

    app.innerHTML = '<section class="lead"><div class="eyebrow">Your area' + (aw ? " · " + esc(wardTitle(aw)) : "") + (ews.length ? " · electoral ward " + esc(ews.join(", ")) : "") + '</div><h2>' + esc(label || "This spot") + '</h2><p>Who to ask, what is being built nearby, and the air you are breathing. <a href="#area">Pick another place</a></p></section>' +
      '<div class="people people-4">' +
      (ews.length ? ews.map(function (n) { var c = CORP_BY_WARD[n] || {}; return '<div class="person"><div class="role">' + gl("Corporator") + ' · ward ' + esc(n) + '</div><div class="name">' + (c.vacant ? "Seat vacant" : esc(c.name || "—")) + '</div><div class="detail">' + esc(c.vacant ? c.statusNote : (c.party || "") + (c.area ? " · " + c.area : "")) + "</div></div>"; }).join("") : "") +
      (mlaConst.length ? mlaConst.map(function (cn) { var mm = mlaByConst[cn] || {}; return '<a class="person" style="text-decoration:none;color:inherit" href="#mla-' + esc(mm.no) + '"><div class="role">' + gl("MLA") + ' · ' + esc(cn) + (splitNote ? " · " + acShare[cn] + "% of voters" : "") + '</div><div class="name">' + esc(mm.name || "—") + '</div><div class="detail">' + esc(mm.party || "") + " · profile →</div></a>"; }).join("")
        : '<a class="person" style="text-decoration:none;color:inherit" href="#mlas"><div class="role">MLA</div><div class="name" style="font-weight:500">Not mapped for this spot yet</div><div class="detail">Find your constituency on the MLAs tab →</div></a>') +
      (aw ? '<a class="person" style="text-decoration:none;color:inherit" href="#ward-' + wardSlug(aw) + '"><div class="role">' + gl("Ward officer") + ' · ' + esc(wardTitle(aw)) + '</div><div class="name">' + esc(info.assistantCommissioner || "Not on file") + '</div><div class="detail">' + esc(info.phone || "") + " · ward page →</div></a>" : "") +
      "</div>" +
      '<div class="grid-2">' + aqiCard(lat, lng) +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Out to bid</div><h3>' + plural(tenders.length, "open tender") + " in this ward</h3></div></div>" +
      (tenders.length ? '<ul class="tenders">' + tenders.slice(0, 6).map(function (t) { return '<li><a href="#t-' + tenderSlug(t.id) + '">' + esc(t.title) + '</a><span class="closes">closes ' + esc(fmtDT(t.closing)) + '</span><span class="meta">' + esc(t.dept || t.org) + "</span></li>"; }).join("") + "</ul>" : '<p class="muted" style="margin:0">None open today.</p>') + "</section></div>" +
      (aw && wardComplaints(aw) ? '<section class="panel">' + complaintsBlock(aw, true).replace('style="margin-top:22px"', 'style="margin-top:0"') + '<p class="axis-note" style="margin-top:4px"><a href="#ward-' + wardSlug(aw) + '">Full ward picture →</a></p></section>' : "") +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Within 1.5 km</div><h3>' + plural(nearby.length, "project") + ' near here</h3></div><p>Distance to the nearest station, site or junction of each project.</p></div>' +
      (nearby.length ? '<div class="table-scroll"><table class="data"><tbody>' + nearby.map(function (x) {
        return '<tr class="click" data-open="' + esc(x.p.id) + '" tabindex="0"><td class="num" style="width:1%">' + (x.km < 0.1 ? "here" : x.km.toFixed(1) + " km") + "</td><td><b>" + esc(x.p.shortName || x.p.name) + '</b><div class="sub">' + esc(x.part) + " · " + esc(x.p.agency) + "</div></td><td>" + pill(x.p.status) + '</td><td class="num">' + crore(cost(x.p)) + "</td></tr>";
      }).join("") + "</tbody></table></div>" : '<p class="muted" style="margin:0">No tracked projects within 1.5 km.</p>') + "</section>" +
      (function () {
        var near = CONS.sites.map(function (x) { return Object.assign({ km: kmBetween(lat, lng, x.lat, x.lng) }, x); }).filter(function (x) { return x.km <= 1; })
          .sort(function (a, b) { return (consStale(a) - consStale(b)) || a.km - b.km; });
        var live = near.filter(function (x) { return !consStale(x); }).length;
        return '<section class="panel"><div class="section-head"><div><div class="eyebrow">Within 1 km · public and private</div><h3>' + plural(near.length, "construction site") + ' mapped near here</h3></div><p>' + live + ' recently confirmed on the map, ' + (near.length - live) + ' not updated in 18 months.</p></div>' +
          (near.length ? consRows(near.slice(0, 15), true) + (near.length > 15 ? '<p class="axis-note">+' + (near.length - 15) + ' more on the Map tab</p>' : "") : '<p class="muted" style="margin:0">No construction sites mapped within 1 km.</p>') + consNote() + "</section>";
      })();
    bindClicks(app, "[data-open]", function (el) { go("#p-" + el.dataset.open); });
  }
  function viewAreaPicker() {
    var popular = ["Dadar", "Andheri", "Bandra", "Kurla", "Worli", "Borivali", "Ghatkopar", "Chembur", "Colaba", "Malad", "Mulund", "Powai", "Dharavi", "Goregaon", "Byculla", "Sion"];
    app.innerHTML = '<section class="lead"><div class="eyebrow">Your area</div><h2>What’s happening where you live?</h2><p>Type your locality to see your corporator and ward officer, projects within 1.5 km, open tenders and the air quality now.</p></section>' +
      '<section class="panel hero-search"><div class="field search">' + ICON_SEARCH + '<input type="search" id="area-q" placeholder="Your locality, e.g. Lalbaug, Chakala, Mahim" aria-label="Search for your locality" autocomplete="off"></div><div class="search-results" id="area-results" hidden></div>' +
      '<div class="locate-row">' + locateBtn() + '<span class="axis-note" style="margin:0">Your location is used only in your browser to find your ward. It is not sent or stored anywhere.</span></div>' +
      '<div class="chips" style="margin-top:12px">' + popular.map(function (n) {
        var pl = PLACES.find(function (p) { return p.name.toLowerCase().indexOf(n.toLowerCase()) === 0; });
        return pl ? '<a class="chip" href="#' + placeSlug(pl.lat, pl.lng) + "-" + slug(pl.name) + '">' + esc(n) + "</a>" : "";
      }).join("") + "</div></section>";
    var input = document.getElementById("area-q");
    mountSearch(input, document.getElementById("area-results"));
    input.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- tender detail
  function tenderSlug(id) { return id.replace(/_/g, "-"); }
  function openTender(slugId) {
    var t = TENDERS.items.find(function (x) { return tenderSlug(x.id) === slugId; });
    if (!t) { closeDrawer(); return; }
    lastFocus = document.activeElement;
    var d = t.detail || {}, by = d.invitedBy || {};
    function row(k, v) { return v == null || v === "" ? "" : "<dt>" + k + "</dt><dd>" + v + "</dd>"; }
    drawer.innerHTML = '<div class="d-head"><h2 id="drawer-title">' + esc(t.title) + '</h2><button type="button" class="close" id="close" aria-label="Close">×</button>' +
      '<div class="meta"><span class="pill" style="color:var(' + (t.status === "Open" ? "--st-progress" : "--st-notstarted") + ')">' + esc(t.status === "Open" ? "Open for bids" : "Closed") + "</span><span>" + esc(t.org) + "</span>" + (t.ward ? wcode(t.ward) : "") + "</div></div>" +
      '<div class="d-body">' +
      (d.description && d.description !== t.title ? '<p class="d-summary">' + esc(d.description) + "</p>" : "") +
      '<dl class="kv"><div><dt>Estimated value</dt><dd>' + (d.valueRs ? "₹" + Math.round(d.valueRs).toLocaleString("en-IN") : '<span class="muted" style="font-size:1rem">not disclosed</span>') + "<small>" + (d.valueRs ? "as published" : "BMC often withholds it on the portal") + "</small></dd></div>" +
      "<div><dt>Earnest money (" + gl("EMD") + ")</dt><dd>" + (d.emdRs ? "₹" + Math.round(d.emdRs).toLocaleString("en-IN") : "—") + "<small>deposit bidders pay</small></dd></div>" +
      "<div><dt>Closes</dt><dd>" + esc(fmtDate((t.closing || "").slice(0, 10))) + "<small>" + esc((t.closing || "").slice(11, 16)) + "</small></dd></div></dl>" +
      '<section class="panel"><h3>Who is putting it out</h3><dl class="facts-list">' + row("Body", esc(t.org)) + row("Department", esc(t.unit || t.dept || "")) +
      row("Issued by", by.name ? "<b>" + esc(by.name) + "</b>" + (by.address ? '<div class="sub">' + esc(by.address) + "</div>" : "") : null) + row("Ward officer", t.ward && WARD_INFO[tenderMapWard(t)] ? esc(WARD_INFO[tenderMapWard(t)].assistantCommissioner) : null) + "</dl></section>" +
      '<section class="panel"><h3>The work</h3><dl class="facts-list">' + row("Category", esc([d.category, d.productCategory].filter(Boolean).join(" · "))) + row("Location", esc([d.location, d.pincode].filter(Boolean).join(", "))) +
      row("Work period", d.periodDays ? esc(d.periodDays) + " days" : null) + row("Contract form", esc(d.formOfContract || "")) + row("Who may bid", d.bidderClass ? "Contractors registered in " + esc(d.bidderClass) : null) +
      row("Tender type", esc(d.type || "")) + row("Published", esc(fmtDT(t.published))) + row("Bids open", esc(fmtDT(d.bidOpening || t.opening))) + row("Reference", '<span class="mono">' + esc(t.ref || "") + "</span>") + row("Tender ID", '<span class="mono">' + esc(t.id) + "</span>") + "</dl></section>" +
      '<section class="panel"><h3>Who won, and for how much</h3><p style="margin:0 0 8px;font-size:.9rem">Not collected yet. The state portal publishes award results only behind a captcha, so they cannot be gathered automatically. To check this one: open <a href="' + esc(safeUrl(TENDERS.sourceUrl)) + '" target="_blank" rel="noopener">Mahatenders</a>, choose <b>Results of Tenders</b> and search Tender ID <span class="mono">' + esc(t.id) + "</span>.</p>" +
      '<p class="axis-note" style="margin:0">BMC contracts above ₹50 lakh also go to the Standing Committee, whose proposals state the estimate and the winning bid. Large awards appear on the Contracts tab.</p></section>' +
      '<p class="axis-note">Source: Mahatenders, Government of Maharashtra e-procurement. First seen ' + esc(fmtDate(t.firstSeen)) + ", last seen " + esc(fmtDate(t.lastSeen)) + ".</p></div>";
    drawer.classList.add("open"); overlay.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); drawer.scrollTop = 0;
    document.getElementById("close").addEventListener("click", closeDrawer);
    document.getElementById("close").focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- representatives: MLAs, corporators, MPs
  var MPS = (window.PUBLIC_WORKS_MPS || { mps: [] }).mps;
  var RECORDS = window.PUBLIC_WORKS_RECORDS || { people: {} }; // id -> { record: [...], searched, verified }
  var CATS = [
    { key: "Work for the area", css: "--st-completed" },
    { key: "Raised an issue", css: "--accent" },
    { key: "Recognition", css: "--st-partial" },
    { key: "Controversy", css: "--st-delayed" },
    { key: "Legal matter", css: "--st-stalled" },
    { key: "Politics", css: "--st-notstarted" },
  ];
  function catPill(c) { var x = CATS.find(function (k) { return k.key === c; }) || CATS[5]; return '<span class="pill" style="color:var(' + x.css + ')">' + esc(c) + "</span>"; }
  // Older MLA items predate categories: map their kind to the nearest category until reclassified.
  function itemCategory(it, isNews) {
    if (it.category) return it.category;
    if (!isNews) return /Raised|Demanded/.test(it.kind || "") ? "Raised an issue" : "Work for the area";
    return "Politics";
  }
  function recordSection(items, opts) {
    opts = opts || {};
    var id = "rec-" + Math.random().toString(36).slice(2, 8);
    var counts = {};
    items.forEach(function (it) { counts[it.category] = (counts[it.category] || 0) + 1; });
    var html = '<section class="panel"><div class="section-head"><div><div class="eyebrow">Public record</div><h3>What they have done, and what they are criticised for</h3></div><p>Each entry is one reported fact with its source, sorted by what it is, not by our opinion. Controversies state who alleged what.</p></div>';
    if (!items.length) return html + '<p class="muted" style="margin:0">' + esc(opts.empty || "Nothing found and checked yet.") + "</p></section>";
    html += '<div class="legend" id="' + id + '-f"><button type="button" class="chip" data-cat="" aria-pressed="true">All <b>' + items.length + "</b></button>" +
      CATS.filter(function (c) { return counts[c.key]; }).map(function (c) { return '<button type="button" class="chip" data-cat="' + esc(c.key) + '" aria-pressed="false"><span class="swatch" style="background:var(' + c.css + ')"></span>' + esc(c.key) + " <b>" + counts[c.key] + "</b></button>"; }).join("") + "</div>";
    html += '<ol class="events" id="' + id + '" style="margin-top:10px">' + items.slice().sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }).map(function (it) {
      return '<li data-c="' + esc(it.category) + '"><div class="ev-head">' + catPill(it.category) + '<span class="ev-date">' + esc(fmtDate(it.date)) + "</span></div><div>" + esc(it.text) + (it.projectId && PROJECTS.some(function (q) { return q.id === it.projectId; }) ? ' <a href="#p-' + esc(it.projectId) + '">project →</a>' : "") + '</div><div class="sub">' + srcLinks([it.source]) + (it.verified ? " · source re-checked " + esc(fmtDate(it.verified)) : "") + "</div></li>";
    }).join("") + "</ol>" + (opts.note ? '<p class="axis-note">' + opts.note + "</p>" : "") + "</section>";
    setTimeout(function () {
      var f = document.getElementById(id + "-f"); if (!f) return;
      bindClicks(f, "[data-cat]", function (el) {
        f.querySelectorAll("[data-cat]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === el)); });
        document.querySelectorAll("#" + id + " li").forEach(function (li) { li.hidden = !!el.dataset.cat && li.dataset.c !== el.dataset.cat; });
      });
    }, 0);
    return html;
  }
  function peopleRecord(id) {
    var r = (RECORDS.people || {})[id];
    return r ? (r.record || []).map(function (x) { return { date: x.date, category: x.category, text: x.what, source: x.source, verified: x.verified }; }) : null;
  }

  var repGroup = "mlas", repQ = "", repParty = "";
  function viewReps() {
    app.innerHTML = '<section class="lead"><div class="eyebrow">Your representatives</div><h2>Learn about the people you elect</h2><p>Who represents each part of Mumbai in the BMC, the state Assembly and Parliament: what they declared under oath, the work they have done, the issues they raise, and the controversies and legal matters reported about them. Everything links to its source.</p></section>' +
      ((CORP.office || []).length ? '<section class="panel"><div class="section-head"><div><div class="eyebrow">In charge</div><h3>City and state office-holders</h3></div></div><div class="people" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr));margin:0">' +
        CORP.office.map(function (o) { return '<a class="person" style="text-decoration:none;color:inherit" href="#cor-' + esc(o.ward) + '"><div class="role">BMC · ' + esc(o.role) + '</div><div class="name">' + esc(o.name) + '</div><div class="detail">' + esc(o.party) + " · ward " + esc(o.ward) + "</div></a>"; }).join("") +
        OFFICIALS.filter(function (o) { return !/Mayor/.test(o.role); }).map(function (o) { return '<div class="person"><div class="role">' + esc(o.role) + '</div><div class="name">' + esc(o.name) + "</div></div>"; }).join("") + "</div></section>" : "") +
      '<section class="panel"><div class="toolbar" style="margin-top:0"><span class="seg" role="tablist" aria-label="Which representatives">' +
      [["mlas", "MLAs", MLAS.length], ["corporators", "Corporators", CORP.corporators.length], ["mps", "MPs", MPS.length]].map(function (g) { return '<button type="button" role="tab" data-g="' + g[0] + '" aria-pressed="' + (repGroup === g[0]) + '">' + g[1] + " " + g[2] + "</button>"; }).join("") +
      '</span><span class="actions"><div class="field search" style="width:min(320px,100%)">' + ICON_SEARCH + '<input type="search" id="rep-q" placeholder="Name, area, ward or party" aria-label="Search representatives" value="' + esc(repQ) + '"></div></span></div><div id="rep-list"></div></section>';
    bindClicks(app, "[data-g]", function (el) { repGroup = el.dataset.g; repQ = ""; viewReps(); });
    document.getElementById("rep-q").addEventListener("input", debounce(function (e) { repQ = e.target.value; renderRepList(); }, 150));
    renderRepList();
  }
  function renderRepList() {
    var box = document.getElementById("rep-list"); if (!box) return;
    var q = repQ.toLowerCase();
    if (repGroup === "mlas") { box.innerHTML = '<div id="m-results"></div>'; mq = repQ; renderMlas(); return; }
    if (repGroup === "mps") {
      box.innerHTML = '<div class="cards">' + MPS.filter(function (m) { return !q || [m.name, m.constituency, m.party, m.segments.join(" ")].join(" ").toLowerCase().indexOf(q) !== -1; }).map(function (m) {
        var rec = peopleRecord(m.id);
        return '<a class="card" style="text-decoration:none;color:inherit" href="#' + esc(m.id) + '"><div class="top"><span class="eyebrow">Lok Sabha · ' + esc(m.constituency) + "</span></div><h4>" + esc(m.name) + '</h4><div class="where">' + esc(m.party) + " · covers " + esc(m.segments.join(", ")) + '</div><dl class="facts"><div><dt>Declared cases</dt><dd>' + m.affidavit.pendingCases + "</dd></div><div><dt>Assets</dt><dd>" + crore(m.affidavit.totalAssetsCr) + "</dd></div><div><dt>Record items</dt><dd>" + (rec ? rec.length : "—") + "</dd></div></dl></a>";
      }).join("") + "</div>";
      return;
    }
    var rows = CORP.corporators.filter(function (c) { return !q || [c.name, c.area, c.party, "ward " + c.ward, c.adminWard].join(" ").toLowerCase().indexOf(q) !== -1; });
    var agg = (RECORDS.corporatorDisclosures || {}).aggregate || [];
    box.innerHTML = (agg.length ? '<div class="note" style="margin:0 0 12px"><b>What the 227 declared in their 2026 election affidavits:</b><ul style="margin:6px 0 0;padding-left:18px">' + agg.map(function (a) { return "<li>" + esc(a.finding) + " " + srcLinks([a.source]) + "</li>"; }).join("") + "</ul></div>" : "") + '<div class="table-scroll"><table class="data"><thead><tr><th class="num">Ward</th><th>Corporator</th><th>Party</th><th>Area</th><th>BMC ward</th><th class="num">Projects</th><th class="num">Record</th></tr></thead><tbody>' +
      rows.map(function (c) {
        var n = PROJECTS.filter(function (p) { return CORP_PARTS[p.id] && CORP_PARTS[p.id][c.ward]; }).length, rec = peopleRecord("cor-" + c.ward);
        return '<tr class="click" data-cor="' + esc(c.ward) + '" tabindex="0"><td class="num muted">' + esc(c.ward) + "</td><td><b>" + (c.vacant ? '<span class="muted">Vacant</span> ' : "") + esc(c.name) + "</b>" + (c.vacant ? '<div class="sub">' + esc(c.statusNote) + "</div>" : "") + "</td><td>" + esc(c.party) + '</td><td class="sub">' + esc(c.area || "") + "</td><td>" + wcode(c.adminWard) + '</td><td class="num">' + (n || '<span class="muted">0</span>') + '</td><td class="num">' + (rec ? rec.length : '<span class="muted">—</span>') + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    bindClicks(box, "[data-cor]", function (el) { go("#cor-" + el.dataset.cor); });
  }

  function viewCorporator(n) {
    var c = CORP_BY_WARD[n]; if (!c) { viewReps(); return; }
    var ps = PROJECTS.filter(function (p) { return CORP_PARTS[p.id] && CORP_PARTS[p.id][c.ward]; });
    var aw = WARD_PARENT[c.adminWard] || c.adminWard, info = WARD_INFO[aw] || {};
    var tenders = OPEN_TENDERS.filter(function (t) { return tenderMapWard(t) === aw; });
    var roles = (CORP.office || []).filter(function (o) { return String(o.ward) === String(c.ward); });
    var rec = peopleRecord("cor-" + c.ward);
    var feat = EWARD_GEO.find(function (f) { return String(f.properties.ward) === String(c.ward); });
    app.innerHTML = '<p style="margin:0"><a href="#mlas" data-back="corporators">← All representatives</a></p>' +
      '<section class="lead"><div class="eyebrow">Corporator · BMC electoral ward ' + esc(c.ward) + " · " + esc(wardTitle(aw)) + "</div><h2>" + (c.vacant ? "Seat vacant" : esc(c.name)) + '</h2><p style="margin-top:6px">' + (c.vacant ? esc(c.statusNote) : esc(c.party) + (c.area ? " · " + esc(c.area) : "") + (roles.length ? " · " + esc(roles.map(function (r) { return r.role; }).join(", ")) : "")) + "</p>" +
      (c.partyNote ? '<p class="axis-note">' + esc(c.partyNote) + "</p>" : "") + (c.nameNote ? '<p class="axis-note">' + esc(c.nameNote) + "</p>" : "") + "</section>" +
      '<div class="grid-2"><section class="panel"><div class="section-head"><div><div class="eyebrow">Ward</div><h3>Electoral ward ' + esc(c.ward) + "</h3></div></div>" +
      (feat ? '<div class="ward-shape" style="max-width:220px">' + shapeSvg(feat.geometry, ps, c.ward) + "</div>" : "") +
      '<dl class="facts-list" style="margin-top:10px"><dt>Elected</dt><dd>January 2026 BMC election</dd>' +
      ((window.PUBLIC_WORKS_WARD_AC || {})[c.ward] ? "<dt>MLA" + ((window.PUBLIC_WORKS_WARD_AC[c.ward].length > 1) ? "s" : "") + "</dt><dd>" + window.PUBLIC_WORKS_WARD_AC[c.ward].map(function (x) { var mm = mlaByConst[x[0]] || {}; return '<a href="#mla-' + esc(mm.no) + '">' + esc(mm.name || x[0]) + "</a> (" + esc(x[0]) + (window.PUBLIC_WORKS_WARD_AC[c.ward].length > 1 ? ", " + x[1] + "% of voters" : "") + ")"; }).join("<br>") + "</dd>" : "") + '<dt>BMC ward office</dt><dd><a href="#ward-' + wardSlug(aw) + '">' + esc(wardTitle(aw)) + "</a> · officer " + esc(info.assistantCommissioner || "—") + "</dd>" + (info.phone ? "<dt>Ward control room</dt><dd>" + esc(info.phone) + "</dd>" : "") + "<dt>Source</dt><dd>" + srcLinks(CORP.sources) + "</dd></dl></section>" +
      aqiCardForWard(feat) + "</div>" +
      recordSection(rec || [], { empty: rec ? "Nothing found and checked yet." : "Not researched yet. Records for all 227 corporators are being compiled and checked.", note: "Searched the same way for every corporator. Few entries usually means little coverage, not little work." }) +
      ((HIST.corporators || {})[n] && HIST.corporators[n].some(function (x) { return x.field !== "added"; }) ? '<section class="panel"><div class="eyebrow">Changes to this seat on the portal</div>' + histList(HIST.corporators[n], "") + "</section>" : "") +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">In this electoral ward</div><h3>' + plural(ps.length, "project") + " and " + plural(tenders.length, "open tender") + " in " + esc(wardTitle(aw)) + "</h3></div></div>" +
      (ps.length ? '<div class="cards">' + sortList(ps).map(card).join("") + "</div>" : '<p class="muted" style="margin:0">No tracked projects in this electoral ward.</p>') + "</section>";
    bindClicks(app, "[data-open]", function (el) { go("#p-" + el.dataset.open); });
    var back = app.querySelector("[data-back]"); if (back) back.addEventListener("click", function () { repGroup = "corporators"; });
  }
  function aqiCardForWard(feat) {
    if (!feat || !AQI.stations.length) return "";
    var ring = feat.geometry.coordinates.reduce(function (a, p) { return p[0].length > a.length ? p[0] : a; }, []);
    var x = 0, y = 0; ring.forEach(function (c) { x += c[0]; y += c[1]; });
    return aqiCard(y / ring.length, x / ring.length);
  }
  function shapeSvg(geom, ps, eward) {
    var pts = [].concat.apply([], geom.coordinates.map(function (p) { return p[0]; }));
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (c) { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); });
    var kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180), W = (maxX - minX) * kx, H = maxY - minY, S = 160 / Math.max(W, H);
    function xy(lng, lat) { return [(5 + (lng - minX) * kx * S + (160 - W * S) / 2).toFixed(1), (5 + (maxY - lat) * S + (160 - H * S) / 2).toFixed(1)]; }
    var d = geom.coordinates.map(function (poly) { return poly.map(function (ring) { return "M" + ring.map(function (c) { return xy(c[0], c[1]).join(","); }).join("L") + "Z"; }).join(""); }).join("");
    var dots = "";
    ps.forEach(function (p) { (ROUTES[p.id] || []).forEach(function (path) { path.forEach(function (pt) {
      if (pt[1] < minX - 0.002 || pt[1] > maxX + 0.002 || pt[0] < minY - 0.002 || pt[0] > maxY + 0.002) return;
      var c = xy(pt[1], pt[0]); dots += '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="4" fill="' + statusColor(p.status) + '" stroke="var(--surface)" stroke-width="1.5"><title>' + esc((p.shortName || p.name) + ": " + pt[2]) + "</title></circle>";
    }); }); });
    return '<svg viewBox="0 0 170 170" role="img" aria-label="Outline of electoral ward ' + esc(eward) + '"><path d="' + d + '" fill="var(--surface-2)" stroke="var(--ink-3)" stroke-width="1.2" fill-rule="evenodd"/>' + dots + "</svg>";
  }

  function viewMp(id) {
    var m = MPS.find(function (x) { return x.id === id; }); if (!m) { viewReps(); return; }
    var a = m.affidavit, rec = peopleRecord(m.id), extra = (RECORDS.mps || {})[m.id] || {};
    if (extra.party && extra.party !== m.party && !extra.partyNote) extra.partyNote = "elected as " + m.party;
    var ps = PROJECTS.filter(function (p) { return (p.constituencies || []).some(function (c) { return m.segments.indexOf(c) !== -1; }); });
    app.innerHTML = '<p style="margin:0"><a href="#mlas" data-back="mps">← All representatives</a></p>' +
      '<section class="lead"><div class="eyebrow">Member of Parliament · Lok Sabha · ' + esc(m.constituency) + "</div><h2>" + esc(m.name) + '</h2><p style="margin-top:6px">' + esc(extra.party || m.party) + (extra.partyNote ? " · " + esc(extra.partyNote) : "") + ((extra.posts || []).length ? " · " + esc(extra.posts.join("; ")) : "") + "</p></section>" +
      '<section class="stats"><div class="stat"><span class="label">Assembly segments</span><span class="value">' + m.segments.length + '</span><span class="sub">' + esc(m.segments.join(", ")) + '</span></div>' +
      '<div class="stat' + (a.pendingCases ? " alert" : "") + '"><span class="label">Cases declared pending</span><span class="value">' + a.pendingCases + '</span><span class="sub">sworn in the 2024 election affidavit; not convictions</span></div>' +
      '<div class="stat"><span class="label">Declared assets</span><span class="value">' + (a.totalAssetsCr != null ? a.totalAssetsCr.toLocaleString("en-IN") : "—") + '<small>cr</small></span><span class="sub">liabilities ' + crore(a.liabilitiesCr) + "</span></div>" +
      '<div class="stat"><span class="label">MP fund (MPLADS)</span><span class="value">' + (extra.mplads && extra.mplads.spentCr != null ? extra.mplads.spentCr + "<small>cr spent</small>" : '<span class="muted" style="font-size:1.1rem">not published</span>') + '</span><span class="sub">' + (extra.mplads && extra.mplads.allocatedCr != null ? "of " + crore(extra.mplads.allocatedCr) + " allocated" : "₹5 cr a year per MP") + "</span></div></section>" +
      (extra.prs ? '<section class="panel"><div class="section-head"><div><div class="eyebrow">In Parliament</div><h3>Attendance and participation, 18th Lok Sabha</h3></div><p>' + (/Goyal/.test(m.name) ? "Ministers do not sign the attendance register or ask questions, so these figures are not comparable." : "As tracked by PRS Legislative Research.") + "</p></div>" +
        '<dl class="kv"><div><dt>Attendance</dt><dd>' + (extra.prs.attendancePct != null ? extra.prs.attendancePct + "%" : "—") + "<small>" + esc(extra.prs.asOf || "") + "</small></dd></div><div><dt>Questions asked</dt><dd>" + (extra.prs.questions != null ? extra.prs.questions : "—") + "<small>&nbsp;</small></dd></div><div><dt>Debates joined</dt><dd>" + (extra.prs.debates != null ? extra.prs.debates : "—") + '<small>&nbsp;</small></dd></div></dl><p class="axis-note">' + srcLinks([extra.prs.source]) + "</p></section>" : "") +
      recordSection(rec || [], { empty: rec ? "Nothing found and checked yet." : "Being compiled and checked." }) +
      '<div class="grid-2"><section class="panel"><div class="section-head"><div><div class="eyebrow">MLAs in this seat</div><h3>The six Assembly constituencies</h3></div></div><div class="people" style="margin:0">' +
      m.segments.map(function (cn) { var x = mlaByConst[cn] || {}; return '<a class="person" style="text-decoration:none;color:inherit" href="#mla-' + esc(x.no) + '"><div class="role">' + esc(cn) + '</div><div class="name">' + esc(x.name || "—") + '</div><div class="detail">' + esc(x.party || "") + "</div></a>"; }).join("") + "</div></section>" +
      '<section class="panel"><div class="section-head"><div><div class="eyebrow">Election affidavit, 2024</div><h3>Declared cases and assets</h3></div></div>' + affidavitBlock(a) + "</section></div>" +
      '<section class="panel"><div class="section-head"><div><h3>' + plural(ps.length, "project") + " in this Lok Sabha seat</h3></div></div>" + (ps.length ? '<div class="cards">' + sortList(ps).map(card).join("") + "</div>" : "") + "</section>";
    bindClicks(app, "[data-open]", function (el) { go("#p-" + el.dataset.open); });
    var back = app.querySelector("[data-back]"); if (back) back.addEventListener("click", function () { repGroup = "mps"; });
  }
  function affidavitBlock(a) {
    return '<dl class="facts-list"><dt>Cases declared pending</dt><dd>' + a.pendingCases + "</dd><dt>Convictions declared</dt><dd>" + a.convictedCases + "</dd><dt>Assets</dt><dd>" + crore(a.totalAssetsCr) + "</dd><dt>Liabilities</dt><dd>" + crore(a.liabilitiesCr) + "</dd>" + (a.age ? "<dt>Age at election</dt><dd>" + a.age + "</dd>" : "") + (a.education ? "<dt>Education</dt><dd>" + esc(a.education) + "</dd>" : "") + (a.profession ? "<dt>Profession</dt><dd>" + esc(a.profession) + "</dd>" : "") + '<dt>Source</dt><dd><a href="' + esc(safeUrl(a.mynetaUrl)) + '" target="_blank" rel="noopener">MyNeta affidavit summary (ADR)</a></dd></dl>' +
      ((a.caseList || []).length ? '<h4 style="margin:14px 0 8px">Each case, as declared</h4><div class="table-scroll"><table class="data cases"><thead><tr><th>FIR / case</th><th>Court</th><th>Law and sections</th><th>Charges framed</th></tr></thead><tbody>' +
        a.caseList.map(function (c) { return "<tr><td>" + esc(c.fir || "—") + (c.caseNo ? '<div class="sub">' + esc(c.caseNo) + "</div>" : "") + "</td><td>" + esc(c.court || "—") + "</td><td>" + esc([c.law, c.sections].filter(Boolean).join(" ") || "—") + (c.other ? '<div class="sub">' + esc(c.other) + "</div>" : "") + "</td><td>" + esc(c.chargesFramed || "—") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "");
  }

  // ---------------------------------------------------------------- router
  // ================================================================ v5: information layer
  var EVIDENCE = { official: ["Official source", "--st-completed", "Core facts are supported by an official document (agency, government, court or auditor)."], multiple: ["Two or more outlets", "--st-progress", "Core facts are reported by two or more independent reputable outlets."], single: ["Single report", "--st-partial", "Core facts rest on one reputable report. Treat with more caution."] };
  function evidenceBadge(p) {
    var e = EVIDENCE[p.evidence]; if (!e && !p.recheckedAt && !p.statusUnchecked) return "";
    return '<div class="evidence">' + (e ? '<span class="pill" style="color:var(' + e[1] + ')" data-tip="' + esc(e[2]) + '">' + esc(e[0]) + "</span>" : "") + (p.statusUnchecked ? '<span class="pill" style="color:var(--st-delayed)" data-tip="A second reviewer could not find a 2026 report on this project\u2019s current state.">Latest status not confirmed</span>' : "") + (p.recheckedAt ? '<span class="sub">Every fact re-checked against its sources by a second reviewer on ' + esc(fmtDate(p.recheckedAt)) + "</span>" : '<span class="sub">Not yet re-checked by a second reviewer</span>') + "</div>";
  }
  // ---- glossary: plain-language meanings, shown on hover/tap and listed on About
  var GLOSS = {
    "Corporator": "Elected member of the BMC for one of 227 electoral wards. Votes on the city budget and civic contracts and raises local complaints.",
    "MLA": "Member of the Maharashtra Legislative Assembly. Mumbai has 36. Makes state laws, gets a local development fund, and takes up issues with state agencies like MMRDA and MSRDC.",
    "MP": "Member of Parliament (Lok Sabha). Mumbai has 6. Makes national laws and recommends works under the MP local area fund (MPLADS).",
    "Ward officer": "The Assistant Commissioner who heads a BMC administrative ward: roads, drains, encroachments, licences and complaints. Appointed, not elected.",
    "BMC ward": "One of 24 administrative wards (A to T) the BMC uses to run the city. Each has a ward office. Different from the 227 electoral wards.",
    "Electoral ward": "One of 227 areas that each elect a corporator. Several electoral wards make up one administrative ward.",
    "Tender": "A public invitation to bid for a contract. The issuing office sets the work, the estimated value and the closing date; the contract usually goes to the lowest qualified bidder.",
    "EMD": "Earnest money deposit: a sum bidders pay to show they are serious. It is returned to unsuccessful bidders.",
    "Delayed": "Still being built but past the deadline first announced, or the deadline has been pushed back.",
    "Stalled": "Work has stopped, for example over land, permissions, a court case or a contract dispute.",
    "Not started": "Approved or announced, but construction has not begun on the ground.",
    "Partially open": "Some sections are open to the public while others are still being built.",
    "Cost overrun": "How much the latest approved cost exceeds the original approved cost.",
    "FIR": "First Information Report: the police record that starts an investigation. Being named in an FIR is not being charged or convicted.",
    "Chargesheet": "The police report filed in court after an investigation, listing the charges. A court then decides.",
    "Affidavit": "The sworn statement every candidate files with their nomination, listing pending criminal cases, assets and liabilities.",
    "AQI": "Air Quality Index on India’s national scale: 0–50 Good, 51–100 Satisfactory, 101–200 Moderate, 201–300 Poor, 301–400 Very poor, above 400 Severe.",
    "Crore": "1 crore = 10 million = 100 lakh. ₹1,000 crore = ₹10 billion.",
    "MahaRERA": "Maharashtra’s real-estate regulator. Private housing projects above a set size must register there before selling.",
  };
  function gl(key, label) { return GLOSS[key] ? '<span class="term" tabindex="0" data-tip="<b>' + esc(key) + "</b><br>" + esc(GLOSS[key]) + '">' + (label || esc(key)) + "</span>" : (label || esc(key)); }

  // ---- freshness: how current each dataset is
  function maxDate(list) { return list.filter(Boolean).map(String).sort().pop() || null; }
  function daysSince(d) { return d ? Math.floor((TODAY - Date.parse(String(d).slice(0, 10) + "T00:00:00Z")) / 864e5) : null; }
  function datasets() {
    var recs = Object.values((window.PUBLIC_WORKS_RECORDS || {}).people || {});
    return [
      { name: "Projects", what: "status, cost, dates, funders", date: maxDate(PROJECTS.map(function (p) { return p.lastVerified; })), kind: "checked", every: 45, href: "#explorer" },
      { name: "Tenders", what: "open tenders from Mahatenders", date: TENDERS.fetchedAt, kind: "fetched", every: 3, href: "#tenders" },
      { name: "Air quality", what: "official monitoring stations", date: AQI.fetchedAt, kind: "fetched", every: 1, href: "#map" },
      { name: "Construction sites", what: "OpenStreetMap", date: CONS.fetchedAt, kind: "fetched", every: 120, href: "#map" },
      { name: "MLA profiles", what: "affidavits, funds, work, news", date: MLA_DATA.workVerified || MLA_DATA.compiled, kind: "checked", every: 120, href: "#mlas" },
      { name: "Corporator and MP records", what: "work, issues, controversies, cases", date: maxDate(recs.map(function (r) { return r.verified; })), kind: "checked", every: 120, href: "#mlas" },
      { name: "Contractors and agencies", what: "contracts, penalties, cases", date: CONTRACTS.verified || CONTRACTS.compiled, kind: "checked", every: 180, href: "#contracts" },
      { name: "Schemes", what: "government yojanas", date: maxDate(YOJ_LIST().map(function (y) { return y.verified || maxDate((y.recent || []).map(function (r) { return r.date; })); })), kind: "latest item", every: 180, href: "#schemes" },
    ].map(function (d) { d.age = daysSince(d.date); d.stale = d.age == null || d.age > d.every; return d; });
  }
  function YOJ_LIST() { var y = window.PUBLIC_WORKS_YOJANAS; return Array.isArray(y) ? y : (y && y.schemes) || []; }
  function freshnessPanel(compact) {
    var ds = datasets();
    return '<section class="panel"><div class="section-head"><div><div class="eyebrow">Freshness</div><h3>How current each part is</h3></div><p>When each dataset was last fetched or re-checked. Anything past its normal refresh interval is flagged.</p></div>' +
      '<div class="fresh">' + ds.map(function (d) {
        return '<a class="fresh-row' + (d.stale ? " stale" : "") + '" href="' + d.href + '"><span class="fr-n"><b>' + esc(d.name) + "</b>" + (compact ? "" : '<span class="sub">' + esc(d.what) + "</span>") + '</span><span class="fr-d">' + (d.date ? esc(d.kind) + " " + esc(fmtDate(String(d.date).slice(0, 10))) : "no date") + '</span><span class="fr-a">' + (d.age == null ? "" : d.age <= 0 ? "today" : d.age === 1 ? "1 day ago" : d.age + " days ago") + '</span><span class="fr-s">' + (d.stale ? '<span class="pill" style="color:var(--st-delayed)">Due for refresh</span>' : '<span class="pill" style="color:var(--st-completed)">Current</span>') + "</span></a>";
      }).join("") + "</div></section>";
  }

  // ---- latest: every dated event in the data, newest first
  var FEED = null;
  function feedItems() {
    if (FEED) return FEED;
    var out = [], today = new Date(TODAY).toISOString().slice(0, 10);
    function add(o) { if (o.date && String(o.date) <= today && o.what) out.push(o); }
    var D = window.PUBLIC_WORKS_DELAYS || {};
    Object.keys(D).forEach(function (id) {
      var p = PROJECTS.find(function (q) { return q.id === id; }); var l = D[id] && D[id].latest;
      if (p && l) add({ date: l.date, type: "Projects", cat: "Project update", who: p.shortName || p.name, href: "#p-" + id, what: l.what, src: l.source });
    });
    MLAS.forEach(function (m) {
      var prof = (MLA_DATA.profiles || {})[m.no] || {}, aff = prof.affidavit || {};
      var who = m.name + " (MLA, " + m.constituency + ")", href = "#mla-" + m.no;
      (prof.work || []).forEach(function (w) { add({ date: w.date, type: "MLAs", cat: itemCategory(w, false), who: who, href: href, what: w.what, src: w.source }); });
      (prof.news || []).forEach(function (n) { add({ date: n.date, type: "MLAs", cat: itemCategory(n, true), who: who, href: href, what: n.headline, src: n.source }); });
      (aff.laterCases || []).forEach(function (c) { add({ date: c.date, type: "MLAs", cat: "Legal matter", who: who, href: href, what: c.kind + ": " + c.summary, src: (c.sources || [])[0] }); });
    });
    var people = (RECORDS.people || {});
    Object.keys(people).forEach(function (id) {
      var who, href, type;
      if (id.indexOf("cor-") === 0) { var c = CORP_BY_WARD[+id.slice(4)] || {}; who = (c.name || "Corporator") + " (corporator, ward " + id.slice(4) + ")"; href = "#" + id; type = "Corporators"; }
      else { var mp = MPS.find(function (x) { return "mp-" + x.id === id; }) || {}; who = (mp.name || "MP") + " (MP, " + (mp.constituency || "") + ")"; href = "#" + id; type = "MPs"; }
      (people[id].record || []).forEach(function (r) { add({ date: r.date, type: type, cat: r.category, who: who, href: href, what: r.what, src: r.source }); });
    });
    YOJ_LIST().forEach(function (y) { (y.recent || []).forEach(function (r) { add({ date: r.date, type: "Schemes", cat: "Scheme update", who: y.name, href: "#schemes", what: r.what, src: r.source }); }); });
    (CONTRACTS.companies || []).forEach(function (c) { (c.events || []).forEach(function (e) { add({ date: e.date, type: "Companies", cat: e.kind, who: c.name, href: "#co-" + c.slug, what: e.summary, src: (e.sources || [e.source])[0] }); }); });
    out.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    return (FEED = out);
  }
  function feedList(items) {
    return '<ol class="feed">' + items.map(function (x) {
      var u = x.src && safeUrl(x.src.url);
      return '<li><span class="fd-date">' + esc(fmtDate(x.date)) + (PREV_VISIT && String(x.date) > PREV_VISIT ? '<span class="newtag">New</span>' : "") + '</span><div class="fd-body"><div class="fd-head"><a href="' + esc(x.href) + '">' + esc(x.who) + "</a> " + (CATS.some(function (c) { return c.key === x.cat; }) ? catPill(x.cat) : '<span class="pill" style="color:var(--ink-3)">' + esc(x.cat) + "</span>") + "</div><div>" + esc(x.what) + "</div>" +
        (u ? '<div class="sub"><a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc((x.src.title || u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]).slice(0, 90)) + " ↗</a></div>" : "") + "</div></li>";
    }).join("") + "</ol>";
  }
  var lstate = { type: "", cat: "", days: 90, q: "" };
  function viewLatest() {
    var all = feedItems();
    var TYPES = ["Projects", "MLAs", "Corporators", "MPs", "Schemes", "Companies"];
    app.innerHTML = '<section class="lead"><div class="eyebrow">Latest</div><h2>What happened recently</h2><p>Every dated event in this portal, newest first: project milestones and blockers, what representatives did or were reported for, scheme changes and actions against contractors. Each one is a checked fact with its source. Dates are when it happened or was reported.</p></section>' +
      '<section class="panel"><div class="legend" id="lf-type"><button type="button" class="chip" data-v="" aria-pressed="' + !lstate.type + '">Everything</button>' + TYPES.map(function (t) { var n = all.filter(function (x) { return x.type === t; }).length; return n ? '<button type="button" class="chip" data-v="' + t + '" aria-pressed="' + (lstate.type === t) + '">' + t + " <b>" + n + "</b></button>" : ""; }).join("") + "</div>" +
      '<div class="legend" id="lf-days" style="margin-top:8px">' + [[30, "Last 30 days"], [90, "Last 3 months"], [365, "Last year"], [0, "All time"]].map(function (d) { return '<button type="button" class="chip" data-v="' + d[0] + '" aria-pressed="' + (lstate.days === d[0]) + '">' + d[1] + "</button>"; }).join("") + "</div>" +
      '<div class="field search" style="margin-top:10px;max-width:420px">' + ICON_SEARCH + '<input type="search" id="lf-q" placeholder="Filter by name, place or word" aria-label="Filter updates" value="' + esc(lstate.q) + '"></div>' +
      '<div id="lf-out" style="margin-top:14px"></div></section>';
    function draw() {
      var cut = lstate.days ? new Date(TODAY - lstate.days * 864e5).toISOString().slice(0, 10) : "";
      var q = lstate.q.trim().toLowerCase();
      var list = all.filter(function (x) { return (!lstate.type || x.type === lstate.type) && (!cut || String(x.date) >= cut) && (!q || (x.who + " " + x.what).toLowerCase().indexOf(q) !== -1); });
      document.getElementById("lf-out").innerHTML = '<p class="axis-note" style="margin:0 0 6px">' + plural(list.length, "update") + (list.length > 150 ? ", showing the newest 150" : "") + "</p>" + (list.length ? feedList(list.slice(0, 150)) : '<p class="muted">Nothing in this range.</p>');
    }
    ["lf-type", "lf-days"].forEach(function (id) {
      var box = document.getElementById(id);
      bindClicks(box, "[data-v]", function (el) { box.querySelectorAll("[data-v]").forEach(function (b) { b.setAttribute("aria-pressed", String(b === el)); }); if (id === "lf-type") lstate.type = el.dataset.v; else lstate.days = +el.dataset.v; draw(); });
    });
    document.getElementById("lf-q").addEventListener("input", function (e) { lstate.q = e.target.value; draw(); });
    draw();
  }

  // ---- ward scorecards and comparison
  var WARD_CENTRE = {};
  function wardCentre(w) {
    if (WARD_CENTRE[w]) return WARD_CENTRE[w];
    var f = WARD_FEATURE[w]; if (!f) return null;
    var ring = f.geometry.coordinates.reduce(function (a, p) { return p[0].length > a.length ? p[0] : a; }, []);
    var cx = 0, cy = 0; ring.forEach(function (c) { cx += c[0]; cy += c[1]; });
    return (WARD_CENTRE[w] = [cy / ring.length, cx / ring.length]);
  }
  function wardCard(w) {
    var s = wardStats(w), c = wardCentre(w);
    var cons = CONS.sites.filter(function (x) { return x.ward === w; });
    var cors = CORP.corporators.filter(function (x) { return x.adminWard === w; });
    var st = c && AQI.stations.length ? nearestStations(c[0], c[1], 1)[0] : null;
    return {
      ward: w, projects: s.ps.length, late: s.late, value: s.ps.reduce(function (a, p) { return a + (cost(p) || 0); }, 0),
      tenders: s.tenders.length, cons: cons.length, consLive: cons.filter(function (x) { return !consStale(x); }).length,
      cors: cors.length, vacant: cors.filter(function (x) { return x.vacant; }).length, officer: (WARD_INFO[w] || {}).assistantCommissioner || null,
      aqi: st && st.km <= 4 ? st.s : null, aqiKm: st ? st.km : null,
      cdays: (window.PUBLIC_WORKS_CIVIC && PUBLIC_WORKS_CIVIC.complaints && PUBLIC_WORKS_CIVIC.complaints.wards[w] || {}).avgDays,
    };
  }
  var WARD_COLS = [
    { k: "projects", t: "Projects", f: function (r) { return r.projects; } },
    { k: "late", t: "Delayed or stalled", f: function (r) { return r.late ? '<span class="up">' + r.late + "</span>" : "0"; } },
    { k: "value", t: "Cost of projects passing through", tip: "Full cost of every project with a part in the ward. A metro line crossing five wards counts in full in each, so these do not add up to a city total.", f: function (r) { return r.value ? crore(r.value) : "—"; } },
    { k: "tenders", t: "Open tenders", f: function (r) { return r.tenders; } },
    { k: "consLive", t: "Construction sites", tip: "Mapped on OpenStreetMap; first number updated in the last 18 months", f: function (r) { return r.consLive + '<span class="sub"> / ' + r.cons + "</span>"; } },
    { k: "cors", t: "Corporators", f: function (r) { return r.cors + (r.vacant ? '<span class="sub"> (' + r.vacant + " vacant)</span>" : ""); } },
    { k: "cdays", t: "Days to close a complaint", tip: "Average days BMC took to close residents’ complaints in 2025 (Praja Foundation, from BMC data)", f: function (r) { return r.cdays != null ? String(r.cdays) : "—"; }, v: function (r) { return r.cdays != null ? r.cdays : -1; } },
    { k: "aqi", t: "Air now", tip: "Nearest official station within 4 km of the ward centre", f: function (r) { return r.aqi ? aqiBadge(r.aqi) : '<span class="muted">no station</span>'; }, v: function (r) { return r.aqi ? r.aqi.aqi : -1; } },
  ];
  var wsort = { k: "projects", d: -1 };
  function wardTable() {
    var rows = WARD_NAMES.map(wardCard);
    var col = WARD_COLS.find(function (c) { return c.k === wsort.k; }) || WARD_COLS[0];
    var val = col.v || function (r) { return r[col.k]; };
    rows.sort(function (a, b) { return wsort.d * (val(a) - val(b)) || WARD_ORDER.indexOf(a.ward) - WARD_ORDER.indexOf(b.ward); });
    return '<div class="table-scroll"><table class="data sortable" id="ward-table"><thead><tr><th>Ward</th>' + WARD_COLS.map(function (c) { return '<th class="num"><button type="button" class="th-sort" data-k="' + c.k + '"' + (c.tip ? ' data-tip="' + esc(c.tip) + '"' : "") + ">" + esc(c.t) + (wsort.k === c.k ? (wsort.d < 0 ? " ↓" : " ↑") : "") + "</button></th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) { return '<tr class="click" data-ward-go="' + esc(r.ward) + '" tabindex="0"><td>' + wcode(r.ward) + "<b>" + esc(wardTitle(r.ward)) + "</b>" + (r.officer ? '<div class="sub">' + esc(r.officer) + "</div>" : "") + "</td>" + WARD_COLS.map(function (c) { return '<td class="num">' + c.f(r) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
  }
  function mountWardTable(box) {
    box.innerHTML = '<div class="section-head"><div><div class="eyebrow">All 24 wards</div><h3>Compare wards</h3></div><p>Tap a column to sort, a row to open the ward. Or <a href="#compare">compare two side by side</a>.</p></div>' + wardTable();
    bindClicks(box, "[data-ward-go]", function (el) { go("#ward-" + wardSlug(el.dataset.wardGo)); });
    box.querySelectorAll(".th-sort").forEach(function (b) { b.addEventListener("click", function (e) { e.stopPropagation(); wsort = { k: b.dataset.k, d: wsort.k === b.dataset.k ? -wsort.d : -1 }; mountWardTable(box); }); });
  }
  function wardScorecard(w) {
    var r = wardCard(w), n = WARD_NAMES.length;
    function rank(k, desc) { var vals = WARD_NAMES.map(function (x) { return wardCard(x)[k]; }); var v = r[k]; return 1 + vals.filter(function (x) { return desc ? x > v : x < v; }).length; }
    return '<div class="scorecard">' +
      '<div><span class="sc-v">' + r.projects + '</span><span class="sc-l">projects</span><span class="sc-r">#' + rank("projects", true) + " of " + n + "</span></div>" +
      '<div><span class="sc-v' + (r.late ? " alert" : "") + '">' + r.late + '</span><span class="sc-l">delayed or stalled</span><span class="sc-r">' + (r.projects ? Math.round(100 * r.late / r.projects) + "% of its projects" : "&nbsp;") + "</span></div>" +
      '<div><span class="sc-v">' + (r.value ? crore(r.value) : "—") + '</span><span class="sc-l"><span class="term" tabindex="0" data-tip="Full cost of every project with a part in this ward, not this ward\u2019s share.">cost of projects passing through</span></span><span class="sc-r">#' + rank("value", true) + " of " + n + "</span></div>" +
      '<div><span class="sc-v">' + r.tenders + '</span><span class="sc-l">open tenders</span><span class="sc-r">#' + rank("tenders", true) + " of " + n + "</span></div>" +
      '<div><span class="sc-v">' + r.consLive + '</span><span class="sc-l">active construction sites</span><span class="sc-r">' + r.cons + " mapped in all</span></div>" +
      '<div><span class="sc-v">' + r.cors + '</span><span class="sc-l">' + gl("Corporator", "corporators") + '</span><span class="sc-r">' + (r.vacant ? r.vacant + " seat vacant" : "all seats filled") + "</span></div>" +
      "</div>";
  }

  // ---- compare two wards or two MLAs
  var cstate = { kind: "wards", a: "", b: "" };
  function mlaCard(m) {
    var prof = (MLA_DATA.profiles || {})[m.no] || {}, aff = prof.affidavit || {}, f = prof.funds || {};
    var ps = PROJECTS.filter(function (p) { return (p.constituencies || []).indexOf(m.constituency) !== -1; });
    var items = (prof.work || []).map(function (w) { return itemCategory(w, false); }).concat((prof.news || []).map(function (n) { return itemCategory(n, true); }));
    var byCat = {}; items.forEach(function (c) { byCat[c] = (byCat[c] || 0) + 1; });
    return { m: m, aff: aff, f: f, ps: ps, late: ps.filter(isLate).length, byCat: byCat, later: (aff.laterCases || []).length };
  }
  function viewCompare() {
    var isW = cstate.kind === "wards";
    var opts = isW ? WARD_NAMES.map(function (w) { var loc = ((WARD_INFO[w] || {}).localities || []).slice(0, 2).join(", "); return [w, wardTitle(w) + (loc ? " · " + loc : "")]; }) : MLAS.slice().sort(function (a, b) { return a.constituency.localeCompare(b.constituency); }).map(function (m) { return [String(m.no), m.constituency + " · " + m.name]; });
    if (!opts.some(function (o) { return o[0] === cstate.a; })) cstate.a = opts[0][0];
    if (!opts.some(function (o) { return o[0] === cstate.b; })) cstate.b = opts[1][0];
    function sel(id, v) { return '<select id="' + id + '" aria-label="Choose">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === v ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>"; }
    var rows;
    if (isW) {
      var A = wardCard(cstate.a), B = wardCard(cstate.b);
      rows = [["Ward officer", A.officer || "—", B.officer || "—"]].concat(WARD_COLS.map(function (c) { return [c.t, c.f(A), c.f(B), c.v ? null : [A[c.k], B[c.k]]]; }));
      rows.unshift(["", '<a href="#ward-' + wardSlug(A.ward) + '"><b>' + esc(wardTitle(A.ward)) + "</b></a>", '<a href="#ward-' + wardSlug(B.ward) + '"><b>' + esc(wardTitle(B.ward)) + "</b></a>"]);
    } else {
      var ma = mlaCard(MLAS.find(function (m) { return String(m.no) === cstate.a; })), mb = mlaCard(MLAS.find(function (m) { return String(m.no) === cstate.b; }));
      var row = function (label, fn, num) { return [label, fn(ma), fn(mb), num ? [num(ma), num(mb)] : null]; };
      rows = [
        ["", '<a href="#mla-' + ma.m.no + '"><b>' + esc(ma.m.name) + "</b></a>", '<a href="#mla-' + mb.m.no + '"><b>' + esc(mb.m.name) + "</b></a>"],
        row("Constituency", function (x) { return esc(x.m.constituency); }),
        row("Party", function (x) { return esc(x.m.party); }),
        row("MLA since", function (x) { return esc(x.m.since); }),
        row("Projects in the constituency", function (x) { return x.ps.length; }, function (x) { return x.ps.length; }),
        row("Delayed or stalled", function (x) { return x.late; }),
        row(gl("Affidavit", "Cases declared pending (2024 affidavit)"), function (x) { return x.aff.pendingCases != null ? x.aff.pendingCases + (x.aff.convictedCases ? " + " + x.aff.convictedCases + " conviction" : "") : "—"; }),
        row("Cases reported since the election", function (x) { return x.later; }),
        row("Declared assets", function (x) { return x.aff.totalAssetsCr != null ? "₹" + x.aff.totalAssetsCr.toLocaleString("en-IN") + " cr" : "—"; }),
        row("2024 winning margin", function (x) { var e = ELEC && (ELEC.constituencies || []).find(function (c) { return c.no === x.m.no; }); return e && e.r2024 && e.r2024.margin != null ? fmtN(e.r2024.margin) + " votes" : "—"; }),
        row("Assets declared, 2019 → 2024", function (x) { var e = ELEC && (ELEC.constituencies || []).find(function (c) { return c.no === x.m.no; }); var a = e && e.assets; return a && a.y2024 != null ? (a.y2019 != null ? rs(a.y2019) + " → " : "") + rs(a.y2024) : "—"; }),
        row("Praja report card", function (x) { return x.f.score != null ? x.f.score.toFixed(1) + "/100 · rank " + x.f.rank : '<span class="muted">not rated</span>'; }),
        row("Assembly attendance (Praja)", function (x) { return esc(x.f.attendanceBand || "—"); }),
        row("MLA fund use (Praja)", function (x) { return esc(x.f.fundUtilisationBand || "—"); }),
      ].concat(CATS.map(function (c) { return row("Record: " + c.key.toLowerCase(), function (x) { return x.byCat[c.key] || 0; }); }));
    }
    app.innerHTML = '<section class="lead"><div class="eyebrow">Compare</div><h2>Side by side</h2><p>Pick two ' + (isW ? "BMC wards" : "MLAs") + ". Every figure comes from the same pages as the rest of the portal, with the same sources.</p></section>" +
      '<section class="panel"><div class="legend" id="cmp-kind"><button type="button" class="chip" data-v="wards" aria-pressed="' + isW + '">Wards</button><button type="button" class="chip" data-v="mlas" aria-pressed="' + !isW + '">MLAs</button></div>' +
      '<div class="cmp-pick"><label>' + sel("cmp-a", cstate.a) + '</label><span class="vs">vs</span><label>' + sel("cmp-b", cstate.b) + "</label></div>" +
      '<div class="table-scroll"><table class="data cmp"><tbody>' + rows.map(function (r, i) {
        var hi = r[3] && typeof r[3][0] === "number" && r[3][0] !== r[3][1] ? (r[3][0] > r[3][1] ? 1 : 2) : 0;
        return (i === 0 ? "<tr class=\"cmp-h\">" : "<tr>") + "<th>" + r[0] + '</th><td class="' + (hi === 1 ? "more" : "") + '">' + r[1] + '</td><td class="' + (hi === 2 ? "more" : "") + '">' + r[2] + "</td></tr>";
      }).join("") + "</tbody></table></div>" +
      (isW ? "" : '<p class="axis-note">Record counts are items found and checked so far; coverage is not equal for every MLA, so a low count does not mean nothing was done.</p>') + "</section>";
    var k = document.getElementById("cmp-kind");
    bindClicks(k, "[data-v]", function (el) { cstate.kind = el.dataset.v; cstate.a = cstate.b = ""; viewCompare(); });
    ["a", "b"].forEach(function (s) { document.getElementById("cmp-" + s).addEventListener("change", function (e) { cstate[s] = e.target.value; viewCompare(); }); });
  }

  // ================================================================ v8: city services
  var CIVIC = window.PUBLIC_WORKS_CIVIC || {};
  var CMP = CIVIC.complaints || null, FLOOD = CIVIC.flooding || null;
  function srcA(s, label) { var u = s && safeUrl(s.url); return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(label || s.title || "source") + "</a>" + (s.date ? " · " + esc(fmtDate(s.date)) : "") : ""; }
  function fmtN(n) { return n == null ? "—" : Number(n).toLocaleString("en-IN"); }
  function wardComplaints(w) { return CMP && CMP.wards ? CMP.wards[w] || null : null; }
  function complaintRank(w, k, asc) {
    if (!CMP) return null; var ws = Object.keys(CMP.wards).filter(function (x) { return CMP.wards[x][k] != null; });
    var v = (CMP.wards[w] || {})[k]; if (v == null) return null;
    return { rank: 1 + ws.filter(function (x) { return asc ? CMP.wards[x][k] < v : CMP.wards[x][k] > v; }).length, of: ws.length };
  }
  function complaintsBlock(w, compact) {
    var c = wardComplaints(w); if (!c) return "";
    var rd = complaintRank(w, "avgDays", true), rr = complaintRank(w, "resolvedPct", false);
    var cc = c.categoryCounts || {};
    return '<div class="section-head" style="margin-top:22px"><div><h3>Civic complaints (' + esc(CMP.periodLabel || "2025") + ')</h3><p>Complaints residents filed with BMC about this ward, from BMC’s complaint system as published by Praja Foundation.</p></div></div>' +
      '<div class="scorecard">' +
      '<div><span class="sc-v">' + fmtN(c.received) + '</span><span class="sc-l">complaints received</span><span class="sc-r">city: ' + fmtN(CMP.city.received) + " in all</span></div>" +
      '<div><span class="sc-v">' + (c.resolvedPct != null ? c.resolvedPct + "%" : "—") + '</span><span class="sc-l">closed</span><span class="sc-r">' + (rr ? "#" + rr.rank + " of " + rr.of + " wards" : "") + "</span></div>" +
      '<div><span class="sc-v' + (c.avgDays != null && CMP.city.avgDays != null && c.avgDays > CMP.city.avgDays ? " alert" : "") + '">' + (c.avgDays != null ? c.avgDays : "—") + '</span><span class="sc-l">days on average to close</span><span class="sc-r">' + (rd ? "#" + rd.rank + " fastest of " + rd.of + " · city " + CMP.city.avgDays : "") + "</span></div>" +
      (!compact && cc.solidWasteManagement ? '<div><span class="sc-v">' + fmtN(cc.solidWasteManagement.received) + '</span><span class="sc-l">about garbage and waste</span><span class="sc-r">' + (cc.solidWasteManagement.avgDays != null ? cc.solidWasteManagement.avgDays + " days on average" : "") + "</span></div>" : "") +
      (!compact && cc.drainage ? '<div><span class="sc-v">' + fmtN(cc.drainage.received) + '</span><span class="sc-l">about drainage</span><span class="sc-r">' + (cc.drainage.avgDays != null ? cc.drainage.avgDays + " days on average" : "") + "</span></div>" : "") +
      (!compact && c.actionNotInitiated != null ? '<div><span class="sc-v">' + fmtN(c.actionNotInitiated) + '</span><span class="sc-l">marked “action not initiated”</span><span class="sc-r">as recorded by BMC</span></div>' : "") +
      "</div>" + '<p class="axis-note">' + srcA(c.source || CMP.source, "Praja Foundation report") + (c.note ? " · " + esc(c.note) : "") + "</p>";
  }
  function floodBlock(w) {
    if (!FLOOD) return "";
    var spots = (FLOOD.spots || []).filter(function (s) { return s.ward === w; }), ps = (FLOOD.pumpingStations || []).filter(function (s) { return s.ward === w; });
    if (!spots.length && !ps.length) return "";
    return '<div class="section-head" style="margin-top:22px"><div><h3>Flooding</h3><p>Reported flooding spots and stormwater pumping stations in this ward. BMC has not published a full ward-wise list, so this is what news reports and BMC statements name.</p></div></div>' +
      '<ul class="cons nokm">' + spots.map(floodRow).concat(ps.map(pumpRow)).join("") + "</ul>";
  }
  function floodRow(s) {
    var bad = /still|despite|flooded|flooding/i.test(s.status || "") && !/mitigated|resolved/i.test(s.status || "");
    return '<li><span class="cn"><b>' + esc(s.name) + '</b><span class="sub">' + esc(s.action || "") + '</span><span class="sub">' + srcA(s.source) + (s.ward ? "" : " · ward not confirmed") + '</span></span><span class="cs"><span class="pill" style="color:var(' + (bad ? "--st-delayed" : /mitigat|resolv|addressed/i.test(s.status || "") ? "--st-completed" : "--st-notstarted") + ')">' + esc(s.status || "status not reported") + "</span></span></li>";
  }
  function pumpRow(s) {
    return '<li><span class="cn"><b>' + esc(s.name) + ' pumping station</b><span class="sub">' + [s.commissioned ? "commissioned " + esc(s.commissioned) : "", s.capacity ? esc(s.capacity) : ""].filter(Boolean).join(" · ") + '</span><span class="sub">' + srcA(s.source) + '</span></span><span class="cs"><span class="pill" style="color:var(' + (/operational/i.test(s.status || "") ? "--st-completed" : "--st-progress") + ')">' + esc(s.status || "") + "</span></span></li>";
  }
  // ---- elections, audits, roads, facilities, slum redevelopment (render only when published)
  var ELEC = CIVIC.elections || null, AUD = CIVIC.audits || null, ROADS = CIVIC.roads || null, FAC = CIVIC.facilities || null, SRA = CIVIC.sra || null;
  function rs(n) { return n == null ? "—" : "₹" + (n >= 1e7 ? (n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 }) + " cr" : Number(n).toLocaleString("en-IN")); }
  function electionBlock(m) {
    if (!ELEC) return "";
    var e = (ELEC.constituencies || []).find(function (x) { return x.no === m.no || x.constituency === m.constituency; }); if (!e) return "";
    function res(r, y) {
      if (!r || !r.winner) return "<tr><th>" + y + '</th><td colspan="3" class="muted">not available</td></tr>';
      return "<tr><th>" + y + "</th><td><b>" + esc(r.winner) + "</b><div class=\"sub\">" + esc(r.party || "") + (r.votes != null ? " · " + fmtN(r.votes) + " votes" : "") + "</div></td><td>" + esc(r.runnerUp || "—") + '<div class="sub">' + esc(r.runnerUpParty || "") + (r.runnerUpVotes != null ? " · " + fmtN(r.runnerUpVotes) + " votes" : "") + '</div></td><td class="num">' + (r.margin != null ? fmtN(r.margin) : "—") +  (r.unverified ? '<div class="sub">not confirmed by a second source</div>' : "") + "</td></tr>";
    }
    var a = e.assets || {}, ch = a.y2024 != null && a.y2019 != null && a.y2019 > 0 ? Math.round(100 * (a.y2024 - a.y2019) / a.y2019) : null;
    return '<section class="panel"><div class="section-head"><div><div class="eyebrow">Elections</div><h3>How ' + esc(m.constituency) + ' voted</h3></div><p>Assembly election results, cross-checked between two sources (see the note below). Margin is the winner’s lead over the runner-up.</p></div>' +
      '<div class="table-scroll"><table class="data"><thead><tr><th>Year</th><th>Winner</th><th>Runner-up</th><th class="num">Margin</th></tr></thead><tbody>' + res(e.r2024, "2024") + res(e.r2019, "2019") + "</tbody></table></div>" +
      (a.y2024 != null ? '<p style="margin:12px 0 0;font-size:.92rem">Declared assets: <b>' + rs(a.y2024) + "</b> in 2024" + (a.y2019 != null ? ", " + rs(a.y2019) + " in 2019" + (ch != null ? " (" + (ch >= 0 ? "+" : "") + ch + "%)" : "") : "; no 2019 declaration found on ADR (myneta)") + ". " + [a.y2024Url ? '<a href="' + esc(safeUrl(a.y2024Url)) + '" target="_blank" rel="noopener">2024 affidavit</a>' : "", a.y2019Url ? '<a href="' + esc(safeUrl(a.y2019Url)) + '" target="_blank" rel="noopener">2019 affidavit</a>' : ""].filter(Boolean).join(" · ") + "</p>" : "") +
      (a.note ? '<p class="axis-note">' + esc(a.note) + "</p>" : "") +
      '<p class="axis-note">' + esc(ELEC.note || "") + " " + srcA((e.r2024 || {}).source, "2024 result") + ((e.r2019 || {}).source ? " · " + srcA(e.r2019.source, "2019 result") : "") + " · Asset change is what the candidate declared; it is not an allegation.</p></section>";
  }
  function auditItems(filter) { return AUD ? (AUD.findings || []).filter(filter) : []; }
  function auditList(list) {
    return '<ol class="events">' + list.map(function (f) {
      var u = f.report && safeUrl(f.report.url);
      return '<li><div class="ev-head"><span class="pill" style="color:var(--st-partial)">Audit finding</span><span class="ev-date">' + esc(fmtDate(f.date || (f.report || {}).year)) + "</span>" + (f.agency ? '<span class="sub">' + esc(f.agency) + "</span>" : "") + "</div><div><b>" + esc(f.subject || "") + "</b></div><div>" + esc(f.finding || "") + (f.amountCr != null ? " <b>(" + crore(f.amountCr) + ")</b>" : "") + "</div>" +
        (f.response ? '<div class="sub">Agency’s response: ' + esc(f.response) + "</div>" : "") + (f.followUp ? '<div class="sub">Follow-up: ' + esc(f.followUp) + "</div>" : "") +
        '<div class="sub">' + (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc((f.report || {}).title || "Audit report") + "</a>" : esc((f.report || {}).title || "")) + (f.source && f.source.url && f.source.url !== (f.report || {}).url ? " · " + srcA(f.source) : "") + (f.verified ? " · source re-checked " + esc(fmtDate(f.verified)) : "") + "</div></li>";
    }).join("") + "</ol>";
  }
  function viewAudits() {
    var list = auditItems(function () { return true; }).sort(function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
    var byAg = {}; list.forEach(function (f) { byAg[f.agency || "Other"] = (byAg[f.agency || "Other"] || 0) + 1; });
    app.innerHTML = '<section class="lead"><div class="eyebrow">Money · audits</div><h2>What the auditors found</h2><p>Findings by the Comptroller and Auditor General (CAG), BMC’s chief auditor and the legislature’s Public Accounts Committee about Mumbai’s public works. An audit finding is the auditor’s observation: it is not a criminal finding, and the agency’s reply is shown where reported.</p></section>' +
      (list.length ? '<section class="panel"><div class="section-head"><div><div class="eyebrow">By agency</div><h3>' + plural(list.length, "finding") + "</h3></div></div>" + hbars(Object.keys(byAg).sort(function (a, b) { return byAg[b] - byAg[a]; }).map(function (k) { return { label: k, value: byAg[k], display: String(byAg[k]) }; })) + "</section>" +
        '<section class="panel">' + auditList(list) + "</section>" : '<p class="muted">Being compiled and checked.</p>');
  }
  function roadsPanel() {
    if (!ROADS) return "";
    return '<section class="panel"><div class="section-head"><div><div class="eyebrow">Roads</div><h3>Concrete roads programme</h3></div><p>' + esc(ROADS.note || "") + "</p></div>" +
      (ROADS.phases || []).map(function (ph) {
        return '<h4 style="margin:14px 0 6px">' + esc(ph.phase) + "</h4>" + '<p style="margin:0 0 8px;font-size:.9rem">' + [ph.km != null ? fmtN(ph.km) + " km" : "", ph.roads != null ? fmtN(ph.roads) + " roads" : "", ph.value != null ? crore(ph.value) : "", ph.deadline ? "due " + esc(fmtDate(ph.deadline)) : "", ph.revisedDeadline ? "now " + esc(fmtDate(ph.revisedDeadline)) : ""].filter(Boolean).join(" · ") + (ph.progress && (ph.progress.pct != null || ph.progress.kmDone != null) ? " · <b>" + (ph.progress.pct != null ? ph.progress.pct + "% done" : fmtN(ph.progress.kmDone) + " km done") + "</b> (" + esc(fmtDate(ph.progress.asOf)) + ")" : "") + "</p>" +
          ((ph.packages || []).length ? '<div class="table-scroll"><table class="data"><thead><tr><th>Zone</th><th>Contractor</th><th class="num">Value</th><th>Status</th></tr></thead><tbody>' + ph.packages.map(function (k) { return "<tr><td>" + esc(k.zone || "") + (k.wards && k.wards.length ? '<div class="sub">wards ' + esc(k.wards.join(", ")) + "</div>" : "") + "</td><td>" + esc(k.contractor || "—") + '</td><td class="num">' + (k.value != null ? crore(k.value) : "—") + "</td><td>" + esc(k.status || "") + (k.note ? '<div class="sub">' + esc(k.note) + "</div>" : "") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
          '<p class="axis-note">' + srcA(ph.source) + "</p>";
      }).join("") +
      ((ROADS.events || []).length ? '<h4 style="margin:14px 0 6px">Penalties and terminations</h4><ol class="events">' + ROADS.events.map(function (e) { return '<li><div class="ev-head"><span class="pill" style="color:var(--st-stalled)">' + esc(e.kind) + '</span><span class="ev-date">' + esc(fmtDate(e.date)) + "</span></div><div>" + esc(e.summary) + '</div><div class="sub">' + srcA(e.source) + "</div></li>"; }).join("") + "</ol>" : "") + "</section>";
  }
  function facilitiesPanel(w) {
    if (!FAC) return "";
    var hs = (FAC.hospitals || []).filter(function (h) { return !w || h.ward === w; });
    var cl = w ? (FAC.clinicsByWard || {})[w] : null;
    if (w && !hs.length && !cl) return "";
    return (w ? '<div class="section-head" style="margin-top:22px"><div><h3>Public hospitals and clinics</h3></div></div>' : '<section class="panel"><div class="section-head"><div><div class="eyebrow">Health</div><h3>BMC hospitals</h3></div><p>' + esc(FAC.note || "") + "</p></div>") +
      (hs.length ? '<div class="table-scroll"><table class="data"><thead><tr><th>Hospital</th><th>Type</th>' + (w ? "" : "<th>Ward</th>") + '<th class="num">Beds</th></tr></thead><tbody>' + hs.map(function (h) { return "<tr><td><b>" + esc(h.name) + '</b><div class="sub">' + esc(h.address || "") + "</div></td><td>" + esc(h.type || "") + "</td>" + (w ? "" : "<td>" + (h.ward ? '<a href="#ward-' + wardSlug(h.ward) + '">' + esc(h.ward) + "</a>" : "—") + "</td>") + '<td class="num">' + (h.beds != null ? fmtN(h.beds) : "—") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
      (cl ? '<p style="font-size:.9rem;margin:10px 0 0">' + [cl.dispensaries != null ? fmtN(cl.dispensaries) + " dispensaries" : "", cl.aaplaDawakhana != null ? fmtN(cl.aaplaDawakhana) + " Aapla Dawakhana clinics" : "", cl.healthPosts != null ? fmtN(cl.healthPosts) + " health posts" : ""].filter(Boolean).join(" · ") + " " + srcA(cl.source) + "</p>" : "") +
      (FAC.schools && FAC.schools.city && !w ? '<p style="font-size:.9rem;margin:12px 0 0">BMC schools: <b>' + fmtN(FAC.schools.city.count) + "</b>" + (FAC.schools.city.enrolment != null ? " with " + fmtN(FAC.schools.city.enrolment) + " students" : "") + (FAC.schools.city.year ? " (" + esc(FAC.schools.city.year) + ")" : "") + ". " + srcA(FAC.schools.city.source) + "</p>" : "") +
      (w ? "" : "</section>");
  }
  function sraPanel(w) {
    if (!SRA) return "";
    var sc = (SRA.schemes || []).filter(function (s) { return !w || s.ward === w; });
    if (w && !sc.length) return "";
    var c = SRA.city || {};
    return (w ? '<div class="section-head" style="margin-top:22px"><div><h3>Slum redevelopment schemes</h3><p>Schemes with a public record of delay or state action.</p></div></div>' : '<section class="panel"><div class="section-head"><div><div class="eyebrow">Slum redevelopment</div><h3>SRA schemes</h3></div><p>' + esc(c.note || SRA.note || "") + "</p></div>" +
      ((c.approved != null || c.stalled != null) ? '<section class="stats" style="margin:0 0 14px">' + [["Approved", c.approved], ["Completed", c.completed], ["Ongoing", c.ongoing], ["Stalled", c.stalled], ["Tenements built", c.tenements]].filter(function (x) { return x[1] != null; }).map(function (x) { return '<div class="stat' + (x[0] === "Stalled" ? " alert" : "") + '"><span class="label">' + x[0] + '</span><span class="value">' + fmtN(x[1]) + '</span><span class="sub">' + esc(c.period || "") + "</span></div>"; }).join("") + "</section>" + '<p class="axis-note">' + srcA(c.source) + "</p>" : "") +
      ((SRA.actions || []).length ? '<h4 style="margin:12px 0 6px">What the state has done</h4><ol class="events">' + SRA.actions.map(function (a) { return '<li><div class="ev-head"><span class="ev-date">' + esc(fmtDate(a.date)) + "</span></div><div>" + esc(a.what) + '</div><div class="sub">' + srcA(a.source) + "</div></li>"; }).join("") + "</ol>" : "")) +
      (sc.length ? '<ul class="cons nokm">' + sc.map(function (s) { return '<li><span class="cn"><b>' + esc(s.name) + "</b>" + (!w && s.ward ? ' <a href="#ward-' + wardSlug(s.ward) + '">' + wcode(s.ward) + "</a>" : "") + '<span class="sub">' + esc([s.locality, s.developer ? "developer: " + s.developer : ""].filter(Boolean).join(" · ")) + "</span>" + (s.events || []).map(function (e) { return '<span class="sub">' + esc(fmtDate(e.date)) + ": " + esc(e.kind && e.kind !== "Other" ? e.kind + ": " : "") + esc(e.summary) + "</span>"; }).join("") + '<span class="sub">' + srcA(s.source) + '</span></span><span class="cs"><span class="pill" style="color:var(' + (/stall/i.test(s.status || "") ? "--st-stalled" : /complet/i.test(s.status || "") ? "--st-completed" : "--st-delayed") + ')">' + esc(s.status || "") + "</span></span></li>"; }).join("") + "</ul>" : "") +
      (w ? "" : "</section>");
  }

  function viewServices() {
    var parts = [];
    if (CMP) {
      var ws = Object.keys(CMP.wards).filter(function (w) { return CMP.wards[w].avgDays != null; }).sort(function (a, b) { return CMP.wards[b].avgDays - CMP.wards[a].avgDays; });
      var tr = CMP.city.receivedTrend || {};
      parts.push('<section class="panel"><div class="section-head"><div><div class="eyebrow">Complaints · ' + esc(CMP.periodLabel || "2025") + '</div><h3>How quickly each ward closes residents’ complaints</h3></div><p>Average days from complaint to closure, slowest first. City average ' + esc(CMP.city.avgDays) + " days; " + esc(CMP.city.resolvedPct) + "% of " + fmtN(CMP.city.received) + ' complaints closed. Tap a ward to open it.</p></div>' +
        hbars(ws.map(function (w) { var c = CMP.wards[w]; return { label: wardTitle(w), value: c.avgDays, display: c.avgDays + " days", color: c.avgDays > CMP.city.avgDays ? "var(--st-delayed)" : "var(--accent)", attrs: ' data-ward-go="' + esc(w) + '"', tip: "<b>" + esc(wardTitle(w)) + "</b><br>" + fmtN(c.received) + " complaints · " + c.resolvedPct + "% closed" }; }), { note: "Orange: slower than the city average. " + srcA(CMP.source, "Praja Foundation, from BMC’s complaint system") + (CMP.note ? " · " + esc(CMP.note) : "") }) +
        (Object.keys(tr).length ? '<h4 style="margin:18px 0 8px">Complaints filed each year, whole city</h4>' + hbars(Object.keys(tr).sort().map(function (y) { return { label: y, value: tr[y], display: fmtN(tr[y]) }; })) : "") +
        ((CMP.city.topIssues || []).length ? '<h4 style="margin:18px 0 8px">What people complain about most</h4><div class="table-scroll"><table class="data"><thead><tr><th>Category</th><th class="num">Received</th><th class="num">Closed</th><th class="num">Avg days</th></tr></thead><tbody>' + CMP.city.topIssues.map(function (t) { return "<tr><td>" + esc(t.category) + '</td><td class="num">' + fmtN(t.received) + '</td><td class="num">' + (t.resolvedPct != null ? t.resolvedPct + "%" : fmtN(t.closed)) + '</td><td class="num">' + (t.avgDays != null ? t.avgDays : "—") + "</td></tr>"; }).join("") + "</tbody></table></div>" : "") +
        "</section>");
    }
    if (FLOOD) {
      var c = FLOOD.counts || {};
      parts.push('<section class="panel"><div class="section-head"><div><div class="eyebrow">Flooding · as of ' + esc(fmtDate(FLOOD.asOf)) + '</div><h3>Flood spots and pumping stations</h3></div><p>' + esc(c.summary || "") + "</p></div>" +
        (c.spots != null ? '<section class="stats" style="margin:0 0 14px"><div class="stat"><span class="label">Flood-prone spots</span><span class="value">' + fmtN(c.spots) + '</span><span class="sub">as counted by BMC</span></div><div class="stat"><span class="label">Addressed</span><span class="value">' + fmtN(c.addressed) + '</span><span class="sub">as stated by BMC</span></div>' + (c.pumpingStations != null ? '<div class="stat"><span class="label">Pumping stations</span><span class="value">' + fmtN(c.pumpingStations) + '</span><span class="sub">' + (c.miniPumpingStations != null ? "+ " + c.miniPumpingStations + " mini stations" : "") + "</span></div>" : "") + (c.dewateringPumps != null ? '<div class="stat"><span class="label">Dewatering pumps</span><span class="value">' + fmtN(c.dewateringPumps) + '</span><span class="sub">deployed for monsoon</span></div>' : "") + "</section>" : "") +
        '<h4 style="margin:6px 0 8px">Spots named in reports</h4><ul class="cons nokm">' + (FLOOD.spots || []).map(function (s) { return floodRow(s).replace("<b>" + esc(s.name) + "</b>", "<b>" + esc(s.name) + "</b>" + (s.ward ? ' <a class="wcode-link" href="#ward-' + wardSlug(s.ward) + '">' + wcode(s.ward) + "</a>" : "")); }).join("") + "</ul>" +
        '<h4 style="margin:18px 0 8px">Stormwater pumping stations</h4><ul class="cons nokm">' + (FLOOD.pumpingStations || []).map(pumpRow).join("") + "</ul>" +
        '<p class="axis-note">' + esc(FLOOD.note || "") + " " + srcA(FLOOD.source) + "</p></section>");
    }
    parts.push(roadsPanel(), facilitiesPanel(null), sraPanel(null));
    app.innerHTML = '<section class="lead"><div class="eyebrow">City services</div><h2>How the city is serving you</h2><p>Complaints and how fast each ward deals with them, flooding, roads, hospitals and slum redevelopment: published figures from BMC, the state and Praja Foundation, each with its source and period.</p></section>' + (parts.join("") || '<p class="muted">Being compiled.</p>');
    bindClicks(app, "[data-ward-go]", function (el) { go("#ward-" + wardSlug(el.dataset.wardGo)); });
  }

  var VIEWS = { area: viewAreaPicker, overview: viewOverview, map: viewMap, wards: viewWards, tenders: viewTenders, mlas: viewReps, contracts: viewContracts, schemes: viewSchemes, funding: viewFunding, about: viewAbout, latest: viewLatest, compare: viewCompare, services: viewServices, audits: viewAudits };
  var MONEY = { contracts: "Contracts", tenders: "Tenders", funding: "Funding", audits: "Audits" };
  function moneyTabs(active) {
    return '<nav class="subtabs" aria-label="Money">' + Object.keys(MONEY).map(function (k) { return '<a href="#' + k + '"' + (k === active ? ' aria-current="page" class="on"' : "") + ">" + MONEY[k] + (k === "tenders" ? ' <span class="count">' + OPEN_TENDERS.length + "</span>" : "") + "</a>"; }).join("") + "</nav>";
  }
  function setTab(tab) {
    if (MONEY[tab]) tab = "money";
    document.querySelectorAll("nav.tabs a, nav.bottom-nav a").forEach(function (a) {
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
    if (/^at-\d+-\d+/.test(name)) { setTab("area"); if (leafletMap) { leafletMap.remove(); leafletMap = null; } viewArea(name); window.scrollTo(0, 0); return; }
    var rm = name.match(/^(cor-(\d+)|mp-[a-z-]+)$/);
    if (rm) { setTab("mlas"); if (leafletMap) { leafletMap.remove(); leafletMap = null; } if (rm[2]) viewCorporator(rm[2]); else viewMp(name); window.scrollTo(0, 0); return; }
    var sub = name.match(/^(mla|co)-(.+)$/);
    if (sub) {
      setTab(sub[1] === "mla" ? "mlas" : "contracts");
      if (sub[1] === "co") setTimeout(function () { app.insertAdjacentHTML("afterbegin", moneyTabs("contracts")); }, 0);
      if (leafletMap) { leafletMap.remove(); leafletMap = null; }
      (sub[1] === "mla" ? viewMla : viewCompany)(sub[2]);
      if (sub[1] === "co") { var ca = auditItems(function (f) { return f.companySlug === sub[2]; }); if (ca.length) app.insertAdjacentHTML("beforeend", '<section class="panel"><div class="section-head"><div><div class="eyebrow">Audits</div><h3>What auditors found</h3></div><p>Observations in official audit reports that name this company. An audit finding is not a criminal finding.</p></div>' + auditList(ca) + "</section>"); }
      window.scrollTo(0, 0);
      return;
    }
    if (name === "explorer") { setTab("overview"); VIEWS.overview(); setTimeout(function () { var x = document.getElementById("explorer"); if (x) x.scrollIntoView({ block: "start" }); }, 30); return; }
    var tab = VIEWS[name] ? name : "overview";
    setTab(tab);
    if (tab !== "map" && leafletMap) { leafletMap.remove(); leafletMap = null; }
    ui.limit = 48;
    VIEWS[tab]();
    if (MONEY[tab]) app.insertAdjacentHTML("afterbegin", moneyTabs(tab));
    window.scrollTo(0, 0);
  }
  function route() {
    var h = location.hash;
    var tm = h.match(/^#t-(.+)$/);
    if (tm) { if (!app.innerHTML) render(lastHash); openTender(tm[1]); return; }
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

  document.getElementById("footer").innerHTML =
    '<div class="f-col f-about"><div class="board board-sm"><span class="deva" lang="mr">मुंबई सार्वजनिक कामे</span><span class="latin">Mumbai Public Works</span></div><p>An independent public record of government projects in Mumbai, the people responsible and the money involved. Built from official records and news reports; every fact is re-checked by a second reviewer. Compiled with AI assistance; <a href="#about">how</a>.</p><p class="muted">Data updated ' + esc(fmtDate(META.lastUpdated)) + ". Costs in ₹ crore (1 crore = 10 million).</p></div>" +
    '<div class="f-col"><h4>Explore</h4><a href="#area">Your area</a><a href="#overview">Projects</a><a href="#map">Map</a><a href="#wards">BMC wards</a><a href="#mlas">Representatives</a><a href="#latest">Latest updates</a><a href="#services">City services</a><a href="#compare">Compare</a></div>' +
    '<div class="f-col"><h4>Money</h4><a href="#contracts">Contracts</a><a href="#tenders">Tenders</a><a href="#funding">Funding</a><a href="#schemes">Schemes</a></div>' +
    '<div class="f-col"><h4>About</h4><a href="#about">Sources and method</a><a href="#about">How we check</a><a href="#glossary">What the words mean</a><span class="muted">Corrections: send the source link.</span></div>';
  var hq = document.getElementById("site-q");
  if (hq) {
    mountSearch(hq, document.getElementById("site-results"));
    document.addEventListener("keydown", function (e) { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); if (drawer.classList.contains("open")) closeDrawer(); hq.focus(); } });
  }

  // ---- change history (from git history of the data files)
  var HIST = window.PUBLIC_WORKS_HISTORY || { projects: {}, corporators: {} };
  function histVal(f, v) {
    if (v == null || v === "") return "—";
    if (f === "cost") return crore(v).replace(/<[^>]+>/g, "");
    if (f === "vacant") return v ? "yes" : "no";
    if (/Date$/.test(f)) return fmtDate(v);
    if (f === "progress") return v + "%";
    return String(v);
  }
  function histList(list, empty) {
    var ch = (list || []).filter(function (x) { return x.field !== "added"; });
    var added = (list || []).find(function (x) { return x.field === "added"; });
    return (ch.length ? '<ol class="events">' + ch.slice().reverse().map(function (x) {
      return '<li><div class="ev-head"><span class="ev-date">' + esc(fmtDate(x.date)) + '</span></div><div><b>' + esc(x.label || x.field) + ":</b> " + esc(histVal(x.field, x.from)) + " → <b>" + esc(histVal(x.field, x.to)) + "</b></div></li>";
    }).join("") + "</ol>" : '<p class="muted" style="margin:0">' + esc(empty) + "</p>") +
      '<p class="axis-note">' + (added ? "Tracked on this portal since " + esc(fmtDate(added.date)) + ". " : "") + "Dates are when the change was made here, which can be later than the event itself.</p>";
  }
  function historyLog() {
    var rows = [];
    Object.keys(HIST.projects || {}).forEach(function (id) { var p = PROJECTS.find(function (q) { return q.id === id; }); (HIST.projects[id] || []).forEach(function (x) { if (x.field !== "added" && p) rows.push({ x: x, who: p.shortName || p.name, href: "#p-" + id }); }); });
    Object.keys(HIST.corporators || {}).forEach(function (w) { (HIST.corporators[w] || []).forEach(function (x) { if (x.field !== "added") rows.push({ x: x, who: "Corporator, electoral ward " + w, href: "#cor-" + w }); }); });
    rows.sort(function (a, b) { return String(b.x.date).localeCompare(String(a.x.date)); });
    return '<section class="panel" id="changes"><div class="section-head"><div><div class="eyebrow">Changes and corrections</div><h3>Every change to a project or seat on this portal</h3></div><p>Status, cost, deadline and progress changes to projects, and corrections to corporator names, parties and vacancies, since ' + esc(fmtDate(HIST.since)) + '. Built automatically from the portal’s own history, so nothing is changed silently.</p></div>' +
      (rows.length ? '<div class="table-scroll"><table class="data"><thead><tr><th>Date</th><th>Record</th><th>Change</th></tr></thead><tbody>' + rows.map(function (r) { return "<tr><td style=\"white-space:nowrap\">" + esc(fmtDate(r.x.date)) + '</td><td><a href="' + r.href + '">' + esc(r.who) + "</a></td><td>" + esc(r.x.label) + ": " + esc(histVal(r.x.field, r.x.from)) + " → <b>" + esc(histVal(r.x.field, r.x.to)) + "</b></td></tr>"; }).join("") + "</tbody></table></div>" : '<p class="muted">No changes yet.</p>') +
      '<p class="axis-note">Spotted a mistake? Use “Suggest a correction” on any page, or <a href="' + REPO + '/issues?q=label%3Acorrection" target="_blank" rel="noopener">see corrections people have reported</a>.</p></section>';
  }

  // ================================================================ v6: use & share
  var REPO = "https://github.com/upadhyayameya/ControlApp";
  var SHARE_BASE = EMBED ? "https://claude.ai/artifact/BhZ5q6rVZy9fFqtKAA7Seq" : location.href.split("#")[0];
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem("pw-" + k)); localStorage.setItem("pw-" + k, JSON.stringify(v)); } catch (e) { return null; } }
  // ---- last visit (read once per session, then stamp today)
  var PREV_VISIT = (function () { var p = null; try { p = sessionStorage.getItem("pw-prev"); if (p == null) { p = store("visit") || ""; sessionStorage.setItem("pw-prev", p); } } catch (e) { p = store("visit") || ""; } store("visit", new Date(TODAY).toISOString().slice(0, 10)); return p || null; })();

  // ---- toast
  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }

  // ---- use my location
  function locateMe() {
    if (!navigator.geolocation) { toast("This browser can’t share its location. Type your locality instead."); return; }
    toast("Finding your location…");
    navigator.geolocation.getCurrentPosition(function (pos) {
      var la = pos.coords.latitude, ln = pos.coords.longitude;
      if (!wardAt(la, ln)) { toast("You seem to be outside BMC limits. Type a Mumbai locality instead."); return; }
      go("#" + placeSlug(la, ln) + "-here");
    }, function (err) {
      toast(err && err.code === 1 ? "Location permission was refused. Type your locality instead." : "Couldn’t get your location. Type your locality instead.");
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }
  function locateBtn() { return '<button type="button" class="btn locate" data-locate>' + icon("pin", 16) + "<span>Use my location</span></button>"; }
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-locate]"); if (b) { e.preventDefault(); locateMe(); } });

  // ---- share
  function pageFacts() {
    var h = location.hash, m;
    if ((m = h.match(/^#p-(.+)$/))) {
      var p = PROJECTS.find(function (x) { return x.id === decodeURIComponent(m[1]); }); if (!p) return null;
      return { kind: "Project", title: p.shortName || p.name, lines: [p.status + (p.progress != null ? " · " + p.progress + "% built" : ""), "Cost " + crore(cost(p)).replace(/<[^>]+>/g, "") + (overrunPct(p) ? " (+" + overrunPct(p) + "% over original)" : ""), (p.completedDate ? "Opened " + fmtDate(p.completedDate) : "Due " + fmtDate(p.revisedTargetDate || p.targetDate)), "Run by " + p.agency] };
    }
    if ((m = h.match(/^#ward-(.+)$/))) {
      var w = wardFromSlug(m[1]); if (WARD_NAMES.indexOf(w) === -1) return null; var r = wardCard(w);
      return { kind: "BMC ward", title: wardTitle(w), lines: [plural(r.projects, "project") + " · " + r.late + " delayed or stalled", plural(r.tenders, "open tender"), r.consLive + " active construction sites", "Ward officer: " + (r.officer || "not on file")] };
    }
    if ((m = h.match(/^#mla-(\d+)$/))) {
      var ml = MLAS.find(function (x) { return String(x.no) === m[1]; }); if (!ml) return null; var c = mlaCard(ml);
      return { kind: "MLA", title: ml.name, lines: [ml.constituency + " · " + ml.party, plural(c.ps.length, "project") + " in the constituency, " + c.late + " delayed", "Cases declared pending (2024 affidavit): " + (c.aff.pendingCases != null ? c.aff.pendingCases : "—"), "Praja score: " + (c.f.score != null ? c.f.score.toFixed(1) + "/100" : "not rated")] };
    }
    if ((m = h.match(/^#cor-(\d+)$/))) {
      var co = CORP_BY_WARD[+m[1]]; if (!co) return null;
      return { kind: "Corporator", title: co.vacant ? "Electoral ward " + m[1] + " (vacant)" : co.name, lines: ["Electoral ward " + m[1] + (co.area ? " · " + co.area : ""), (co.party || "") + (co.adminWard ? " · BMC ward " + co.adminWard : "")] };
    }
    if ((m = h.match(/^#at-\d+-\d+(?:-(.*))?$/))) {
      var t = (document.querySelector(".lead h2") || {}).textContent || "This area";
      var people = [].slice.call(document.querySelectorAll(".people .person .name")).slice(0, 3).map(function (n) { return n.textContent; });
      var aw = /^#at-(\d+)-(\d+)/.exec(h), awd = aw ? wardAt(+aw[1] / 1e4, +aw[2] / 1e4) : null;
      if (t === "Your location" || t === "This spot") t = awd ? wardTitle(awd) : "This area"; else if (awd) t += ", " + wardTitle(awd);
      return { kind: "Area", title: t, lines: people.length ? ["Representatives: " + people.join(", ")] : [] };
    }
    return null;
  }
  function shareUrl() { return SHARE_BASE + location.hash; }
  function shareLink() {
    var f = pageFacts() || { title: document.title, lines: [] }, url = shareUrl();
    var text = f.title + "\n" + f.lines.join("\n");
    if (navigator.share) { navigator.share({ title: f.title, text: text, url: url }).catch(function () {}); return; }
    var done = function () { toast("Link copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text + "\n" + url).then(done, function () { prompt("Copy this link", url); });
    else prompt("Copy this link", url);
  }
  function cardCanvas(f) {
    var W = 1200, H = 630, c = document.createElement("canvas"); c.width = W; c.height = H; var x = c.getContext("2d");
    x.fillStyle = "#0e2a3d"; x.fillRect(0, 0, W, H); x.fillStyle = "#f4c400"; x.fillRect(0, H - 14, W, 14);
    x.fillStyle = "#f4c400"; x.fillRect(64, 56, 360, 66); x.fillStyle = "#111"; x.font = "700 30px 'Anek Latin', Inter, sans-serif"; x.fillText("MUMBAI PUBLIC WORKS", 82, 100);
    x.fillStyle = "#a9bccb"; x.font = "600 24px Inter, sans-serif"; x.fillText(f.kind.toUpperCase(), 64, 178);
    x.fillStyle = "#f3f6f8"; x.font = "750 60px 'Anek Latin', Inter, sans-serif";
    var words = f.title.split(" "), line = "", y = 248, lines = [];
    words.forEach(function (w) { var t = line ? line + " " + w : w; if (x.measureText(t).width > W - 128 && line) { lines.push(line); line = w; } else line = t; }); lines.push(line);
    lines.slice(0, 2).forEach(function (l, i) { x.fillText(l, 64, y + i * 66); }); y += Math.min(lines.length, 2) * 66 + 18;
    x.font = "500 30px Inter, sans-serif"; x.fillStyle = "#dbe5ec";
    f.lines.slice(0, 4).forEach(function (l, i) { var s = l; while (x.measureText(s).width > W - 128 && s.length > 4) s = s.slice(0, -2); if (s !== l) s = s.trim() + "…"; x.fillText(s, 64, y + i * 44); });
    x.fillStyle = "#a9bccb"; x.font = "500 22px Inter, sans-serif"; x.fillText("Every fact linked to its source · " + fmtDate(new Date(TODAY).toISOString().slice(0, 10)), 64, H - 44);
    return c;
  }
  function shareImage() {
    var f = pageFacts(); if (!f) return;
    var c = cardCanvas(f), name = "mumbai-public-works-" + slug(f.title) + ".png";
    c.toBlob(function (blob) {
      var file = blob && window.File ? new File([blob], name, { type: "image/png" }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: f.title, text: f.title + " " + shareUrl() }).catch(function () {}); return; }
      var url = c.toDataURL("image/png");
      var m = document.getElementById("imgmodal");
      if (!m) { m = document.createElement("div"); m.id = "imgmodal"; m.className = "imgmodal"; document.body.appendChild(m); m.addEventListener("click", function (e) { if (e.target === m || e.target.closest("[data-x]")) m.hidden = true; }); }
      m.innerHTML = '<div class="imgbox" role="dialog" aria-label="Share image"><img src="' + url + '" alt="' + esc(f.title) + ' summary card"><div class="imgact"><a class="btn" download="' + esc(name) + '" href="' + url + '">Save image</a><button type="button" class="btn" data-x>Close</button></div><p class="axis-note">On a phone, press and hold the image to save or share it.</p></div>';
      m.hidden = false;
    }, "image/png");
  }
  function correctionUrl() {
    var f = pageFacts() || { title: (document.querySelector(".lead h2") || {}).textContent || document.title };
    var body = "**Page:** " + shareUrl() + "\n**Item:** " + f.title + "\n\n**What is wrong or missing:**\n\n\n**Source link that shows the correct information:**\n\n";
    return REPO + "/issues/new?labels=correction&title=" + encodeURIComponent("Correction: " + f.title) + "&body=" + encodeURIComponent(body);
  }
  function actionBar() {
    var hasCard = !!pageFacts();
    return '<div class="actions" data-actions>' +
      '<button type="button" class="btn ghost" data-share="link">' + icon("share", 16) + "<span>Share</span></button>" +
      (hasCard ? '<button type="button" class="btn ghost" data-share="img">' + icon("image", 16) + "<span>Share as image</span></button>" : "") +
      '<a class="btn ghost" target="_blank" rel="noopener" href="' + esc(correctionUrl()) + '">' + icon("flag", 16) + "<span>Suggest a correction</span></a></div>";
  }
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-share]"); if (!b) return; e.preventDefault(); if (b.dataset.share === "img") shareImage(); else shareLink(); });
  function decorate() {
    var h = location.hash;
    if (/^#p-/.test(h)) { var db = drawer.querySelector(".d-body"); if (db && !db.querySelector("[data-actions]")) db.insertAdjacentHTML("afterbegin", actionBar()); return; }
    if (/^#(ward-|mla-\d|cor-\d|mp-|at-\d|co-)/.test(h)) {
      var target = /^#ward-/.test(h) ? document.querySelector("#ward-detail .ward-hero > div") : app.querySelector(".lead");
      if (target && !target.querySelector("[data-actions]")) target.insertAdjacentHTML("beforeend", actionBar());
    }
    var mh = h.match(/^#(at-\d+-\d+)(?:-(.*))?$/);
    if (mh) { var lbl = (app.querySelector(".lead h2") || {}).textContent; store("area", { hash: "#" + mh[1] + (mh[2] && mh[2] !== "here" ? "-" + mh[2] : "-here"), label: mh[2] === "here" ? "Your location" : lbl, ward: wardAt(+mh[1].split("-")[1] / 1e4, +mh[1].split("-")[2] / 1e4) }); }
  }
  function myAreaLink() { var a = store("area"); return a && a.hash ? '<a class="myarea" href="' + esc(a.hash) + '">' + icon("pin", 15) + "<span>Your area: <b>" + esc(a.label || "saved place") + "</b>" + (a.ward ? " · " + esc(wardTitle(a.ward)) : "") + "</span> →</a>" : ""; }

  // ---- language: translate the portal's fixed text; records stay in English
  var I18N = window.PUBLIC_WORKS_I18N || { t: {}, langs: { en: "English" }, note: {} };
  var LANG = store("lang") || "en";
  var EN_OF = new WeakMap();
  function trText(en) { var r = I18N.t[en]; return r ? (LANG === "mr" ? r[0] : LANG === "hi" ? r[1] : null) : null; }
  function translateNode(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { var p = n.parentNode; return p && /^(SCRIPT|STYLE|TEXTAREA)$/.test(p.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    var n, list = []; while ((n = w.nextNode())) list.push(n);
    list.forEach(function (node) {
      var en = EN_OF.get(node); var cur = node.nodeValue;
      if (en == null) { var k = cur.trim(); if (!k || !I18N.t[k]) return; en = cur; EN_OF.set(node, en); }
      var key = en.trim(), out = LANG === "en" ? null : trText(key);
      var want = out ? en.replace(key, out) : en;
      if (cur !== want) node.nodeValue = want;
    });
    (root.querySelectorAll ? root.querySelectorAll("input[placeholder]") : []).forEach(function (i) {
      if (!i.dataset.enPh) i.dataset.enPh = i.placeholder;
      var tr = LANG === "en" ? null : trText("PH:" + i.dataset.enPh); var want = tr || i.dataset.enPh;
      if (i.placeholder !== want) i.placeholder = want;
    });
  }
  var trPending = false;
  function applyLang() {
    document.documentElement.lang = LANG === "en" ? "en" : LANG;
    translateNode(document.body);
    var ln = document.getElementById("lang-note");
    if (ln) { ln.hidden = LANG === "en"; ln.textContent = I18N.note[LANG] || ""; }
    document.querySelectorAll("#lang [data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.lang === LANG)); });
  }
  if (window.MutationObserver) new MutationObserver(function () { if (LANG === "en" || trPending) return; trPending = true; requestAnimationFrame(function () { trPending = false; translateNode(document.body); }); }).observe(document.body, { childList: true, subtree: true });
  (function mountLang() {
    var hdr = document.querySelector("header.site .wrap"); if (!hdr) return;
    hdr.insertAdjacentHTML("beforeend", '<div class="lang" id="lang" role="group" aria-label="Language">' + Object.keys(I18N.langs).map(function (k) { return '<button type="button" data-lang="' + k + '" lang="' + k + '" aria-pressed="' + (k === LANG) + '">' + esc(I18N.langs[k]) + "</button>"; }).join("") + "</div>");
    var nt = document.getElementById("notice"); if (nt) nt.insertAdjacentHTML("afterend", '<p class="lang-note" id="lang-note" hidden></p>');
    bindClicks(document.getElementById("lang"), "[data-lang]", function (el) { LANG = el.dataset.lang; store("lang", LANG); applyLang(); });
  })();

  function routeAll() { route(); decorate(); if (LANG !== "en") applyLang(); }
  if (!EMBED && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
  window.addEventListener("hashchange", routeAll);
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { if (leafletMap) viewMap(); });
  routeAll();
  applyLang();
})();
