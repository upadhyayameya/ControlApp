# Submarine Pens USA — online store

The US storefront for Submarine Pens. The range comes from the **2026–27 catalogue**
(both PDF parts): 288 catalogue codes, grouped into ~190 products with colour options,
with photos cut from the catalogue pages. **US prices are calculated from the India
M.R.P.** (at least 3× the India price, covering duty, freight and fees), so when ₹ prices
change you just update the M.R.P. Customers pay on **Square's secure hosted checkout**.

**Pages:** Home (hero slider, category tiles, New & Noteworthy and Signature Pens
carousels, Horizon feature, gift sets, scented inks, brand story) · Shop (`/shop`: category,
price, colour-family and "new" filters, search, sort, load more) · Product pages (gallery
with zoom, colour swatches, Add to bag / Buy it now, details accordions, related products,
sticky buy bar on phones) · Live search overlay · Bag drawer with free-shipping progress ·
About · Contact (form) · Newsletter sign-up (saved to `data/subscribers.jsonl`) · Shipping,
Returns, Privacy and Terms policies · Order confirmation · 404 · `sitemap.xml`.

```
data/us-range.csv           ← THE US RANGE (edit this): one row per catalogue code
data/catalogue-2026-27.json ← catalogue facts per code: photo, packaging, details, page, NEW
data/india-website.json     ← products from submarinepens.com, used for extra photos/descriptions
data/product-copy.json      ← optional hand-written product descriptions (override the generated ones)
public/img/brand/           ← banners, category tiles and lifestyle photos from submarinepens.com
site.config.json            ← pricing assumptions, shipping, returns, contact details, policy wording
public/img/products/        ← product photos cut from the catalogue
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

1. **Review the range** in `data/us-range.csv`: rename placeholder products, check colours, confirm your real export cost % and exchange rate in `site.config.json` (see below).
2. **Fill in every `[REVIEW: …]` value** in `site.config.json`: where orders ship from,
   delivery time, who pays US import duties, who pays return shipping, governing law
   and the policy effective date. Until you do, the text shows on the policy pages
   with a yellow highlight.
3. **Have the policy pages reviewed** (`public/policies/*.html`). They're drafts
   written for a US store and aren't legal advice.
4. Add a **US support phone number** to `site.config.json` if you have one (leave it blank to hide it).
5. Connect **Square** (payment gateway: next step).
6. **Deploy** and point a domain at it.

## The US range and prices: `data/us-range.csv`

Open it in Excel or Google Sheets. One row per catalogue code:

| column | what it does |
|---|---|
| `code` | catalogue code (don't change) |
| `include` | `yes` to sell it in the US, `no` to hide it |
| `product` | product name. Rows with the **same name become one product** with a colour choice |
| `colour` | the option name shown to customers (Black, Gold, Rose Gold…) |
| `category` | Fountain Pens, Roller Pens, Ball Pens, Gift Sets, Ink & Refills |
| `inr_mrp` | India M.R.P. in ₹. **Update this when Indian prices change**; the US price follows |
| `pack_size` | pens per listing (cheap ball pens are sold as 3-packs) |
| `usd_price_override` | type a USD price here to override the calculated one (e.g. `24.99`) |
| `notes` | things to check: placeholder names, NASA/ISRO licence |

Save as CSV. The site picks up changes automatically, with no restart.

**Things to tidy:** part 1 of the catalogue has no product names, so ~115 products have
placeholder names like "Submarine Ball Pen 0917" (marked in `notes`). Colour names come
from the code (digits 7–8: 01 Black, 03 Gold, 05 Rose Gold, 06 Red, 07 Blue…), and a few
products have "Style 1/2" where the colour isn't known. Rename them in the CSV.
NASA/ISRO-branded items are set to `include = no` until the US licence is confirmed.

### How prices are calculated

Settings are in `site.config.json` → `pricing` (the same formula as the Range & Pricing
Planner spreadsheet):

- **Cost-based price** = (your export cost + freight + US duty + clearance + US fulfilment + card fees)
  at your target margin
- **Floor** = India M.R.P. × pack size ÷ exchange rate × `min_multiple_of_india_price` (now **3×**)
- **US price** = the higher of the two, rounded up to .99

Change `min_multiple_of_india_price` to move every price at once, and update `inr_per_usd`
as the exchange rate moves. Check `export_cost_pct_of_mrp` (30% placeholder) and
`duty_pct` (15.4%: 5.4% pen duty + 10% Section 301 on Indian goods, Nov 2026).

### Refreshing data from the Indian website

```bash
npm run import
```

This updates `data/india-website.json`. Products on both the catalogue and the website use
the website's description and extra photos.

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

At checkout, the server recalculates every price from `us-range.csv` and the pricing settings, so prices can't be
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
