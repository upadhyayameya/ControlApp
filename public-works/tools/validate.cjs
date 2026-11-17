#!/usr/bin/env node
// Validate every data file the page loads. Run: node tools/validate.cjs
// Loads the <script src="data/..."> files listed in index.html, in order, then checks each project.
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");

function loadAll() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const files = [...html.matchAll(/<script src="(data\/[^"]+)"/g)].map((m) => m[1]);
  const ctx = { window: {} };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
  return { files, D: ctx.window.PUBLIC_WORKS_DATA, R: ctx.window.PUBLIC_WORKS_ROUTES || {} };
}

const STATUSES = ["Completed", "Partially open", "In progress", "Delayed", "Stalled", "Not started"];
const FUNDER_TYPES = ["Central Govt", "State Govt", "Municipal", "Multilateral", "Private / PPP"];
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function validate({ D, R }) {
  const errors = [], warnings = [];
  const consts = new Set(D.mlas.map((m) => m.constituency));
  const ids = new Set();
  for (const p of D.projects) {
    const e = (msg) => errors.push(`${p.id || "(no id)"}: ${msg}`);
    const w = (msg) => warnings.push(`${p.id}: ${msg}`);
    if (!p.id) e("missing id");
    if (ids.has(p.id)) e("duplicate id");
    ids.add(p.id);
    if (!p.name) e("missing name");
    if (!STATUSES.includes(p.status)) e(`bad status "${p.status}"`);
    if (p.progress != null && !(p.progress >= 0 && p.progress <= 100)) e(`bad progress ${p.progress}`);
    if (!p.agency) e("missing agency");
    if (!p.cost || typeof p.cost !== "object") e("missing cost object");
    for (const k of ["startDate", "targetDate", "revisedTargetDate", "completedDate"])
      if (p[k] != null && !DATE.test(p[k])) e(`${k} not ISO: "${p[k]}"`);
    if (p.status === "Completed" && !p.completedDate) w("completed but no completedDate");
    for (const f of p.funders || []) if (!FUNDER_TYPES.includes(f.type)) e(`funder "${f.name}" bad type "${f.type}"`);
    for (const c of p.constituencies || []) if (!consts.has(c)) e(`unknown constituency "${c}"`);
    if (!(p.sources || []).length) e("no sources");
    for (const s of p.sources || []) if (!/^https?:\/\//.test(s.url || "")) e(`bad source url "${s.url}"`);
    if (!p.citywide && !R[p.id] && !p.location) w("no map points (won't appear on map or in wards)");
    for (const path of R[p.id] || []) for (const pt of path)
      if (!(pt[0] > 18.85 && pt[0] < 19.5 && pt[1] > 72.7 && pt[1] < 73.2)) w(`point "${pt[2]}" far from Mumbai: ${pt[0]},${pt[1]}`);
  }
  // Staleness: statuses go out of date. Flag records not re-checked recently (default 180 days).
  const staleDays = Number((process.argv.find(a => a.startsWith("--stale-days=")) || "").split("=")[1]) || 180;
  const now = Date.now(), stale = [];
  for (const p of D.projects) {
    const t = Date.parse(p.lastVerified || "");
    if (!t || (now - t) / 864e5 > staleDays) stale.push(p.id);
  }
  if (stale.length) warnings.push(`${stale.length} projects not re-checked in ${staleDays} days: ${stale.slice(0, 20).join(", ")}${stale.length > 20 ? " ..." : ""}`);
  return { errors, warnings, stale };
}

if (require.main === module) {
  const all = loadAll();
  const { errors, warnings } = validate(all);
  console.log(`${all.D.projects.length} projects from ${all.files.length} data files`);
  warnings.forEach((m) => console.log("warn  " + m));
  errors.forEach((m) => console.log("ERROR " + m));
  process.exit(errors.length ? 1 : 0);
}
module.exports = { loadAll, validate };
