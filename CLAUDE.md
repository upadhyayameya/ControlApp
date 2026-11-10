# Project context

This repo holds two unrelated things:

1. **HBS BAS Simulation Trainer**: the Vite/React/TypeScript app in `src/` (see `README.md`).
2. **Submarine Pens USA**: the owner's US pen business (@submarinepensusa, Arlington, Virginia). It imports and sells
   pens made by Submarine Pens Limited, Mumbai, India (ISO 9001:2015, brand line "Power to Express", since 1995).
   - `catalogue/`: the manufacturer's 2026-27 catalogue (India, ₹ M.R.P.) and the **US edition** built from it.
     The product master data is `catalogue/products-2026-27.json` (292 products: code, section, packaging, ₹ M.R.P.,
     US MSRP, wholesale). Rebuild with `python3 catalogue/build.py`. Pricing rule and caveats are in `catalogue/README.md`.
   - `shop/`: an Instagram storefront with Stripe Payment Links (`shop/products.json`).
   - `instagram/`: an auto-poster, content plan and strategy for the Instagram account.

## Submarine catalogue facts

- Sections: Ball Pens (152), Roller Pens (38), Fountain Pens (23), Sets (44), Diary Set (1), Ink Bottles (9), Refills (25).
- Product codes are the factory's SKUs (e.g. `0109320100`); the `(Code: 1800…)` in descriptions is the packaging SKU.
  US orders should quote the product code.
- US MSRP is proposed as ₹ M.R.P. ÷ 40, rounded (₹500 → $13, matching the $13 Faire listing). Wholesale is 50% of MSRP.
  The owner has not confirmed this yet. It lives in `catalogue/us-config.json`.
- When adding a product to `shop/products.json`, take its code, MSRP and description from `catalogue/products-2026-27.json`.
