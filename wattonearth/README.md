# Watt on Earth — public portal (Stage 1)

The public site for **wattonearth.in**: an India-focused energy and carbon advisory. Stage 1 generates leads and shows credibility:

- **Home, Services (5), About, Contact, Privacy** with an animated single-line logo, dark/light theme and a CCTS countdown driven by the tracker data.
- **Energy & Carbon Check** (`/check`): a free tool that runs entirely in the browser. It gives EPI or SEC against a benchmark band, flags unusual months, estimates a savings range in ₹, calculates Scope 1 & 2 emissions, and shows which of CCTS, CBAM, BRSR and ECBC are likely to apply. The branded PDF report unlocks after a lead form submitted to Formspree.
- **News** (`/news`): MDX posts with tag and sector filters in the URL, search, pagination, highlighted weekly roundups, RSS, Open Graph images and JSON-LD.
- **Regulation Tracker** (`/tracker`): timeline and table views of CCTS/CBAM/BRSR/ECBC milestones, each linked to its official source.
- **Weekly news drafting**: a GitHub Action fetches RSS feeds, drafts summaries with Claude and opens a PR. Every post it creates is a draft.

> ⚠️ **Placeholders.** The Check's emission factors and building benchmarks were verified on 2026-11-18 (see below). Regulatory dates, news feeds, contact details and the three savings-method values are still placeholders. See [Placeholders to replace before launch](#placeholders-to-replace-before-launch). `npm run assumptions` prints the current list, and a banner appears on every page during development until the list is empty.

---

## Stack

Next.js 16 (App Router, Turbopack) · TypeScript (strict) · Tailwind CSS v4 · `next-themes` · MDX via `next-mdx-remote` + `gray-matter` · Recharts · `@react-pdf/renderer` (client-side) · Formspree · Vercel Analytics. There is no database: domain types in `lib/types.ts` are shaped so that Supabase can be added in Stage 2 without a rewrite.

> This Next.js version changes some APIs (for example, `params` and `searchParams` are Promises). Its docs ship in `node_modules/next/dist/docs/` and `AGENTS.md` points coding agents to them.

## Setup

Requires Node 20.9+ (CI uses 22).

```bash
cd wattonearth
npm install
cp .env.example .env.local   # then fill in values
npm run dev                  # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server. Shows drafts and the unverified-data banner |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` · `npm run typecheck` · `npm test` | ESLint · `tsc` (after `next typegen`) · unit tests (Node test runner via `tsx`) |
| `npm run assumptions` | Lists every unverified assumption, tracker entry and feed |
| `npm run news:fetch` | Weekly news drafting (see below). Flags: `--dry-run`, `--no-ai`, `--fixture <file.xml>` |

### Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Vercel | Canonical URL for metadata, sitemap, RSS and OG (default `https://wattonearth.in`) |
| `NEXT_PUBLIC_FORMSPREE_ID` | Vercel | Formspree form ID (the part after `formspree.io/f/`). Used by contact, newsletter and Check lead capture. If it's missing, **dev** logs submissions to the console and lets you continue, but **production** shows an error and does not unlock the PDF, so no lead is silently lost |
| `SHOW_DRAFTS` | Vercel *preview* only | `true` shows draft posts on a preview deployment, which is handy for reviewing the weekly PR. **Never set it on production** |
| `ANTHROPIC_API_KEY` | GitHub secret | Used by the news drafting script |
| `ANTHROPIC_MODEL` | GitHub variable (optional) | Model for news drafting. Default `claude-opus-5-5` |

Every form submission carries a `type` field (`contact`, `check` or `newsletter`) so you can filter in Formspree. Check submissions also include the key inputs and results: facility, location, size, EPI/SEC and band, savings range, Scope 1/2, flagged months, regulatory exposure and monthly kWh.

## Project structure

