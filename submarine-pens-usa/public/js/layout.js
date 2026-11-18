// Shared UI for every page: header, search, mobile menu, cart drawer, toast, footer,
// product cards, colour swatches and small helpers.

const CART_KEY = "subpens-cart-v3"; // { [variantId]: qty }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const usd = (cents) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const img = (src, width) => {
  if (!src) return "";
  if (src.startsWith("/")) return src; // local photos are already sized
  return `${src}${src.includes("?") ? "&" : "?"}width=${width}`;
};

// ---------- icons ----------
const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bag: '<path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 8Z"/><path d="M9 8V7a3 3 0 0 1 6 0v1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  truck: '<path d="M3 6h11v9H3zM14 9h4l3 3v3h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  return: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8S10 3 7.5 4.5 9 8 12 8Zm0 0s2-5 4.5-3.5S15 8 12 8Z"/>',
  pen: '<path d="m15 4 5 5L9 20H4v-5L15 4Z"/><path d="m13 6 5 5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
export const icon = (name, cls = "icon") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;

// ---------- colours ----------
const COLOURS = {
  "black": "#1c1d21", "shine black": "linear-gradient(135deg,#3a3b40,#0b0b0d 55%,#2a2b30)", "white": "#f6f5f1",
  "gold": "linear-gradient(135deg,#f1d98c,#c49a3c 55%,#e8c66e)", "silver": "linear-gradient(135deg,#f1f2f4,#b9bdc3 55%,#e4e6e9)",
  "rose gold": "linear-gradient(135deg,#f3c7b5,#c98a72 55%,#e9b39e)", "red": "#c4262e", "blue": "#2d55b8", "green": "#3f8f5b",
  "purple": "#6a4aa2", "pink": "#e58fb4", "orange": "#e8742e", "yellow": "#f0c419", "coffee brown": "#6b4430", "grey": "#8e9197",
  "gunmetal": "linear-gradient(135deg,#7a7e85,#3f4247 55%,#62666c)", "royal blue": "#2742a8", "turquoise": "#2fbec6", "navy blue": "#1f2d5c",
  "black & silver": "linear-gradient(135deg,#1c1d21 50%,#c3c6cb 50%)", "black & gold": "linear-gradient(135deg,#1c1d21 50%,#d4b05a 50%)",
  "brown & gold": "linear-gradient(135deg,#6b4430 50%,#d4b05a 50%)", "charcoal": "#3a3b3f", "olive": "#6b6a48", "maroon": "#7a1f2b",
  "tan": "#c49a6c", "light pink": "#f2c4d0", "blue texture": "#3a5a9a", "brown texture": "#7a5236",
  "cool water t-blue": "#45b0c2", "morning coffee": "#8a5a3c", "vintage rose": "#c7848c", "wild strawberry": "#d8445c",
};
// colour families for filtering (many finishes -> one filter swatch)
const FAMILY = {
  Black: ["black", "shine black", "charcoal"], White: ["white"], Silver: ["silver", "black & silver"],
  Grey: ["grey", "gunmetal"], Gold: ["gold", "black & gold"], "Rose Gold": ["rose gold"],
  Red: ["red", "maroon", "wild strawberry"], Pink: ["pink", "light pink", "vintage rose"], Orange: ["orange"],
  Yellow: ["yellow"], Green: ["green", "olive"], Blue: ["blue", "royal blue", "navy blue", "turquoise", "blue texture", "cool water t-blue"],
  Purple: ["purple"], Brown: ["coffee brown", "brown & gold", "tan", "brown texture", "morning coffee"],
};
export const FAMILY_SWATCH = {
  Black: "#1c1d21", White: "#f6f5f1", Silver: "linear-gradient(135deg,#f1f2f4,#b9bdc3 55%,#e4e6e9)", Grey: "#7d8086", Gold: "linear-gradient(135deg,#f1d98c,#c49a3c 55%,#e8c66e)",
  "Rose Gold": "linear-gradient(135deg,#f3c7b5,#c98a72 55%,#e9b39e)", Red: "#c4262e", Pink: "#e58fb4", Orange: "#e8742e",
  Yellow: "#f0c419", Green: "#3f8f5b", Blue: "#2d55b8", Purple: "#6a4aa2", Brown: "#6b4430",
};
export function colourFamily(name) {
  const base = String(name || "").split(" – ")[0].trim().toLowerCase();
  for (const [fam, members] of Object.entries(FAMILY)) if (members.includes(base)) return fam;
  return null;
}
export function swatch(name) {
  if (!name) return null;
  const base = String(name).split(" – ")[0].trim().toLowerCase();
  return COLOURS[base] || null;
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

export function priceLabel(p) {
  if (p.min_price_cents == null) return "Price coming soon";
  if (p.min_price_cents === p.max_price_cents) return usd(p.min_price_cents);
  return `From ${usd(p.min_price_cents)}`;
}

// ---------- product card ----------
export function productCard(p, { eager = false } = {}) {
  const colours = p.variants.map((v) => v.title).filter(Boolean);
  const sw = colours.map((c) => swatch(c)).filter(Boolean);
  const single = p.variants.length === 1 && p.purchasable;
  const href = `/products/${esc(p.id)}`;
  const loading = eager ? "eager" : "lazy";
  return `
  <article class="card">
    <a class="card-media" href="${href}" aria-label="${esc(p.name)}">
      <img class="main${p.image2 ? " has-alt" : ""}" src="${esc(img(p.image, 600))}" alt="${esc(p.name)}" loading="${loading}" width="600" height="600" />
      ${p.image2 ? `<img class="alt" src="${esc(img(p.image2, 600))}" alt="" loading="lazy" width="600" height="600" />` : ""}
      <div class="card-badges">${p.new ? `<span class="pill new">New</span>` : ""}</div>
    </a>
    ${
      p.purchasable
        ? `<div class="quick-add">${
            single
              ? `<button class="btn" data-add="${esc(p.variants[0].id)}">${icon("bag")} Quick add</button>`
              : `<a class="btn" href="${href}">Choose ${sw.length ? "colour" : "option"}</a>`
          }</div>`
        : ""
    }
    <div class="card-body">
      <span class="card-cat">${esc(p.category)}</span>
      <a class="card-title" href="${href}">${esc(p.name)}</a>
      <div class="card-foot">
        <span class="price ${p.min_price_cents == null ? "muted" : ""}">${esc(priceLabel(p))}</span>
        ${
          sw.length > 1
            ? `<span class="dots" aria-label="${sw.length} colours">${sw.slice(0, 5).map((c) => `<i class="dot" style="background:${c}"></i>`).join("")}${
                sw.length > 5 ? `<span class="more">+${sw.length - 5}</span>` : ""
              }</span>`
            : colours.length > 1
              ? `<span class="muted small">${colours.length} options</span>`
              : ""
        }
      </div>
    </div>
  </article>`;
}

// horizontal rails with prev/next buttons
export function wireRail(rail, prev, next) {
  const step = () => rail.clientWidth * 0.9;
  const update = () => {
    prev.disabled = rail.scrollLeft < 8;
    next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 8;
  };
  prev.addEventListener("click", () => rail.scrollBy({ left: -step() }));
  next.addEventListener("click", () => rail.scrollBy({ left: step() }));
  rail.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
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
export function addToCart(variantId, qty = 1, { open = true } = {}) {
  cart[variantId] = Math.min((cart[variantId] || 0) + qty, 20);
  writeCart();
  renderCart();
  const b = $("#cartCount");
  b.classList.remove("bump");
  void b.offsetWidth;
  b.classList.add("bump");
  setTimeout(() => b.classList.remove("bump"), 300);
  const hit = store?.variants.get(variantId);
  toast(hit ? `Added ${hit.product.name}${hit.variant.title ? ` (${hit.variant.title})` : ""}` : "Added to your bag");
  if (open) openCart(true);
}
function setQty(variantId, qty) {
  if (qty <= 0) delete cart[variantId];
  else cart[variantId] = Math.min(qty, 20);
  writeCart();
  renderCart();
}
export function clearCart() {
  cart = {};
  writeCart();
  renderCart();
}

let toastTimer;
export function toast(msg) {
  const t = $("#toast");
  t.innerHTML = `${icon("check")}<span>${esc(msg)}</span>`;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- chrome ----------
const NAV = [
  ["/shop", "Shop All"],
  ["/shop?category=Fountain%20Pens", "Fountain Pens"],
  ["/shop?category=Roller%20Pens", "Roller Pens"],
  ["/shop?category=Ball%20Pens", "Ball Pens"],
  ["/shop?category=Gift%20Sets", "Gift Sets"],
  ["/shop?category=Ink%20%26%20Refills", "Inks & Refills"],
  ["/about", "Our Story"],
];
const ANNOUNCEMENTS = [
  'Free US shipping on orders over <strong data-cfg="shipping.free_over_usd" data-fmt="usd0">$120</strong>',
  'New: the <strong>2026–27 collection</strong> has arrived',
  '<strong>30-day</strong> easy returns · Secure checkout by Square',
];

function isCurrent(href) {
  const u = new URL(href, location.origin);
  if (u.pathname !== location.pathname) return false;
  return (new URLSearchParams(location.search).get("category") || "") === (u.searchParams.get("category") || "");
}

function headerHtml() {
  return `
  <a class="skip" href="#main">Skip to content</a>
  <div class="announce" role="region" aria-label="Announcements">
    <div class="wrap announce-inner">
      <button type="button" id="annPrev" aria-label="Previous announcement">‹</button>
      <div class="announce-msg" id="annMsg" aria-live="polite">${ANNOUNCEMENTS[0]}</div>
      <button type="button" id="annNext" aria-label="Next announcement">›</button>
    </div>
  </div>
  <header class="site-header" id="siteHeader">
    <div class="wrap header-top">
      <div style="display:flex;align-items:center;gap:4px">
        <button class="icon-btn only-mobile" id="menuBtn" aria-label="Open menu" aria-expanded="false">${icon("menu")}</button>
        <button class="search-pill" type="button" data-open-search>${icon("search")}<span>Search pens, sets, inks…</span></button>
      </div>
      <a class="brand" href="/" aria-label="Submarine Pens USA home">
        <img src="/img/logo.png" alt="Submarine Pens" width="132" height="58" />
        <span class="brand-usa">USA</span>
      </a>
      <div class="header-actions">
        <button class="icon-btn only-mobile" type="button" data-open-search aria-label="Search">${icon("search")}</button>
        <button class="icon-btn" id="cartBtn" aria-label="Open bag">${icon("bag")}<span class="badge" id="cartCount" hidden>0</span></button>
      </div>
    </div>
    <nav class="nav wrap" aria-label="Main">
      ${NAV.map(([href, label]) => `<a href="${href}" ${isCurrent(href) ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
    </nav>
  </header>
  <aside class="menu-drawer" id="menuDrawer" aria-label="Menu" aria-hidden="true" inert>
    <div class="menu-drawer-head">
      <img src="/img/logo.png" alt="Submarine Pens" width="96" height="42" />
      <button class="icon-btn" id="menuClose" aria-label="Close menu">${icon("close")}</button>
    </div>
    <nav>${NAV.map(([href, label]) => `<a href="${href}">${label}<span>›</span></a>`).join("")}<a href="/contact">Contact<span>›</span></a></nav>
    <div class="drawer-foot-links">
      <a href="/policies/shipping">Shipping</a><a href="/policies/returns">Returns &amp; refunds</a>
      <a data-cfg-mailto="support_email" href="#"><span data-cfg="support_email"></span></a>
    </div>
  </aside>
  <div class="search-panel" id="searchPanel" role="dialog" aria-label="Search" aria-hidden="true" inert>
    <div class="wrap">
      <form class="search-bar" id="searchForm" action="/shop">
        ${icon("search")}
        <input id="searchInput" name="q" type="search" placeholder="Search for fountain pens, gift sets, scented ink…" autocomplete="off" aria-label="Search products" />
        <button type="button" class="icon-btn" id="searchClose" aria-label="Close search">${icon("close")}</button>
      </form>
      <div class="search-results" id="searchResults"></div>
    </div>
  </div>`;
}

function footerHtml() {
  const y = new Date().getFullYear();
  return `
  <section class="trust" aria-label="Why shop with us">
    <div class="wrap trust-grid">
      <div class="trust-item">${icon("truck")}<div><strong>Free US shipping</strong><span>On orders over <span data-cfg="shipping.free_over_usd" data-fmt="usd0">$120</span></span></div></div>
      <div class="trust-item">${icon("return")}<div><strong><span data-cfg="returns.window_days">30</span>-day returns</strong><span>Easy, no-fuss returns</span></div></div>
      <div class="trust-item">${icon("lock")}<div><strong>Secure checkout</strong><span>Payments by Square</span></div></div>
      <div class="trust-item">${icon("gift")}<div><strong>Gift-ready</strong><span>Premium boxes &amp; sets</span></div></div>
    </div>
  </section>
  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div>
        <img class="footer-logo" src="/img/logo.png" alt="Submarine Pens" width="132" height="58" />
        <p>Power to Express. Crafting writing instruments since 1995: ball, roller and fountain pens made to be used and gifted.</p>
      </div>
      <div>
        <h4>Shop</h4>
        <a href="/shop?category=Fountain%20Pens">Fountain pens</a>
        <a href="/shop?category=Roller%20Pens">Roller pens</a>
        <a href="/shop?category=Ball%20Pens">Ball pens</a>
        <a href="/shop?category=Gift%20Sets">Gift sets</a>
        <a href="/shop?category=Ink%20%26%20Refills">Inks &amp; refills</a>
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
        <a href="/about">Our story</a>
        <a data-cfg-href="india_site_url" href="https://www.submarinepens.com" rel="noopener">Shopping from India?</a>
        <a data-cfg-mailto="support_email" href="#">Email us</a>
      </div>
      <div class="newsletter">
        <h4>Join the list</h4>
        <p>New collections, limited editions and gift ideas. No spam, unsubscribe anytime.</p>
        <form id="newsForm" novalidate>
          <label class="sr-only" for="newsEmail">Email address</label>
          <input id="newsEmail" type="email" name="email" placeholder="Your email address" autocomplete="email" required />
          <button class="btn gold small" type="submit">Subscribe</button>
        </form>
        <div class="msg" id="newsMsg" role="status"></div>
      </div>
    </div>
    <div class="wrap footer-base">
      <span>© ${y} <span data-cfg="legal_name">Submarine Pens</span>. All prices in USD.</span>
      <span class="pay-icons" aria-label="Accepted payments"><span>VISA</span><span>MC</span><span>AMEX</span><span>APPLE PAY</span><span>SQUARE</span></span>
    </div>
  </footer>`;
}

function drawerHtml() {
  return `
  <div class="overlay" id="overlay" hidden></div>
  <aside class="drawer" id="drawer" aria-label="Shopping bag" aria-hidden="true" inert>
    <div class="drawer-head">
      <h2>Your bag <span id="bagCount"></span></h2>
      <button class="icon-btn" id="closeCart" aria-label="Close bag">${icon("close")}</button>
    </div>
    <div class="drawer-body" id="cartItems"></div>
    <div class="drawer-foot" id="cartFoot">
      <div class="ship-progress" id="shipProgress"></div>
      <div class="row"><span>Subtotal</span><span id="subtotal">$0.00</span></div>
      <div class="row"><span>Shipping</span><span id="shipping">—</span></div>
      <div class="row total"><span>Total</span><span id="total">$0.00</span></div>
      <p class="muted small" style="margin:0 0 14px">Sales tax, if applicable, is calculated at checkout.</p>
      <p class="error" id="checkoutError" role="alert"></p>
      <button class="btn block" id="checkoutBtn" disabled>${icon("lock")} Checkout securely</button>
      <p class="muted small center" id="modeNote" style="margin:10px 0 0"></p>
    </div>
  </aside>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}

// overlays: only one open at a time, shared backdrop
let openPanel = null;
function setPanel(el, open) {
  const ov = $("#overlay");
  if (open && openPanel && openPanel !== el) setPanel(openPanel, false);
  el.classList.toggle("open", open);
  el.setAttribute("aria-hidden", String(!open));
  el.toggleAttribute("inert", !open);
  if (open) {
    openPanel = el;
    ov.hidden = false;
    requestAnimationFrame(() => ov.classList.add("show"));
    document.body.classList.add("no-scroll");
  } else if (openPanel === el) {
    openPanel = null;
    ov.classList.remove("show");
    setTimeout(() => { if (!openPanel) ov.hidden = true; }, 300);
    document.body.classList.remove("no-scroll");
  }
}
export function openCart(open) {
  setPanel($("#drawer"), open);
  if (open) setTimeout(() => $("#closeCart").focus(), 50);
}
export function registerPanel(el) {
  return (open) => setPanel(el, open);
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
  $("#bagCount").textContent = count ? `(${count})` : "";
  $("#cartFoot").hidden = lines.length === 0;
  $("#cartItems").innerHTML = lines.length
    ? lines
        .map(({ product: p, variant: v, qty, id }) => `
      <div class="line">
        <a class="line-art" href="/products/${esc(p.id)}"><img src="${esc(img(v.image || p.image, 200))}" alt="" loading="lazy" /></a>
        <div>
          <a class="line-name" href="/products/${esc(p.id)}">${esc(p.name)}</a>
          ${v.title ? `<div class="muted small">${esc(v.title)}</div>` : ""}
          <div style="display:flex;align-items:center">
            <div class="qty sm">
              <button data-dec="${esc(id)}" aria-label="Decrease quantity">−</button>
              <span aria-live="polite">${qty}</span>
              <button data-inc="${esc(id)}" aria-label="Increase quantity">+</button>
            </div>
            <button class="remove" data-remove="${esc(id)}">Remove</button>
          </div>
        </div>
        <div class="line-total">${usd(v.price_cents * qty)}</div>
      </div>`)
        .join("")
    : `<div class="empty-cart">${icon("bag")}<p>Your bag is empty.</p><a class="btn" href="/shop">Explore the collection</a></div>`;

  const free = Math.round(Number(store.config.shipping?.free_over_usd || 0) * 100);
  $("#shipProgress").innerHTML =
    free > 0 && subtotal > 0
      ? subtotal >= free
        ? `${icon("truck", "icon")} <strong>You've unlocked free US shipping.</strong><div class="bar"><i style="width:100%"></i></div>`
        : `You're <strong>${usd(free - subtotal)}</strong> away from free US shipping.<div class="bar"><i style="width:${Math.min(100, (subtotal / free) * 100)}%"></i></div>`
      : "";
  $("#subtotal").textContent = usd(subtotal);
  $("#shipping").textContent = subtotal === 0 ? "—" : ship === 0 ? "Free" : usd(ship);
  $("#total").textContent = usd(subtotal + ship);
  $("#checkoutBtn").disabled = lines.length === 0;
}

export async function startCheckout(items, btn) {
  const err = $("#checkoutError");
  if (err) err.textContent = "";
  const label = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = "Taking you to secure checkout…"; }
  try {
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed.");
    window.location.href = data.url;
  } catch (e) {
    if (err) err.textContent = e.message;
    toast(e.message);
    if (btn) { btn.disabled = false; btn.innerHTML = label; }
  }
}

// Fill [data-cfg="a.b"] elements from site.config.json (optionally formatted as usd).
export function fillConfig(config, root = document) {
  const get = (k) => k.split(".").reduce((o, part) => (o == null ? o : o[part]), config);
  root.querySelectorAll("[data-cfg]").forEach((el) => {
    let v = get(el.dataset.cfg);
    if (v == null || v === "") { if (el.dataset.fallback) el.textContent = el.dataset.fallback; return; }
    if (el.dataset.fmt === "usd") v = usd(Math.round(Number(v) * 100));
    if (el.dataset.fmt === "usd0") v = "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
    el.textContent = v;
    if (/^\[REVIEW/.test(String(v))) el.classList.add("review");
  });
  root.querySelectorAll("[data-cfg-href]").forEach((el) => { const v = get(el.dataset.cfgHref); if (v) el.href = v; });
  root.querySelectorAll("[data-cfg-mailto]").forEach((el) => { const v = get(el.dataset.cfgMailto); if (v) el.href = `mailto:${v}`; });
  root.querySelectorAll("[data-cfg-if]").forEach((el) => { el.hidden = !get(el.dataset.cfgIf); });
}

// ---------- search ----------
function norm(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ");
}
export function searchProducts(products, q) {
  const terms = norm(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return products
    .map((p) => {
      const hay = norm(`${p.name} ${p.category} ${p.variants.map((v) => v.title).join(" ")} ${p.variants.map((v) => v.id).join(" ")}`);
      if (!terms.every((t) => hay.includes(t))) return null;
      const score = terms.reduce((s, t) => s + (norm(p.name).includes(t) ? 2 : 1), 0) + (p.new ? 0.5 : 0);
      return { p, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

function wireSearch() {
  const panel = $("#searchPanel");
  const toggle = registerPanel(panel);
  const input = $("#searchInput");
  const results = $("#searchResults");
  const suggestions = ["Fountain pen", "Gift set", "Lion", "Rose gold", "Scented ink", "Horizon", "Refill"];
  const render = () => {
    const q = input.value.trim();
    if (!store) return;
    if (!q) {
      results.innerHTML = `<h4>Popular searches</h4><div class="search-suggest">${suggestions
        .map((s) => `<a class="chip" href="/shop?q=${encodeURIComponent(s)}">${icon("search")}${esc(s)}</a>`)
        .join("")}</div>`;
      return;
    }
    const hits = searchProducts(store.products, q);
    results.innerHTML = hits.length
      ? `<h4>${hits.length} result${hits.length === 1 ? "" : "s"}</h4><div class="search-grid">${hits
          .slice(0, 9)
          .map((p) => `<a class="search-item" href="/products/${esc(p.id)}"><img src="${esc(img(p.image, 160))}" alt="" /><div><b>${esc(p.name)}</b><span>${esc(priceLabel(p))}</span></div></a>`)
          .join("")}</div>${hits.length > 9 ? `<p style="margin-top:18px"><a class="link-arrow" href="/shop?q=${encodeURIComponent(q)}">See all ${hits.length} results ${icon("arrow")}</a></p>` : ""}`
      : `<p class="muted">No products match “${esc(q)}”. Try “fountain”, “gift” or a colour like “gold”.</p>`;
  };
  $$("[data-open-search]").forEach((b) =>
    b.addEventListener("click", () => {
      toggle(true);
      render();
      setTimeout(() => input.focus(), 60);
    })
  );
  $("#searchClose").addEventListener("click", () => toggle(false));
  input.addEventListener("input", render);
  $("#searchForm").addEventListener("submit", (e) => {
    if (!input.value.trim()) e.preventDefault();
  });
}

// ---------- mount ----------
function mountChrome() {
  document.body.insertAdjacentHTML("afterbegin", headerHtml());
  document.body.insertAdjacentHTML("beforeend", footerHtml() + drawerHtml());

  // announcement rotator
  let ai = 0;
  const showAnn = (d) => {
    ai = (ai + d + ANNOUNCEMENTS.length) % ANNOUNCEMENTS.length;
    const m = $("#annMsg");
    m.style.opacity = 0;
    setTimeout(() => { m.innerHTML = ANNOUNCEMENTS[ai]; if (store) fillConfig(store.config, m); m.style.opacity = 1; }, 200);
  };
  $("#annPrev").addEventListener("click", () => showAnn(-1));
  $("#annNext").addEventListener("click", () => showAnn(1));
  setInterval(() => { if (!document.hidden) showAnn(1); }, 5000);

  // sticky header shadow
  const hdr = $("#siteHeader");
  const onScroll = () => hdr.classList.toggle("scrolled", window.scrollY > 10);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // menu
  const menu = registerPanel($("#menuDrawer"));
  $("#menuBtn").addEventListener("click", () => menu(true));
  $("#menuClose").addEventListener("click", () => menu(false));

  // cart
  $("#cartBtn").addEventListener("click", () => openCart(true));
  $("#closeCart").addEventListener("click", () => openCart(false));
  $("#overlay").addEventListener("click", () => openPanel && setPanel(openPanel, false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openPanel) setPanel(openPanel, false);
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("[data-open-search]").click();
    }
  });
  $("#checkoutBtn").addEventListener("click", (e) =>
    startCheckout(cartLines().map((l) => ({ variant_id: l.id, qty: l.qty })), e.currentTarget)
  );
  $("#cartItems").addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) return;
    if (t.dataset.inc) setQty(t.dataset.inc, (cart[t.dataset.inc] || 0) + 1);
    if (t.dataset.dec) setQty(t.dataset.dec, (cart[t.dataset.dec] || 0) - 1);
    if (t.dataset.remove) setQty(t.dataset.remove, 0);
  });
  // quick-add buttons anywhere on the page
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-add]");
    if (b) { e.preventDefault(); addToCart(b.dataset.add); }
  });
  window.addEventListener("storage", (e) => { if (e.key === CART_KEY) { cart = readCart(); renderCart(); } });

  // newsletter
  $("#newsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#newsEmail").value.trim();
    const msg = $("#newsMsg");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = "Please enter a valid email address."; return; }
    try {
      const r = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Couldn't subscribe right now.");
      msg.textContent = "Thanks! You're on the list.";
      e.target.reset();
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  wireSearch();
}

// reveal-on-scroll for elements with .reveal
export function observeReveals(root = document) {
  const els = $$(".reveal:not(.in)", root);
  if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  els.forEach((e) => io.observe(e));
}

mountChrome();

export const ready = loadStore()
  .then((s) => {
    store = s;
    fillConfig(s.config);
    if (s.checkout_mode === "demo") $("#modeNote").textContent = "Demo mode: no payment will be taken.";
    else if (s.checkout_mode === "sandbox") $("#modeNote").textContent = "Square test mode: use a test card.";
    renderCart();
    observeReveals();
    return s;
  })
  .catch((err) => {
    console.error(err);
    throw err;
  });
