#!/usr/bin/env python3
"""Build the Submarine Pens USA catalogue from the India 2026-27 catalogue.

  pip install pymupdf pillow
  python3 catalogue/build.py

Reads   catalogue/source/submarine-catalogue-2026-27-india.pdf  (the original, ₹ M.R.P.)
        catalogue/us-config.json                                 (exchange rule, rounding, back page)
Writes  catalogue/products-2026-27.json   every product: code, section, packaging, ₹ M.R.P., US MSRP, wholesale
        catalogue/us-price-list.csv       the same as a spreadsheet
        catalogue/us/Submarine-Pens-USA-Catalogue-2026-27.pdf        (~12 MB, for email and web)
        catalogue/us/Submarine-Pens-USA-Catalogue-2026-27-print.pdf  (full-resolution photos, for a printer)
                                          the original layout and photos, with ₹ M.R.P. changed to US MSRP,
                                          US spelling, and a US back page

The US PDF is made by editing the original's text layer, so photos and layout stay pixel-identical.
"""
import io
import json
import math
import re
import sys
from pathlib import Path

import pymupdf
from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source" / "submarine-catalogue-2026-27-india.pdf"
CONFIG = json.loads((ROOT / "us-config.json").read_text())
OUT_PDF = ROOT / "us" / "Submarine-Pens-USA-Catalogue-2026-27.pdf"            # 200 dpi photos, ~12 MB: email and web
OUT_PRINT = ROOT / "us" / "Submarine-Pens-USA-Catalogue-2026-27-print.pdf"  # original photos, ~40 MB: printer (not committed)

# The catalogue's fonts use private ligature glyphs; map them back to letters.
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

# Fonts for replacement text. Inter is close to the catalogue's Franklin Gothic at these sizes;
# Helvetica is the fallback when Inter isn't installed.
FONT_FILES = {
    "bold": ["/usr/share/fonts/opentype/inter/Inter-Bold.otf"],
    "regular": ["/usr/share/fonts/opentype/inter/Inter-Regular.otf"],
}
FALLBACK = {"bold": "hebo", "regular": "helv"}


def fix(text):
    for k, v in LIGATURES.items():
        text = text.replace(k, v)
    return " ".join(text.split())


def usd_price(inr, code=None):
    p = CONFIG["pricing"]
    if code in p.get("overrides", {}):
        return float(p["overrides"][code])
    raw = inr / p["inrPerUsd"]
    step = p["roundBelow10"] if raw < 10 else p["roundFrom10"]
    usd = math.floor(raw / step + 0.5) * step  # round half up
    return max(usd, p["minimumUsd"])


def money(usd):
    return f"${usd:,.0f}" if usd == int(usd) else f"${usd:,.2f}"


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
            usd = usd_price(inr, c["code"]) if inr else None
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
                "usdMsrp": usd,
                "usdWholesale": round(usd * CONFIG["pricing"]["wholesaleFraction"], 2) if usd else None,
            })
    return items


def font_for(page, weight):
    for path in FONT_FILES[weight]:
        if Path(path).exists():
            name = f"us-{weight}"
            page.insert_font(fontname=name, fontfile=path)
            return name, pymupdf.Font(fontfile=path)
    return FALLBACK[weight], pymupdf.Font(FALLBACK[weight])


# Prices printed inside product photos (Indian packaging): (pdf page, rect, replacement text, fill colour).
PHOTO_PATCHES = [
    (50, (360.6, 135.2, 382.4, 143.2), "$10", (0.09, 0.09, 0.09)),  # "MRP ₹390" ribbon on the Navigator diary display box
]


def background(page, rect):
    """Colour just outside the left edge of rect, for painting over text without a visible box."""
    pix = page.get_pixmap(dpi=72, clip=pymupdf.Rect(rect.x0 - 3, rect.y0, rect.x0 - 1, rect.y1))
    px = [pix.pixel(x, y) for x in range(pix.width) for y in range(pix.height)] or [(255, 255, 255)]
    return tuple(sum(c[i] for c in px) / len(px) / 255 for i in range(3))


def redaction_is_clean(source, pn, rects):
    """Some pages rewrite badly when text is removed (glyphs pile up). Try on a scratch copy and check
    that every untouched span stays where it was."""
    scratch = pymupdf.open(source)
    page = scratch[pn]
    keep = lambda spans: sorted((s["text"], round(s["origin"][0]), round(s["origin"][1])) for s in spans
                                if not any(pymupdf.Rect(s["bbox"]).intersects(r) for r in rects))
    before = keep(spans_of(page))
    for r in rects:
        page.add_redact_annot(r, fill=False)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                          text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    return keep(spans_of(page)) == before


