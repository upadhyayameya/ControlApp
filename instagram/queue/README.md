# Queue

Drop posts here. Each daily run publishes the next due item (by filename order) and moves it to `../posted/`.

| You add | Becomes |
|---|---|
| `2026-11-10-lorient.jpg` + `2026-11-10-lorient.txt` | Single photo |
| `2026-11-12-valentin.mp4` + `2026-11-12-valentin.txt` | Reel |
| `2026-11-14-brest/` with 2–10 `.jpg`/`.mp4` + `caption.txt` | Carousel |

- A name starting with a date (`YYYY-MM-DD`) won't post before that date. Without a date it posts as soon as it's next in line.
- Images must be **JPEG**. Aspect ratio 4:5 to 1.91:1 (1080×1350 portrait works best).
- Hashtags from `../config.json` are appended automatically, skipping duplicates; max 30 total.
- Prefix a name with `_` to keep it in the queue without posting it.
- Only post photos you took or have the rights to use.
