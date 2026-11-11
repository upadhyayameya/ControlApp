# Submarine Pens USA: retail catalogue 2026-27

**The catalogue to send customers:** [`us/Submarine-Pens-USA-Catalogue-2026-27.pdf`](us/Submarine-Pens-USA-Catalogue-2026-27.pdf).
It is 38 pages and 3.5 MB, small enough to attach to an email.

It is built from the manufacturer's India catalogue (`source/`). Product photos and codes come from that file; names, layout and prices are new:

- **Cover and brand page:** the original artwork with US text.
- **How to Order:** what "landed" means, shipping ($5.99 flat, free over $49), how to order, and wholesale and corporate gifting. A table shows each section with its price range.
- **Product pages:** Ball Pens, Roller Pens, Fountain Pens, Gift Sets, Diaries & Pen Sets, Inks, Refills & Cartridges. Each card has a photo, name, packaging, code, NEW flag and US retail price.
- **Price List:** every code and price on a few pages, for quick ordering.
- **Back cover:** Submarine Pens USA, Arlington, Virginia, and the manufacturer credit.

## Online catalogue portal

`portal.py` builds a web page you can browse and share. It includes all 288 products with photos, search, section filters, price sorting, a "New only" filter and a product view with a copy-code button. Each product has its own link (`#p-<code>`), so you can send someone one pen. It shows US retail prices only, never your costs or the India M.R.P.

```bash
python3 catalogue/build.py && python3 catalogue/portal.py    # writes catalogue/.work/portal.html
```

## Pricing console (internal)

`costs.py` builds a private page with every product's India M.R.P., factory price, duty, tariff, freight, fees, landed cost, US retail, markup, profit and margin, plus wholesale profit and margin. The pricing assumptions are sliders, so you can try out a different freight rate or markup and see the effect before rebuilding. **Don't share it.**

```bash
python3 catalogue/build.py && python3 catalogue/costs.py      # writes catalogue/.work/costs.html
```

## How retail prices are set: landed cost × 3.5

```
factory price  = India M.R.P. × 50%  ÷ ₹94 per $          (ASSUMPTION until you have Submarine's export prices)
+ US duty      = HTSUS rate for the product (pens 5.4% + 0.8¢ each, fountain pens 2.7% + 0.4¢, ink 1.8%, ...)
+ India tariff = 10% extra on goods from India
+ freight      = unit shipping weight × $7/kg air cargo     (ASSUMPTION)
+ fees         = customs processing fee 0.35% + broker, bank and insurance 3%
= LANDED COST, delivered to Virginia, duty paid

retail    = landed × 3.5, rounded up to .99   (minimum $3.99 a pen, $1.99 a refill)
wholesale = 50% of retail                     (still about 1.75 × landed)
```

| Example | India M.R.P. | Landed | US retail |
|---|---:|---:|---:|
| Ball pen, blister card (`0109320100`) | ₹120 | $0.94 | $3.99 |
| Roller pen, metal tin (`0315972043`) | ₹500 | $3.76 | $13.99 |
| Roller & fountain pen set (`13401674112`) | ₹1,299 | $9.83 | $34.99 |
| Scented ink (`16-0012-06-101`) | ₹150 | $1.69 | $5.99 |
| Coffee diary & metal pen set (`1016251400`) | ₹1,999 | $16.82 | $58.99 |

All of these inputs live in `us-config.json`: the exchange rate, factory price (a share of M.R.P., or exact prices per code in `factoryPriceInr`), freight per kg, unit weights, duty rates, tariff, markup, price floors, single-price overrides, shipping terms and contact details. Edit it and rebuild. **Replace the two ASSUMPTION inputs with real numbers before relying on the prices.** Ask your customs broker to confirm the HTS codes and the India tariff.

`us-pricing-workbook.csv` itemizes each product's cost (factory, duty, tariff, freight, fees, landed, retail, wholesale). It is **internal: don't send it to customers.**

## Left out of the US catalogue

Four products carry NASA's logo, and NASA's name and insignia need NASA's permission on US products: `0130070100`, `0330070100`, `0330000700` and the Pluto Nasa set `3230070100`. They are listed under `excludeFromUS` in `us-config.json`. Delete a line to bring a product back.

## Rebuild

```bash
pip install pymupdf pillow
python3 catalogue/build.py        # needs Node with Playwright and Chromium for the PDF
```

| File | What it does |
|---|---|
| `build.py` | Runs everything: products, prices, photos, HTML, PDF, data files |
| `extract.py` | Reads codes, sections, packaging lines, NEW flags and ₹ M.R.P. from the source PDF |
| `photos.py` | Cuts each product's photo out of the source, with all text removed so no ₹ prices appear |
| `pricing.py` | Landed cost and retail price |
| `catalogue.css`, `render.cjs` | Layout, and printing to US Letter PDF with Chromium |
| `portal.py`, `portal-template.html` | The online catalogue portal (one self-contained page) |
| `costs.py`, `costs-template.html` | The internal pricing console |
| `products-2026-27.json` | All 292 products with every field above |

## Still to check

- The Indian packaging shown in some photos may carry ₹ M.R.P. stickers. Goods you sell need US labels, including "Made in India".
- Most pens have no model name in the source, so their cards say "Ball Pen" etc. with the packaging. To name one, add it to `NAMES` in `extract.py`.
- Contact on the catalogue is Instagram only. Add an email, phone or website under `contact` in `us-config.json` and rebuild.
