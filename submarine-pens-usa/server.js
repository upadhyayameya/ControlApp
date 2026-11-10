// Submarine Pens USA storefront server.
// Serves the site, the catalog API, the contact form, and turns a cart into a
// Square hosted-checkout link. No dependencies: Node 18+ only.

import http from "node:http";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCatalog, productSummary, publicConfig } from "./lib/catalog.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const MESSAGES_FILE = path.join(ROOT, "data", "messages.jsonl");

await loadDotEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || "";
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || "";
const SQUARE_ENV = (process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase();
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const CONTACT_FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || "";
const CONTACT_TO_EMAIL = process.env.CONTACT_TO_EMAIL || "";
const MAX_QTY_PER_ITEM = 20;

const SQUARE_BASE =
  SQUARE_ENV === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
const SQUARE_VERSION = "2024-10-17";
const squareConfigured = Boolean(SQUARE_ACCESS_TOKEN && SQUARE_LOCATION_ID);

const catalog = createCatalog(ROOT);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

// Pretty URLs -> files in public/
const PAGES = {
  "/": "index.html",
  "/shop": "index.html",
  "/about": "about.html",
  "/contact": "contact.html",
  "/policies/shipping": "policies/shipping.html",
  "/policies/returns": "policies/returns.html",
  "/policies/privacy": "policies/privacy.html",
  "/policies/terms": "policies/terms.html",
  "/order/success": "success.html",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- checkout ----------

function shippingFor(subtotalCents, shipping) {
  const flat = Math.round(Number(shipping?.flat_rate_usd || 0) * 100);
  const freeOver = Math.round(Number(shipping?.free_over_usd || 0) * 100);
  if (freeOver > 0 && subtotalCents >= freeOver) return 0;
  return flat;
}

// Rebuild the order from the catalog so prices can't be tampered with in the browser.
async function priceCart(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new HttpError(400, "Your cart is empty.");
  if (rawItems.length > 50) throw new HttpError(400, "Too many different items in one order.");
  const { variantIndex, config } = await catalog.get();
  const lines = [];
  for (const raw of rawItems) {
    const hit = variantIndex.get(String(raw?.variant_id));
    const qty = Math.floor(Number(raw?.qty));
    if (!hit) throw new HttpError(400, "An item in your cart is no longer available. Please remove it and try again.");
    const { product, variant } = hit;
    const label = variant.title ? `${product.name} (${variant.title})` : product.name;
    if (!variant.purchasable) throw new HttpError(400, `${label} isn't available right now.`);
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM)
      throw new HttpError(400, `Quantity for ${label} must be 1–${MAX_QTY_PER_ITEM}.`);
    lines.push({ product, variant, label, qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.variant.price_cents * l.qty, 0);
  return { lines, subtotal, shipping: shippingFor(subtotal, config.shipping) };
}

async function createSquareCheckout({ lines, shipping }) {
  const body = {
    idempotency_key: randomUUID(),
    order: {
      location_id: SQUARE_LOCATION_ID,
      line_items: lines.map(({ variant, label, qty }) => ({
        name: label.slice(0, 500),
        quantity: String(qty),
        note: variant.sku ? `SKU ${variant.sku}` : undefined,
        base_price_money: { amount: variant.price_cents, currency: "USD" },
      })),
    },
    checkout_options: {
      redirect_url: `${SITE_URL}/order/success`,
      ask_for_shipping_address: true,
      allow_tipping: false,
      ...(shipping > 0
        ? { shipping_fee: { name: "US Shipping", charge: { amount: shipping, currency: "USD" } } }
        : {}),
    },
  };

  const res = await fetch(`${SQUARE_BASE}/v2/online-checkout/payment-links`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.payment_link?.url) {
    console.error("Square error:", res.status, JSON.stringify(data?.errors ?? data));
    throw new HttpError(502, "Checkout is temporarily unavailable. Please try again shortly.");
  }
  return data.payment_link.url;
}

// ---------- contact form ----------

const contactHits = new Map(); // ip -> [timestamps]
function rateLimited(ip, max = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const hits = (contactHits.get(ip) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  contactHits.set(ip, hits);
  return hits.length > max;
}

async function handleContact(req) {
  const body = await readJsonBody(req);
  if (body.website) return; // honeypot: silently accept bots
  const ip = req.socket.remoteAddress || "?";
  if (rateLimited(ip)) throw new HttpError(429, "Too many messages. Please try again later.");
  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 200);
  const order = String(body.order || "").trim().slice(0, 60);
  const message = String(body.message || "").trim().slice(0, 5000);
  if (!name || !message) throw new HttpError(400, "Please enter your name and a message.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Please enter a valid email address.");

  const entry = { at: new Date().toISOString(), name, email, order, message };
  await mkdir(path.dirname(MESSAGES_FILE), { recursive: true });
  await appendFile(MESSAGES_FILE, JSON.stringify(entry) + "\n");
  console.log("[contact]", entry.at, name, email);

  if (RESEND_API_KEY && CONTACT_FROM_EMAIL && CONTACT_TO_EMAIL) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: CONTACT_FROM_EMAIL,
        to: [CONTACT_TO_EMAIL],
        reply_to: email,
        subject: `Website message from ${name}${order ? ` (order ${order})` : ""}`,
        text: `Name: ${name}\nEmail: ${email}\nOrder: ${order || "-"}\n\n${message}`,
      }),
    }).catch((e) => ({ ok: false, status: e.message }));
    if (!res.ok) console.error("Contact email failed:", res.status);
  }
}

