"""Cut one product photo per product code out of the source catalogue.

The photos are rendered from a copy of the catalogue with all text removed, so no ₹ prices, codes or NEW
labels end up inside them. The source page layout decides how each code is matched to its photo:

- list pages (one product per row, codes stacked at the same x): the photos in the band between the
  previous code and this one;
- grid pages (several products per row): the photos closest above each code.
"""
import re

import pymupdf

from extract import spans_of


def _mid_y(s):
    return (s["bbox"][1] + s["bbox"][3]) / 2


def code_positions(page, spans):
    """[(code, label_bbox, number_bbox)] for every 'Code:' on the page."""
    out = []
    for s in spans:
        t = s["text"].strip()
        if not t.startswith("Code:") or "(" in t:
            continue
        rest = t[5:].strip()
        if rest:
            out.append((rest, s["bbox"], s["bbox"]))
            continue
        right = [x for x in spans if "Bold" in x["font"] and abs(_mid_y(x) - _mid_y(s)) < 4
                 and -1 <= x["bbox"][0] - s["bbox"][2] < 8]
        if not right:
            right = sorted((x for x in spans if "Bold" in x["font"] and re.fullmatch(r"[\d-]{8,}", x["text"].strip())),
                           key=lambda x: abs(x["bbox"][0] - s["bbox"][0]) + abs(x["bbox"][1] - s["bbox"][1]))[:1]
        if right:
            out.append((right[0]["text"].strip(), s["bbox"], right[0]["bbox"]))
    return out


def _photos(page, im_infos):
    """Product photo rectangles on a page, without logos, packaging thumbnails, price badges or backgrounds."""
    W, H = page.rect.width, page.rect.height
    out = []
    for im in im_infos:
        r = pymupdf.Rect(im["bbox"]) & page.rect
        if r.is_empty or r.width < 12 or r.height < 12:
            continue
        if r.width * r.height > 0.3 * W * H:  # page backgrounds and big rotated decorations
            continue
        if r.y1 < 95 and r.width < 160:  # header logo
            continue
        if r.width < 40 and r.height > 1.4 * r.width and (r.x0 < 90 or r.x1 > W - 75):  # packaging thumbnail
            continue
        if im["xref"] == 0 and r.width < 60 and r.height < 35:  # price badge
            continue
        out.append(r)
    return out


def _big_photos(page, im_infos):
    """Fallback: any image that isn't the whole page, e.g. the diary and gift-box photos."""
    W, H = page.rect.width, page.rect.height
    return [r for r in (pymupdf.Rect(im["bbox"]) & page.rect for im in im_infos)
            if not r.is_empty and r.width > 30 and r.height > 30 and r.y0 > 60 and r.width * r.height < 0.95 * W * H]


def find(doc):
    """{code: (page_index, Rect)} for every product code with a photo."""
    found = {}
    for pn, page in enumerate(doc):
        spans = spans_of(page)
        codes = code_positions(page, spans)
        if not codes:
            continue
        section = next((s["text"] for s in spans if s["size"] >= 20), "")
        infos = page.get_image_info(xrefs=True)
        photos = _photos(page, infos)
        xs = sorted(c[1][0] for c in codes)
        is_list = len(codes) >= 3 and xs[-1] - xs[0] < 6
        keep_stacked = "Sets" in section  # sets show two pens stacked; single pens should be one photo

        def dist(r, c):
            num = c[2]
            x, y = (num[0] + num[2]) / 2, c[1][1]
            dx = max(r.x0 - x, 0, x - r.x1)
            dy = (r.y0 - y) * 3 if r.y0 > y else max(0, y - r.y1)
            return dx + dy

        owner = {}
        if is_list:
            ys = sorted(c[1][1] for c in codes)
            for j, c in enumerate(codes):
                y = c[1][1]
                top = max([v for v in ys if v < y - 5] + [60])
                lo, hi = top + 12, y - 1  # below the previous code's caption, above this code
                band = [r for r in photos if min(r.y1, hi) - max(r.y0, lo) > 0.3 * min(r.height, hi - lo)]
                if band:
                    # some photos are larger images clipped on the page; keep only what shows in this band
                    owner[j] = [pymupdf.Rect(r.x0, max(r.y0, lo), r.x1, min(r.y1, hi)) for r in band]
                clipped = band and all(r.y0 < lo for r in band) and max(r.height for r in owner[j]) < 0.5 * (hi - lo)
                if not band or clipped or max(r.height for r in owner[j]) < 20:
                    # image boxes that don't match what is drawn (rotated photos): take the whole band
                    owner[j] = [pymupdf.Rect(40, lo, page.rect.width - 75, hi)]
        else:
            for r in photos:
                ds = [dist(r, c) for c in codes]
                j = min(range(len(codes)), key=ds.__getitem__)
                if ds[j] < 90:
                    owner.setdefault(j, []).append(r)

        for j, c in enumerate(codes):
            rs = owner.get(j)
            if not rs:  # diary and gift-box pages: the larger photos in this code's band
                y = c[1][1]
                top = max([k[1][1] for k in codes if k[1][1] < y - 5] + [60])
                big = _big_photos(page, infos)
                rs = [r for r in big if top < (r.y0 + r.y1) / 2 <= y + 5] or sorted(big, key=lambda r: dist(r, c))[:1]
            if not rs:
                continue
            if not keep_stacked and len(rs) > 1:
                main = max(rs, key=lambda r: r.width * r.height)
                rs = [r for r in rs if min(r.y1, main.y1) - max(r.y0, main.y0) >= 0.5 * min(r.height, main.height)]
            u = pymupdf.Rect(rs[0])
            for r in rs[1:]:
                u |= r
            found[c[0]] = (pn, (u + (-3, -3, 3, 3)) & page.rect)
    return found


def textless(path):
    """A copy of the catalogue with every piece of text removed."""
    doc = pymupdf.open(path)
    for page in doc:
        page.add_redact_annot(page.rect, fill=False)
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
    return doc
