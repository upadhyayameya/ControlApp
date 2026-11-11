# Project context

This repo holds two unrelated things:

1. **HBS BAS Simulation Trainer**: the Vite/React/TypeScript app in `src/` (see `README.md`).
2. **Submarine Pens USA**: the owner's US pen business (@submarinepensusa, Arlington, Virginia). It imports and sells
   pens made by Submarine Pens Limited, Mumbai, India (ISO 9001:2015, brand line "Power to Express", since 1995).
   - `catalogue/`: the manufacturer's 2026-27 catalogue (India, ₹ M.R.P.) and the **US retail catalogue** built from it
     (`catalogue/us/Submarine-Pens-USA-Catalogue-2026-27.pdf`, kept small enough to email). The product master data is
     `catalogue/products-2026-27.json` (292 products: code, section, packaging, ₹ M.R.P., landed cost, US retail,
     wholesale). Rebuild with `python3 catalogue/build.py`. Pricing and caveats are in `catalogue/README.md`.
   - `shop/`: an Instagram storefront with Stripe Payment Links (`shop/products.json`).
   - `instagram/`: an auto-poster, content plan and strategy for the Instagram account.

## Submarine catalogue facts

- Sections: Ball Pens (152), Roller Pens (38), Fountain Pens (23), Sets (44), Diary Set (1), Ink Bottles (9), Refills (25).
- Product codes are the factory's SKUs (e.g. `0109320100`); the `(Code: 1800…)` in descriptions is the packaging SKU.
  US orders should quote the product code.
- US prices are **landed-cost based**: factory price (assumed 50% of M.R.P., ₹94/$) + US duty + 10% India tariff +
  air freight ($7/kg) + fees = landed; retail = landed × 3.5 rounded up to .99; wholesale = 50% of retail.
  The factory share and freight rate are assumptions until the owner supplies real figures. All of this is in
  `catalogue/us-config.json`. `catalogue/us-pricing-workbook.csv` shows costs and is internal, not for customers.
- Four NASA-logo products are left out of the US catalogue (`excludeFromUS` in the config).
- The owner sends the catalogue as an email attachment, so keep the PDF well under 10 MB.
- When adding a product to `shop/products.json`, take its code, retail price (`retailUsd`) and description from `catalogue/products-2026-27.json`.
