# Submarine Pens USA — online store

A small storefront for US customers. Shoppers browse pens, add them to a cart, and
pay on **Square's secure hosted checkout**. You see each order in your **Square
Dashboard** (Orders and Transactions), and Square emails the customer a receipt.

```
Browser (catalog + cart) ──► /api/checkout (this server) ──► Square Checkout API
                                     │ re-prices the cart            │
                                     │ from products.json            ▼
                                     └──── redirect ◄──── Square payment page
                                                         ──► /success.html
```

- The server rebuilds every order from `products.json`, so a customer can't change prices in the browser.
- Card details go only to Square. This site never sees or stores them.
- No npm packages are needed. It runs on plain Node 18+.

## Run it locally

```bash
cd submarine-pens-usa
cp .env.example .env
npm start            # http://localhost:3000
```

Without Square keys the site runs in **demo mode**: checkout skips payment, goes
straight to the thank-you page, and prints the order in the terminal.

## Connecting Square (step by step)

1. **Make sure your Square account can take US payments in USD.** A Square seller
   account belongs to one country. If your current Square account is not US-based,
   you need a US Square account (this needs a US business and bank account). If you
   can't get one, a processor like Stripe or PayPal can take USD from an Indian
   business; ask and the checkout can be switched.
2. Open the **Square Developer Dashboard** (developer.squareup.com/apps), sign in
   with your Square login, and click **+ Create app** (name it e.g. "Submarine Pens USA").
3. **Start with Sandbox (test mode).** On the app's **Credentials** page, set the
   toggle to *Sandbox* and copy the **Sandbox Access token**. On the **Locations**
   page, copy the Sandbox **Location ID**.
4. Put them in `.env`:
   ```
   SQUARE_ACCESS_TOKEN=EAAA...your sandbox token...
   SQUARE_LOCATION_ID=L...
   SQUARE_ENVIRONMENT=sandbox
   ```
5. Restart (`npm start`) and place a test order. Square's test card is
   `4111 1111 1111 1111`, any future expiry date, CVV `111`, and any US ZIP code.
   The order then shows up in your **Sandbox** Seller Dashboard (open it from the developer console).
6. **Go live.** Switch the Credentials toggle to *Production*, copy the
   **Production** access token and your real Location ID, and set
   `SQUARE_ENVIRONMENT=production`.

> Keep the access token secret. It works like a password to your Square account.
> `.env` is git-ignored. Never paste the token into code or a chat.

### Taxes and shipping

- **Shipping** is a flat fee with an optional free-shipping threshold, set in `.env`
  (`SHIPPING_FLAT_CENTS`, `FREE_SHIPPING_OVER_CENTS`). Square asks the customer for a shipping address.
- **Sales tax**: US sales tax rules differ by state. Check with your accountant about
  where you owe tax. You can set up taxes in the Square Dashboard, but this site
  sends prices without tax. If you need tax added, tell us and we'll pass a tax rate
  in each checkout.

## Editing products

Edit `products.json`. `price_cents` is the price in cents (`2499` = $24.99). Set
`"in_stock": false` to show an item as sold out. Restart the server after editing.
The product pictures are simple drawings made in code. To use real photos later,
put them in `public/` and add an `image` field to each product.

Also replace the placeholder contact email (`orders@example.com`) in `public/index.html`.

## Putting it online

Any host that runs Node works: Render, Railway, Fly.io, or a small VPS.

1. Create a **Web Service** from this repo, with the root directory set to `submarine-pens-usa`.
2. Build command: *(none)*. Start command: `npm start`.
3. Add the environment variables from `.env.example` in the host's dashboard.
   Set `SITE_URL` to your public address, e.g. `https://us.submarinepens.com`.
4. Point a subdomain (like `us.`) or a new domain at the host, and link to it from your Indian site.

The host must use HTTPS (all of the above do by default).