// ---------- HTTP plumbing ----------

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": MIME[".html"] });
  res.end(html);
}

async function readJsonBody(req, limit = 32 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "Invalid request.");
  }
}

async function serveFile(req, res, rel, status = 200) {
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return notFound(res);
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(status, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    return notFound(res);
  }
}

async function notFound(res) {
  try {
    sendHtml(res, 404, await readFile(path.join(PUBLIC_DIR, "404.html"), "utf8"));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

// Product pages get their title/description/image filled in on the server for search engines and link previews.
async function serveProductPage(res, handle) {
  const { byId, config } = await catalog.get();
  const p = byId.get(handle);
  if (!p) return notFound(res);
  const tpl = await readFile(path.join(PUBLIC_DIR, "product.html"), "utf8");
  const html = tpl
    .replaceAll("{{TITLE}}", escapeHtml(`${p.name} | ${config.store_name}`))
    .replaceAll("{{DESCRIPTION}}", escapeHtml(p.summary))
    .replaceAll("{{IMAGE}}", escapeHtml(p.images[0]?.src || ""))
    .replaceAll("{{URL}}", escapeHtml(`${SITE_URL}/products/${p.id}`))
    .replaceAll("{{HANDLE}}", escapeHtml(p.id));
  sendHtml(res, 200, html);
}

async function sitemap(res) {
  const { products } = await catalog.get();
  const urls = [...Object.keys(PAGES).filter((u) => u !== "/order/success" && u !== "/shop"), ...products.map((p) => `/products/${p.id}`)];
  res.writeHead(200, { "Content-Type": MIME[".xml"] });
  res.end(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${escapeHtml(SITE_URL + u)}</loc></url>`).join("\n") +
      `\n</urlset>\n`
  );
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    return sendJson(res, 400, { error: "Bad request" });
  }
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, "");
  try {
    // API
    if (pathname === "/api/products" && req.method === "GET") {
      const { products, config } = await catalog.get();
      return sendJson(res, 200, {
        products: products.map(productSummary),
        config: publicConfig(config),
        checkout_mode: squareConfigured ? SQUARE_ENV : "demo",
      });
    }
    if (pathname.startsWith("/api/products/") && req.method === "GET") {
      const { byId } = await catalog.get();
      const p = byId.get(pathname.slice("/api/products/".length));
      return p ? sendJson(res, 200, { product: p }) : sendJson(res, 404, { error: "Product not found" });
    }
    if (pathname === "/api/config" && req.method === "GET") {
      const { config } = await catalog.get();
      return sendJson(res, 200, { config: publicConfig(config), checkout_mode: squareConfigured ? SQUARE_ENV : "demo" });
    }
    if (pathname === "/api/checkout" && req.method === "POST") {
      const { items } = await readJsonBody(req);
      const priced = await priceCart(items);
      if (!squareConfigured) {
        console.log("[demo order]", JSON.stringify({
          items: priced.lines.map((l) => ({ sku: l.variant.sku, name: l.label, qty: l.qty, cents: l.variant.price_cents })),
          subtotal_cents: priced.subtotal,
          shipping_cents: priced.shipping,
        }));
        return sendJson(res, 200, { url: "/order/success?demo=1" });
      }
      return sendJson(res, 200, { url: await createSquareCheckout(priced) });
    }
    if (pathname === "/api/contact" && req.method === "POST") {
      await handleContact(req);
      return sendJson(res, 200, { ok: true });
    }
    if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });

    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });

    // Pages
    if (pathname === "/sitemap.xml") return sitemap(res);
    if (pathname.startsWith("/products/")) return serveProductPage(res, pathname.slice("/products/".length));
    if (PAGES[pathname]) return serveFile(req, res, PAGES[pathname]);
    if (pathname.endsWith(".html")) return notFound(res); // only pretty URLs for pages
    return serveFile(req, res, pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return sendJson(res, status, { error: status === 500 ? "Something went wrong." : err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Submarine Pens USA running at http://localhost:${PORT}`);
  console.log(
    squareConfigured
      ? `Square checkout: ${SQUARE_ENV.toUpperCase()}`
      : "Square checkout: DEMO MODE (set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID in .env)"
  );
});

// Minimal .env loader so there are no dependencies.
async function loadDotEnv(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
