# HBS Client Portal

A customer-facing portal for BEPS compliance, built on ENERGY STAR Portfolio
Manager. Customers sign in to see their own buildings measured against the
performance standard, what missing it would cost, how they are trending, and
what we can do about it — and to put new energy data in, which the portal
pushes back to Portfolio Manager.

This lives alongside the BAS Simulation Trainer in the repository root; the two
share a palette and nothing else.

---

## Running it

```bash
cd portal
npm install
npm run seed          # demo organizations, five buildings, four years of data
npm run dev:server    # API on :4000
npm run dev:web       # portal on :5173
```

Open http://localhost:5173. Demo accounts, password `PortalDemo123!` for all:

| Email | Sees |
| --- | --- |
| `staff@hbssolutions.example` | HBS staff — every organization, plus the sync console |
| `dana@meridian.example` | Meridian Property Group (admin — can enter data) |
| `chris@meridian.example` | Meridian Property Group (read-only) |
| `sam@cedarline.example` | Cedarline Holdings (admin) |

```bash
npm run typecheck     # all three packages
npm run test          # compliance engine tests
npm run build
```

### It runs without ESPM credentials

With `ESPM_USERNAME` / `ESPM_PASSWORD` unset the portal starts in **fixture
mode**: `FixtureTransport` replays recorded Portfolio Manager XML, so the whole
application — sync, metrics, two-way push — works with no network and no
account. The client code under test is identical either way; only the bytes'
origin differs.

To point it at the real service, fill in `.env` from `.env.example`:

```
ESPM_MODE=live
ESPM_ENVIRONMENT=test        # the /wstest endpoint, where the HBS test account lives
ESPM_USERNAME=…            # the HBS test account
ESPM_PASSWORD=…            # keep both in .env, never in the repo
```

Then sign in as staff, pick an organization, and press **Pull from Portfolio
Manager**.

> The ESPM API was unreachable from the environment this was built in (egress
> policy), so the live path is correct by construction and exercised against
> recorded fixtures, but has not been run against the real service. Expect to
> spend an hour reconciling the metric names in `server/src/espm/types.ts`
> against a live account — see *Known unknowns* below.

---

## ⚠ The numbers are provisional

**The compliance engine is exact. The constants it runs on are not yet
verified.**

`shared/src/beps/standards.ts` holds every BEPS target and penalty rate as
data, each carrying a `verification` field. Everything currently ships as
`needs-verification`: the values are the right shape and the right ballpark,
but they have not been checked against the published DOEE and Montgomery County
rules.

That flag is load-bearing. An unverified constant propagates `verified: false`
into every `PenaltyEstimate`, which makes the UI render a **range with a
caveat** instead of a single figure, and puts a provisional-figures banner on
the dashboard, the building page, the service recommendations and the generated
report. Nothing quotes a customer a number we have not checked.

**To make it real:** correct the values in `standards.ts`, flip each
`verification` to `'verified'`, and fill in `citationUrl`. Nothing else changes
— the banners disappear on their own and the portal starts quoting exact
figures. That is the intended one-sitting task before this goes in front of a
customer.

---

## What is here

| Feature | Status |
| --- | --- |
| Per-customer logins, scoped to their own portfolio | ✅ |
| Building metrics (score, EUI, GHG, water) vs the BEPS standard | ✅ |
| Estimated fines for missing the standard | ✅ (provisional constants) |
| Historical data stored per year and per billing period | ✅ |
| Trend graphs with the target line and a "do you arrive in time?" projection | ✅ |
| Enter new data in the portal, pushed back to ESPM | ✅ |
| Communication tracking — portal threads mirrored to email both ways | ✅ (outbox written, SMTP not wired) |
| Contextual service promotion tied to the building's own gap | ✅ |
| Automatic report generation | ✅ (HTML; prints to PDF) |
| Anomaly and usage-spike monitoring | ✅ (endpoint; no scheduler yet) |

---

## How it fits together

```
portal/
  shared/          Imported by BOTH the API and the browser app.
    types.ts         The domain model.
    api.ts           The request/response contract — a route that changes
                     shape breaks the frontend build, not a customer's screen.
    beps/
      standards.ts   Jurisdictions, cycles, targets, penalty models — as data,
                     each constant flagged verified or not.
      engine.ts      metrics + standard → verdict, gap, money. Pure functions,
                     so the API, the monitor and the browser agree to the cent.
    offerings.ts     Services, and the rules that decide when to surface one.

  server/
    espm/
      client.ts        EspmClient. Injectable transport, queued + throttled +
                       retried, reads and writes.
      fixtureTransport.ts / fixtures/   Recorded XML for offline running.
      mapper.ts        ESPM ⇄ domain. Property types, jurisdictions, units.
      sync.ts          Two-way sync. Pull upserts; push sends only what we owe.
    services/
      auth.ts          scrypt, opaque session ids in the database.
      portfolio.ts     Buildings joined to metrics and judged.
      messaging.ts     Threads, the email bridge, quoted-reply stripping.
      alerts.ts        The monitor: compliance, deadlines, anomalies, failures.
      reports.ts       Structured report → self-contained HTML.
    routes/index.ts    The API.
    db/                Schema, row mappers, demo seed.

  web/
    pages/           Login, Dashboard, BuildingDetail, Messages, Reports, Admin.
    components/      ComplianceGauge, TrendCharts, DataEntry, Recommendations.
```

