const CART_KEY = "subpens-cart";
const $ = (id) => document.getElementById(id);
const usd = (cents) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

let products = [];
let shipping = { flat_cents: 0, free_over_cents: 0 };
let cart = loadCart(); // { [id]: qty }
let activeCategory = "All";

function loadCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; }
}
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
}

function penSvg(color, category) {
  if (category === "Ink") {
    return `<svg viewBox="0 0 120 120" aria-hidden="true">
      <rect x="38" y="22" width="44" height="16" rx="3" fill="#2b2f36"/>
      <rect x="28" y="38" width="64" height="62" rx="10" fill="${color}"/>
      <rect x="38" y="56" width="44" height="24" rx="3" fill="#f4efe6" opacity=".9"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    <g transform="rotate(-38 60 60)">
      <rect x="14" y="52" width="58" height="16" rx="8" fill="${color}"/>
      <rect x="66" y="53" width="22" height="14" rx="3" fill="${color}" opacity=".85"/>
      <rect x="20" y="49" width="30" height="3" rx="1.5" fill="#c9a84a"/>
      <path d="M88 54 L106 60 L88 66 Z" fill="#c9a84a"/>
      <line x1="92" y1="60" x2="104" y2="60" stroke="#2b2f36" stroke-width="1"/>
    </g>
  </svg>`;
}

function renderFilters() {
  const cats = ["All", ...new Set(products.map((p) => p.category))];
  $("filters").innerHTML = cats
    .map((c) => `<button role="tab" aria-selected="${c === activeCategory}" data-cat="${c}">${c}</button>`)
    .join("");
}

function renderGrid() {
  const list = products.filter((p) => activeCategory === "All" || p.category === activeCategory);
  $("grid").innerHTML = list
    .map(
      (p) => `
    <article class="card">
      <div class="art">${penSvg(p.color, p.category)}</div>
      <div class="card-body">
        <span class="tag">${p.category}</span>
        <h3>${p.name}</h3>
        <p>${p.description}</p>
        <div class="card-foot">
          <strong>${usd(p.price_cents)}</strong>
          ${
            p.in_stock
              ? `<button class="btn small" data-add="${p.id}">Add to cart</button>`
              : `<span class="muted">Sold out</span>`
          }
        </div>
      </div>
    </article>`
    )
    .join("");
}

function cartLines() {
  return Object.entries(cart)
    .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
    .filter((l) => l.product && l.product.in_stock && l.qty > 0);
}

function shippingFor(subtotal) {
  if (subtotal === 0) return 0;
  if (shipping.free_over_cents > 0 && subtotal >= shipping.free_over_cents) return 0;
  return shipping.flat_cents;
}

function renderCart() {
  const lines = cartLines();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.product.price_cents, 0);
  const ship = shippingFor(subtotal);
  $("cartCount").textContent = count;
  $("cartItems").innerHTML = lines.length
    ? lines
        .map(
          ({ product: p, qty }) => `
      <div class="line">
        <div class="line-art">${penSvg(p.color, p.category)}</div>
        <div class="line-info">
          <div class="line-name">${p.name}</div>
          <div class="muted small">${usd(p.price_cents)} each</div>
          <div class="qty">
            <button data-dec="${p.id}" aria-label="Decrease">−</button>
            <span>${qty}</span>
            <button data-inc="${p.id}" aria-label="Increase">+</button>
            <button class="link" data-remove="${p.id}">Remove</button>
          </div>
        </div>
        <div class="line-total">${usd(p.price_cents * qty)}</div>
      </div>`
        )
        .join("")
    : `<p class="muted empty">Your cart is empty.</p>`;
  $("subtotal").textContent = usd(subtotal);
  $("shipping").textContent = subtotal === 0 ? "—" : ship === 0 ? "Free" : usd(ship);
  $("total").textContent = usd(subtotal + ship);
  $("checkoutBtn").disabled = lines.length === 0;
}

function setQty(id, qty) {
  if (qty <= 0) delete cart[id];
  else cart[id] = Math.min(qty, 20);
  saveCart();
  renderCart();
}

function openCart(open) {
  $("drawer").classList.toggle("open", open);
  $("drawer").setAttribute("aria-hidden", String(!open));
  $("overlay").hidden = !open;
}

async function checkout() {
  const btn = $("checkoutBtn");
  $("checkoutError").textContent = "";
  btn.disabled = true;
  btn.textContent = "Redirecting to secure checkout…";
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cartLines().map((l) => ({ id: l.product.id, qty: l.qty })) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed.");
    window.location.href = data.url;
  } catch (err) {
    $("checkoutError").textContent = err.message;
    btn.disabled = false;
    btn.textContent = "Checkout securely";
  }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.cat) { activeCategory = t.dataset.cat; renderFilters(); renderGrid(); }
  if (t.dataset.add) { setQty(t.dataset.add, (cart[t.dataset.add] || 0) + 1); openCart(true); }
  if (t.dataset.inc) setQty(t.dataset.inc, (cart[t.dataset.inc] || 0) + 1);
  if (t.dataset.dec) setQty(t.dataset.dec, (cart[t.dataset.dec] || 0) - 1);
  if (t.dataset.remove) setQty(t.dataset.remove, 0);
});
$("cartBtn").addEventListener("click", () => openCart(true));
$("closeCart").addEventListener("click", () => openCart(false));
$("overlay").addEventListener("click", () => openCart(false));
document.addEventListener("keydown", (e) => e.key === "Escape" && openCart(false));
$("checkoutBtn").addEventListener("click", checkout);
$("year").textContent = new Date().getFullYear();

(async function init() {
  try {
    const res = await fetch("/api/products");
    const data = await res.json();
    products = data.products;
    shipping = data.shipping;
    if (shipping.free_over_cents > 0) $("shipNote").textContent = `Free US shipping on orders over ${usd(shipping.free_over_cents)}.`;
    if (data.checkout_mode === "demo") $("modeNote").textContent = "Demo mode — no payment will be taken.";
    else if (data.checkout_mode === "sandbox") $("modeNote").textContent = "Square sandbox — use a test card.";
    renderFilters();
    renderGrid();
    renderCart();
  } catch {
    $("grid").innerHTML = `<p class="error">Couldn't load products. Please refresh.</p>`;
  }
})();
