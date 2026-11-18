import { $, $$, esc, productCard, colourFamily, FAMILY_SWATCH, ready, registerPanel, searchProducts, observeReveals } from "/js/layout.js";

const CATS = ["Fountain Pens", "Roller Pens", "Ball Pens", "Gift Sets", "Ink & Refills"];
const INTRO = {
  "Fountain Pens": "Gold-tone nibs, metal bodies and the Royal Edition Lion series, for writing that feels like a ritual.",
  "Roller Pens": "Smooth, wet-ink writing with the weight and balance of a fine pen.",
  "Ball Pens": "Everyday reliability in lacquer, metal and gift-worthy finishes.",
  "Gift Sets": "Pen sets, diary combos and scented collections, boxed and ready to give.",
  "Ink & Refills": "Scented fountain pen inks, cartridges and refills to keep your Submarine writing.",
};
const PRICES = [
  ["u15", "Under $15", 0, 1500],
  ["15-25", "$15 – $25", 1500, 2500],
  ["25-40", "$25 – $40", 2500, 4000],
  ["40", "$40 and over", 4000, Infinity],
];
const PAGE = 24;

const params = new URLSearchParams(location.search);
const state = {
  category: CATS.includes(params.get("category")) ? params.get("category") : "",
  q: params.get("q") || "",
  sort: params.get("sort") || "featured",
  prices: new Set((params.get("price") || "").split(",").filter(Boolean)),
  colours: new Set((params.get("colour") || "").split(",").filter(Boolean)),
  newOnly: params.get("new") === "1",
  shown: PAGE,
};
let products = [];


function syncUrl() {
  const p = new URLSearchParams();
  if (state.category) p.set("category", state.category);
  if (state.q) p.set("q", state.q);
  if (state.sort !== "featured") p.set("sort", state.sort);
  if (state.prices.size) p.set("price", [...state.prices].join(","));
  if (state.colours.size) p.set("colour", [...state.colours].join(","));
  if (state.newOnly) p.set("new", "1");
  history.replaceState(null, "", p.toString() ? `/shop?${p}` : "/shop");
}

