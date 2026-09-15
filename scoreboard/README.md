# HBS Weekly Scoreboard

Replaces the hand-updated `HBS_Weekly_Scoreboard.xlsx` for the Building Tune-Up
division. Pulls KPI data from monday.com, applies the division's counting rules,
serves a dashboard, and writes the same numbers back into the existing workbook
so the Monday leadership meeting keeps running off the file it already uses.

The business rules are the point of this tool, not the plumbing. The raw board
data is dirty in specific, known ways; every correction below is applied
consistently and logged so any number traces back to the monday items behind it.

---

## Quick start

```bash
pip install -r requirements.txt
cp .env.example .env          # add MONDAY_API_KEY

python -m hbs_scoreboard.cli pull                    # monday -> local cache
python -m hbs_scoreboard.cli report                  # print the scoreboard
python -m hbs_scoreboard.cli serve                   # dashboard on :8000
python -m hbs_scoreboard.cli excel path/to/wb.xlsx   # fill this week's column
python -m hbs_scoreboard.cli upload path/to/wb.xlsx  # push to SharePoint
```

No API key? Load the captured sample (real monday records, partial month) and
explore the pipeline offline:

```bash
python scripts/load_sample.py data/demo.sqlite
python -m hbs_scoreboard.cli --db data/demo.sqlite serve --offline
```

---

## The counting rules

Each rule lives in its own module and has its own acceptance test.

### 1. Unique projects, not log entries — `rules/dedupe.py`

The board logs many closeouts twice: same project, same date, same stage, same
program, same value, two separate items. Deduplicated on
`(completion_date, project_name, stage, program)`.

**Program is part of the key on purpose.** One building can legitimately carry a
BGE building tune-up *and* a separate prescriptive tune-up submitted the same
day — two real submissions. This is not hypothetical: `415 Williams Ct -
Greenleigh at Crossroads` is logged 9/1 as BGE ($4,382) and 9/2 as HVAC BTU
($3,680).

On the September closeout data this collapses **47 log entries to 28 unique
projects** and removes **$92,046** of double-counted dollars. The raw entry
count stays visible beside the corrected one.

### 2. Repeat submissions across periods — `rules/repeats.py`

The same preapproval gets re-logged weeks later with an identical project,
program and value. Any submission matching an earlier one
`(project_name, program, hbs_share)` from a *prior period* is flagged.

Default: counted **once, at first logging**. Configurable via
`rules.count_repeats_as_new` — the business has not settled whether a
resubmission after an ICF/TRC RFI is new work. Either setting applies to goals
and actuals together. The repeat rate is its own metric, target zero.

### 3. Program split — the Utility field is overloaded — `rules/programs.py`

The `text` (Utility) column mixes real utilities with project types.
`HVAC BTU`, `HVAC BPTU` and `HVAC Tune Up` all mean prescriptive HVAC tune-ups
and map to a single **Prescriptive** program.

Prescriptive is a source/type, not a utility. Those records carry **no real
utility at all**, so every prescriptive project is missing from its utility's
totals. The dashboard says so out loud rather than implying the BGE line is all
BGE work.

### 4. BGE Tune-Up vs BGE BPTU — `rules/programs.py`

Utility `BGE` covers two separately reported programs. A record is **BPTU** when
the project name contains `(Phase 1)` or `(Phase 2)`, otherwise **BGE Tune-Up**.
This rule reproduced the team's own hand-kept figures exactly.

Where possible it is cross-checked against membership of board `6530139050`.
Disagreements are **logged, not silently resolved** — the validated name rule
wins and the conflict is surfaced.

### 5. Payments are not a monday number — `metrics.py`

`Payments Received ($)` and every `Revenue ($)` row are accounting figures owned
by the Director of Accounting and entered by hand. This tool **never** computes
or overwrites them. monday's `Closeouts Received` is shown alongside as a
clearly-labelled cross-check; the two will differ.

