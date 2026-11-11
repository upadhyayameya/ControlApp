# Submarine Outreach — US B2B email portal

A portal to find US businesses for **Submarine Pens**, gather their public contact
emails, and write each one a personal email that you approve before it's sent. It also
handles the replies.
**Small and mid-size businesses come first; large ones are held back until you turn them on.**

```
Find businesses ──► Read their website ──► Write an email for them ──► You review ──► Send ──► Inbox
 (nationwide sweep,   + public emails        (their business, the pens      & approve    (business   (replies stop
  search, CSV, URLs)                          that suit them, brochure)      each one     hours)      follow-ups)
```

## Run it on your computer

You don't need to use the terminal.

1. **Install Node.js (one time).** Go to [nodejs.org](https://nodejs.org/en/download), download the **LTS** version and install it like any other app.
2. **Download the portal.** [Download this ZIP](https://github.com/upadhyayameya/ControlApp/archive/refs/heads/claude/festive-dijkstra-byvjxy.zip) and unzip it. Once this is merged, use the GitHub page → **Code → Download ZIP** instead. Open the `submarine-outreach` folder inside.
3. **Start it by double-clicking:**
   - **Mac:** `Start Submarine Outreach (Mac).command`. The first time, macOS may say it's from an unidentified developer. If so, right-click the file, choose **Open**, then **Open** again.
   - **Windows:** `Start Submarine Outreach (Windows).bat`. If Windows SmartScreen appears, click **More info → Run anyway**.

   The first start installs what it needs, which takes about a minute. Your browser then opens at **http://localhost:3000**. **Keep that small window open** while you use the portal; close it to stop.
4. **In the portal, go to Settings → Connections:**
   - Click **Use Gmail / Google Workspace** (or Outlook). Enter your email address and an **app password**. For Google, go to Google Account → Security → 2-Step Verification → App passwords. Then click **Test email login**.
   - Paste your **Claude API key** (from console.anthropic.com) so each email is written for its business.
   - Optionally, paste a **Google Places API key** for the nationwide business search.
   - Further down, fill in your name, title, phone, postal address and what you offer as samples.
5. **Pens & brochures:** upload your brochure PDFs and check the pen list.
6. **Find businesses:** import a CSV, paste websites, or run a search. Then **Campaigns → New campaign → Enroll**.
7. **Review emails:** read, edit and approve each email. When you're happy, switch **Settings → Mode** to **LIVE**.

Things to know when it runs on your own computer:

- Emails are only sent, and replies only checked, **while the portal is running**. Approved emails wait until you start it again, and still go out only during the recipient's business hours.
- The people you email can't open links to your computer. So:
  - Brochures are **attached** to the email, unless you add a Google Drive or Dropbox share link to the brochure on the Pens & brochures page.
  - People opt out by **replying "unsubscribe"**. The portal catches that reply and never emails them again. The US CAN-SPAM Act allows a reply address as the opt-out method.
- Your data is in `data/outreach.db` inside the folder. Back it up now and then, and keep it when you download a newer version.
- The portal only opens on this computer; others on your Wi-Fi can't reach it.

To move it online later, see *Quick start* below and set `PORTAL_PASSWORD` and `PUBLIC_URL`.

## No mass mailing: every email is personal and approved by you

- **Research first.** The crawler saves what each business says about itself: its site title, description, and homepage and about-page text.
- **One email per business.** With `ANTHROPIC_API_KEY` set, each email is written for that business from its website:
  - It opens with something true and specific about them.
  - It recommends the **2–3 pens from your catalog that suit them**, saying why. For example, a coffee roaster gets the coffee-scented pens, and a science museum gets the Space Series.
  - It links your brochure and offers samples.
  - It never invents facts. When there's little to go on, it stays honest and general.
- **Fit check.** Each business gets a fit score and a one-line reason. "Not a fit" removes them for good.
- **Human review is on by default.** Every email waits in **Review emails**. You can edit it, attach a PDF, rewrite it with guidance (e.g. "mention their wedding line"), skip it, or approve it. Follow-ups are drafted and reviewed the same way.
- **Written like a person.** The emails are plain text with no marketing clichés. They're signed with your name, title and phone. The opt-out line is polite ("just reply 'no thanks'"). Sends are spaced at random within the recipient's business hours.
- **Low volume.** The default is 20 emails a day and at most one intro plus one follow-up per business. Any reply stops the follow-up.

Without an AI key, drafts use your campaign template filled in per business:
- `{{products}}` lists the pens matched to their segment.
- `{{brochure_link}}` is the brochure link.
- `{{sample_offer}}` is your sample offer.

These drafts still wait for your review.

## Pens & brochures

On the **Pens & brochures** page you manage what emails can offer:
- **Pens.** Each has a name, a short description, an optional price or minimum-order note, and which business types it's **best for**. It starts with Submarine's public range. No prices are filled in for you.
- **Brochures.** Upload PDFs and each gets a shareable link (`PUBLIC_URL/b/...`). You can link a brochure to each pen.

By default, first emails **link** to the brochure rather than attaching it. Attachments in first-contact emails often go to spam or get stripped by company filters. You can tick "Attach PDF" on any email in Review, or on a reply in the Inbox, for example when someone asks for the catalog.


## Quick start (developers / servers)

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
| **Campaigns** | The brief for each email (intro and follow-up), and enrollment by segment, state or size. |
| **Review emails** | Every personal draft, next to that business's research and fit. You edit, attach, rewrite, skip or approve. |
| **Pens & brochures** | Your pen options (and what each suits) and brochure PDFs with shareable links. |
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

## Connections (Settings page or `.env`)

Everything below except `PORTAL_PASSWORD` can also be entered on **Settings → Connections**. Values saved there are stored in the local database and override `.env`.

| Variable | Needed for |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Sweep and targeted search. In Google Cloud, enable **Places API (New)**. Each search is billed, so use the daily cap. |
| `SMTP_HOST/PORT/USER/PASS` | Sending. For Google Workspace, use `smtp.gmail.com:465` with an App Password. |
| `IMAP_HOST/PORT/USER/PASS` | Receiving replies. For Google Workspace, use `imap.gmail.com:993`. User and password default to the SMTP ones. |
| `PUBLIC_URL` | Only when the portal is hosted online. Use its **https** address; it enables unsubscribe and brochure links. Leave it unset on your own computer. |
| `PORTAL_PASSWORD` | Login to the portal. Required before putting it online. Also set `HOST=0.0.0.0`; without a password it only listens on this computer. |
| `ANTHROPIC_API_KEY` | Writing each email for its business, reply drafts and reply triage. Recommended. |

## Compliance and deliverability (please read)

US B2B cold email is legal under **CAN-SPAM**, which the portal enforces:

- Every email gets a footer with your name, company, **physical postal address** and a working **unsubscribe link**. It also carries `List-Unsubscribe` and one-click headers. Live mode refuses to start until the postal address, sender and SMTP are set.
- Unsubscribes (by link or by a "remove me" reply) and bounces go onto a **permanent suppression list** and stop all sequences. You can also suppress whole domains.
- Any reply stops the sequence for that business. An out-of-office reply pushes the next follow-up back a week.

To protect your domain's reputation:

- **Send from a separate domain**, for example `submarinepens-usa.com` or `trysubmarinepens.com`, not your main one. Set up SPF, DKIM and DMARC on it.
- Warm the mailbox up. The default is **20/day**, which is about what one person can review and follow up well. Raise it slowly if at all.
- Emails go out only on weekdays, during business hours in the recipient's own time zone (by state), with a gap between sends.
- Keep messages short and plain-text, and link brochures rather than attaching them on first contact. The defaults already work this way.

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
  ai.js               Claude API: per-business emails, reply drafts, reply triage (optional)
  catalog.js          pen options + brochures (stored in SQLite, served at /b/<token>)
  data/               geo.js (states, cities, time zones), segments.js (targets + pitches)
public/               single-page UI (no build step)
test/                 unit + end-to-end flow tests (node --test)
```
