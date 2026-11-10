// Shared header, footer, cart drawer and helpers for every page.

const CART_KEY = "subpens-cart-v2"; // { [variantId]: qty }
export const $ = (sel, root = document) => root.querySelector(sel);
export const usd = (cents) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const img = (src, width) => (src ? `${src}${src.includes("?") ? "&" : "?"}width=${width}` : "");

export function priceLabel(p) {
  if (p.min_price_cents == null) return "Price coming soon";
  if (p.min_price_cents === p.max_price_cents) return usd(p.min_price_cents);
  return `From ${usd(p.min_price_cents)}`;
}

// ---------- data ----------
let storePromise;
export function loadStore() {
  if (!storePromise) {
    storePromise = fetch("/api/products")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load store");
        return r.json();
      })
      .then((data) => {
        const variants = new Map();
        for (const p of data.products) for (const v of p.variants) variants.set(v.id, { product: p, variant: v });
        return { ...data, variants };
      });
  }
  return storePromise;
}

// ---------- cart ----------
function readCart() {
  try {
    const c = JSON.parse(localStorage.getItem(CART_KEY));
    return c && typeof c === "object" ? c : {};
  } catch {
    return {};
  }
}
let cart = readCart();
function writeCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
}

export function addToCart(variantId, qty = 1) {
  cart[variantId] = Math.min((cart[variantId] || 0) + qty, 20);
  writeCart();
  renderCart();
  openCart(true);
}
function setQty(variantId, qty) {
  if (qty <= 0) delete cart[variantId];
  else cart[variantId] = Math.min(qty, 20);
  writeCart();
  renderCart();
}

// ---------- chrome ----------
const NAV = [
  ["/", "Shop"],
  ["/about", "About"],
  ["/contact", "Contact"],
];

