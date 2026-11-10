# Submarine Pens USA — online store

The US storefront for Submarine Pens. The catalog (photos, descriptions, colours
and pack sizes) is imported from the Indian store at submarinepens.com. You set
**US-dollar prices** in a spreadsheet, and customers pay on **Square's secure
hosted checkout**.

**Pages:** Shop (filters, search, sort) · Product pages (gallery, colour/pack
options) · Cart drawer with free-shipping progress · About · Contact (form) ·
Shipping, Returns, Privacy and Terms policies · Order confirmation · 404 · `sitemap.xml`.

```
data/products.json   ← catalog imported from the Indian site (npm run import)
data/prices.csv      ← YOUR US prices, one row per colour/pack size
site.config.json     ← shipping rates, return window, contact details, policy wording
public/              ← the website (HTML, CSS, JS, logo)
server.js            ← serves the site, re-checks prices at checkout, talks to Square
```

## Run it

```bash
cd submarine-pens-usa
cp .env.example .env
npm start            # http://localhost:3000
```

It needs Node 18 or newer and no `npm install`. Until Square keys are added it
runs in **demo mode**: checkout skips payment and goes straight to the thank-you page.

## Before launch: checklist

1. **Set US prices** in `data/prices.csv` (see below).
2. **Fill in every `[REVIEW: …]` value** in `site.config.json`: where orders ship from,
   delivery time, who pays US import duties, who pays return shipping, governing law
   and the policy effective date. Until you do, the text shows on the policy pages
   with a yellow highlight.
3. **Have the policy pages reviewed** (`public/policies/*.html`). They're drafts
   written for a US store and aren't legal advice.
4. Add a **US support phone number** to `site.config.json` if you have one (leave it blank to hide it).
5. Connect **Square** (payment gateway: next step).
6. **Deploy** and point a domain at it.

## Setting US prices

Open `data/prices.csv` in Excel or Google Sheets. There's one row per sellable
variant (colour / pack size):

| variant_id | sku | product | variant | in_stock | inr_price | usd_price |
|---|---|---|---|---|---|---|
| 51179557945620 | 01-2060-21-00 | Royale Black & Gold Ball Pen | | yes | 600 | **19.99** |

- Fill in **only** the `usd_price` column (e.g. `19.99`). Don't edit `variant_id`.
- `inr_price` is the Indian price, for reference. You can use a formula, e.g. `=ROUND(F2/45,0)-0.01`, then paste as values.
- A product without a USD price shows **"Price coming soon"** and can't be bought.
  To hide unpriced products completely, set `"hide_unpriced_products": true` in `site.config.json`.
- Save as CSV. The site picks up changes automatically, with no restart needed.

## Updating the catalog from the Indian site

```bash
npm run import          # in-stock products only
npm run import -- --all # include sold-out products as well
```

This refreshes `data/products.json` (names, photos, descriptions, stock) and adds
new variants to `prices.csv`. **Your USD prices are kept.** Products whose titles
match `import.exclude_title_patterns` in `site.config.json` are skipped (by default:
mystery gifts and customisation charges, which are India-only).

Categories (Fountain / Roller / Ball Pens, Gift Sets, Ink & Refills, Kids, More)
are guessed from product titles. To change the rules, edit `CATEGORY_RULES` in
`scripts/import-india.mjs`.

Product photos load straight from `submarinepens.com/cdn/shop/...`, so the US site
always shows the same photos as the Indian one.

## Contact form

Messages are saved to `data/messages.jsonl` (one JSON object per line). To get
them **by email** as well, sign up at resend.com (free tier), verify your sending
domain, and set `RESEND_API_KEY`, `CONTACT_FROM_EMAIL` and `CONTACT_TO_EMAIL` in `.env`.
On hosts with temporary disks (Render, Railway), saved messages are lost on redeploy,
so turn on email.

## Connecting Square (step by step)

1. **Make sure your Square account can take US payments in USD.** A Square seller
   account belongs to one country, so you need a US Square account (US business and
   bank account). If that's not possible, Stripe or PayPal can take USD from an Indian
   business, and the checkout can be switched.
2. Open the **Square Developer Dashboard** (developer.squareup.com/apps) and click **+ Create app**.
3. **Start with Sandbox.** On **Credentials**, copy the *Sandbox* access token. On
   **Locations**, copy the Sandbox Location ID.
4. Put them in `.env`:
   ```
   SQUARE_ACCESS_TOKEN=EAAA...
   SQUARE_LOCATION_ID=L...
   SQUARE_ENVIRONMENT=sandbox
   ```
5. Restart and place a test order with card `4111 1111 1111 1111`, any future expiry date, CVV `111`, any ZIP code.
6. **Go live:** use the *Production* token and Location ID, and set `SQUARE_ENVIRONMENT=production`.

> The access token works like a password to your Square account. `.env` is
> git-ignored. Never commit it or paste it into a chat.

At checkout, the server recalculates every price from `prices.csv`, so prices can't be
changed in the browser. Square collects the shipping address, emails the receipt, and
lists the order in your Square Dashboard.

## Putting it online

Any Node host works: Render, Railway, Fly.io, or a small VPS.

1. Create a **Web Service** from this repo, with the root directory set to `submarine-pens-usa`.
2. Build command: *(none)*. Start command: `npm start`.
3. Add the variables from `.env.example` in the host's dashboard, and set `SITE_URL`
   to the public address (e.g. `https://us.submarinepens.com`).
4. Point a domain or subdomain at it and link to it from the Indian site.

## Tests

```bash
npm test
```
