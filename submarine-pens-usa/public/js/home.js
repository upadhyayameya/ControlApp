import { $, $$, esc, img, icon, usd, priceLabel, productCard, wireRail, swatch, ready, observeReveals } from "/js/layout.js";

// ---------- hero slider ----------
(function hero() {
  const root = $("#hero");
  const slides = $$(".slide", root);
  const dots = $(".hero-dots", root);
  let i = 0;
  let timer;
  dots.innerHTML = slides.map((_, k) => `<button type="button" role="tab" aria-label="Slide ${k + 1}" ${k === 0 ? 'aria-current="true"' : ""}></button>`).join("");
  const go = (n) => {
    slides[i].classList.remove("active");
    dots.children[i].removeAttribute("aria-current");
    i = (n + slides.length) % slides.length;
    slides[i].classList.add("active");
    // restart the progress animation
    const d = dots.children[i];
    d.setAttribute("aria-current", "true");
    d.replaceWith(d.cloneNode(true));
    wireDots();
    restart();
  };
  const restart = () => {
    clearInterval(timer);
    timer = setInterval(() => { if (!root.classList.contains("paused") && !document.hidden) go(i + 1); }, 6500);
  };
  const wireDots = () => [...dots.children].forEach((d, k) => (d.onclick = () => go(k)));
  wireDots();
  $$("[data-hero]", root).forEach((b) => b.addEventListener("click", () => go(i + Number(b.dataset.hero))));
  root.addEventListener("mouseenter", () => root.classList.add("paused"));
  root.addEventListener("mouseleave", () => root.classList.remove("paused"));
  let x0 = null;
  root.addEventListener("touchstart", (e) => (x0 = e.touches[0].clientX), { passive: true });
  root.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  restart();
})();

// marquee text (duplicated for a seamless loop)
const MSGS = ["Free US shipping over $50", "30-day returns", "Secure checkout by Square", "Crafted since 1995", "Gift-ready packaging", "New 2026–27 collection"];
$("#marquee").innerHTML = [...MSGS, ...MSGS].map((m) => `<span>${m}</span>`).join("");

// rail arrow icons
for (const id of ["newPrev", "sigPrev"]) $("#" + id).innerHTML = icon("left");
for (const id of ["newNext", "sigNext"]) $("#" + id).innerHTML = icon("right");

ready.then(({ products }) => {
  // category counts
  const counts = products.reduce((m, p) => ((m[p.category] = (m[p.category] || 0) + 1), m), {});
  $$("[data-count]").forEach((el) => {
    const n = counts[el.dataset.count] || 0;
    el.textContent = `${n} ${n === 1 ? "style" : "styles"}`;
  });

  const buyable = products.filter((p) => p.purchasable);

  // new & noteworthy: catalogue NEW items, then the multi-colour families (most colours first)
  const pens = ["Fountain Pens", "Roller Pens", "Ball Pens"];
  const fresh = buyable.filter((p) => p.new).sort((a, b) => b.min_price_cents - a.min_price_cents);
  for (const p of buyable.filter((p) => pens.includes(p.category) && p.variants.length > 2 && !p.new).sort((a, b) => b.variants.length - a.variants.length || b.min_price_cents - a.min_price_cents)) {
    if (fresh.length >= 12) break;
    fresh.push(p);
  }
  $("#newRail").innerHTML = fresh.map((p) => productCard(p)).join("");
  wireRail($("#newRail"), $("#newPrev"), $("#newNext"));

  // signature: the named premium pens (Lion, Rudraksha, 24 carat gold…), most expensive first
  const sig = buyable
    .filter((p) => pens.includes(p.category) && !/^Submarine /.test(p.name) && !fresh.slice(0, 3).includes(p))
    .sort((a, b) => b.min_price_cents - a.min_price_cents)
    .slice(0, 12);
  $("#sigRail").innerHTML = sig.map((p) => productCard(p)).join("");
  wireRail($("#sigRail"), $("#sigPrev"), $("#sigNext"));

  // Horizon feature
  const hz = products.find((p) => p.id === "horizon-dual-shade-fragrance-roller-and-fountain-pen-set");
  if (hz) {
    $("#horizonPrice").textContent = priceLabel(hz);
    $("#horizonSwatches").innerHTML = hz.variants
      .filter((v) => swatch(v.title))
      .map((v) => `<a class="chip" href="/products/${esc(hz.id)}?v=${esc(v.id)}"><i class="dot" style="background:${swatch(v.title)}"></i>${esc(v.title)}</a>`)
      .join("");
  }

  // gift sets: named premium sets
  const gifts = buyable
    .filter((p) => p.category === "Gift Sets" && !/Horizon/.test(p.name))
    .sort((a, b) => b.min_price_cents - a.min_price_cents)
    .slice(0, 3);
  $("#giftCards").innerHTML = gifts.map((p) => productCard(p)).join("");

  // scented inks
  const inks = buyable.filter((p) => /Ink Bottle/.test(p.name)).sort((a, b) => b.min_price_cents - a.min_price_cents);
  $("#inkRow").innerHTML = inks
    .map((p) => `<a class="ink" href="/products/${esc(p.id)}"><figure><img src="${esc(img(p.image, 400))}" alt="" loading="lazy" /></figure><b>${esc(p.name.replace(/ Ink Bottle$/, ""))}</b><span>${esc(priceLabel(p))}</span></a>`)
    .join("");

  observeReveals();
});