The Excel writer snapshots every protected cell before writing and **refuses to
save** if any of them changed.

### 6. Week boundaries — `rules/weeks.py`

Two conventions are in play and they disagree:

| Mode | Wk1 | Coverage |
|---|---|---|
| `team` (the workbook's own) | 9/7–9/13 | leaves **9/1–9/6 in no week at all** |
| `calendar` (default) | 9/1–9/7 | whole month, Wk4 = 9/22–9/30 |

Configured weeks that leave any day uncovered raise a **loud error banner**
naming the gap and counting the KPI events stranded in it. Those events are
marked `uncovered_by_weeks`, never silently folded into an adjacent week.

Only the current month counts. Nothing carries over — a project submitted last
month but approved this month counts this month, at the stage that happened this
month.

### 7. Levels vs flows — `metrics.py`

Utilization %, MRR and live contract counts are **levels**. Never summed across
weeks, never a monthly target divided by the week count. The latest reading is
shown. This holds even for hand-entered level rows.

---

## Status colouring

Colour is on **pace-to-date by working days**, not the latest week. This work
batches hard — 40+ prescriptive preapprovals can land in a single day — so a
latest-week rule produces false reds constantly.

```
expected_to_date = monthly_goal × (working days elapsed ÷ working days in month)
GREEN   actual ≥ expected_to_date
YELLOW  actual ≥ 0.85 × expected_to_date
RED     below that
```

`MANUAL`, `NO DATA` and `SET GOAL` are distinct states. **An empty cell is
never a zero.**

---

## Dollars beside every count

A mix shift to prescriptive dropped average preapproval value from $11,666 to
$3,640 in a month, so count alone is actively misleading. Every count row also
shows `$ MTD` and `Avg $`. On the sample data the gap is stark: Prescriptive
averages **$2,228** per preapproval against BGE Tune-Up's **$8,618**.

---

## Layout

```
hbs_scoreboard/
  monday_client.py   GraphQL v2: retry, cursor pagination, MirrorValue fragment
  etl.py             raw items -> ledger entries, every correction logged
  metrics.py         goals, MTD, pace, run rate, levels, cross-checks
  excel_writer.py    openpyxl; formulas, formatting and manual rows preserved
  sharepoint.py      Microsoft Graph upload (device-code or client-credentials)
  store.py           SQLite cache + week-over-week snapshots
  web.py             dashboard, drill-down, audit trail, JSON API
  scheduler.py       nightly pull, Friday 5pm ET publish
  cli.py             entry points
  rules/             dedupe · repeats · programs · weeks
config/scoreboard.yml  programs, KPI rows, goals, owners, Excel cell mapping
```

`config/scoreboard.yml` is the single source of truth for layout. Each row
declares its workbook row number, stage, measure (`count` / `dollars` /
`level`), owner, goal, and whether it is `monday`- or `manual`-sourced. Adding a
KPI is a config change, not a code change.

### monday.com sources

Verified against the live account, not taken on trust.

| Board | ID | Role |
|---|---|---|
| Monthly KPIs | 1069742731 | Authoritative KPI event log (~7,800 items) |
| Master TU Tracker | 1069746645 | Implementation dates, non-BPTU |
| BGE BPTU Tracker | 6530139050 | Implementation dates, BPTU; membership cross-check |
| Prescriptive Tune-Up Tracker | 18409151061 | Prescriptive HVAC |
| Preapproval Workload | 9889346356 | PA queue, response-time dates |
| Closeout Workload | 10030690180 | CO queue, `Estimated $CO` mirror column |

Key columns on Monthly KPIs: `date4` Completion Date (**the event date** — never
`__creation_log__` or `__last_updated__`, which bulk edits make meaningless),
`text` Utility, `text8` Source, `dup__of_incentive` **HBS Share** (not
`numbers_2`, the gross incentive — MDEA-sourced projects run ~50% share, so the
two differ a lot), `person` Engineer.

`Implementations Completed` is **not** on this board: it comes from the
Implementation Date on the project trackers. **The trackers do not share the
Monthly KPIs column layout**, so each has its own spec in
`monday_client.TRACKERS` — reading the KPI ids against a tracker returns blank
utilities and uses the Project ID as the Source:

| Tracker | Implementation Date | Utility | Source | HBS Share |
|---|---|---|---|---|
| Master TU `1069746645` | `date_mm4b5x2` | `text` | `dropdown` | `dup__of_incentive_amount` |
| BGE BPTU `6530139050` | `date_mm0whh86` | `text_mkpea39n` | `dropdown` | `dup__of_incentive_amount` |
| Prescriptive `18409151061` | *(none)* | `text` | `dropdown` | `numbers` |

On every tracker `text8` is **Project ID**, not Source, and `numbers_2` does not
exist. The Prescriptive tracker has no Implementation Date column at all —
prescriptive implementations ride on Master TU, where the utility reads
`HVAC BTU` and resolves through rule 3.

Mirror columns return null through normal item queries and cannot be aggregated
server-side; they are read via the `MirrorValue` fragment and summed in code.

---

## Excel writer

Fills one week column (E–H) for monday-sourced rows only, in the existing
workbook. It will not touch:

- payments, revenue or any `source: manual` row
- any cell holding a formula (Weekly Target, MTD, % to Goal, Latest, Status)
- formatting — styles are preserved on load/save

A `--dry-run` reports exactly what it would write and why it skipped the rest.
Cells with no data are **left as they are**, not zeroed.

The writer also reports formula errors already present in the workbook. The
current file has real ones: `Company Results!E44` and `!G44` carry `#REF!` from
a deleted row, and `F44` references `'Tune-Up Factory'!G10` where the rest of the
row references column F. See *Known workbook issues* below.

---

## Scheduler

`python -m hbs_scoreboard.cli schedule --workbook <path> --item-id <id>` runs a
nightly pull (02:00 ET) and a Friday 17:00 ET pull-and-publish. It refuses to
publish while any `error`-severity warning is open. The same work is fine as
cron:

```cron
0 2 * * *   hbs-scoreboard pull
0 17 * * 5  hbs-scoreboard pull && hbs-scoreboard excel <wb> && hbs-scoreboard upload <wb>
```

---

## Tests

```bash
python -m pytest tests/ -q      # 29 tests
```

`tests/test_acceptance.py` holds the eight acceptance criteria from the brief.
`tests/test_excel_writer.py` runs against a copy of the real workbook and
asserts that every payments and revenue cell, all 300+ formulas, and all cell
formatting survive a write.

---

## Ground rules this tool follows

- **Never invent a number.** An unavailable source leaves the cell empty and
  says why. An empty cell is recoverable; a plausible wrong number is not.
- **Every figure is traceable.** Click any number for the project list behind
  it, with a link to each monday item.
- **Corrections keep the original visible.** Duplicates and repeats are greyed,
  never hidden; raw totals sit beside corrected ones.

---

## Known workbook issues

Found while mapping the current file. This tool does not propagate them, but
they affect the spreadsheet as it stands today:

1. `Company Results!E44` and `!G44` — `#REF!` errors from a deleted row, so the
   Implementations Scheduled rollup is broken for Wk1 and Wk3.
2. `Company Results!F44` references `'Tune-Up Factory'!G10` where every other
   term in the row uses column F — Wk2 double-counts Wk3's prescriptive figure.
3. `Tune-Up Factory!I11` is `=SUM(F11:H11)`, skipping `E11` — Prescriptive
   Implementations Completed drops Wk1's 13 from MTD.
4. Several `Closeouts Submitted (count)` rows carry dollar monthly goals
   (80000, 240000, 300000…) against a count KPI, so `% to Goal` there is
   meaningless. Left as-is in config; set real count goals when the team does.
5. The `Start Here` week setup (Wk1 = 9/7) leaves 9/1–9/6 uncovered — see rule 6.
