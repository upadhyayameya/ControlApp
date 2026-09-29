# Submarine Outreach — US B2B email portal

A portal to find US businesses for **Submarine Pens**, gather their public contact
emails, run email sequences, and answer replies, all in one place.
**Small and mid-size businesses come first; large ones are held back until you turn them on.**

```
Find businesses ──► Crawl websites for emails ──► Campaign sequences ──► Inbox (replies)
 (nationwide sweep,     (smallest first, robots.txt   (daily cap, recipient-   (auto-matched, stop
  search, CSV, URLs)     respected, MX-checked)        local business hours)     sequence, AI drafts)
```

## Quick start

Requires Node.js 22.5 or newer. There's no build step and no database server, because it uses the SQLite built into Node.

```bash
cd submarine-outreach
npm install
cp .env.example .env      # fill in what you have; everything is optional to start
npm start                 # http://localhost:3000
npm test
```

The portal starts in **Dry-run mode**, so emails are recorded in the portal but not sent.
Try the whole flow safely first, then switch to Live in **Settings**.

## What each page does

| Page | Purpose |
|---|---|
| **Dashboard** | Pipeline by size tier, sweep progress, what's needed next. |
| **Find businesses** | *Nationwide sweep* (every segment × all 50 states + DC), *targeted search*, *CSV import*, *paste websites*. |
| **Leads** | Filter by state / size / segment / status / has-email. Open a lead to edit, re-crawl, add contacts or email them. Bulk-enroll, export CSV. |
| **Campaigns** | Multi-step sequences with merge fields, live preview, optional AI drafting, and enrollment by segment/state/size. |
| **Inbox** | Replies matched to the right conversation. Reply in-thread, draft with AI, and mark leads interested or customer. |
| **Sent** | Every outgoing email and its status. |
| **Settings** | Sender identity, postal address, send limits, the large-business switch, the suppression list, and connection status. |

## How "nationwide, small businesses first" works

1. **Segments** (`server/data/segments.js`) are ranked in three phases:
   - **Phase 1 (resellers and partners):** promotional-products distributors, corporate-gifting companies, stationery and pen shops, gift shops, independent bookstores, museum and space-center shops (for the space-themed pens), coffee roasters (for the coffee-scented pens), engraving and awards shops, and office-supply dealers.
   - **Phase 2 (small/mid end buyers):** real estate, law and CPA firms, medical and dental offices, insurance agencies and credit unions, and event planners.
   - **Phase 3 (large-organisation segments):** hotels, universities and corporate HQs.
2. **The sweep** (`server/sourcing/sweep.js`) queues about 8,800 Google Places searches. The biggest city in **every** state is searched before any state's second city, so coverage is national from day one. You pick the maximum phase and the daily search cap.
3. **Sizing** (`server/sourcing/sizing.js`) classifies each business:
   - small: fewer than 50 staff
   - mid: 50–499 staff
   - large: 500+ staff

   It uses the employee count when known (from CSV or Hunter). Otherwise it uses chain detection (how many locations share one website), then review volume. You can override the size on any lead.
4. **Crawling and sending** always go small → mid → large. Large businesses are **not enrolled** until *Settings → Large businesses → Allow*.

## Where the emails come from

- The **website crawler** visits the homepage plus contact, about and wholesale pages, up to 5 pages per site. It collects **publicly listed** addresses, including mailto links, `info [at]` style addresses and Cloudflare-obfuscated ones. It honours `robots.txt`, drops junk and no-reply addresses, and keeps only domains with MX records. Buyer roles such as `wholesale@`, `purchasing@` and `sales@` rank highest.
- **Hunter.io** (optional, `HUNTER_API_KEY`) adds named contacts and headcount.
- **CSV import** accepts any list you are allowed to use, such as trade-show attendee lists, ASI/PPAI distributor directories, or data-vendor exports like Apollo or ZoomInfo. The columns are detected automatically.

## Connections (`.env`)

| Variable | Needed for |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Sweep and targeted search. In Google Cloud, enable **Places API (New)**. Each search is billed, so use the daily cap. |
| `SMTP_HOST/PORT/USER/PASS` | Sending. For Google Workspace, use `smtp.gmail.com:465` with an App Password. |
| `IMAP_HOST/PORT/USER/PASS` | Receiving replies. For Google Workspace, use `imap.gmail.com:993`. User and password default to the SMTP ones. |
| `PUBLIC_URL` | Unsubscribe links. Use your deployed **https** URL. |
| `PORTAL_PASSWORD` | Login to the portal. Set it before putting the portal on the internet. |
| `ANTHROPIC_API_KEY` | Optional AI buttons: draft sequences, draft replies, and triage replies. |

## Compliance and deliverability (please read)

US B2B cold email is legal under **CAN-SPAM**, which the portal enforces:

- Every email gets a footer with your name, company, **physical postal address** and a working **unsubscribe link**. It also carries `List-Unsubscribe` and one-click headers. Live mode refuses to start until the postal address, sender and SMTP are set.
- Unsubscribes (by link or by a "remove me" reply) and bounces go onto a **permanent suppression list** and stop all sequences. You can also suppress whole domains.
- Any reply stops the sequence for that business. An out-of-office reply pushes the next follow-up back a week.

To protect your domain's reputation:

- **Send from a separate domain**, for example `submarinepens-usa.com` or `trysubmarinepens.com`, not your main one. Set up SPF, DKIM and DMARC on it.
- Warm the mailbox up. Start at **20–40/day** per mailbox and raise it slowly (the daily cap is in Settings).
- Emails go out only on weekdays, during business hours in the recipient's own time zone (by state), with a gap between sends.
- Keep messages short and plain-text. The starter sequence and AI prompts are already written this way.

Canada (CASL) and the EU/UK (GDPR/PECR) have stricter consent rules. This tool is set up for **US** businesses only.

## Data

Everything lives in `data/outreach.db` (SQLite). Back up that file. **Leads → Export CSV** exports leads and contacts.

## Code map

```
server/
  index.js            boot + background workers (sweep, crawl, send, IMAP poll)
  app.js              HTTP API + unsubscribe pages + auth
  db.js / settings.js schema, settings, env config
  leads.js            upsert/dedupe businesses, contacts, suppression, enrichment, CSV import
  sourcing/           places.js, crawler.js, emails.js, robots.js, sizing.js, sweep.js, hunter.js, csv.js
  mail/               sender.js (SMTP), outreach.js (sequences), inbox.js (IMAP + reply matching), render.js
  ai.js               Claude API drafting/classification (optional)
  data/               geo.js (states, cities, time zones), segments.js (targets + pitches)
public/               single-page UI (no build step)
test/                 unit + end-to-end flow tests (node --test)
```
