import { $, $$, esc, img, icon, usd, priceLabel, ready, addToCart, startCheckout, fillConfig, swatch, productCard, wireRail } from "/js/layout.js";

const handle = document.body.dataset.handle;
const root = $("#product");
const preselect = new URLSearchParams(location.search).get("v");

function variantFor(product, selected) {
  if (!product.options.length) return product.variants[0];
  return product.variants.find((v) => v.options.every((o, i) => o === selected[i]));
}

function render(product, summary) {
  const hasOptions = product.options.length > 0;
  const initial =
    product.variants.find((v) => v.id === preselect) || product.variants.find((v) => v.purchasable) || product.variants[0];
  let selected = [...initial.options];
  let qty = 1;
  let activeImage = initial.image || product.images[0]?.src;
  let lastVariant = null; // only jump to the variant's photo when the variant changes, so thumbnails stay clickable
  const allSwatches = hasOptions && product.variants.every((v) => swatch(v.title));

  const optionHtml = product.options
    .map((name, i) => {
      const values = [...new Set(product.variants.map((v) => v.options[i]))];
      return `<fieldset class="opt">
        <legend>${esc(name)}: <strong data-sel="${i}"></strong></legend>
        ${
          allSwatches
            ? `<div class="swatches">${values
                .map((val) => `<button type="button" data-opt="${i}" data-val="${esc(val)}" title="${esc(val)}" aria-label="${esc(val)}" class="${/Gift Box/.test(val) ? "giftbox" : ""}" style="background:${swatch(val)}"></button>`)
                .join("")}</div>`
            : `<div class="opt-values">${values.map((val) => `<button type="button" data-opt="${i}" data-val="${esc(val)}">${esc(val)}</button>`).join("")}</div>`
        }
      </fieldset>`;
    })
    .join("");

  root.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb">
      <a href="/">Home</a><span>/</span><a href="/shop?category=${encodeURIComponent(product.category)}">${esc(product.category)}</a><span>/</span>${esc(product.name)}
    </nav>
    <div class="pdp">
      <div class="gallery">
        ${product.images.length > 1 ? `<div class="thumbs" id="thumbs">${product.images
          .map((im, i) => `<button type="button" data-img="${esc(im.src)}" aria-label="Show image ${i + 1}"><img src="${esc(img(im.src, 200))}" alt="" loading="lazy" /></button>`)
          .join("")}</div>` : "<div></div>"}
        <div class="gallery-main" id="galleryMain">
          <div class="card-badges">${product.new ? `<span class="pill new">New</span>` : ""}</div>
          <img id="mainImg" src="" alt="${esc(product.name)}" width="900" height="900" />
        </div>
      </div>
      <div class="buy">
        <span class="card-cat">${esc(product.category)}</span>
        <h1>${esc(product.name)}</h1>
        <div class="pdp-price" id="price"></div>
        <div class="pdp-sub">Taxes calculated at checkout · Free US shipping over <span data-cfg="shipping.free_over_usd" data-fmt="usd"></span></div>
        ${optionHtml}
        <div class="buy-row">
          <div class="qty" aria-label="Quantity">
            <button type="button" id="qDec" aria-label="Decrease quantity">−</button>
            <span id="qVal">1</span>
            <button type="button" id="qInc" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn grow" id="addBtn">${icon("bag")} Add to bag</button>
        </div>
        <button class="btn ghost block" id="buyNow">Buy it now</button>
        <p class="stock" id="stock"></p>
        <div class="perks">
          <div>${icon("truck")}<span>Ships in <span data-cfg="shipping.processing_days">1–2 business days</span></span></div>
          <div>${icon("return")}<span><span data-cfg="returns.window_days">30</span>-day easy returns</span></div>
          <div>${icon("lock")}<span>Secure checkout by Square</span></div>
          <div>${icon("gift")}<span>Gift-ready packaging</span></div>
        </div>
        <div class="accordion">
          <details open><summary>Details</summary><div class="acc-body rich">${product.description_html || `<p>${esc(product.summary)}</p>`}</div></details>
          <details><summary>Shipping</summary><div class="acc-body">
            <p>Free US shipping on orders over <span data-cfg="shipping.free_over_usd" data-fmt="usd"></span>; otherwise a flat <span data-cfg="shipping.flat_rate_usd" data-fmt="usd"></span>. We ship to <span data-cfg="shipping.regions"></span>.</p>
            <p><a href="/policies/shipping">Full shipping policy</a></p></div></details>
          <details><summary>Returns</summary><div class="acc-body">
            <p>Not quite right? Return unused items within <span data-cfg="returns.window_days"></span> days of delivery for a refund.</p>
            <p><a href="/policies/returns">Returns &amp; refunds policy</a></p></div></details>
          <details><summary>Product code</summary><div class="acc-body"><p id="sku"></p></div></details>
        </div>
      </div>
    </div>`;

  const sticky = $("#stickyBuy");
  $("#stickyName").textContent = product.name;

  const current = () => (hasOptions ? variantFor(product, selected) : product.variants[0]);
  const update = () => {
    const v = current();
    $$("[data-opt]", root).forEach((b) => {
      const i = Number(b.dataset.opt);
      const trial = [...selected];
      trial[i] = b.dataset.val;
      const tv = variantFor(product, trial);
      b.setAttribute("aria-pressed", String(selected[i] === b.dataset.val));
      b.disabled = !tv || !tv.available;
    });
    $$("[data-sel]", root).forEach((el) => (el.textContent = selected[Number(el.dataset.sel)] || ""));
    const add = $("#addBtn");
    const buy = $("#buyNow");
    if (!v) {
      $("#price").textContent = priceLabel(summary);
      add.disabled = buy.disabled = true;
      $("#stock").textContent = "This combination isn't available.";
    } else {
      const price = v.price_cents != null ? usd(v.price_cents) : "Price coming soon";
      $("#price").textContent = price;
      $("#stickyPrice").textContent = price;
      add.disabled = buy.disabled = $("#stickyAdd").disabled = !v.purchasable;
      $("#stock").textContent = v.purchasable ? "In stock, ready to ship" : "Coming soon to the US";
      $("#sku").textContent = `Catalogue code ${v.sku}`;
      if (v.id !== lastVariant) {
        if (v.image) activeImage = v.image;
        lastVariant = v.id;
      }
      if (v.id !== preselect && hasOptions) history.replaceState(null, "", `?v=${encodeURIComponent(v.id)}`);
    }
    if (!activeImage) activeImage = product.images[0]?.src;
    const main = $("#mainImg");
    const src = img(activeImage, 1000);
    if (main.getAttribute("src") !== src) {
      main.style.opacity = 0;
      main.onload = () => (main.style.opacity = 1);
      main.src = src;
    }
    $("#stickyImg").src = img(activeImage, 120);
    $$("[data-img]", root).forEach((b) => b.setAttribute("aria-current", String(b.dataset.img === activeImage)));
  };

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.opt) { selected[Number(b.dataset.opt)] = b.dataset.val; update(); }
    if (b.dataset.img) {
      // a thumbnail that is a colourway's photo also selects that colourway
      const owner = hasOptions && product.variants.find((v) => v.image === b.dataset.img);
      if (owner) selected = [...owner.options];
      activeImage = b.dataset.img;
      update();
    }
    if (b.id === "qDec") { qty = Math.max(1, qty - 1); $("#qVal").textContent = qty; }
    if (b.id === "qInc") { qty = Math.min(20, qty + 1); $("#qVal").textContent = qty; }
    if (b.id === "addBtn") { const v = current(); if (v?.purchasable) addToCart(v.id, qty); }
    if (b.id === "buyNow") { const v = current(); if (v?.purchasable) startCheckout([{ variant_id: v.id, qty }], b); }
  });
  $("#stickyAdd").addEventListener("click", () => { const v = current(); if (v?.purchasable) addToCart(v.id, qty); });

  // hover zoom on desktop
  const gm = $("#galleryMain");
  if (matchMedia("(hover: hover)").matches) {
    gm.addEventListener("mousemove", (e) => {
      const r = gm.getBoundingClientRect();
      $("#mainImg").style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    });
    gm.addEventListener("mouseenter", () => gm.classList.add("zoom"));
    gm.addEventListener("mouseleave", () => gm.classList.remove("zoom"));
  }

  // sticky buy bar appears once the main button scrolls away
  const io = new IntersectionObserver(([en]) => {
    const show = !en.isIntersecting && en.boundingClientRect.top < 0;
    sticky.classList.toggle("show", show);
    sticky.setAttribute("aria-hidden", String(!show));
  });
  io.observe($("#addBtn"));

  update();
}

function related(product, all) {
  const price = product.min_price_cents || 0;
  return all
    .filter((p) => p.id !== product.id && p.purchasable)
    .map((p) => ({ p, s: (p.category === product.category ? 0 : 1) * 1e6 + Math.abs((p.min_price_cents || 0) - price) + (/^Submarine /.test(p.name) ? 800 : 0) }))
    .sort((a, b) => a.s - b.s)
    .slice(0, 10)
    .map((x) => x.p);
}

Promise.all([fetch(`/api/products/${encodeURIComponent(handle)}`).then((r) => (r.ok ? r.json() : Promise.reject())), ready])
  .then(([{ product }, store]) => {
    const summary = store.products.find((p) => p.id === product.id) || product;
    render(product, summary);
    fillConfig(store.config, root);
    const rel = related(summary, store.products);
    if (rel.length) {
      $("#relRail").innerHTML = rel.map((p) => productCard(p)).join("");
      $("#relPrev").innerHTML = icon("left");
      $("#relNext").innerHTML = icon("right");
      $("#relatedSection").hidden = false;
      wireRail($("#relRail"), $("#relPrev"), $("#relNext"));
    }
  })
  .catch(() => {
    root.innerHTML = `<div class="center-page"><h1>We couldn't load this product.</h1><a class="btn" href="/shop">Back to the shop</a></div>`;
  });