```
app/                  routes (home, services/[slug], check, news, news/[slug], tracker, about, contact, privacy)
  news/rss.xml/       RSS 2.0 feed (published posts only)
  sitemap.ts robots.ts opengraph-image.tsx icon.svg
components/
  Logo.tsx            <Logo animated /> (stroke-draw, honours prefers-reduced-motion)
  check/              Check tool: form, results, gauge, chart, lead gate, PDF report
  news/ tracker/ site/ forms/ ui/
content/news/         MDX posts
data/
  assumptions.ts      ALL benchmarks, emission factors, tariffs (value, unit, source, sourceUrl, verified, lastChecked)
  regulations.json    tracker milestones (drives the home countdown)
  news-sources.json   RSS feeds + keywords for the drafting script
  services.ts measures.ts climate.ts sample.ts
lib/
  types.ts            domain types (Stage 2/3 ready)
  check/              calculation engine, CSV parser, exposure rules
  news.ts regulations.ts forms.ts newsletter.ts seo.tsx site.ts format.ts og.tsx
scripts/              fetch-news.ts, list-unverified.ts
public/templates/     CSV template + sample CSV (illustrative)
tests/                unit tests + RSS fixture
```

Colours are CSS variables in `app/globals.css` (`:root` for light, `.dark` for dark), mapped to Tailwind names (`bg-bg`, `text-fg`, `text-muted`, `bg-accent` and so on). Change the palette there only. The good/typical/poor status colours were checked for colour-vision separation and contrast, and are always shown with a text label.

## How to add a news post

1. Create `content/news/YYYY-MM-DD-short-slug.mdx`:

   ```mdx
   ---
   title: "BEE notifies ..."
   date: 2026-10-05
   summary: >-
     3–5 lines in our own words.
   whatItMeans: >-
     1–2 lines for the most affected sector.
   tags: ["CCTS", "Carbon Markets"]        # CCTS, CBAM, BRSR, ECBC, Energy Prices, Carbon Markets, Efficiency
   sectors: ["Manufacturing"]              # Hotels, Commercial, Manufacturing, Exporters
   sourceName: "Bureau of Energy Efficiency"
   sourceUrl: "https://..."
   status: draft                           # draft | published
   type: news                              # news | roundup
   ---

   Optional short commentary. Never paste the original article.
   ```

2. `npm run dev` and check it at `/news`. Drafts are visible in dev only.
3. Set `status: published` and merge. It then appears on the list, RSS, sitemap and home page.

The build validates frontmatter: an unknown tag or sector, or a bad date, fails with the file name. **Delete the three `[PLACEHOLDER]` example posts before launch.**

## News automation

`scripts/fetch-news.ts`:

1. Fetches every enabled feed in `data/news-sources.json`. Each feed has a 20-second hard timeout, and a feed that is down is logged and skipped.
2. Keeps items from the last 7 days whose headline or snippet matches a keyword. Short acronyms such as `BEE` only match as whole words.
3. Removes duplicates by normalised source URL (tracking parameters and `www.` are stripped), both within the run and against posts already in `content/news`.
4. Sends **only headlines and feed snippets** to Claude. Claude returns JSON matching a schema: summary, whatItMeans, tags and sectors from the fixed lists, and an `include` flag that drops off-topic matches. It also writes one weekly roundup.
5. Writes every file with `status: draft` and validates it.

`.github/workflows/weekly-news.yml` (at the repo root) runs every **Monday at 06:00 IST** and can also be run by hand from the Actions tab. It builds the site with the new drafts and opens a PR titled **"News drafts – week of {date}"** with a review checklist. Nothing is published until you edit and merge.

Setup: add the `ANTHROPIC_API_KEY` secret, optionally set the `ANTHROPIC_MODEL` variable, and enable *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*.

To add a source, append `{ "name", "url", "enabled": true, "verified": false }` to `sources`. Test it locally with `npm run news:fetch -- --dry-run --no-ai`. To test offline, use `--fixture tests/fixtures/sample-feed.xml`; its item dates were fixed when the file was made, so edit the `pubDate`s to fall within the last 7 days.

## How to update the Regulation Tracker

Edit `data/regulations.json`. Each entry has these fields:

| Field | Notes |
|---|---|
| `id` | Stable slug; also the `#anchor` on `/tracker` |
| `regime` | `CCTS` · `CBAM` · `BRSR` · `ECBC` |
| `milestone`, `appliesTo`, `notes` | Plain language |
| `date` | `YYYY-MM-DD`. For `tbc` it is used only for ordering and is never displayed |
| `dateStatus` | `confirmed` (from an official notification) · `expected` · `tbc` |
| `officialSourceUrl` | The notification itself (eGazette, SEBI circular, EU regulation), not a news article |
| `lastVerified` | Date you last checked it, or `null` |

