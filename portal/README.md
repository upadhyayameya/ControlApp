# HBS Client Portal

A multi-tenant platform for BEPS compliance, built on ENERGY STAR Portfolio
Manager. Organizations sign up, connect their ENERGY STAR account, invite their
team, and see every building measured against the performance standard — what
missing it would cost, how they are trending, and what we can do about it. New
energy data entered in the portal is pushed back to Portfolio Manager.

It lives alongside the BAS Simulation Trainer in the repository root; the two
share a repository and nothing else.

---

## Two doors

- **`/login`** — the client portal. A customer sees their own organization and
  nothing else.
- **`/hbs`** — the HBS staff console. Every client account, their portfolios,
  and the Portfolio Manager sync behind them.

Both authenticate against the same endpoint; the split is about where people
arrive, not a second authentication system, which would be two places to get
wrong. Signing in with the "wrong" kind of account still works and routes you
where you belong — refusing would add friction and tell an attacker with valid
credentials nothing they do not already know.

## The portfolio tree

```
SJP portfolio                 2 buildings · 275,000 ft²
  └ Phase 1
      └ Maple Lawn
  └ Phase 2
      └ Maple Lawn North
```

Arbitrary depth rather than two fixed levels, because a phase-within-a-phase
costs nothing in the schema and a migration later. A group only earns its
indentation if it says something the building list does not, so every node
carries a roll-up: the combined floor area, compliance counts and penalty
exposure of everything beneath it, at any depth. That is what makes "Phase 1 is
carrying $2.4M" answerable without opening five buildings.

The assembly (`shared/src/tree.ts`) is deliberately forgiving. A group whose
parent is missing, or part of a cycle, becomes a root; a building filed under a
group that no longer exists is listed as unfiled. Losing a customer's building
because a row was inconsistent would be far worse than showing it in the wrong
place. Deleting a group detaches its contents rather than destroying them, for
the same reason.

## The design in one line

BEPS reduces to one fact: **there is a line, and a building is above it or
below it.** The whole interface is built from that — a threshold instrument
that normalises the two metrics (an ENERGY STAR score is a floor, a site EUI is
a ceiling) so that on every screen, fuller always means better and the standard
always sits in the same place.

The palette is monochrome on purpose. The only saturated colour in the product
is compliance status, so colour on screen always carries information. A
tenant's own accent is quarantined to its mark and focus rings, where it can
never be mistaken for meaning.

---

## Running it

```bash
cd portal
npm install
npm run seed          # demo organizations, five buildings, four years of data
npm run dev:server    # API on :4000
npm run dev:web       # portal on :5173
```

Or build a single self-contained file that runs with no server at all:

```bash
npm run build:demo --workspace=web   # → web/dist/index.html, open it directly
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
| Self-service signup, per-tenant organizations | ✅ |
| Team invitations, roles, last-admin protection | ✅ |
| Per-tenant ENERGY STAR connection, credentials encrypted at rest | ✅ |
| Plans with enforced limits, and an audit trail | ✅ |
| Onboarding checklist computed from real state | ✅ |
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
| Light and dark, on real design tokens | ✅ |

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
    services/
      tenancy.ts       Signup, the organization profile, plan usage, onboarding.
      invitations.ts   Invite, accept, revoke; members and roles.
      connections.ts   Which ESPM account a request uses, and its credential.
      secrets.ts       AES-256-GCM for credentials that must be replayable.
      audit.ts         Who did what, with the actor's name denormalised.
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
    index.css        The design tokens. Light on :root, dark redefining the
                     same names — no colour is ever first defined inside a
                     media or [data-theme] block.
    components/
      Threshold.tsx    The signature instrument: the normalised threshold track
                       and the band that opens every building page.
      Shell.tsx        Left rail, tenant mark, accent injection.
      TrendCharts.tsx  Trends with the target line and an arrival projection.
      DataEntry.tsx    The two-way sync surface.
    pages/           Login, Signup, AcceptInvite, Dashboard, BuildingDetail,
                     Messages, Reports, Settings (team / connection / plan /
                     branding / activity), Staff.
    api/
      client.ts        The live client, and the demo/live switch.
      demoClient.ts    The whole app running in the browser on captured
                       responses — see "Running it" above.
```

### Tenancy

`espm_connections.organization_id` is nullable: NULL is the shared HBS
service-provider account customers share properties into, and a row with an
organization is that customer's own ENERGY STAR account. `connectionFor()`
picks between them, and it is the only place that decision is made.

A tenant's credential is encrypted at rest with AES-256-GCM and a key held
outside the database. It cannot be hashed, because ESPM speaks HTTP Basic and
the password has to be replayable — which makes how it is stored the most
security-sensitive decision here. A tenant connection missing its credential is
**refused**, never quietly fulfilled with the HBS password: authenticating as
HBS against a customer's account would be both wrong and nearly invisible.

Invitation tokens exist only in the emailed link; the database holds a SHA-256
hash. They are single-use, superseded on re-invite, and an unknown, revoked or
expired token all answer identically so probing tells an attacker nothing.

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

- **Payment.** Plans are enforced, but changing one raises a request rather
  than charging a card. There is no payment processor wired up and the UI says
  so rather than pretending.
- **SMTP delivery.** `email_outbox` is written correctly; nothing drains it,
  and there is no inbound mail webhook. `ingestInboundEmail` is the entry point
  and is tested-shaped, waiting for a provider.
- **A scheduler.** `POST /api/alerts/run-monitor` is the "twice a month" job;
  it needs cron or a queue in front of it.
- **Report templates beyond HTML.** `buildComplianceReport` returns structured
  data precisely so a formal template can render the same numbers.
- **Rate limiting on login**, and password reset.
- **A proper migration system.** `db/migrations.ts` applies additive columns
  idempotently, which is honest but additive-only — no renames, no drops.