def localise(doc):
    """Edit the text layer: ₹ M.R.P. -> US MSRP, UK -> US spelling, US back page."""
    labels = CONFIG["labels"]
    spelling = [("CUSTOMISATION", "CUSTOMIZATION"), ("Customisation", "Customization"),
                ("Personalisation", "Personalization"), ("personalisation", "personalization")]
    changed = 0
    for page in doc:
        spans = spans_of(page)
        edits = []  # (rect to clear, text, origin point, size, colour, weight, align)
        for sym, amt in price_spans(spans):
            inr = int(re.match(r"\d+", amt["text"].strip()).group())
            text = money(usd_price(inr))
            if "PP" in amt["text"]:
                text += f" {labels['perPiece']}"
            right = amt["bbox"][2]
            edits.append((pymupdf.Rect(sym["bbox"]) | pymupdf.Rect(amt["bbox"]), text, right, amt["origin"][1],
                          amt["size"], amt["color"], "bold", "right"))
            changed += 1
        for s in spans:
            t = s["text"].strip()
            if t == "M.R.P.":
                edits.append((pymupdf.Rect(s["bbox"]), labels["priceLabel"], s["bbox"][2], s["origin"][1],
                              s["size"], s["color"], "regular", "right"))
            elif s["font"] == "ArialMT" and t in ("Cover Page", "COVER INSIDE", "BACK PAGE"):
                edits.append((pymupdf.Rect(s["bbox"]), None, 0, 0, 0, 0, None, None))  # printer's marks
            elif any(a in s["text"] for a, _ in spelling) and s["dir"] == (1.0, 0.0):
                new = s["text"]
                for a, b in spelling:
                    new = new.replace(a, b)
                edits.append((pymupdf.Rect(s["bbox"]), fix(new), s["bbox"][0], s["origin"][1], s["size"], s["color"],
                              "bold" if "Bold" in s["font"] else "regular", "left"))
        back = next((s for s in spans if "SUBMARINE PENS LIMITED" in s["text"]), None)
        if back:
            for s in spans:
                if s["bbox"][1] >= back["bbox"][1] - 1 and s["color"] == 0xFFFFFF:
                    edits.append((pymupdf.Rect(s["bbox"]), None, 0, 0, 0, 0, None, None))
            for d in page.get_drawings():  # the phone and email icons beside the old contact line
                r = d["rect"]
                if d.get("fill") == (1.0, 1.0, 1.0) and r.y0 > back["bbox"][3] and r.width < 10 and r.height < 10:
                    page.draw_rect(r + (-1, -1, 1, 1), color=None, fill=background(page, r), overlay=True)
        rects = []
        for rect, *_ in edits:
            r = pymupdf.Rect(rect)
            r.y0 += r.height * 0.2
            r.y1 -= r.height * 0.2
            rects.append(r)
        if rects and redaction_is_clean(SOURCE, page.number, rects):
            for r in rects:
                page.add_redact_annot(r, fill=False)
            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                                  graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                                  text=pymupdf.PDF_REDACT_TEXT_REMOVE)
        elif rects:  # paint over instead, in the surrounding colour
            fills = [background(page, pymupdf.Rect(rect)) for rect, *_ in edits]
            for (rect, *_), fill in zip(edits, fills):
                page.draw_rect(pymupdf.Rect(rect) + (-0.5, -0.5, 0.5, 0.5), color=None, fill=fill, overlay=True)
        for pno, rect, text, fill in PHOTO_PATCHES:
            if page.number == pno - 1:
                r = pymupdf.Rect(rect)
                page.draw_rect(r, color=None, fill=fill, overlay=True)
                if text:
                    edits.append((r, text, (r.x0 + r.x1) / 2, r.y1 - 1.6, 6.5, 0xFFFFFF, "bold", "center"))
        fonts = {}
        for _, text, x, baseline, size, color, weight, align in edits:
            if not text:
                continue
            if weight not in fonts:
                fonts[weight] = font_for(page, weight)
            fname, font = fonts[weight]
            width = font.text_length(text, fontsize=size)
            px = x - width if align == "right" else x - width / 2 if align == "center" else x
            rgb = tuple(((color >> sh) & 255) / 255 for sh in (16, 8, 0))
            page.insert_text((px, baseline), text, fontname=fname, fontsize=size, color=rgb)
        if back:
            bp = CONFIG["backPage"]
            fname, font = font_for(page, "bold")
            rname, rfont = font_for(page, "regular")
            cx = page.rect.width / 2
            y = back["origin"][1]
            for text, f, fn, size, gap in [(bp["company"], font, fname, 12, 15), (bp["line1"], rfont, rname, 8, 11),
                                           (bp["line2"], rfont, rname, 8, 16), (bp["line3"], rfont, rname, 9, 14),
                                           (bp.get("contact", ""), rfont, rname, 9, 0)]:
                if text:
                    page.insert_text((cx - f.text_length(text, fontsize=size) / 2, y), text,
                                     fontname=fn, fontsize=size, color=(1, 1, 1))
                y += gap
    return changed


