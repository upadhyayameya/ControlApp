import { $, esc, img, usd, priceLabel, ready, addToCart, fillConfig } from "/js/layout.js";

const handle = document.body.dataset.handle;
const root = $("#product");

function variantFor(product, selected) {
  return product.variants.find((v) => v.options.every((o, i) => o === selected[i]));
}

function render(product, summary) {
  const hasOptions = product.options.length > 0;
  const firstBuyable = product.variants.find((v) => v.purchasable) || product.variants[0];
  let selected = [...firstBuyable.options];
  let qty = 1;
  let activeImage = firstBuyable.image || product.images[0]?.src;

  root.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Shop</a> <span>/</span>
      <a href="/?category=${encodeURIComponent(product.category)}">${esc(product.category)}</a>
    </nav>
    <div class="pdp">
      <div class="gallery">
        <div class="gallery-main"><img id="mainImg" src="" alt="${esc(product.name)}" width="800" height="800" /></div>
        ${product.images.length > 1 ? `<div class="thumbs" id="thumbs">
          ${product.images.map((im, i) => `<button type="button" data-img="${esc(im.src)}" aria-label="Show image ${i + 1}"><img src="${esc(img(im.src, 160))}" alt="" loading="lazy" /></button>`).join("")}
        </div>` : ""}
      </div>
      <div class="buy">
        <span class="tag">${esc(product.category)}</span>
        <h1>${esc(product.name)}</h1>
        <div class="pdp-price" id="price"></div>
        <div id="options">
          ${product.options.map((name, i) => {
            const values = [...new Set(product.variants.map((v) => v.options[i]))];
            return `<fieldset class="opt">
              <legend>${esc(name)}: <strong data-sel="${i}"></strong></legend>
              <div class="opt-values">${values.map((val) => `<button type="button" data-opt="${i}" data-val="${esc(val)}">${esc(val)}</button>`).join("")}</div>
            </fieldset>`;
          }).join("")}
        </div>
        <div class="buy-row">
          <div class="qty big" aria-label="Quantity">
            <button type="button" id="qDec" aria-label="Decrease quantity">−</button>
            <span id="qVal">1</span>
            <button type="button" id="qInc" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn grow" id="addBtn">Add to cart</button>
        </div>
        <p class="stock" id="stock"></p>
        <ul class="assure">
          <li>Ships to <span data-cfg="shipping.regions">all 50 states</span></li>
          <li>Free US shipping over <span data-cfg="shipping.free_over_usd" data-fmt="usd"></span></li>
          <li><span data-cfg="returns.window_days"></span>-day returns · <a href="/policies/returns">details</a></li>
          <li>Secure checkout by Square</li>
        </ul>
      </div>
    </div>
    <section class="desc">
      <h2>Product details</h2>
      <div class="rich">${product.description_html || `<p>${esc(product.summary)}</p>`}</div>
    </section>`;

  const update = () => {
    const v = hasOptions ? variantFor(product, selected) : product.variants[0];
    // option buttons: mark selected, and strike through values that are sold out or don't exist with the other choices
    root.querySelectorAll("[data-opt]").forEach((b) => {
      const i = Number(b.dataset.opt);
      const trial = [...selected];
      trial[i] = b.dataset.val;
      const tv = variantFor(product, trial);
      b.setAttribute("aria-pressed", String(selected[i] === b.dataset.val));
      b.classList.toggle("unavailable", !tv || !tv.available);
    });
    root.querySelectorAll("[data-sel]").forEach((el) => (el.textContent = selected[Number(el.dataset.sel)] || ""));

    const add = $("#addBtn");
    if (!v) {
      $("#price").textContent = priceLabel(summary);
      add.disabled = true; add.textContent = "Unavailable";
      $("#stock").textContent = "This combination isn't available.";
    } else {
      $("#price").textContent = v.price_cents != null ? usd(v.price_cents) : "Price coming soon";
      add.disabled = !v.purchasable;
      add.textContent = v.purchasable ? "Add to cart" : v.available ? "Coming soon" : "Sold out";
      $("#stock").textContent = v.purchasable ? "In stock, ready to ship" : v.available ? "Available soon in the US" : "Currently sold out";
      if (v.image) activeImage = v.image;
    }
    $("#mainImg").src = img(activeImage, 900);
    root.querySelectorAll("[data-img]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.img === activeImage)));
    add.dataset.variant = v?.id || "";
  };

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.opt) { selected[Number(b.dataset.opt)] = b.dataset.val; update(); }
    if (b.dataset.img) { activeImage = b.dataset.img; update(); }
    if (b.id === "qDec") { qty = Math.max(1, qty - 1); $("#qVal").textContent = qty; }
    if (b.id === "qInc") { qty = Math.min(20, qty + 1); $("#qVal").textContent = qty; }
    if (b.id === "addBtn" && b.dataset.variant) addToCart(b.dataset.variant, qty);
  });
  update();
}

Promise.all([fetch(`/api/products/${encodeURIComponent(handle)}`).then((r) => (r.ok ? r.json() : Promise.reject())), ready])
  .then(([{ product }, store]) => {
    const summary = store.products.find((p) => p.id === product.id) || product;
    render(product, summary);
    fillConfig(store.config, root);
  })
  .catch(() => {
    root.innerHTML = `<p class="error">We couldn't load this product. <a href="/">Back to the shop</a></p>`;
  });
