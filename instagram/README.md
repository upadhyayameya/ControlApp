# Instagram automation: @submarinepensusa

> **Paused:** posting is manual for now. The daily schedules are commented out in `.github/workflows/instagram.yml`; uncomment the `schedule:` block to resume. Queued posts in `queue/` stay put. Use them as ready-made images and captions to upload by hand.

Everything runs on GitHub Actions (`.github/workflows/instagram.yml`) through Instagram's official API. There's no server to run and nothing to install.

| You want to… | Use | Where you see it |
|---|---|---|
| Plan posts ahead and have them go out automatically | `queue/` + daily **post** job | Calendar at the bottom of `REPORT.md`, or `node instagram/plan.mjs` |
| See traction on each post | daily **report** job | `REPORT.md`: reach, views, likes, comments, saves, shares, engagement rate, and results by pillar |
| Know whether every DM has been answered | daily **report** job | GitHub issue **"Unanswered Instagram DMs"**: opened when someone is waiting (you get a notification), closed when all are answered |
| Sell from Instagram | `../shop/` | Shop page for your bio link + Meta catalog feed for product tags (see `../shop/README.md`) |
| Set and run a strategy | `STRATEGY.md` + `config.json` | Pillars and post days are enforced by the queue; the report scores each pillar |

```
instagram/
  STRATEGY.md     ← goals, pillars, cadence, weekly and monthly routines
  REPORT.md       ← updated every morning (traction, followers, calendar)
  queue/          ← posts waiting to go out (naming rules in queue/README.md)
  posted/         ← published items + log.jsonl
  insights/       ← latest.json (per-post metrics), history.jsonl (daily follower count)
  drafts/         ← caption ideas per pillar
  config.json     ← hashtags, pillars + target mix, post days
  post.mjs  plan.mjs  report.mjs  refresh-token.mjs  lib.mjs
```

## Schedule (UTC; change it in the workflow)
| Job | When | What it does |
|---|---|---|
| report | daily 12:17 (7:17 am ET) | Updates `REPORT.md`, the follower history, and the DM issue |
| post | daily 16:07 (11:07 am ET) | Posts dated items on their day; backlog items only on `postDays` (Mon/Wed/Fri) |
| refresh-token | 1st & 15th | Renews the 60-day token (needs `GH_PAT`) |
| validate | every push | Checks the queue, shows the calendar, builds the shop (download it from the run's *shop-site* artifact) |

You can run any job by hand: **Actions → Instagram → Run workflow**, then choose *report*, *post*, or *post (dry run)*.

## One-time setup

### 1. Instagram account
It's already a business-style profile. Make sure it's set to **Professional** (Business or Creator): Settings → Account type and tools.

### 2. Meta app and token
1. At <https://developers.facebook.com/apps>, create an app (type **Business**) and add the **Instagram** product, under *API setup with Instagram login*.
2. Under *Generate access tokens*, add @submarinepensusa and click **Generate token**. Grant these permissions:
   - `instagram_business_basic`
   - `instagram_business_content_publish`: posting
   - `instagram_business_manage_insights`: traction numbers
   - `instagram_business_manage_messages`: DM check (also turn on *Allow access to messages* in the Instagram app: Settings → Messages and story replies → Message controls → Connected tools)
3. Get the account's user ID:
   ```bash
   curl "https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=YOUR_TOKEN"
   ```
   While the Meta app is in development mode it works for accounts with a role on the app, which includes your own.

### 3. GitHub secrets and variables
Repo → Settings → Secrets and variables → Actions:

| Name | Kind | Value |
|---|---|---|
| `IG_USER_ID` | secret | `user_id` from step 2 |
| `IG_ACCESS_TOKEN` | secret | token from step 2 |
| `GH_PAT` | secret, optional | fine-grained PAT with **Secrets: read & write** on this repo, so the token renews itself |
| `MEDIA_BASE_URL` | variable, needed if repo is private | public URL serving this `instagram/` folder (Instagram downloads media from a public URL; the default `raw.githubusercontent.com` link only works for public repos) |

### 4. Turn it on
Merge into the **default branch**. GitHub runs scheduled jobs only from there. Then trigger *report* once by hand to check the connection.

## Day to day
- **Monthly:** batch-shoot, write captions (see `drafts/captions.md`), drop files into `queue/`, push. See STRATEGY.md §5.
- **Weekly (Mon):** read `REPORT.md` and adjust (STRATEGY.md §6).
- **Daily:** answer DMs when the issue notification arrives, and reply to comments on the day's post.

Locally (Node 20+): `node instagram/plan.mjs`, `node instagram/post.mjs --dry-run`; with `IG_USER_ID` and `IG_ACCESS_TOKEN` set, `node instagram/report.mjs`.

## Limits worth knowing
- Photos must be JPEG; Reels MP4/MOV; carousels 2–10 items. Up to 50 API posts per 24h, 2,200-character captions, 30 hashtags.
- Stories, collabs and product tags can't be scheduled through this API. Do those in the app.
- The DM check sees the account's most recent conversations (up to 50). DM previews appear only in the GitHub issue, which is visible to people with access to this repo; they are never committed to files.
- Without `GH_PAT`, renew the token by hand every ~50 days: `IG_ACCESS_TOKEN=... node instagram/refresh-token.mjs`, then paste the output into the secret.
