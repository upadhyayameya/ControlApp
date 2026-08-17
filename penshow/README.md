# Pen Show Tracker

Inventory, pricing, point of sale and P&L for a five-show US pen show season —
SF, Orlando, Dallas, Denver and Ohio — carrying **Submarine**, **Swiss Brand**
and **Lamborghini**.

## SKU nomenclature

SKUs are generated for you. The shape is:

```
BRAND-TYPE-MODEL[-NIB][-FINISH]

SUB-FP-SHIKAR-M-BLK    Submarine · fountain pen · Shikari · medium nib · black
SWB-ST-ALPINE-F        Swiss Brand · pen set · Alpine Duo · fine nib
LAM-BP-AVENTA-CHR      Lamborghini · ballpoint · Aventador · chrome
```

| Part | Values |
|---|---|
| Brand | `SUB` Submarine · `SWB` Swiss Brand · `LAM` Lamborghini |
| Type | `FP` fountain · `BP` ballpoint · `RB` rollerball · `MP` pencil · `ST` set · `IN` ink · `AC` accessory |
| Model | first 6 letters/digits of the model name |
| Nib | fountain pens and sets only — `EF F M B BB ST IT MU FX` |
| Finish | `BLK BLU RED GRN WHT SLV GLD GRY ORG PUR YEL BRN PNK MRN CLR CHR MAT RGD GUN DEM`, else the first three letters |

It sorts by brand then type, reads off a label at a glance, and never collides —
an identical spec gets a numeric tail (`…-BLK-2`). Tap **Edit** beside the SKU to
override it by hand; the app then leaves it alone forever.

Two things live in this folder, built on the same data model so you can move
between them:

| | **The app** (`index.html`) | **The workbook** (`PenShowTracker.xlsx`) |
|---|---|---|
| Runs on | Phone, tablet, laptop — any browser | Excel, Google Sheets, Numbers |
| Works offline | Yes, fully | Yes (desktop Excel) |
| Ring up a sale mid-conversation | Two taps | Type a row — slow at a busy table |
| Photos of each pen | Yes — camera, drag or paste | Link only |
| Auto SKUs | Yes, live as you type | Paste them in |
| Warns below floor price | Yes, live in the cart | No |
| Holds ("back Sunday for this") | Yes, reserves stock | No |
| Pivot, chart, hand to an accountant | Export CSV | Native |
| Multiple people selling at once | No — see *Gaps* | No |

**Use the app at the table. Use the workbook for planning before the show and
for the accountant after it.** The app exports CSVs that paste straight into the
workbook's tabs.

---

## Running the app

It is a single HTML file with no build step, no server and no network calls.
All data stays on the device, in IndexedDB.

**On your phone — via GitHub Pages (set up, one switch left to flip)**

`.github/workflows/penshow-pages.yml` publishes this folder as the site root on
every push. It needs Pages turned on once first, because enabling Pages requires
repository-admin rights that the workflow's token deliberately does not have:

1. Open **<https://github.com/upadhyayameya/ControlApp/settings/pages>**
2. Under **Source**, choose **GitHub Actions**.
3. Re-run the *Deploy pen show tracker* workflow (Actions tab → the failed run →
   *Re-run all jobs*), or just push anything to `penshow/`.

The site then lives at **<https://upadhyayameya.github.io/ControlApp/>**.
Open it on your phone → Share → **Add to Home Screen**. It launches full-screen
and works in airplane mode, because `sw.js` caches the shell on first load.

**Or skip GitHub entirely** — drag the `penshow/` folder onto
<https://app.netlify.com/drop>. That gives you a URL in about thirty seconds with
no settings to change. Fine for a single-person table; the Pages route is better
if you want it to update whenever the repo does.

**On a laptop** — double-click `index.html`. Works, but the service worker and
"add to home screen" only activate over `http(s)`, not `file://`.

**Important:** each device holds its own separate copy of the data. The phone
and the laptop do not sync.

### Where the data actually lives

**In the browser you opened it in, on that one machine.** Nothing is uploaded;
there is no account and no server. Concretely, it is an IndexedDB database named
`penshow`, owned by the page's origin.

That has three consequences worth understanding before you enter hundreds of pens:

- **The origin is part of the identity.** A file you double-clicked
  (`file://…/index.html`) and the same app served over `http://localhost:8000`
  or a Pages URL are *different origins* and therefore *different databases*.
  Data entered in one does not appear in the other.
