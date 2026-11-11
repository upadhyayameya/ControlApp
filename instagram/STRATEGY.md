# Instagram strategy: Submarine Pens USA (@submarinepensusa)

This is a working playbook, not a one-time document. The tools in this folder enforce and measure it:

| Strategy piece | Where it lives | How it is enforced or measured |
|---|---|---|
| Content pillars and target mix | `config.json` → `pillars` | Every queued post must name a pillar; `plan.mjs` and `REPORT.md` compare the planned mix to the targets |
| Posting cadence | `config.json` → `postDays` | Backlog posts go out only on these days; empty post days are flagged ⚠️ in the calendar |
| Results | `REPORT.md`, updated daily | Traction per post and per pillar, follower trend |
| Customer care | "Unanswered Instagram DMs" GitHub issue | Opened automatically when a DM is waiting, closed when all are answered |
| Sales | `shop/` + bio link | Checkout links carry `utm_source=instagram`, so Stripe shows which sales came from Instagram |

Fill in the **[brackets]** with what you know about the business, then revisit this page monthly.

---

## 1. Goals (first 90 days)

Start with goals you can measure from `REPORT.md` and Stripe:

1. **Build an audience:** reach [300] followers by [date]. Track: the follower 7- and 30-day change in `REPORT.md`.
2. **Get engagement:** median engagement rate of at least [4%] (interactions ÷ reach). Track: the median line in `REPORT.md`.
3. **Make sales:** [10] orders a month with `utm_source=instagram` in Stripe. Track: Stripe → Payments, filtered by UTM.
4. **Answer customers:** every DM answered within 24 hours. Track: the DM issue should stay closed.

## 2. Audience

Write down who you are selling to; each pillar should serve one of these groups. Some starting guesses to confirm or replace:

- **Everyday writers:** students, office workers, people who keep planners. They want a pen that writes smoothly and doesn't skip.
- **Stationery enthusiasts:** they care about ink, tip size, feel and looks, and they save and share posts.
- **Gift buyers:** they want something that looks good in a box and arrives on time.
- **Local (Arlington / DC area):** they may want pickup, local events, or office orders.

## 3. Content pillars

Defined in `config.json`. Put the pillar in each queue filename: `2026-11-16_writing_journal-spread.jpg`.

| Pillar (filename key) | Target | What it is | Formats that tend to work |
|---|---|---|---|
| Product spotlight (`spotlight`) | 30% | One pen, shot well: close-ups, colours, clicking or capping | Carousel (details), short Reel |
| Writing in action (`writing`) | 25% | The pen in use: handwriting, journaling, ink swatches, desk setups | Reel (writing sounds and visuals do well), carousel |
| Community & reviews (`community`) | 20% | Customer photos (ask permission), reviews, questions, giveaways | Single photo, carousel |
| Behind the brand (`brand`) | 15% | Packing orders, new stock, the people behind it | Reel, photo |
| Offers & launches (`offer`) | 10% | New arrivals, bundles, deals; always "link in bio" | Photo, carousel |

Why this mix: posts that only sell wear an audience out. Around 90% of posts should give people a reason to follow, and around 10% should ask for the sale.

## 4. Cadence

- Start at **3 posts a week** (Mon/Wed/Fri at 11:07 ET, set in `config.json` and the workflow). Consistency matters more than volume.
- When you have a two-week backlog and engagement is steady, move to 4–5 a week by adding days to `postDays`.
- Stories are not automated here. Use them by hand for polls, re-sharing each new post, and "new in shop" links.

## 5. Plan ahead: the monthly routine (about 2 hours)

1. Run `node instagram/plan.mjs --weeks 6` (or read the calendar at the bottom of `REPORT.md`) to see empty days and the pillar mix.
2. Shoot a batch: aim for 12–15 photos or clips in one session, covering every pillar.
3. Write captions with the hook first. The first line is all most people see.
4. Add the files to `queue/`:
   - dated files (`2026-12-01_offer_holiday-set.jpg`) for anything tied to a day: launches, holidays, sales
   - undated files (`writing_ink-swatches.jpg`) for evergreen posts; these fill the next empty post day in filename order
5. Push. The validation check flags any problems within a minute.

Dates worth planning around: back to school (Aug–Sep), National Handwriting Day (Jan 23), Valentine's Day, Mother's Day and Father's Day, graduation (May–Jun), Black Friday and Cyber Monday, holiday gifting (Nov–Dec).

## 6. Weekly loop (15 minutes, Monday)

Open `instagram/REPORT.md` and work through it:

1. **🔥 posts:** what do they have in common (pillar, format, first line, time)? Queue 1–2 more like them.
2. **🧊 posts:** don't repeat that angle for now.
3. **Pillar table:** if one pillar has clearly higher engagement or saves over 4 or more weeks, raise its `share` in `config.json` by 5–10 points and lower the weakest one. Keep `offer` at 15% or below.
4. **Followers:** if the 7-day change is flat for three weeks, try something new, such as a collab, a giveaway, or a Reels-only week.
5. **DMs:** make sure the issue is closed.

## 7. Captions and hashtags

- Structure: **hook** (one line) → **value** (1–3 lines) → **call to action** ("Which colour would you pick?", "Shop via link in bio").
- The default hashtags in `config.json` are appended automatically. Add 3–5 specific tags per post in the caption, such as `#bulletjournal` or `#gelpen`. Specific tags reach the right people better than 30 generic ones.
- Keep the brand line *Power to express* as a recurring sign-off for some posts.

## 8. Engagement (does not automate well, but matters)

- Reply to every comment within the first hour after posting. The poster runs at a fixed time, so you'll know when.
- Spend 10 minutes a day commenting on posts from accounts your audience follows: stationery, journaling and study accounts.
- Repost customer content only with permission, and credit them.

## 9. Selling from Instagram

- **Bio link:** point it to the shop page (`shop/`) with `?utm_source=instagram&utm_medium=bio`.
- **Instagram Shopping** (product tags on posts): once you have a Meta Commerce account, upload `shop/dist/meta-catalog.csv` as your catalog. Meta reviews the account; when approved you can tag products in posts and get a Shop tab on the profile.
- **DM orders:** reply with the product's direct link (`your-shop-url/#product-id`), which jumps straight to that product.
