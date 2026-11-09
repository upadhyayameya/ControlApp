# Instagram auto-poster — Submarine Pens

Posts from `queue/` to Instagram on a schedule, using the official Instagram Graph API and GitHub Actions. There's no server and nothing to install.

```
instagram/
  queue/          ← drop posts here (see queue/README.md)
  posted/         ← published items + log.jsonl (permalinks)
  drafts/         ← caption ideas
  config.json     ← hashtags, posts per run, API version
  post.mjs        ← the poster (Node 20, no dependencies)
  refresh-token.mjs
../.github/workflows/instagram.yml
```

## One-time setup

### 1. Instagram account
Switch the account to **Professional** (Creator or Business) in Instagram → Settings → Account type and tools.

### 2. Get an API token
1. At <https://developers.facebook.com/apps> create an app (type **Business**) and add the **Instagram** product, under *API setup with Instagram login*.
2. Under *Generate access tokens*, add your Instagram account and click **Generate token**. Grant `instagram_business_basic` and `instagram_business_content_publish`. This is a long-lived (60-day) token.
3. Get your Instagram user ID:
   ```bash
   curl "https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=YOUR_TOKEN"
   ```
   While the app is in development mode, it can post only to accounts added as app testers/roles. That's fine for your own page.

### 3. Add GitHub secrets
Repo → Settings → Secrets and variables → Actions:

| Name | Kind | Value |
|---|---|---|
| `IG_USER_ID` | secret | `user_id` from step 2 |
| `IG_ACCESS_TOKEN` | secret | token from step 2 |
| `GH_PAT` | secret, optional | fine-grained PAT with **Secrets: read & write** on this repo, so the token refreshes itself on the 1st and 15th |
| `MEDIA_BASE_URL` | variable, needed if repo is private | public URL serving this `instagram/` folder |

**Why `MEDIA_BASE_URL`?** Instagram downloads each image from a public URL. In a **public** repo the default (`raw.githubusercontent.com/<repo>/<branch>/instagram`) just works. In a **private** repo, point it at any public host that mirrors the folder, for example a small public GitHub repo or a storage bucket.

### 4. Default branch
GitHub runs scheduled workflows **only on the default branch**, so merge this there.

## Daily use
1. Add `2026-11-20-keroman.jpg` + `2026-11-20-keroman.txt` to `queue/` and push. A dry-run check validates the queue on every push.
2. Every day at 16:07 UTC the workflow posts the next due item, moves it to `posted/`, and commits a log entry with the permalink.
3. To post right away, or to test: Actions → *Instagram auto-post* → **Run workflow** (tick *Dry run* to only validate).

Locally: `node instagram/post.mjs --dry-run`.

Change the time in `.github/workflows/instagram.yml` (cron is UTC). Change how many posts go out per run with `postsPerRun` in `config.json`.

## Limits worth knowing
- JPEG only for photos; MP4/MOV for Reels; carousels hold 2–10 items.
- Up to 50 API-published posts per 24h, 2,200-char captions, 30 hashtags.
- Without `GH_PAT`, refresh the token by hand every ~50 days: run `IG_ACCESS_TOKEN=... node instagram/refresh-token.mjs` and paste the output into the secret.
