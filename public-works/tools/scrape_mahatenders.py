#!/usr/bin/env python3
"""Pull live tenders for Mumbai bodies from Mahatenders (mahatenders.gov.in, NIC eProcurement)
and write data/tenders.js for the dashboard.

    python3 tools/scrape_mahatenders.py            # updates data/tenders.js in place

Standard library only. Each run keeps tenders seen in earlier runs: a tender that no longer
appears in the live list is kept with status "Closed" and its lastSeen date, so the file builds
up a history over time. Run it daily (cron / GitHub Actions) to keep the feed current.

What Mahatenders publishes per tender: published/closing/opening dates, title, reference
number, tender ID and the organisation chain (e.g. "Municipal Corporation of Greater Mumbai||
L Ward||Maintenance Department"). Award amounts and winning bidders sit behind a captcha and
are not collected.
"""
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

BASE = "https://mahatenders.gov.in"
ORG_LIST = BASE + "/nicgep/app?page=FrontEndTendersByOrganisation&service=page"
SEARCH_URL = BASE + "/nicgep/app?page=FrontEndAdvancedSearch&service=page"

# Organisation names exactly as Mahatenders lists them -> short label used on the dashboard.
ORGS = {
    "Municipal Corporation of Greater Mumbai": "BMC",
    "Brihanmumbai Electric Supply and Transport Undertaking": "BEST",
    "Mumbai Metropolitan Region Development Authority": "MMRDA",
    "Public Works Special Projects Mumbai": "PWD (Special Projects, Mumbai)",
}

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "tenders.js")
PREFIX = "window.PUBLIC_WORKS_TENDERS = "

WARD_ALIASES = {
    "F NORTH": "F/N", "F SOUTH": "F/S", "G NORTH": "G/N", "G SOUTH": "G/S", "H EAST": "H/E", "H WEST": "H/W",
    "K EAST": "K/E", "K WEST": "K/W", "K NORTH": "K/N", "K SOUTH": "K/S", "P NORTH": "P/N", "P SOUTH": "P/S", "P EAST": "P/E",
    "R NORTH": "R/N", "R SOUTH": "R/S", "R CENTRAL": "R/C", "M EAST": "M/E", "M WEST": "M/W",
}


def opener():
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = [("User-Agent", "Mozilla/5.0 (public-works-dashboard)")]
    return op


def get(op, url, tries=4):
    for i in range(tries):
        try:
            with op.open(url, timeout=60) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:  # network hiccups are common on this host
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def text(cell):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cell))).strip()


def rows(page):
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)
        yield cells, [html.unescape(h) for h in re.findall(r'href="([^"]+)"', r)]


WARD_RE = re.compile(r"(?<![A-Za-z])([A-T])(?:\s*[/-]\s*|\s+)?(North|South|East|West|Central|N|S|E|W|C)?\s*[-]?\s*Ward\b", re.I)


def norm_ward(*texts):
    """Find a BMC ward in the organisation chain, then the title.
    'Municipal Corporation of Greater Mumbai||L Ward||Maintenance' -> 'L'; '(H/East Ward)' -> 'H/E'."""
    for t in texts:
        for m in WARD_RE.finditer(t or ""):
            letter, side = m.group(1).upper(), (m.group(2) or "").upper()
            if side:
                side = {"N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST", "C": "CENTRAL"}.get(side, side)
                w = WARD_ALIASES.get(letter + " " + side)
                if w:
                    return w
            elif letter in "ABCDELNST":
                return letter
    return None


def parse_date(s):
    try:
        return datetime.strptime(s.strip(), "%d-%b-%Y %I:%M %p").strftime("%Y-%m-%dT%H:%M")
    except ValueError:
        return None


def scrape():
    op = opener()
    org_page = get(op, ORG_LIST)
    links = {}
    for cells, hrefs in rows(org_page):
        t = [text(c) for c in cells]
        if len(t) >= 3 and t[0].isdigit() and t[1] in ORGS and hrefs:
            links[t[1]] = BASE + hrefs[0]
    missing = set(ORGS) - set(links)
    if missing:
        print("warning: not listed today:", ", ".join(sorted(missing)), file=sys.stderr)

    items = []
    for org, url in links.items():
        page = get(op, url)
        n = 0
        for cells, hrefs in rows(page):
            t = [text(c) for c in cells]
            if len(t) < 7 or not t[0].rstrip(".").isdigit():
                continue
            title_cell = t[5]
            parts = re.findall(r"\[([^\]]*)\]", title_cell)
            tender_id = next((p for p in parts if re.match(r"^\d{4}_[A-Z0-9]+_\d+_\d+$", p)), None)
            if not tender_id:
                continue
            ref = parts[-2] if len(parts) >= 3 else None
            title = parts[0] if parts else title_cell
            chain = t[6]
            segs = [s.strip() for s in chain.split("||")]
            items.append({
                "id": tender_id,
                "title": title,
                "ref": ref,
                "org": ORGS[org],
                "ward": norm_ward(chain, title),
                "dept": segs[-1] if len(segs) > 1 else None,
                "unit": " / ".join(segs[1:]) if len(segs) > 1 else None,
                "published": parse_date(t[1]),
                "closing": parse_date(t[2]),
                "opening": parse_date(t[3]),
            })
            n += 1
        print(f"{ORGS[org]}: {n} live tenders", file=sys.stderr)
        time.sleep(2)
    return items


def load_previous():
    if not os.path.exists(OUT):
        return {}
    s = open(OUT, encoding="utf-8").read()
    try:
        data = json.loads(s[s.index(PREFIX) + len(PREFIX):].rstrip().rstrip(";"))
        return {t["id"]: t for t in data.get("items", [])}
    except (ValueError, KeyError):
        return {}


def main():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    live = scrape()
    if not live:
        sys.exit("no tenders scraped; leaving data/tenders.js unchanged")
    prev = load_previous()
    merged = {}
    for t in prev.values():
        t = dict(t)
        t["status"] = "Closed"
        merged[t["id"]] = t
    for t in live:
        old = merged.get(t["id"], {})
        t["firstSeen"] = old.get("firstSeen", today)
        t["lastSeen"] = today
        t["status"] = "Open"
        merged[t["id"]] = t
    items = sorted(merged.values(), key=lambda t: (t["status"] != "Open", t.get("published") or ""), reverse=False)
    items.sort(key=lambda t: t.get("published") or "", reverse=True)
    items.sort(key=lambda t: t["status"] != "Open")
    payload = {
        "source": "Mahatenders (mahatenders.gov.in), Government of Maharashtra eProcurement",
        "sourceUrl": ORG_LIST,
        "searchUrl": SEARCH_URL,
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "items": items,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/scrape_mahatenders.py. Do not edit by hand.\n")
        f.write(PREFIX + json.dumps(payload, ensure_ascii=False, indent=0) + ";\n")
    print(f"{sum(t['status'] == 'Open' for t in items)} open, {len(items)} total -> {os.path.relpath(OUT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