function filtered({ ignoreCategory = false } = {}) {
  let list = state.q ? searchProducts(products, state.q) : products.slice();
  if (!ignoreCategory && state.category) list = list.filter((p) => p.category === state.category);
  if (state.newOnly) list = list.filter((p) => p.new);
  if (state.prices.size) {
    const ranges = PRICES.filter(([k]) => state.prices.has(k));
    list = list.filter((p) => p.min_price_cents != null && ranges.some(([, , lo, hi]) => p.min_price_cents >= lo && p.min_price_cents < hi));
  }
  if (state.colours.size) list = list.filter((p) => p.variants.some((v) => state.colours.has(colourFamily(v.title))));
  const price = (p) => p.min_price_cents ?? Infinity;
  if (state.sort === "price-asc") list.sort((a, b) => price(a) - price(b));
  else if (state.sort === "price-desc") list.sort((a, b) => (b.min_price_cents ?? -1) - (a.min_price_cents ?? -1));
  else if (state.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  else if (state.sort === "new") list.sort((a, b) => Number(b.new) - Number(a.new));
  else if (!state.q) {
    // featured: named products and colour families first, placeholders last
    const rank = (p) => (/^Submarine /.test(p.name) ? 1 : 0) - (p.variants.length > 1 ? 0.5 : 0) - (p.new ? 0.25 : 0);
    list.sort((a, b) => rank(a) - rank(b));
  }
  return list;
}

function renderHead() {
  const c = state.category;
  document.title = `${c || "Shop All Pens"} | Submarine Pens USA`;
  $("#shopTitle").textContent = state.q ? `Results for “${state.q}”` : c || "Shop all pens";
  $("#crumbHere").textContent = c || "Shop";
  $("#shopIntro").textContent = INTRO[c] || "Fountain, roller and ball pens, gift sets and scented inks from the 2026–27 collection.";
  const counts = filtered({ ignoreCategory: true }).reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  $("#catPills").innerHTML = [["", "All", total], ...CATS.map((k) => [k, k, counts[k] || 0])]
    .map(([k, label, n]) => `<a href="#" data-cat="${esc(k)}" ${state.category === k ? 'aria-current="true"' : ""}>${esc(label)} <span class="muted">${n}</span></a>`)
    .join("");
}

function renderFilters() {
  $("#priceFilters").innerHTML = PRICES.map(
    ([k, label]) => `<label class="check"><input type="checkbox" data-price="${k}" ${state.prices.has(k) ? "checked" : ""}/>${label}</label>`
  ).join("");
  const present = new Set();
  for (const p of products) for (const v of p.variants) { const f = colourFamily(v.title); if (f) present.add(f); }
  $("#colourFilters").innerHTML = Object.keys(FAMILY_SWATCH)
    .filter((f) => present.has(f))
    .map((c) => `<button type="button" title="${esc(c)}" aria-label="${esc(c)}" data-colour="${esc(c)}" aria-pressed="${state.colours.has(c)}" style="background:${FAMILY_SWATCH[c]}"></button>`)
    .join("");
  $("#newOnly").checked = state.newOnly;
}

function renderActive() {
  const chips = [];
  for (const k of state.prices) chips.push(`<button type="button" data-unprice="${k}">${PRICES.find((p) => p[0] === k)[1]} ✕</button>`);
  for (const c of state.colours) chips.push(`<button type="button" data-uncolour="${esc(c)}">${esc(c)} ✕</button>`);
  if (state.newOnly) chips.push(`<button type="button" data-unnew>New ✕</button>`);
  if (state.q) chips.push(`<button type="button" data-unq>“${esc(state.q)}” ✕</button>`);
  if (chips.length) chips.push(`<button type="button" class="clear" data-clearall>Clear all</button>`);
  $("#activeFilters").innerHTML = chips.join("");
}

function render() {
  const list = filtered();
  $("#count").textContent = `${list.length} ${list.length === 1 ? "product" : "products"}`;
  const shown = Math.min(state.shown, list.length);
  $("#grid").innerHTML = list.length
    ? list.slice(0, shown).map((p, i) => productCard(p, { eager: i < 6 })).join("")
    : `<div class="empty"><p>No products match these filters.</p><button class="btn ghost" type="button" data-clearall>Clear filters</button></div>`;
  $("#loadMore").hidden = shown >= list.length;
  $("#shown").textContent = `Showing ${shown} of ${list.length}`;
  $("#shownBar").style.width = `${(shown / Math.max(1, list.length)) * 100}%`;
  renderHead();
  renderActive();
  syncUrl();
}

function update(fn) {
  fn();
  state.shown = PAGE;
  render();
}

// events
const filtersPanel = registerPanel($("#filters"));
const mq = matchMedia("(max-width: 900px)");
const syncPanelMode = () => {
  const f = $("#filters");
  if (!mq.matches) { f.classList.remove("open"); f.removeAttribute("inert"); f.setAttribute("aria-hidden", "false"); }
  else if (!f.classList.contains("open")) { f.setAttribute("inert", ""); f.setAttribute("aria-hidden", "true"); }
};
mq.addEventListener("change", syncPanelMode);
syncPanelMode();
$("#filtersOpen").addEventListener("click", () => filtersPanel(true));
$("#filtersClose").addEventListener("click", () => filtersPanel(false));
$("#filtersApply").addEventListener("click", () => filtersPanel(false));
$("#filtersClear").addEventListener("click", () => update(() => { state.prices.clear(); state.colours.clear(); state.newOnly = false; renderFilters(); }));

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-cat],[data-colour],[data-unprice],[data-uncolour],[data-unnew],[data-unq],[data-clearall],#moreBtn");
  if (!t) return;
  if (t.dataset.cat !== undefined) { e.preventDefault(); update(() => (state.category = t.dataset.cat)); window.scrollTo({ top: 0, behavior: "smooth" }); }
  if (t.dataset.colour) update(() => { state.colours.has(t.dataset.colour) ? state.colours.delete(t.dataset.colour) : state.colours.add(t.dataset.colour); t.setAttribute("aria-pressed", String(state.colours.has(t.dataset.colour))); });
  if (t.dataset.unprice) update(() => { state.prices.delete(t.dataset.unprice); renderFilters(); });
  if (t.dataset.uncolour) update(() => { state.colours.delete(t.dataset.uncolour); renderFilters(); });
  if (t.dataset.unnew !== undefined) update(() => { state.newOnly = false; renderFilters(); });
  if (t.dataset.unq !== undefined) update(() => { state.q = ""; $("#q").value = ""; });
  if (t.dataset.clearall !== undefined) update(() => { state.prices.clear(); state.colours.clear(); state.newOnly = false; state.q = ""; $("#q").value = ""; renderFilters(); });
  if (t.id === "moreBtn") { state.shown += PAGE; render(); }
});
$("#priceFilters").addEventListener("change", (e) => {
  const k = e.target.dataset.price;
  if (k) update(() => (e.target.checked ? state.prices.add(k) : state.prices.delete(k)));
});
$("#newOnly").addEventListener("change", (e) => update(() => (state.newOnly = e.target.checked)));
let qTimer;
$("#q").value = state.q;
$("#q").addEventListener("input", (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => update(() => (state.q = e.target.value.trim())), 150);
});
$("#sort").value = state.sort;
$("#sort").addEventListener("change", (e) => update(() => (state.sort = e.target.value)));

ready
  .then((s) => {
    products = s.products;
    renderFilters();
    render();
    observeReveals();
  })
  .catch(() => {
    $("#grid").innerHTML = `<p class="error">We couldn't load the products. Please refresh the page.</p>`;
  });
