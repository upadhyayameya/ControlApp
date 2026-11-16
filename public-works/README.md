# Mumbai Public Works

An open, public dashboard of government infrastructure projects in Mumbai. For
each project it shows:

- **Status and progress**: completed, partially open, in progress, delayed, stalled or not started
- **Cost**: original and revised, with overruns flagged
- **Who's funding it**: Government of India, Government of Maharashtra, BMC,
  JICA / World Bank / ADB / AIIB loans, private developers
- **Area MLAs**: the elected MLAs for every assembly constituency the project runs through
- **Sources**: a link and date for every status claim

It has five views: **Projects** (filterable cards plus CSV download), **Map**,
**MLAs** (all 36 Mumbai constituencies), **Who's funding**, and **About the data**.

## Running it

It's a static site with no build step and no server code.

```bash
cd public-works
python3 -m http.server 8080   # then open http://localhost:8080
```

You can also open `index.html` directly in a browser. To publish it for the
public, upload the `public-works/` folder to any static host (GitHub Pages,
Netlify, Cloudflare Pages). The map loads Leaflet from cdnjs and tiles from
OpenStreetMap. Everything else is local.

## Updating the data

All data is in `data/projects.js`. Edit it and reload the page.

### `meta`
| field | meaning |
|---|---|
| `title`, `subtitle` | header text |
| `lastUpdated` | ISO date shown in the footer |
| `notice` | optional banner at the top (e.g. "verify before citing") |
| `sourceNote` | paragraph on the About page |
| `sources` | `[{name, url, note}]` main references, listed on the About page |

### `mlas[]`: one per assembly constituency
`{ no, constituency, district, name, party, since, source }`. Project records
refer to constituencies by `constituency` name, so spell them identically.

### `officials[]`
`{ role, name, source }`: CM, ministers, guardian ministers, agency heads.

### `projects[]`
| field | meaning |
|---|---|
| `id` | stable unique ID, used in links (`#/project/MUM-001`) |
| `name`, `shortName` | full and short display names |
| `summary` | one or two plain-language sentences |
| `sector` | e.g. Metro rail, Roads & bridges, Housing, Sanitation |
| `agency` | implementing body (BMC, MMRDA, MMRCL, MSRDC, MHADA, NHSRCL, MRVC…) |
| `status` | `Completed` · `Partially open` · `In progress` · `Delayed` · `Stalled` · `Not started` |
| `progress` | % physical progress, or `null` if not reported |
| `cost` | `{ original, revised }` in ₹ crore (`revised` may be `null`) |
| `funders` | `[{ name, type, amount, note }]`; `amount` in ₹ crore or `null` if undisclosed. `type` is one of `Central Govt`, `State Govt`, `Municipal`, `Multilateral`, `Private / PPP` |
| `contractor` | main contractor(s) or developer |
| `startDate`, `targetDate`, `revisedTargetDate`, `completedDate` | `YYYY`, `YYYY-MM` or `YYYY-MM-DD` |
| `delayReason` | short reason, shown when delayed or stalled |
| `areas` | localities, free text |
| `constituencies` | assembly constituency names, matching `mlas[].constituency` |
| `location` | `{ lat, lng }`, one approximate point for the map |
| `sources` | `[{ url, title, date, claim }]`: where each fact came from |
| `lastVerified` | date someone last checked the status |

## Data integrity

Every number should trace to a public document: agency progress reports, the
BMC and state budgets, PIB releases, lender project pages (JICA, World Bank, AIIB),
RTI replies, or reputable news reports. When sources disagree, use the most recent
official figure and note the other in `cost.note` or `summary`. Don't estimate a
number that hasn't been published. Use `null` and the UI shows "not disclosed".

The MLA list reflects the November 2024 Maharashtra Assembly election plus any
later changes we found. Re-check it after any by-election.
