# Queue

Drop posts here. The daily run publishes what's due and moves it to `../posted/`.

## Naming: `[date_]pillar_name.ext`

| You add | Becomes |
|---|---|
| `2026-11-16_spotlight_blue-gel.jpg` + `2026-11-16_spotlight_blue-gel.txt` | Photo, posted on Nov 16 |
| `2026-11-18_writing_journal.mp4` + `.txt` with the same name | Reel, posted on Nov 18 |
| `2026-11-20_offer_holiday-set/` (2–10 `.jpg`/`.mp4` + `caption.txt`) | Carousel, posted on Nov 20 |
| `community_review-anna.jpg` + `.txt` (no date) | Backlog: fills the next empty post day |

- **Pillar** (required) is one of `spotlight`, `writing`, `community`, `brand`, `offer` (from `../config.json`). The report uses it to show which kind of post works best.
- **Dated** items post on that date, whatever the weekday. **Undated** items fill empty post days (`postDays` in config, currently Mon/Wed/Fri) in filename order.
- Images must be **JPEG**, aspect ratio 4:5 to 1.91:1 (1080×1350 portrait works best).
- Default hashtags are appended automatically (no duplicates, 30 max).
- Prefix with `_` to keep a draft here without posting it.
- Preview the calendar with `node instagram/plan.mjs`.
- Only post photos you took or have permission to use.