- **The machine is part of the identity.** The Mac's copy and the phone's copy
  are separate. There is no sync.
- **Clearing browsing data deletes it**, as does "empty cache and hard reload"
  in some browsers. Backups are the only protection.

**So: no, you do not have to take the same Mac** — but you do have to take the
data. Move it with **Data → Download backup** on the old machine and
**Restore backup** on the new one. The backup is a single `.json` file
containing every pen, sale, show and photo. Do that before the show as a
rehearsal, not on the morning of.

If you want the show itself to run off a phone or a second laptop, do the whole
inventory build-out on the Mac first — that's the tedious part and a real
keyboard is faster — then restore the backup onto the device you'll actually
sell from.

### First run

The five shows are pre-seeded. Then:

1. **Shows** → open each one, set your table fee, travel, lodging, meals, and
   **verify the sales tax rate**.
2. **Inventory** → **+ Item**, pick brand and type, type model, colour, cost,
   price, qty. Hit **Save & add next** and it keeps the brand, type and prices
   for the following pen — entering twenty colours of one model is twenty
   colour-and-save cycles, nothing more. Or import a CSV
   (Data tab → *Download template*).
3. **Sell** → filter by brand, then type; or search. Tap, pick payment, done.
4. **Reports** → per-show P&L and the end-of-day payment reconciliation.
5. **Data** → *Download backup* every single night.

### Photos, quickly

Four ways in, because with a large catalogue this is the action you repeat most:

- **Tap the square** next to any pen in the Inventory list — attaches straight
  away, without opening the pen.
- **📷 Camera** in the item sheet opens the rear camera directly on a phone.
- **Drag** an image onto the photo panel (Mac).
- **Paste** with ⌘V — screenshot a supplier's product shot and paste it in.

Images are downscaled to about 60KB on the way in, so a few hundred photos stay
comfortably inside the browser's storage budget.

---

## How the money is calculated

- **Revenue** is net of discounts and **excludes sales tax**. Tax you collect is
  a liability you remit to the state — it is never revenue and never profit.
- **COGS** uses the item's landed cost *snapshotted at the moment of sale*, so
  re-pricing an item later never rewrites history.
- **Gross profit** = revenue − COGS.
- **Net profit** = gross profit − card processing fees − show costs (table,
  travel, lodging, meals, shipping, other).
- **Break-even revenue** = (show costs + fees) ÷ your gross margin. This is the
  number that tells you whether a $450 table in Denver is worth it.
- **Floor price** is the lowest you will accept when haggling. Price below it in
  the cart and the line turns red. Set it on everything before you leave home —
  4pm Sunday is the worst moment to be doing margin arithmetic in your head.

---

## Gaps — what this does not do, and what you still need

Ordered by how much it will cost you if ignored.

### 1. Sales tax registration — the biggest exposure

The app calculates tax. It does not register you. **Every one of the five states
requires its own permit before you take a dollar**, and most pen shows now ask
promoters to collect dealer permit numbers.

- **Colorado is the hard one.** Home-rule cities levy and administer their own
  tax on top of the state rate, so "the Denver rate" is a stack, not a number,
  and remittance can go to more than one authority.
- California, Florida, Texas and Ohio all issue temporary/event seller's permits.
- Start each of these **4–6 weeks out**. Some are same-day online; some are not.

The tax rates seeded into both files are typical combined rates for the venue
city. **Verify each one** — they change, and the venue may sit in a different
district than you assume.

### 2. Payment limits will block a sale at the table

- **Zelle** daily send limits are commonly **$500–$2,500** depending on the
  buyer's bank, and it is the *sender's* limit that binds. A customer buying a
  $1,400 Nakaya may simply be unable to send it. Zelle is also **irreversible
  and has no dispute process** — good for you against chargebacks, but a
  mistyped amount is gone.
- **Venmo** caps around **$5,000/week** for person-to-person, and using a
  **personal** profile for business violates the terms — funds can be frozen
  mid-show. Move to a business profile (which charges a seller fee, ~1.9% + $0.10;
  put it in the card-fee field).
- **Card** is the only method with no practical ceiling, which is exactly why
  high-end pens need it. Until it is live, your realistic ceiling per customer
  is cash + one transfer app.
- **1099-K** reporting applies to Venmo business and any card processor. Keeping
  the sales log clean makes this a non-event; not keeping it makes it a problem.

