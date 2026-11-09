// Submarine Pens USA storefront server.
// Serves the static site and turns a cart into a Square hosted-checkout link.
// No dependencies: Node 18+ only (uses built-in fetch).

import http from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

await loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || "";
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || "";
const SQUARE_ENV = (process.env.SQUARE_ENVIRONMENT || "sandbox").toLowerCase();
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const SHIPPING_FLAT_CENTS = Number(process.env.SHIPPING_FLAT_CENTS ?? 599);
const FREE_SHIPPING_OVER_CENTS = Number(process.env.FREE_SHIPPING_OVER_CENTS ?? 5000);
const MAX_QTY_PER_ITEM = 20;

const SQUARE_BASE =
  SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
const SQUARE_VERSION = "2024-10-17";
const squareConfigured = Boolean(SQUARE_ACCESS_TOKEN && SQUARE_LOCATION_ID);

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
};

async function loadProducts() {
  return JSON.parse(await readFile(path.join(__dirname, "products.json"), "utf8"));
}

function shippingFor(subtotalCents) {
  if (FREE_SHIPPING_OVER_CENTS > 0 && subtotalCents >= FREE_SHIPPING_OVER_CENTS) return 0;
  return SHIPPING_FLAT_CENTS;
}

// Rebuild the order from the catalog so prices can't be tampered with in the browser.
async function priceCart(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new HttpError(400, "Your cart is empty.");
  const catalog = new Map((await loadProducts()).map((p) => [p.id, p]));
  const lines = [];
  for (const raw of rawItems) {
    const product = catalog.get(String(raw?.id));
    const qty = Math.floor(Number(raw?.qty));
    if (!product) throw new HttpError(400, "An item in your cart is no longer available.");
    if (!product.in_stock) throw new HttpError(400, `${product.name} is out of stock.`);
    if (!Number.isFinite(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM)
      throw new HttpError(400, `Quantity for ${product.name} must be 1–${MAX_QTY_PER_ITEM}.`);
    lines.push({ product, qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.product.price_cents * l.qty, 0);
  return { lines, subtotal, shipping: shippingFor(subtotal) };
}

async function createSquareCheckout({ lines, shipping }) {
  const body = {
    idempotency_key: randomUUID(),
    order: {
      location_id: SQUARE_LOCATION_ID,
      line_items: lines.map(({ product, qty }) => ({
        name: product.name,
        quantity: String(qty),
        note: product.id,
        base_price_money: { amount: product.price_cents, currency: "USD" },
      })),
    },
    checkout_options: {
      redirect_url: `${SITE_URL}/success.html`,
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

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
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

async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: "Forbidden" });
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  try {
    if (pathname === "/api/products" && req.method === "GET") {
      return sendJson(res, 200, {
        products: await loadProducts(),
        shipping: { flat_cents: SHIPPING_FLAT_CENTS, free_over_cents: FREE_SHIPPING_OVER_CENTS },
        checkout_mode: squareConfigured ? SQUARE_ENV : "demo",
      });
    }
    if (pathname === "/api/checkout" && req.method === "POST") {
      const { items } = await readJsonBody(req);
      const priced = await priceCart(items);
      if (!squareConfigured) {
        // Demo mode: no Square keys yet. Log the order and show the success page.
        console.log("[demo order]", JSON.stringify({
          items: priced.lines.map((l) => ({ id: l.product.id, qty: l.qty })),
          subtotal_cents: priced.subtotal,
          shipping_cents: priced.shipping,
        }));
        return sendJson(res, 200, { url: "/success.html?demo=1" });
      }
      return sendJson(res, 200, { url: await createSquareCheckout(priced) });
    }
    if (pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Not found" });
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });
    return serveStatic(req, res, decodeURIComponent(pathname));
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
