# Submarine Outreach: the Claude portal

The portal is a private page in the owner's Claude account:
https://claude.ai/artifact/FzaDcnMxDPR7K9LJkzUbLZ

Nothing to install or host. It runs inside claude.ai, keeps its data in the page's own database, and works with two helpers.

| Part | What it does | When it runs |
|---|---|---|
| **Prospector** (scheduled Claude agent, `prospector-prompt.md`) | Researches businesses you add. Then it finds new small and mid-size US businesses in the types chosen in Settings, working the Territory plan one state at a time, and finds a *published* business email for each. It writes each one a personal intro email recommending the pens that suit it, and drafts one follow-up after N days without a reply. | Weekdays 8:49am US Eastern, or **Run now** in the portal |
| **Inbox watcher** (inside the portal, uses your Gmail read-only) | Confirms which approved drafts you actually sent, and reads replies from those businesses. It sorts them (interested, question, not interested, unsubscribe, out of office), drafts suggested answers and records bounces. Unsubscribes and bounces go on the do-not-email list. | When the portal is open: on load, then every 10 minutes |
| **You** | Approve, edit or rewrite each email. **Approve → Gmail draft** puts it in your Gmail drafts with your signature, postal address and an unsubscribe line. You press Send in Gmail. | Whenever you like |

Nothing is ever sent automatically.

## Screens

- **Home**: the one next step (add your postal address, review emails, or send the drafts waiting in Gmail), the pipeline from found to interested, a territory map and recent activity.
- **Review emails**: one email at a time, exactly as it will go out (footer included), beside what the agent learned about the business. Keys: J/K for next/previous, Ctrl or Cmd+Enter to approve.
- **Replies**, **Leads**: replies with suggested answers; every business with filters by status, region, state and type. From either you can start a deal or ask for "more like this", which queues a request and starts the Prospector.
- **Deals**: interested businesses on a board (Interested → Samples → Quote sent → Customers). It logs sample shipments and builds quotes from the prices in Settings, which become a quote table in the email. It records orders and says what each deal is waiting on. Due emails are drafted for review: offer samples, address reminder, samples check-in 10 days after shipping, quote follow-up after 5 days, and a reorder check-in 3 weeks before the reorder date.
- **Results**: reply and interest rates by state, region, business type and campaign, plus this week's summary. Once a day the page writes `config/insights`, which the Prospector uses to lean toward what gets replies. The summary can go to your Gmail drafts, and automatically on Mondays if you switch that on.
- **Territory**: three zones and seven regions. West has Pacific Coast and Mountain West. Central has Midwest and South Central. East has Northeast, Mid-Atlantic and Southeast. Add whole regions or tap single states on the map, then put the states in order. The Prospector works the first state that has fewer than the per-state target of businesses with an email (default 20), then moves to the next. With no states chosen it rotates across the country.
- **Settings**: sender details, offer, business types, the share of each run for promotional-products distributors, seasonal campaigns (year-end gifting, holiday stock, tax season, graduation, back to school, conference season, closing gifts), agents, weekly summary, do-not-email list, and pen prices for quotes.

Home also flags drafts approved over 2 days ago but not sent, and deals waiting on you.

## Branded emails

Every email goes into Gmail as HTML with a plain-text copy:

- a navy Submarine Pens header
- the personal note
- the recommended pens as cards, from lines written as `- Pen name: why it suits them`
- a quote table on quote emails
- a button to the catalog or website
- the signature and the legal footer

It uses no images, so nothing hides behind "show images" and it renders the same in Gmail, Outlook and Apple Mail. Review shows the exact email; switch to Edit text to change the wording.

## Data (page database)

The page keeps these collections:

- `config/main`: sender details, postal address, sample offer, brochure link, pricing notes, business types, `states` (ordered territory plan), `per_state_target`, daily target, follow-up days, large-company switch, extra agent instructions. Settings and Territory edit this document, and the Prospector reads it on every run.
- `config/catalog`: the pens the agents may recommend.
- `config/agents`: the Prospector's routine id, which the Run now button uses.
- `leads/<website-host-with-dashes>`: one document per business, holding its research, fit, email, where the email was found, and its status.
- `drafts/<lead>-intro`, `drafts/<lead>-f1` and `drafts/<lead>-r-<gmail message id>`: intro, follow-up and reply drafts, with status `pending`, `in_gmail`, `sent` or `skipped`.
- `deals/<lead id>`: stage, sample shipment, quote, orders, reorder interval, notes, history and which follow-ups were sent (`nudged`).
- `requests/<id>`: "find more like this" requests for the Prospector.
- `config/insights`: daily reply-rate summary the Prospector reads.
- `replies/<gmail message id>`: replies, each with its classification and a one-line summary.
- `suppressions/<email or domain>`: the do-not-email list.
- `runs/<timestamp>`: the activity log.

## Optional: an Inbox watcher that runs without the portal open

`inbox-prompt.md` is a standalone version of the inbox check for a scheduled routine. A routine can only use Gmail if you create it yourself in claude.ai → Routines with the Gmail connector attached. The portal's built-in check covers this as long as you open the portal once or twice a day.