**Recommendation:** get Square or Stripe Tap-to-Pay running before SF. It costs
nothing until you take a payment, and it removes the single biggest reason a
$1,000+ sale dies at the table. Note that Square's offline mode caps stored
transactions and *you* eat any decline that surfaces later.

### 3. Multi-person selling — not supported

If two people work the table on two phones, they will double-sell the same pen.
There is no sync layer, by design: convention wifi is unreliable enough that a
cloud-dependent till is a worse risk than a single-device one.

Options, cheapest first:
- **One device is the till.** Everyone rings through it. Free, works today.
- Second person takes a paper slip, entered on the till between customers.
- If you genuinely need two concurrent tills, that is the point where a hosted
  backend (or Square POS itself) earns its keep. See *Where this goes next*.

### 4. Things a pen show needs that are only partly handled

| Gap | Status | What to do |
|---|---|---|
| **Trades** — extremely common at pen shows | "Trade" is a payment method, but the incoming pen is not added to inventory or costed | Record the trade-in value as the payment amount, then add the received pen as a new SKU with that value as its cost |
| **Partial returns / refunds** | Only whole-sale void (restocks everything) | Void and re-ring the corrected sale |
| **Consignment** — selling someone else's pens | Not modelled; their pens would show as your COGS and inflate your profit | Track separately, or set cost = the amount you owe the owner so margin shows only your cut |
| **Bulk lots** — one price for a box of pens | No lot-cost allocation | Divide the lot cost across the pens yourself before entering cost |
| **Pre-show and dealer-day wholesale** | `Dealer price` field exists in the workbook; the app's cart takes any price | Override the price in the cart for dealer-to-dealer sales |
| **Shipping post-show orders** | Not tracked | Add as a custom line at cost |
| **Per-show allocation** — what you brought vs what is at home | Single quantity only | Keep home stock out of the app, or tag it |
| **Theft / shrinkage** | No cycle count | Count the case against Inventory at the end of each day; pen shows do have theft |
| **Insurance** | Out of scope | Your homeowner's policy almost certainly excludes inventory in transit and in a hotel room. Get a rider or an inland marine policy before SF |
| **Customer follow-up** | Name/email captured per sale, exported in the CSV | Export and load into whatever mailing list you use. The list you build over five shows is worth more than any single sale on it |
| **Barcode scanning** | No | Search-by-name is fast enough under ~200 SKUs |

### 5. Backup is manual, and that is the app's sharpest edge

Everything lives on one device. If the phone is lost, dropped in a hotel pool,
or the browser's storage is cleared, **the show's records are gone**. There is no
cloud copy, because there is no cloud.

Mitigation, and it is not optional:
- **Data → Download backup, every night**, and email the file to yourself.
- Do the same before any browser or OS update.
- Do a dry run before SF: ring a $1 sale, void it, export, restore.

---

## Where this goes next

Three honest options, in increasing cost:

**A. Stay as-is — single device, manual backup.** Zero cost, zero dependencies,
works in a dead-wifi convention hall. Right answer for one person at one table.
This is what is built.

**B. Add sync via a hosted database** (Supabase or Firebase, roughly free at
this volume). Buys you: two people selling at once, automatic backup, and the
laptop and phone showing the same numbers. Costs you: a login, a dependency on
wifi that may not exist, and a genuine offline-conflict problem to solve
(two devices selling the last unit of the same pen offline). About a week of work.

**C. Use Square as the till and this as the brain.** Square handles cards,
receipts and tax; you import its CSV here for the cost/margin/P&L side it does
not do well. Costs 2.6% + $0.10 per card sale and a card reader. This is the
pragmatic answer once card payments are confirmed — and it is why the app's CSV
export exists.

My recommendation: **run A for SF, decide between B and C based on what actually
went wrong.** Two shows of real usage will tell you more than any amount of
planning now.

---

## Files

```
penshow/
├── index.html            the app — everything is in this one file
├── sw.js                 service worker, for offline launch when hosted
├── manifest.webmanifest  makes "Add to Home Screen" behave like an app
├── icon.svg              home-screen icon
├── PenShowTracker.xlsx   the spreadsheet: Inventory, Sales Log, Shows, Dashboard
└── README.md             this file
```

The workbook's **Start here** tab repeats the setup steps and the colour code
(blue = you type it, black = calculated, green = pulled from another tab).
