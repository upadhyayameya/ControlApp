# Shop: buy from Instagram

A one-page storefront for the Instagram bio link, with checkout through **Stripe Payment Links**. Stripe handles cards, Apple Pay and Google Pay, the shipping address, receipts and tax, so there's no server or database to run. It also produces a **catalog feed** for Instagram Shopping product tags.

```
shop/
  products.json   ← your products and store details (edit this)
  images/         ← product photos (JPEG, 4:5 portrait works best) + logo.png
  build.mjs       ← builds dist/index.html and dist/meta-catalog.csv
```

## Set up (about 30 minutes)

1. **Stripe:** create an account at stripe.com. Then for each product: Products → Add product → **Create payment link**. In the link settings, turn on *Collect customers' addresses* (shipping) and choose which countries you ship to. Copy the `https://buy.stripe.com/...` URL.
2. **products.json:** replace every `REPLACE` value: name, price, description, the Stripe link as `buyUrl`, store email, shipping note. Add or remove products freely. `featured: true` puts a product first; `available: false` hides it from the page.
3. **Photos:** put them in `images/` using the filenames in `products.json`. Add your logo as `images/logo.png`.
4. **Build:** run `node shop/build.mjs`. It refuses to build while placeholders or broken links remain. Use `--preview` to look anyway, then open `shop/dist/index.html` in a browser.
5. **Host `shop/dist/`** on any static host:
   - **Netlify Drop** (easiest): drag the `dist` folder onto app.netlify.com/drop. Every push also produces a ready-built *shop-site* artifact in the GitHub Actions run, which you can download and drag in.
   - **Cloudflare Pages** or **GitHub Pages** (Pages needs a public repo or a paid plan).
   - Then set `store.siteUrl` in `products.json` to that address and rebuild, so the catalog feed links work.
6. **Instagram bio:** Edit profile → Links → add `https://YOUR-SHOP-URL/?utm_source=instagram&utm_medium=bio`.

## Knowing which sales came from Instagram
The page passes `utm_source` and other `utm_*` tags through to Stripe checkout, so Stripe's payment details show where each sale came from. Link to one product with `YOUR-SHOP-URL/#product-id`; this is handy in DMs and captions.

## Product tags on posts (Instagram Shopping)
1. Instagram → Settings → Business tools → **Set up Instagram Shopping**, then connect a Meta Commerce account.
2. In Commerce Manager → Catalog → Data sources → **Data feed**, upload `dist/meta-catalog.csv`, or better, give it the hosted URL `YOUR-SHOP-URL/meta-catalog.csv` so it refreshes automatically.
3. Meta reviews the shop, which usually takes a few days. Once approved you can tag products in posts (in the Instagram app) and the profile gets a **View shop** button.

Meta requires that your website is the one listed in the catalog, that the products are physical goods you sell, and that the account follows its commerce policies.
