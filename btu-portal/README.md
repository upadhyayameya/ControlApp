# HBS BTU Scoreboard Portal

A live replacement for the weekly Building Tune-Up Excel scoreboard. It pulls the monday.com
boards, applies the correction rules the same way every time, and shows where every number came
from. The Excel workbook stays the monthly record. The portal fills its week column on request.

## Run it

```bash
cd btu-portal
pip install -r requirements.txt
export MONDAY_API_KEY=...            # personal monday token
python -m btu discover               # list each board's groups and columns (check config.toml)
python -m btu refresh                # first pull (~20 API calls for the KPI board)
python -m btu serve                  # http://127.0.0.1:8000
```

`serve` also schedules a pull each weekday evening (18:30) and on Monday morning (06:30),
in America/New_York time. Change this in `[schedule]`. The **Refresh now** button pulls on demand.

To look around without a token, load the synthetic demo data set. Every page shows a DEMO
banner and the data lives in its own database:

```bash
python -m btu demo
BTU_DB=data/demo.sqlite BTU_TODAY=2026-11-13 python -m btu serve
```

Tests: `python -m pytest`. The brief's acceptance tests are in `tests/test_acceptance.py`.

## Pages

| Page | What it answers |
|---|---|
| **Scoreboard** | Rows for the 8 programs plus Other and Unmapped. Columns for each configured week, then MTD, goal, % to goal and pace status, for each of the 7 stages. A dollar figure sits beside every count, and every number links to the items behind it. |
| **Pace** | MTD against the share of *working days* elapsed, the gap, the run rate, and what's needed per remaining week and day. |
| **Submissions** | Every item logged at a stage, by week. Duplicates and repeats are greyed out, not hidden. |
| **Aging** | From the ICF tracker: who holds the work (HBS and ICF sides of the RFI loop), RFIs older than 7 days, and the Critical/Watch/OK split. |
| **Data quality** | Duplicates, repeats, Phase-rule disagreements, blank or unknown Utility, unmapped groups, missing dates, past-but-not-done implementations, column resolution, and the KPI board's item count against its 10,000 limit with headroom in months. |
| **History** | The scoreboard as it stood after each refresh, so you can see when a closed week's number moved. |
| **Excel export** | Upload the workbook, preview the changes, download a filled copy. |

## How the rules are applied

Each rule is in `btu/rules.py` or `btu/etl.py`. Each correction is logged per item and shown on the drill-through and item pages.

1. **Stages** come from the KPI board's **group id**, never its title (`[kpi.stage_groups]`). Items in unknown groups show up on Data quality.
2. **Event date** is Completion Date (`date4`) only. Items with no date are listed as errors. Creation and update logs are never used.
3. **Programs.** `HVAC BTU`, `HVAC BPTU` and `HVAC Tune Up` map to Prescriptive. The scoreboard notes that utility rows therefore leave out prescriptive work. A BGE record goes to BPTU if its name contains `(Phase 1)` or `(Phase 2)`, otherwise to BGE Tune-Up. If a Program column id is set in `[kpi.columns]`, that column wins. Every BGE record is checked against the BPTU tracker, and disagreements are listed. Potomac Edison, Met ED and National Grid go to **Other**. Blank or unknown utilities go to **Unmapped**, which is shown, not dropped.
4. **Duplicates** share a key of (date, project name, stage, program). The project name is compared ignoring case and whitespace. The lowest item id is kept. The raw count appears in grey beside the corrected one.
5. **Repeats** are earlier submissions at the same stage with the same project, program and incentive. `rules.count_repeats_as_new` (default `false`) decides whether they count. Goals record the basis they were set on (`goals.repeats_counted_as_new`). If that basis differs from the current setting, the goal is hidden with a reason rather than compared against the wrong count. The repeat rate is its own metric, with a target of zero.
6. **Dollars** default to Incentive. The HBS Share toggle is on every page, and the footer names which one is showing. Closeouts Approved is labelled a monday proxy, never revenue.
7. **Weeks** are configured per month in `[weeks]` and never derived. Any day left uncovered raises a red banner on every page. Events in that gap get their own "Not in any week" column. A month with no week config shows no week columns, and says so.
8. **Pace** counts working days (weekdays minus `[rules] holidays`). The status colour is MTD against goal × elapsed share, never the latest week.
9. **Levels** (Utilization %, MRR, live contracts) are readings in `[[levels]]`. Each shows the reading as of each week and the latest reading. They are never summed or pro-rated.
10. **Implementations Completed** comes from the three trackers' implementation dates. An item counts only if the date has passed **and** the status is Tune Up Complete, Complete-Need PA or CO Submitted, or the item sits in a configured closeout group. Past-dated "Scheduled" items are listed on Data quality.

**Never invent a number.** When a board hasn't been pulled or a column doesn't resolve, the cell is
empty and says why. Missing dollar values are not filled in: the cell shows "n without $".
When a refresh fails, the last good pull is kept and a banner gives its age.

## Storage

`data/btu.sqlite` (or `$BTU_DB`) holds:

- the latest raw JSON for each item
- every distinct version of each item ever pulled, viewable at `/item/<board>/<id>`
- one row per refresh run
- the scoreboard snapshot after each refresh
- the correction log

Every refresh pulls each board in full, so closed weeks are never cached as settled.

## Excel export

The export writes only the cells listed in `[excel.rows]` (`"stage|program|metric" = row`),
in the chosen week's column. Use `python -m btu inspect-excel <file>` to find the row numbers. It will not:

- write any row whose label matches `protected_row_labels` (payments, revenue, …) or that is listed in `protected_rows`
- overwrite a formula
- write a value that isn't available
- overwrite the source file

Caveat: openpyxl does not keep charts, images or pivot caches. If the workbook has any, export into a copy and paste the week column across.

## The claude.ai page

`artifact/btu-scoreboard.html` is the same scoreboard as a page on claude.ai. It reads monday.com
through each viewer's own monday.com connector (read-only queries only) every time it opens, applies
these same rules in the browser, and keeps the last pull in that browser so it opens instantly. It
needs no server. Its configuration (weeks, goals, levels, column ids) is the `CONFIG` block at the
top of the file. On the demo data it produces the same figures as the Python ETL.

## Column ids

Every board, group and column id in `config.toml` was read from the live boards on 2026-11-13.
Notes from that read:

- The trackers keep Incentive in `numbers`. The Prescriptive tracker has no Incentive column; its
  `numbers` column is HBS Share, so Prescriptive implementations show HBS Share only.
- The BPTU and Master TU trackers have no "Tune Up Complete" status. Their own "work done" labels
  are used instead ("Implementation & MV Complete", "Implemented. …", "CO Submitted").
- Implementations also count when an item sits in Closeouts to Submit, Closeouts to Receive or Completed Projects.
- The ICF tracker's RFI statuses are in its `status` column ("Current Status Summary").
- The ICF tracker's empty formula cells come back as the text `"null"`. They are treated as empty.
- Goals, holidays and level readings are not filled in.
- The Sep–Nov week boundaries are stored as 2026.
