# Submarine Pens catalogue 2026-27 (India original → US edition)

The manufacturer's 2026-27 catalogue and a US edition built from it for **Submarine Pens USA**.

| File | What it is |
|---|---|
| `source/submarine-catalogue-2026-27-india.pdf` | The original, 60 pages, prices in ₹ M.R.P. The two halves you were sent (pages cover–37 and 38–back) are merged into one file. **Don't edit it; it is the input.** |
| `products-2026-27.json` | All 292 products: code, section, packaging/description, NEW flag, page, ₹ M.R.P., US MSRP, US wholesale |
| `us-price-list.csv` | The same as a spreadsheet, for Faire, wholesale buyers or `shop/products.json` |
| `us/Submarine-Pens-USA-Catalogue-2026-27.pdf` | **The US catalogue**, about 12 MB, for email and web |
| `us/…-print.pdf` | The same at full photo resolution (~40 MB) for a printer. Built locally and not committed (see `.gitignore`) |
| `us-config.json` | Exchange rule, rounding, wholesale %, back-page text, per-code price overrides |
| `build.py` | Rebuilds everything above from the source PDF and the config |

```bash
pip install pymupdf pillow
python3 catalogue/build.py
```

## What the US edition changes

The original's photos and layout are kept as they are. Only text changes:

- **₹ M.R.P. → US MSRP** on all 292 prices, including the badges on the ink bottles, cartridges and diary set.
  The ₹390 printed on the Navigator diary display box in its photo is covered with the US price.
- **US spelling:** Customisation → Customization, Personalisation → Personalization.
- **Back page:** the Mumbai address, +91 phone and .co.in email are replaced with Submarine Pens USA (Arlington, Virginia, @submarinepensusa). The page credits Submarine Pens Limited as the manufacturer and fixes "ISO 9001:205" to 9001:2015.
- The printer's "Cover Page / COVER INSIDE / BACK PAGE" marks are removed.
- Product codes, packaging descriptions and NEW flags are unchanged, so US orders map straight back to factory codes.

## Pricing rule (proposed; confirm before you publish)

```
US MSRP = India M.R.P. ÷ 40, rounded to the nearest $0.50 below $10 and the nearest $1 from $10, minimum $1
US wholesale = 50% of MSRP (Faire's standard keystone)
```

The divisor 40 makes the ₹500 roller pens **$13**, which matches the $13 MSRP already listed on Faire for the Brass Series Rollerball. At about ₹88 to the dollar that is about 2.2× the Indian retail price in dollars. The extra covers freight, US import duty and tariffs, and retailer margin.

| Section | Items | India M.R.P. | US MSRP |
|---|---:|---|---|
| Ball Pens | 152 | ₹120 – ₹1,200 | $3 – $30 |
| Roller Pens | 38 | ₹200 – ₹800 | $5 – $20 |
| Fountain Pens | 23 | ₹300 – ₹1,090 | $7.50 – $27 |
| Sets | 44 | ₹500 – ₹1,999 | $13 – $50 |
| Diary Set (Navigator, pack of 10) | 1 | ₹390 per piece | $10 ea. |
| Ink Bottles | 9 | ₹80 – ₹150 | $2 – $4 |
| Refills & cartridges | 25 | ₹25 – ₹70 | $1 – $2 |

To change prices, edit `us-config.json` and rebuild: change `inrPerUsd` for all of them, or add `"overrides": {"0109320100": 3.99}` for single products.

## Check before sending to US customers

- **NASA name:** `0330000700` (Nasa packaging) and `3230070100` ("Pluto Nasa Pen" set) use the NASA name, which NASA restricts on commercial products in the US. Consider dropping them or renaming them for the US.
- **ISRO pens** (`2340015071`, `2340005071`) are an Indian space-agency theme. They are fine to sell but may not mean much to US buyers.
- **Packaging photos** show the Indian retail packaging, which may carry ₹ M.R.P. stickers and Indian addresses. Goods sold in the US need US labelling, including "Made in India" country-of-origin marking.
- Some product names exist only in the photos. `products-2026-27.json` gives the packaging line as the description; `name` is filled in where the catalogue prints one.