def shrink_photos(doc, dpi=200, quality=82):
    """Re-encode photos at about 200 dpi as they are shown on the page, for a file small enough to email.
    Only the photo stream changes; transparency masks stay as they are. CMYK photos become RGB."""
    shown = {}
    for page in doc:
        for img in page.get_images(full=True):
            for r in page.get_image_rects(img[0]):
                shown[img[0]] = max(shown.get(img[0], 0), r.width / 72, r.height / 72)
    for xref, inches in shown.items():
        if doc.xref_get_key(xref, "Filter")[1] != "/DCTDecode" or inches == 0:
            continue
        before = len(doc.xref_stream_raw(xref))
        pix = pymupdf.Pixmap(doc, xref)
        if pix.alpha:
            pix = pymupdf.Pixmap(pix, 0)
        if pix.colorspace.n not in (1, 3):
            pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
        im = Image.frombytes("RGB" if pix.n == 3 else "L", (pix.width, pix.height), pix.samples)
        scale = min(1.0, dpi * inches / max(pix.width, pix.height))
        if scale < 1:
            im = im.resize((max(1, round(pix.width * scale)), max(1, round(pix.height * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=quality, optimize=True)
        if len(buf.getvalue()) > before * 0.8:
            continue
        doc.update_stream(xref, buf.getvalue(), compress=False)
        for key, value in (("Filter", "/DCTDecode"), ("DecodeParms", "null"), ("Decode", "null"),
                           ("ColorSpace", "/DeviceRGB" if im.mode == "RGB" else "/DeviceGray"),
                           ("Width", str(im.width)), ("Height", str(im.height))):
            doc.xref_set_key(xref, key, value)


def main():
    doc = pymupdf.open(SOURCE)
    items = extract(doc)
    missing = [i["code"] for i in items if i["usdMsrp"] is None]
    (ROOT / "products-2026-27.json").write_text(json.dumps(items, indent=1, ensure_ascii=False) + "\n")
    with open(ROOT / "us-price-list.csv", "w", newline="") as f:
        import csv
        w = csv.writer(f)
        w.writerow(["Code", "Section", "Name / description", "New", "Catalogue page", "India MRP (INR)",
                    "US MSRP (USD)", "US wholesale (USD)", "Per piece"])
        for i in items:
            w.writerow([i["code"], i["section"], i["name"] or i["description"] or "", "NEW" if i["new"] else "",
                        i["page"] or "", i["inrMrp"] or "", f"{i['usdMsrp']:.2f}" if i["usdMsrp"] else "",
                        f"{i['usdWholesale']:.2f}" if i["usdWholesale"] else "", "yes" if i["perPiece"] else ""])
    changed = localise(doc)
    leftover = [(pn + 1, s["text"]) for pn, p in enumerate(doc) for s in spans_of(p) if "₹" in s["text"] or "M.R.P" in s["text"]]
    OUT_PDF.parent.mkdir(exist_ok=True)
    doc.save(OUT_PRINT, garbage=4, deflate=True)
    shrink_photos(doc)
    doc.save(OUT_PDF, garbage=4, deflate=True)
    print(f"{len(items)} products, {changed} prices converted")
    for p in (OUT_PDF, OUT_PRINT):
        print(f"  {p.relative_to(ROOT.parent)}  {p.stat().st_size / 1e6:.1f} MB")
    if missing:
        print(f"! no price found for: {', '.join(missing)}", file=sys.stderr)
    if leftover:
        print(f"! rupee text left in PDF: {leftover}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