The **home page countdown** shows the next upcoming milestone with `regime: "CCTS"` and `dateStatus: "confirmed"`. While none exists it says dates are being confirmed. Past milestones grey out automatically (the page revalidates daily). The build rejects entries with a bad regime, status or date.

## How to verify assumptions

Every numeric input to the Check is in `data/assumptions.ts`. For each value:

1. Open `sourceUrl` and find the current edition of the publication named in `source`.
2. Replace `value` (and `unit` if needed) with the published figure. Update `source` to cite the exact edition or table, for example "CEA CO₂ Baseline Database v20, weighted average FY2023-24".
3. Set `verified: true` and `lastChecked: "YYYY-MM-DD"`.
4. Run `npm test`. The sample-hotel test asserts a plausible EPI range, so adjust it if your benchmarks move the result.

The `/check` page has a *Methodology & assumptions* table showing every value, its source and a *Verified*, *Estimate*, *Default* or *Provisional* badge. The PDF report includes the same table.

## Deploying to Vercel

1. Import the GitHub repo in Vercel and set **Root Directory = `wattonearth`**. The framework is detected as Next.js, with the default build command.
2. Add `NEXT_PUBLIC_FORMSPREE_ID` and `NEXT_PUBLIC_SITE_URL` for Production (and Preview if you want forms to work there). Optionally add `SHOW_DRAFTS=true` for **Preview only**.
3. Enable **Web Analytics** in the Vercel project. `<Analytics />` is already in the layout; locally its script returns 404, which is expected.
4. Add the domain `wattonearth.in`, plus `www` redirecting to the apex.
5. In Formspree, add `wattonearth.in` to the form's allowed domains and turn on email notifications.
6. On preview deployments `robots.txt` disallows all crawling, so only production is indexed.

CI (`.github/workflows/wattonearth-ci.yml`) runs lint, typecheck, tests and build on every PR that touches `wattonearth/`.

## Quality checks run for this build

- `npm run build`, `lint`, `typecheck` and `test` all pass.
- End-to-end in Chromium: uploading the sample CSV through all four steps produces results. The lead gate posts every field to Formspree (mocked in the test) and a 6-page PDF downloads with ₹ glyphs, sample label, data table and assumptions, followed by the audit CTA.
- In production, drafts are hidden: the list is empty, draft URLs return 404, and RSS and the sitemap exclude them. In dev, tag, sector, search and combined filters return the expected counts.
- Lighthouse (mobile, production build): accessibility 100, SEO 100 and performance 93–97 on `/`, `/check`, `/news`, `/tracker`, a service page and `/contact`. Layout shift is 0.
- No horizontal overflow at 390 px in light or dark. Keyboard order is logical and there is a skip link.

---

## Placeholders to replace before launch

### 1. Assumptions (`data/assumptions.ts`)

Verified on 2026-11-18 against the primary documents:

| Key | Value | Source |
|---|---|---|
| `emissionFactors.gridElectricity` | 0.675 tCO₂/MWh | CEA CO₂ Baseline Database v22.0 (Aug 2026), FY 2025-26, Table S |
| `emissionFactors.diesel` | 2.65 kgCO₂e/L | IPCC 2006 Vol. 2 Table 2.4 × NCV 43.0 TJ/Gg × PPAC density (1 t = 1.21 kL) |
| `emissionFactors.lpg` | 2.99 kgCO₂e/kg | IPCC 2006 Vol. 2 Table 2.4 × NCV 47.3 TJ/Gg |
| `emissionFactors.png` | 2.12 kgCO₂e/SCM | IPCC 2006 Vol. 2 Table 2.4 × PPAC/GAIL 10,000 kcal/SCM GCV, NCV = 90% |
| `buildingBenchmarks.office.*` | per-zone BEE bands | BEE Star Rating for Office Buildings (2009), >50% AC |
| `buildingBenchmarks.retail.*` | per-zone BEE bands | BEE Star Rating for Shopping Malls (2011) |
| `buildingBenchmarks.hotel.*`, `.hospital.*`, `office.temperate` | Watt on Earth estimate, ±20% of the BEE/UNDP-GEF average | BEE/UNDP-GEF benchmark flyer; labelled "Estimate" in the UI and the PDF |

