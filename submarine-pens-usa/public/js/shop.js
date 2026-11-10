import { $, esc, img, priceLabel, ready, addToCart } from "/js/layout.js";

const params = new URLSearchParams(location.search);
let state = {
  category: params.get("category") || "All",
  q: params.get("q") || "",
  sort: params.get("sort") || "featured",
};
let products = [];

const CATEGORY_ORDER = ["Fountain Pens", "Roller Pens", "Ball Pens", "Gift Sets", "Ink & Refills", "Kids", "More"];

function syncUrl() {
  const p = new URLSearchParams();
  if (state.category !== "All") p.set("category", state.category);
  if (state.q) p.set("q", state.q);
  if (state.sort !== "featured") p.set("sort", state.sort);
  history.replaceState(null, "", p.toString() ? `/?${p}` : "/");
}

function renderFilters() {
  const counts = products.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
  const cats = ["All", ...CATEGORY_ORDER.filter((c) => counts[c]), ...Object.keys(counts).filter((c) => !CATEGORY_ORDER.includes(c))];
  $("#filters").innerHTML = cats
    .map((c) => `<button type="button" aria-pressed="${c === state.category}" data-cat="${esc(c)}">${esc(c)}${c === "All" ? "" : ` <span>${counts[c]}</span>`}</button>`)
    .join("");
}

function visible() {
  const q = state.q.trim().toLowerCase();
  let list = products.filter(
    (p) => (state.category === "All" || p.category === state.category) && (!q || `${p.name} ${p.category}`.toLowerCase().includes(q))
  );
  const price = (p) => p.min_price_cents ?? Infinity;
  if (state.sort === "price-asc") list = [...list].sort((a, b) => price(a) - price(b));
  if (state.sort === "price-desc") list = [...list].sort((a, b) => (b.min_price_cents ?? -1) - (a.min_price_cents ?? -1));
  if (state.sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function card(p) {
  const single = p.variants.length === 1 && p.purchasable;
  const action = single
    ? `<button class="btn small" data-add="${esc(p.variants[0].id)}">Add to cart</button>`
    : p.purchasable
      ? `<a class="btn small ghost" href="/products/${esc(p.id)}">Choose options</a>`
      : "";
  return `
  <article class="card">
    <a class="card-art" href="/products/${esc(p.id)}" aria-label="${esc(p.name)}">
      <img src="${esc(img(p.image, 480))}" alt="${esc(p.name)}" loading="lazy" width="480" height="480" />
      ${p.image2 ? `<img class="alt" src="${esc(img(p.image2, 480))}" alt="" loading="lazy" width="480" height="480" />` : ""}
    </a>
    <div class="card-body">
      <span class="tag">${esc(p.category)}</span>
      <h3><a href="/products/${esc(p.id)}">${esc(p.name)}</a></h3>
      <div class="card-foot">
        <span class="price ${p.min_price_cents == null ? "muted" : ""}">${esc(priceLabel(p))}</span>
        ${action}
      </div>
    </div>
  </article>`;
}

function render() {
  const list = visible();
  $("#count").textContent = `${list.length} ${list.length === 1 ? "product" : "products"}`;
  $("#grid").innerHTML = list.length
    ? list.map(card).join("")
    : `<p class="muted empty">No products match your search.</p>`;
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.cat) {
    state.category = t.dataset.cat;
    renderFilters(); render(); syncUrl();
  }
  if (t.dataset.add) addToCart(t.dataset.add);
});
$("#search").value = state.q;
$("#search").addEventListener("input", (e) => { state.q = e.target.value; render(); syncUrl(); });
$("#sort").value = state.sort;
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; render(); syncUrl(); });

ready
  .then((s) => {
    products = s.products;
    if (state.category !== "All" && !products.some((p) => p.category === state.category)) state.category = "All";
    renderFilters();
    render();
  })
  .catch(() => {
    $("#grid").innerHTML = `<p class="error">We couldn't load the products. Please refresh the page.</p>`;
  });
