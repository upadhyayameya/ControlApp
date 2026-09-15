#!/usr/bin/env python3
"""Render the dashboard to a static site.

The live app is a server; this walks its routes with Flask's test client and
rewrites the links so the result browses offline. A snapshot, not the tool:
"Refresh from monday" is dropped because there is no server behind it.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hbs_scoreboard.web import create_app   # noqa: E402


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def rewrite(html: str) -> str:
    html = re.sub(r'href="/drill/([a-z_]+)/(\d+)\?week=(\d+)"',
                  r'href="drill-\1-\2-w\3.html"', html)
    html = re.sub(r'href="/drill/([a-z_]+)/(\d+)"', r'href="drill-\1-\2.html"', html)
    html = re.sub(r'href="/program/([a-z_]+)"', r'href="program-\1.html"', html)
    html = html.replace('href="/audit"', 'href="audit.html"')
    html = html.replace('href="/api/scoreboard.json"', 'href="scoreboard.json"')
    html = html.replace('<a href="/?refresh=1">Refresh from monday</a>', '')
    html = html.replace('href="/"', 'href="index.html"')
    return html


def main(outdir: str) -> int:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    app = create_app(db_path="data/demo.sqlite", offline=True)
    client = app.test_client()
    written = []

    def grab(route: str, name: str) -> None:
        r = client.get(route)
        if r.status_code != 200:
            print(f"  !! {route} -> {r.status_code}")
            return
        (out / name).write_text(rewrite(r.get_data(as_text=True)))
        written.append(name)

    grab("/", "index.html")
    grab("/audit", "audit.html")
    grab("/api/scoreboard.json", "scoreboard.json")

    import json
    data = json.loads(client.get("/api/scoreboard.json").get_data(as_text=True))
    for prog in data["programs"]:
        key = prog["key"]
        grab(f"/program/{key}", f"program-{key}.html")
        for row in prog["rows"]:
            if row["source"] != "monday":
                continue
            grab(f"/drill/{key}/{row['row']}", f"drill-{key}-{row['row']}.html")
            for cell in row["weekly"]:
                if cell["entries"]:
                    grab(f"/drill/{key}/{row['row']}?week={cell['week']}",
                         f"drill-{key}-{row['row']}-w{cell['week']}.html")

    # The dashboard links every week cell, but a page is only generated for
    # weeks that hold records. Point the rest at the month-to-date page rather
    # than leaving a dead link -- a static export must not lose navigation.
    existing = {f.name for f in out.glob("*.html")}
    missing_re = re.compile(r'href="(drill-([a-z_]+)-(\d+))-w\d+\.html"')
    repointed = 0
    for f in out.glob("*.html"):
        html = f.read_text()

        def fix(m):
            nonlocal repointed
            if m.group(0)[6:-1] in existing:
                return m.group(0)
            repointed += 1
            return f'href="{m.group(1)}.html"'

        new_html = missing_re.sub(fix, html)
        if new_html != html:
            f.write_text(new_html)

    dead = set()
    for f in out.glob("*.html"):
        for href in re.findall(r'href="([a-z][^"]*\.html)"', f.read_text()):
            if href not in existing:
                dead.add(href)

    total = sum((out / f).stat().st_size for f in written)
    print(f"wrote {len(written)} files, {total/1024:.0f} KB -> {out}")
    print(f"repointed {repointed} empty-week link(s) to month-to-date")
    print(f"dead links: {len(dead)}" + (f" -> {sorted(dead)[:3]}" if dead else ""))
    return 1 if dead else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else "build/static"))
