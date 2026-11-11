"""Read the products out of the India catalogue PDF: code, section, packaging line, NEW flag, page, ₹ M.R.P."""
import math
import re
import sys

import pymupdf

# The catalogue's fonts use private ligature glyphs; map them back to letters (and fix its "Bottel" typo).
LIGATURES = {"Ț": "ff", "ț": "ft", "ȝ": "tt", "\uf001": "fi", "ﬁ": "fi", "\uf002": "fl", "ﬂ": "fl", "Bottel": "Bottle"}

# Product names that appear only as page headings, not under the code.
NAMES = {
    "0210330186": "Inkspire Black Fountain Pen Set (black)",
    "0210330786": "Inkspire Black Fountain Pen Set (blue)",
    "0216000100": "Lumen 18 Fountain Pen with 18 cartridges",
    "0210505000": "Calligraphy Fountain Pen set (1.3 / 1.9 / 3.0 mm)",
    "0112010100": "Thinx ultra-slim ball pen (black)",
    "0112010400": "Thinx ultra-slim ball pen (silver)",
    "0112010700": "Thinx ultra-slim ball pen (blue)",
    "0112010600": "Thinx ultra-slim ball pen (red)",
}

def fix(text):
    for k, v in LIGATURES.items():
        text = text.replace(k, v)
    return " ".join(text.split())


def spans_of(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for line in b.get("lines", []):
            for s in line["spans"]:
                if s["text"].strip():
                    s["dir"] = line["dir"]
                    out.append(s)
    return out


def mid_y(s):
    return (s["bbox"][1] + s["bbox"][3]) / 2


def rect_dist(r, x, y):
    dx = max(r[0] - x, 0, x - r[2])
    dy = max(r[1] - y, 0, y - r[3])
    return math.hypot(dx, dy)


def price_spans(spans):
    """Each '₹' symbol with the bold amount that follows it."""
    found = []
    for s in spans:
        if s["text"].strip() != "₹":
            continue
        amt = [x for x in spans if "Bold" in x["font"] and abs(mid_y(x) - mid_y(s)) < 5
               and -1 <= x["bbox"][0] - s["bbox"][2] < 6 and re.match(r"\d", x["text"].strip())]
        if amt:
            found.append((s, amt[0]))
    return found


def extract(doc):
    items = []
    for pn, page in enumerate(doc):
        spans = spans_of(page)
        section = next((fix(s["text"]) for s in spans if s["size"] >= 20 and "Square721" in s["font"]), None)
        folio = next((s["text"].strip() for s in spans if s["font"] == "Cambria"), None)
        news = [s["bbox"] for s in spans if s["text"].strip() == "NEW"]
        codes = []
        for s in spans:
            t = s["text"].strip()
            if not t.startswith("Code:") or "(" in t:
                continue
            rest = t[5:].strip()
            if rest:
                codes.append(dict(code=rest, label=s["bbox"], cb=s["bbox"]))
                continue
            right = [x for x in spans if "Bold" in x["font"] and abs(mid_y(x) - mid_y(s)) < 4
                     and -1 <= x["bbox"][0] - s["bbox"][2] < 8]
            if not right:  # rotated or stacked layouts: nearest bold code number
                right = sorted((x for x in spans if "Bold" in x["font"] and re.fullmatch(r"[\d-]{8,}", x["text"].strip())),
                               key=lambda x: abs(x["bbox"][0] - s["bbox"][0]) + abs(x["bbox"][1] - s["bbox"][1]))[:1]
            if right:
                codes.append(dict(code=right[0]["text"].strip(), label=s["bbox"], cb=right[0]["bbox"]))
        for c in codes:
            x0, y0, _, y1 = c["label"]
            first = [s for s in spans if -1 < s["bbox"][1] - y1 < 5 and abs(s["bbox"][0] - x0) < 3 and "Regula" in s["font"]]
            line = sorted((s for s in spans if first and abs(s["bbox"][1] - first[0]["bbox"][1]) < 1
                           and s["bbox"][0] >= x0 - 3 and "Regula" in s["font"]), key=lambda s: s["bbox"][0])
            run = line[:1]
            for s in line[1:]:  # stop at a gap: the next product's caption on grid pages
                if s["bbox"][0] - run[-1]["bbox"][2] > 3:
                    break
                run.append(s)
            c["desc"] = fix("".join(s["text"] for s in run)).rstrip("₹ ").strip()
            c["new"] = any((abs(n[1] - y0) < 14 and 0 < n[0] - x0 < 160) or rect_dist(c["cb"], n[0], n[3]) < 25 for n in news)
        prices = price_spans(spans)
        # Pair codes and prices. On list pages the price is level with the code, far to the right; on grid
        # pages it is in the same column, usually above the code (a badge on the photo).
        def cost(c, p):
            dx = abs(p[0]["bbox"][0] - c["label"][0])
            dy = p[0]["bbox"][1] - c["label"][1]
            if abs(dy) < 15:
                return dx * 0.3
            return dx + (-dy if dy < 0 else dy * 3)
        pairs = sorted((cost(c, p), ci, pi) for ci, c in enumerate(codes) for pi, p in enumerate(prices))
        match, used = {}, set()
        for _, ci, pi in pairs:
            if ci not in match and pi not in used:
                match[ci] = pi
                used.add(pi)
        if len(codes) != len(prices):
            print(f"! page {pn + 1}: {len(codes)} codes but {len(prices)} prices", file=sys.stderr)
        for ci, c in enumerate(codes):
            amount = prices[match[ci]][1]["text"].strip() if ci in match else None
            inr = int(re.match(r"\d+", amount).group()) if amount else None
            per_piece = bool(amount and "PP" in amount)
            items.append({
                "code": c["code"],
                "name": NAMES.get(c["code"]),
                "section": section,
                "description": c["desc"] or None,
                "new": c["new"],
                "page": int(folio) if folio and folio.isdigit() else None,
                "pdfPage": pn + 1,
                "inrMrp": inr,
                "perPiece": per_piece,
            })
    return items