function headerHtml() {
  const here = location.pathname.replace(/\/$/, "") || "/";
  return `
  <a class="skip" href="#main">Skip to content</a>
  <div class="announce" id="announce"></div>
  <header class="site-header">
    <div class="wrap header-row">
      <button class="menu-btn" id="menuBtn" aria-label="Menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <a class="brand" href="/" aria-label="Submarine Pens USA home">
        <img src="/img/logo.png" alt="Submarine Pens" width="132" height="58" />
        <span class="brand-usa">USA</span>
      </a>
      <nav class="nav" id="nav" aria-label="Main">
        ${NAV.map(([href, label]) => `<a href="${href}" ${here === href ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
      <button class="cart-btn" id="cartBtn" aria-label="Open cart">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M5 7h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 7Zm3 0V6a4 4 0 0 1 8 0v1"/></svg>
        <span class="badge" id="cartCount" hidden>0</span>
      </button>
    </div>
  </header>`;
}

function footerHtml() {
  return `
  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div>
        <img class="footer-logo" src="/img/logo.png" alt="Submarine Pens" width="132" height="58" />
        <p data-cfg="tagline"></p>
      </div>
      <div>
        <h4>Shop</h4>
        <a href="/">All products</a>
        <a href="/?category=Fountain%20Pens">Fountain pens</a>
        <a href="/?category=Roller%20Pens">Roller pens</a>
        <a href="/?category=Ball%20Pens">Ball pens</a>
      </div>
      <div>
        <h4>Help</h4>
        <a href="/contact">Contact us</a>
        <a href="/policies/shipping">Shipping</a>
        <a href="/policies/returns">Returns &amp; refunds</a>
        <a href="/policies/privacy">Privacy policy</a>
        <a href="/policies/terms">Terms of service</a>
      </div>
      <div>
        <h4>Company</h4>
        <a href="/about">About Submarine Pens</a>
        <a data-cfg-href="india_site_url" href="https://www.submarinepens.com" rel="noopener">Shopping from India?</a>
        <a data-cfg-mailto="support_email" href="#"><span data-cfg="support_email"></span></a>
      </div>
    </div>
    <div class="wrap footer-base">
      <span>© ${new Date().getFullYear()} <span data-cfg="legal_name">Submarine Pens</span>. All prices in USD.</span>
      <span>Secure payments by Square</span>
    </div>
  </footer>`;
}

function drawerHtml() {
  return `
  <div class="overlay" id="overlay" hidden></div>
  <aside class="drawer" id="drawer" aria-label="Shopping cart" aria-hidden="true" inert>
    <div class="drawer-head">
      <h2>Your cart</h2>
      <button class="icon-btn" id="closeCart" aria-label="Close cart">✕</button>
    </div>
    <div class="drawer-body" id="cartItems"></div>
    <div class="drawer-foot">
      <div class="ship-progress" id="shipProgress"></div>
      <div class="row"><span>Subtotal</span><span id="subtotal">$0.00</span></div>
      <div class="row"><span>Shipping</span><span id="shipping">—</span></div>
      <div class="row total"><span>Total</span><span id="total">$0.00</span></div>
      <p class="muted small">Sales tax, if applicable, is calculated at checkout.</p>
      <p class="error" id="checkoutError" role="alert"></p>
      <button class="btn block" id="checkoutBtn" disabled>Checkout securely</button>
      <p class="muted small center" id="modeNote"></p>
    </div>
  </aside>`;
}

function openCart(open) {
  const d = $("#drawer");
  d.classList.toggle("open", open);
  d.setAttribute("aria-hidden", String(!open));
  d.toggleAttribute("inert", !open);
  $("#overlay").hidden = !open;
  document.body.classList.toggle("no-scroll", open);
  if (open) $("#closeCart").focus();
}

let store = null;

function cartLines() {
  if (!store) return [];
  return Object.entries(cart)
    .map(([id, qty]) => ({ ...(store.variants.get(id) || {}), id, qty }))
    .filter((l) => l.variant && l.variant.purchasable && l.qty > 0);
}

function shippingFor(subtotal) {
  const s = store?.config?.shipping || {};
  const flat = Math.round(Number(s.flat_rate_usd || 0) * 100);
  const free = Math.round(Number(s.free_over_usd || 0) * 100);
  if (subtotal === 0) return 0;
  return free > 0 && subtotal >= free ? 0 : flat;
}

function renderCart() {
  if (!store) return;
  const lines = cartLines();
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.variant.price_cents, 0);
  const ship = shippingFor(subtotal);
  const badge = $("#cartCount");
  badge.textContent = count;
  badge.hidden = count === 0;

  $("#cartItems").innerHTML = lines.length
    ? lines
        .map(({ product: p, variant: v, qty, id }) => `
      <div class="line">
        <a class="line-art" href="/products/${esc(p.id)}"><img src="${esc(img(v.image || p.image, 160))}" alt="" loading="lazy" /></a>
        <div class="line-info">
          <a class="line-name" href="/products/${esc(p.id)}">${esc(p.name)}</a>
          ${v.title ? `<div class="muted small">${esc(v.title)}</div>` : ""}
          <div class="qty">
            <button data-dec="${esc(id)}" aria-label="Decrease quantity">−</button>
            <span aria-live="polite">${qty}</span>
            <button data-inc="${esc(id)}" aria-label="Increase quantity">+</button>
            <button class="link" data-remove="${esc(id)}">Remove</button>
          </div>
        </div>
        <div class="line-total">${usd(v.price_cents * qty)}</div>
      </div>`)
        .join("")
    : `<div class="empty"><p>Your cart is empty.</p><a class="btn ghost" href="/">Browse pens</a></div>`;

  const free = Math.round(Number(store.config.shipping?.free_over_usd || 0) * 100);
  $("#shipProgress").innerHTML =
    free > 0 && subtotal > 0
      ? subtotal >= free
        ? `<strong>You've unlocked free US shipping.</strong>`
        : `Add <strong>${usd(free - subtotal)}</strong> more for free US shipping.
           <div class="bar"><i style="width:${Math.min(100, (subtotal / free) * 100)}%"></i></div>`
      : "";
  $("#subtotal").textContent = usd(subtotal);
  $("#shipping").textContent = subtotal === 0 ? "—" : ship === 0 ? "Free" : usd(ship);
  $("#total").textContent = usd(subtotal + ship);
  $("#checkoutBtn").disabled = lines.length === 0;
}

async function checkout() {
  const btn = $("#checkoutBtn");
  $("#checkoutError").textContent = "";
  btn.disabled = true;
  btn.textContent = "Taking you to secure checkout…";
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cartLines().map((l) => ({ variant_id: l.id, qty: l.qty })) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed.");
    window.location.href = data.url;
  } catch (err) {
    $("#checkoutError").textContent = err.message;
    btn.disabled = false;
    btn.textContent = "Checkout securely";
  }
}