### The two-way sync

Pull is straightforward: read ESPM, upsert locally, and never overwrite a local
edit that has not been pushed yet — the customer's unsent correction outranks
the stale value ESPM still holds.

Push is the direction with consequences, and it obeys three rules:

1. **Only rows the customer created here are ever sent.** A row that came from
   ESPM is never echoed back at it.
2. **Each row's outcome is recorded individually.** A batch that half-succeeds
   leaves the good rows `synced` and the rest `failed` with the reason ESPM
   gave, so a retry sends only what is still owed.
3. **Nothing is deleted in ESPM.** Corrections update in place; removal is a
   deliberate act a human performs in ESPM itself.

Every row's state is visible in the UI — *Only here* / *Sending* / *Sent to
ESPM* / *Rejected* — because the customer is typing a number that lands in a
regulated record, and hiding the round trip is how you lose their trust.

### Anomaly detection

Each reading is compared against **the same calendar month in previous years**,
not against last month — that controls for weather and occupancy far better.
The comparison uses a median and a robust spread (MAD), because a single
genuine spike would otherwise inflate a standard deviation enough to hide
itself. A finding reads like a person wrote it: *"August 2024 used 538,155 kWh,
about 90% above the usual August figure of 283,975."*

### Communication

The thread in the database is the record; email is a mirror of it in both
directions. A portal reply is written to the thread and queued to its CC list
in the same transaction — delivery can fail, the message cannot be lost. An
inbound email is matched back to its thread by an HMAC-signed token in the
reply-to address, and is additionally required to come from someone on the CC
list or in the organization, so a guessed address does not let an outsider post
into someone else's thread.

---

## Decisions worth knowing

**TypeScript end to end.** The domain model, the compliance math and the API
contract are one shared package imported by both the server and the browser.
For a portal whose whole point is two-way data flow, that shared truth is worth
more than picking the language with the most ESPM sample code. Background
tools (reports, monitoring) can be written in anything and read the same
database or call the same API.

**The ESPM connection is a row, not a config value.** `espm_connections` has a
nullable `organization_id`: null is the shared HBS service-provider account,
and a customer who brings their own account is the same code path with a
different row. That keeps the open question open without a rewrite.

**Compliance is computed on read, never stored.** It costs microseconds and
means that when a standard is corrected in `standards.ts`, every screen is
right on the next refresh — no backfill, no stale rows disagreeing with the
engine.

**SQLite to start.** Zero setup while the hosting and database conversation is
still open. Everything goes through `db/`, and nothing uses a SQLite-only
feature, so Postgres is a driver swap.

---

## Known unknowns

Things a reviewer should look at rather than trust:

- **BEPS targets and penalty rates** — placeholders. See the warning above.
  This is the one item that blocks showing this to a customer.
- **ESPM metric identifiers** (`server/src/espm/types.ts`, `METRIC_NAMES`) —
  ESPM silently omits a metric name it does not recognise rather than erroring,
  so a stale name shows up as a permanently null column. `pullMetrics` logs any
  requested name that came back absent; watch that log on the first live pull.
- **Jurisdiction inference** (`espm/mapper.ts`) — a Maryland address outside
  the Montgomery County ZIP list returns `none` rather than guessing. Staff can
  override per building. Wrong in the safe direction, but the ZIP list is not
  exhaustive.
- **ESPM error shapes** — the client handles the documented envelope, including
  an error returned under HTTP 200. Real-world responses may surprise it.

## Not built yet

- **SMTP delivery.** `email_outbox` is written correctly; nothing drains it,
  and there is no inbound mail webhook. `ingestInboundEmail` is the entry point
  and is tested-shaped, waiting for a provider.
- **A scheduler.** `POST /api/alerts/run-monitor` is the "twice a month" job;
  it needs cron or a queue in front of it.
- **Report templates beyond HTML.** `buildComplianceReport` returns structured
  data precisely so a formal template can render the same numbers.
- **User self-management.** Users are created by the seed; there is no invite
  flow.
- **Rate limiting on login**, and password reset.