Design decisions that came with verification:
- Good = BEE 4-star or better; poor = below 2-star. This reading is ours, not BEE's.
- The building EPI excludes on-site solar, as BEE does. Solar still reduces grid kWh and Scope 2.
- There are no bands for the Cold zone (BEE publishes none) or for plants (`plantBenchmarks` are all `null` until verified SEC benchmarks are added). Those results show the metric without a rating.
- `tariffs.*` and `conversions.dgSpecificOutput` are **defaults** (`basis: "default"`). Users replace them with their bill amounts and the DG log-book kWh/litre, so they are not counted as unverified.

Still provisional (Watt on Earth engineering judgement): `savingsMethod.gapCaptureLow` (0.5) and `residualLow` / `residualHigh` (0.03 / 0.08). Review them against completed audit outcomes.

To refresh the grid factor each year, download the latest user guide from the CEA site (the v22.0 PDF is at `https://cea.nic.in/api/cdm-report-version/view-pdf/en/82`), then update `value`, `source`, `sourceUrl` and `lastChecked`.

### 2. Regulation Tracker (`data/regulations.json`), 9 entries, all `dateStatus: "tbc"`

All dates are ordering placeholders, and `officialSourceUrl` values are landing pages (BEE, the European Commission CBAM page, SEBI). Replace them with the actual notifications from BEE/eGazette, SEBI circulars and EU regulations:

`ccts-targets-notified`, `ccts-first-compliance-year`, `ccts-trading-launch`, `ccts-first-mrv-report`, `cbam-definitive-period`, `cbam-first-annual-declaration`, `brsr-core-value-chain`, `brsr-core-assurance`, `ecbc-ecsbc-adoption`.

The home countdown stays in its "being confirmed" state until at least one CCTS entry is `confirmed`.

### 3. News

- `data/news-sources.json`: all 5 feed URLs are `verified: false` (ETEnergyWorld, Mongabay-India, Carbon Brief, Down To Earth, ICAP). They could not be reached from the build sandbox. Run the Action once by hand and check its log for feeds that fail, or run `npm run news:fetch -- --dry-run --no-ai` locally.
- `content/news/`: the three `[PLACEHOLDER]` draft posts. Delete them.
- The Claude drafting call has been type-checked against the SDK, but it has not yet been run against the live API (no key was available). Your first manual run of the Action is that test.

### 4. Site content and settings

| Where | What |
|---|---|
| `lib/site.ts` → `email` | `hello@wattonearth.in` is a placeholder inbox |
| `data/services.ts` → `priceLabel` (all 5 services) | `null`, so pages show "Fixed fee, confirmed in writing before we start" or similar. Set real prices, for example "From ₹1.5 lakh", when ready |
| `app/about/page.tsx` | Founder bio uses only the facts in the brief. Add surname, photo, credentials or LinkedIn if you want them |
| `app/privacy/page.tsx` | Plain-language notice. Have it reviewed against the DPDP Act 2023 before launch |
| `lib/check/exposure.ts` | Screening wording for CCTS/CBAM/BRSR/ECBC relevance. Review it against the notified sector lists and thresholds |
| `data/climate.ts` | State→ECBC climate-zone defaults and city overrides are approximate. Users can override them in the tool |
| `data/measures.ts` | Typical measures per facility type. Engineering review recommended |
| `public/templates/sample-mumbai-hotel.csv`, `data/sample.ts` | The fictional 180-key Mumbai hotel, labelled "Sample report — illustrative only" everywhere it appears |
| `NEXT_PUBLIC_FORMSPREE_ID` | Not set. Forms fail safely in production until it is |

## Designed for Stage 2 and 3

- `lib/types.ts` holds the domain shapes (`CheckInput`, `CheckResult`, `Lead`, `NewsPost`, `RegulationMilestone`, `Service`, `Assumption`), which map directly to tables.
- `lib/forms.ts#submitLead` and `lib/newsletter.ts#subscribe` are the only places that know about Formspree. Swap them for a Supabase insert, an API route, Buttondown or Resend without touching components.
- The Check engine (`lib/check/*`) is pure and has unit tests, so it can run server-side for saved client reports.
- Client portal and ops dashboard routes can live under `app/(portal)` and `app/(ops)` route groups with their own layouts.