// Fill [data-cfg="a.b"] elements from site.config.json (optionally formatted as usd).
export function fillConfig(config, root = document) {
  const get = (k) => k.split(".").reduce((o, part) => (o == null ? o : o[part]), config);
  root.querySelectorAll("[data-cfg]").forEach((el) => {
    let v = get(el.dataset.cfg);
    if (v == null || v === "") { if (el.dataset.fallback) el.textContent = el.dataset.fallback; return; }
    if (el.dataset.fmt === "usd") v = usd(Math.round(Number(v) * 100));
    el.textContent = v;
    if (/^\[REVIEW/.test(String(v))) el.classList.add("review");
  });
  root.querySelectorAll("[data-cfg-href]").forEach((el) => { const v = get(el.dataset.cfgHref); if (v) el.href = v; });
  root.querySelectorAll("[data-cfg-mailto]").forEach((el) => { const v = get(el.dataset.cfgMailto); if (v) el.href = `mailto:${v}`; });
  root.querySelectorAll("[data-cfg-if]").forEach((el) => { el.hidden = !get(el.dataset.cfgIf); });
}

function mountChrome() {
  document.body.insertAdjacentHTML("afterbegin", headerHtml());
  document.body.insertAdjacentHTML("beforeend", footerHtml() + drawerHtml());

  $("#menuBtn").addEventListener("click", () => {
    const open = !document.body.classList.contains("nav-open");
    document.body.classList.toggle("nav-open", open);
    $("#menuBtn").setAttribute("aria-expanded", String(open));
  });
  $("#cartBtn").addEventListener("click", () => openCart(true));
  $("#closeCart").addEventListener("click", () => openCart(false));
  $("#overlay").addEventListener("click", () => openCart(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#drawer").classList.contains("open")) { openCart(false); $("#cartBtn").focus(); }
  });
  $("#checkoutBtn").addEventListener("click", checkout);
  $("#cartItems").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.inc) setQty(t.dataset.inc, (cart[t.dataset.inc] || 0) + 1);
    if (t.dataset.dec) setQty(t.dataset.dec, (cart[t.dataset.dec] || 0) - 1);
    if (t.dataset.remove) setQty(t.dataset.remove, 0);
  });
  window.addEventListener("storage", (e) => { if (e.key === CART_KEY) { cart = readCart(); renderCart(); } });
}

mountChrome();

export const ready = loadStore()
  .then((s) => {
    store = s;
    fillConfig(s.config);
    const ship = s.config.shipping || {};
    if (Number(ship.free_over_usd) > 0)
      $("#announce").textContent = `Free US shipping on orders over ${usd(Math.round(ship.free_over_usd * 100))}`;
    else $("#announce").remove();
    if (s.checkout_mode === "demo") $("#modeNote").textContent = "Demo mode: no payment will be taken.";
    else if (s.checkout_mode === "sandbox") $("#modeNote").textContent = "Square test mode: use a test card.";
    renderCart();
    return s;
  })
  .catch((err) => {
    console.error(err);
    $("#announce")?.remove();
    throw err;
  });

export function clearCart() {
  cart = {};
  writeCart();
  renderCart();
}
