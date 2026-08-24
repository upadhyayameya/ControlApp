# Monarch Live Dashboard

A local, always-on dashboard for a [Monarch Money](https://app.monarch.com) account:
net worth over time, this month's cash flow, where the money went, every account
balance, a live transaction feed, and budget progress — all on one page that
refreshes itself and pushes changes to the browser as they land.

It runs as a small portal on your own machine. **Zero npm dependencies** — Node 20+
and the two files' worth of standard library it ships with.

```bash
npm run demo     # synthetic data, no account needed → http://127.0.0.1:4174
npm start        # the real thing; sign in on the page
npm test         # unit tests (they never touch the real API)
```

<!-- Screenshots live in the PR; the page is the artifact. -->

---

## Heads-up: Monarch has no public API

Monarch doesn't publish an API or issue API keys. This talks to the same private
GraphQL endpoint (`https://api.monarch.com/graphql`) their web app uses, with the
same operations. That means:

- **It can break without notice.** If Monarch renames a field, the affected panel
  shows the error and the rest of the dashboard keeps working.
- **It's read-mostly.** The only thing this writes is a sync request — the same
  "refresh my accounts" button the Monarch app has. It never edits your data.
- **It's for your own account.** Credentials go to Monarch and nowhere else.

## Signing in

Two ways, both offered on the sign-in page:

**Email &amp; password** — posts to Monarch's `/auth/login/` exactly as the web app
does. If your account has two-factor auth, the page asks for the six-digit code
and retries. Monarch returns a long-lived token, which is what gets stored.

**Browser session** *(the one that usually works)* — Monarch blocks most programmatic
sign-ins, answering 403 whether or not you have two-factor turned on. Borrow the
session from a browser instead: sign in at app.monarch.com, open DevTools → Network,
reload, right-click any request to `api.monarch.com` → **Copy as cURL**, and paste the
whole command in. The paste box also accepts a bare `Cookie:` header, an
`Authorization: Token …` line, or just the token — whatever your browser makes easy.
Only the session is kept; the rest of the paste is discarded, and it's verified against
Monarch before it's saved.

Either way the session lands in `.monarch/session.json` with `0600` permissions and
is reused on restart. It's gitignored. **Your password is never written to disk.**
Sign out from the header to delete it.

## What "live" means

Monarch itself is not real-time — banks report on their own schedule — so the
dashboard layers three things:

| Mechanism | What it does |
|---|---|
| **Poll** | Re-reads every panel on a timer (default 2 minutes, adjustable in the header from 30s to 15m). |
| **Push** | The server diffs each new snapshot against the last and streams the changes to open tabs over Server-Sent Events. New transactions flash in the table; balance and net-worth moves land in the **Live activity** feed. |
| **Sync banks** | Asks Monarch to pull fresh data from your institutions (`forceRefreshAccounts`), then polls until it reports done and re-reads immediately. |

Open the page in two tabs and both update together — the snapshot lives in the
server process, not in the browser.

## What's on it

- **Net worth** — daily balance history with 1M/3M/6M/1Y/All ranges, hover
  crosshair, and the change over the selected range. Assets and liabilities split out.
- **This month** — income, spending, saved, and a savings-rate meter.
- **Where the money went** — month-to-date spend by category, top 8 plus "Other".
- **Accounts** — grouped by type with per-account balance, institution, last-updated
  time, and a *needs relink* flag when Monarch has lost the connection.
- **Transactions** — the recent feed with pending / review / recurring badges and
  "load more" paging straight from Monarch.
- **Budget** — planned vs actual per category group for the current month, with
  over-budget rows called out.
- **Live activity** — what changed since the page opened.

Light and dark themes, and the charts follow a validated colorblind-safe palette.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4174` | Port to serve on. |
| `HOST` | `127.0.0.1` | Bind address. Loopback on purpose — see below. |
| `MONARCH_POLL_SECONDS` | `120` | Starting refresh interval. |
| `MONARCH_DEMO` | unset | `1` runs on synthetic data. |
| `MONARCH_SESSION_FILE` | `.monarch/session.json` | Where the session is stored. |
| `MONARCH_BASE_URL` | `https://api.monarch.com` | API base (used by the tests' mock server). |

## Security notes

- The server binds to **loopback only** by default. It holds a live financial
  session — don't expose it to a network without putting real auth in front of it.
- Cross-origin requests to `/api/*` are rejected, so a page in another tab can't
  drive your session.
- Nothing is sent anywhere except `api.monarch.com`. There is no telemetry, no
  third-party script, and no CDN — the page loads only its own two static files.
- The session file is the sensitive artifact. It's gitignored and `0600`; delete
  `.monarch/` (or hit **Sign out**) to revoke local access.

## Layout

```
server/
  server.mjs     HTTP routes, SSE stream, static files, session wiring
  monarch.mjs    Monarch API client — auth (token + cookie) and GraphQL
  queries.mjs    The GraphQL operations, kept together for easy patching
  snapshot.mjs   Normalizers → one snapshot shape; polling service; change diffing
  session.mjs    Token/cookie persistence
  demo.mjs       Synthetic account for demo mode and development
public/
  index.html     Sign-in gate + dashboard markup
  app.js         Rendering, SVG charts, SSE client
  styles.css     Palette tokens (light/dark) and layout
test/            Unit tests against a mock Monarch server
```

## When something breaks

- **"Monarch is requiring a CAPTCHA"** → use the browser-session tab on the sign-in page.
- **A single panel shows an error** → that query's shape changed; the fix is usually a
  field name in `server/queries.mjs`.
- **"session expired"** → the token was invalidated (password change, sign-out
  elsewhere). Sign in again; the old file is cleared automatically.
- **Nothing updates** → check the pill in the header. `live` means the timer is
  running; `error` shows the last failure in the banner underneath.
