#!/usr/bin/env python3
"""Build the Submarine Pens USA retail catalogue from the manufacturer's India catalogue.

  pip install pymupdf pillow        (and Node with Playwright + Chromium, for the PDF)
  python3 catalogue/build.py

Reads   source/submarine-catalogue-2026-27-india.pdf   the original (₹ M.R.P.); products and photos come from it
        us-config.json                                  exchange rate, landed-cost inputs, markup, shipping, contact
Writes  us/Submarine-Pens-USA-Catalogue-2026-27.pdf     the catalogue to send to customers (email-sized)
        products-2026-27.json                           every product with its landed cost and US prices
        us-pricing-workbook.csv                         the same as a spreadsheet: INTERNAL, shows your costs
"""
import csv
import html
import io
import json
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

import pymupdf
from PIL import Image

from extract import extract
from photos import find, textless
from pricing import price_all

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "source" / "submarine-catalogue-2026-27-india.pdf"
CONFIG = json.loads((ROOT / "us-config.json").read_text())
OUT_PDF = ROOT / "us" / "Submarine-Pens-USA-Catalogue-2026-27.pdf"
WORK = ROOT / ".work"  # generated HTML and images (not committed)

SECTIONS = [  # (heading, pricing groups, one-line intro)
    ("Ball Pens", ["Ball Pens"], "Ballpoints for every day and every desk, from slim click pens to weighted metal writers."),
    ("Roller Pens", ["Roller Pens"], "The glide of liquid ink with the convenience of a ballpoint."),
    ("Fountain Pens", ["Fountain Pen"], "Steel nibs, smooth ink flow and metal bodies, plus starter sets with ink."),
    ("Gift Sets", ["Sets"], "Matched pairs and multi-pen sets, boxed and ready to give."),
    ("Diaries & Pen Sets", ["Diary combos", "Diary Set"], "Premium PU-leather diaries with a matching metal pen, in a gift box."),
    ("Inks", ["Ink Bottles"], "Bottled fountain pen ink, including seven scented colors."),
    ("Refills & Cartridges", ["Refills", "Cartridges"], "Genuine Submarine refills for every pen in this catalogue."),
]
SINGULAR = {"Ball Pens": "Ball Pen", "Roller Pens": "Roller Pen", "Fountain Pen": "Fountain Pen"}
PACKAGING = [  # (text in the packaging line, how the US catalogue describes it)
    ("Silver Tin", "Blister card with silver tin"), ("Transparent Tin", "Blister card with tin"),
    ("Transparent FP", "Blister card"), ("Inner Blister", "Blister card"), ("Plastic Tin", "Gift tin"),
    ("Metal Tin", "Metal gift tin"), ("P.A Box", "Gift box"), ("with Cartridges", "With ink cartridges"),
]


# ---------------------------------------------------------------- names


def title_and_note(it):
    """What a US customer reads on the card: a product name and one short detail line."""
    desc = it["description"] or ""
    group = it["pricingGroup"]
    if it["name"]:
        return it["name"], ""
    if group in SINGULAR:
        note = next((us for key, us in PACKAGING if key in desc), "")
        if desc.lower().startswith("coffee") or desc.lower().startswith("cofee"):
            note = (note + " · Coffee edition").lstrip(" ·")
        return SINGULAR[group], note
    if group == "Sets":
        name = desc[len("Sets of "):] if desc.startswith("Sets of ") else desc
        note = ""
        if "(" in name:
            name, inner = name.split("(", 1)
            inner = inner.rstrip(")").strip()
            note = {"Ball Pen & Roller Pen": "Ball pen + roller pen",
                    "Retail Blister hanging pack": "Space-themed pens, hanging pack"}.get(inner, inner.replace("Pcs", "pens"))
        name = name.strip()
        if name == "Roller Pen & Fountain Pen":
            return "Roller & Fountain Pen Set", "Roller pen + fountain pen, gift box"
        if name == "Roller Pen & Ball Pen":
            return "Roller & Ball Pen Set", ""
        if name.endswith(" Pen"):
            name = name[:-4]
        name = name.replace("Expresso", "Espresso").replace("ISRO Box", "ISRO Space Pens")
        return f"{name} Set", note
    if group == "Diary Set":
        return "Navigator A5 Diary & Pen", "160 ruled pages · sold in packs of 10, price per set"
    if group == "Diary combos":
        name = desc.replace("Diary Pen Combo Set", "Diary & Pen Set")
        note = "PU-leather diary, 180 pages, metal pen, gift box"
        if "(" in name:
            name, inner = name.split("(", 1)
            note = inner.rstrip(")")
        return name.strip(), note
    if group == "Ink Bottles":
        scented = (it["inrMrp"] or 0) >= 150
        return desc.replace(" Ink Bottle", " Ink"), "Scented fountain pen ink" if scented else "Fountain pen ink"
    if group == "Cartridges":
        name, _, pack = desc.partition("(")
        return f"Ink {name.strip()}s", pack.rstrip(")").replace("Pack", "pack")
    return desc.replace("Lavendra", "Lavender"), ""


# ---------------------------------------------------------------- photos


def tidy(img):
    """Whiten the catalogue's thin separator lines, then crop to the product with a small margin."""
    img = img.convert("RGB")
    g = img.convert("L")
    w, h = g.size
    px = g.load()
    dark_rows = [sum(1 for x in range(w) if px[x, y] < 225) / w for y in range(h)]
    y = 0
    while y < h:
        if dark_rows[y] > 0.2:
            run = y
            while run < h and dark_rows[run] > 0.2:
                run += 1
            if run - y <= 3:  # a hairline, not a pen
                for yy in range(y, run):
                    for x in range(w):
                        px[x, yy] = 255
                img.paste((255, 255, 255), (0, y, w, run))
            y = run
        else:
            y += 1
    dark_cols = [sum(1 for yy in range(h) if px[x, yy] < 225) / h for x in range(w)]
    for x, frac in enumerate(dark_cols):
        if frac > 0.5 and (x == 0 or dark_cols[x - 1] < 0.2 or x == w - 1 or dark_cols[x + 1] < 0.2):
            img.paste((255, 255, 255), (x, 0, x + 1, h))
    mask = img.convert("L").point(lambda v: 255 if v < 238 else 0)
    box = mask.getbbox()
    if box:
        pad = 6
        img = img.crop((max(box[0] - pad, 0), max(box[1] - pad, 0), min(box[2] + pad, w), min(box[3] + pad, h)))
    return img


def save_photos(items):
    doc = pymupdf.open(SOURCE)
    clean = textless(SOURCE)
    where = find(doc)
    out = WORK / "img"
    out.mkdir(parents=True, exist_ok=True)
    for it in items:
        if it["code"] not in where:
            continue
        pn, rect = where[it["code"]]
        pix = clean[pn].get_pixmap(dpi=200, clip=rect)
        img = tidy(Image.open(io.BytesIO(pix.tobytes("png"))))
        wide = img.width >= 3 * img.height
        img.thumbnail((720, 140) if wide else (520, 520), Image.LANCZOS)
        path = out / f"{it['code']}.jpg"
        img.save(path, "JPEG", quality=80, optimize=True, progressive=True)
        it["_photo"] = path.name
        it["_wide"] = wide
    # cover, brand and back-cover art, from the text-free source pages
    trim = pymupdf.Rect(9.5, 9, 456.5, 601)  # the source pages carry bleed and crop marks outside this
    clean[0].get_pixmap(dpi=170, clip=trim).pil_save(out / "cover.jpg", quality=82)
    clean[1].get_pixmap(dpi=200, clip=pymupdf.Rect(222, 9, 456.5, 304)).pil_save(out / "nib.jpg", quality=82)
    logo = clean[59].get_pixmap(dpi=200, clip=pymupdf.Rect(110, 400, 356, 480)).pil_tobytes("png")
    grey = Image.open(io.BytesIO(logo)).convert("L")
    white = Image.new("RGBA", grey.size, (255, 255, 255, 0))
    white.putalpha(grey.point(lambda v: max(0, min(255, (v - 40) * 255 // 180))))  # white logo, see-through background
    white.save(out / "logo-white.png")


# ---------------------------------------------------------------- HTML

e = html.escape


def money(v):
    return f"${v:,.2f}"


def card(it):
    title, note = title_and_note(it)
    photo = f'<img src="img/{it["_photo"]}" alt="">' if it.get("_photo") else ""
    new = '<span class="new">NEW</span>' if it["new"] else ""
    return f'''<article class="card {'wide' if it.get('_wide') else 'square'}">
  <div class="photo">{photo}</div>
  <div class="info">
    <h3>{e(title)}{new}</h3>
    <p class="note">{e(note)}</p>
    <div class="meta"><span class="code">{e(it["code"])}</span><span class="price">{money(it["retailUsd"])}</span></div>
  </div>
</article>'''


def section_html(heading, intro, items):
    blocks, run, shape = [], [], None
    for it in items:  # keep catalogue order; group consecutive items of the same photo shape
        s = "wide" if it.get("_wide") else "square"
        if s != shape and run:
            blocks.append((shape, run))
            run = []
        shape = s
        run.append(it)
    if run:
        blocks.append((shape, run))
    grids = "".join(f'<div class="grid {s}">{"".join(card(i) for i in r)}</div>' for s, r in blocks)
    return f'''<section class="products">
  <header class="sec"><h2>{e(heading)}</h2><p>{e(intro)}</p></header>
  {grids}
</section>'''


def price_list_html(items_by_section):
    rows = []
    for heading, items in items_by_section:
        rows.append(f'<li class="h">{e(heading)}</li>')
        for it in items:
            title, note = title_and_note(it)
            label = title if not note or it["pricingGroup"] not in SINGULAR else f"{title}, {note.lower()}"
            rows.append(f'<li><span class="c">{e(it["code"])}</span><span class="t">{e(label)}{" <b>NEW</b>" if it["new"] else ""}</span>'
                        f'<span class="p">{money(it["retailUsd"])}</span></li>')
    return f'''<section class="pricelist"><header class="sec"><h2>Price List</h2>
<p>Every product in this catalogue by code. US retail prices in US dollars, landed: duty and freight included.</p></header>
<ul>{"".join(rows)}</ul></section>'''


def contact_lines():
    c = CONFIG["contact"]
    lines = [c["instagram"] and f"Instagram {c['instagram']}", c["email"], c["phone"], c["website"]]
    return [l for l in lines if l]


def overview_html(by_section):
    rows = "".join(
        f"<tr><td>{e(h)}</td><td>{len(its)}</td><td>{money(min(i['retailUsd'] for i in its))} – {money(max(i['retailUsd'] for i in its))}</td></tr>"
        for h, _, its in by_section if its)
    return f'''<div class="overview"><h4>The collection</h4>
  <table><thead><tr><th>Section</th><th>Products</th><th>Retail prices</th></tr></thead><tbody>{rows}</tbody></table></div>'''


def front_html(by_section):
    ship = CONFIG["customerShipping"]
    c = CONFIG["contact"]
    contact = "".join(f"<li>{e(l)}</li>" for l in contact_lines())
    return f'''
<section class="cover">
  <img class="bg" src="img/cover.jpg" alt="">
  <div class="cover-text">
    <p class="kicker">{e(c["business"])}</p>
    <h1>USA Collection 2026–27</h1>
    <p class="sub">Retail Catalogue · Prices in US dollars, landed</p>
  </div>
</section>
<section class="brand">
  <img class="nib" src="img/nib.jpg" alt="">
  <div class="brand-text">
    <p class="kicker">We don’t just make pens.</p>
    <h1>We create<br><span>instruments</span><br>of <span>expression.</span></h1>
    <p>Since 1995, Submarine has crafted premium writing instruments that inspire ideas, build connections and leave a lasting impression. Made in India by Submarine Pens Limited, an ISO 9001:2015 certified manufacturer, and brought to the United States by {e(c["business"])}.</p>
  </div>
  <div class="pillars">
    <div><h4>Innovation</h4><p>Creative design and modern technology, reimagining the writing experience.</p></div>
    <div><h4>Craftsmanship</h4><p>Every detail engineered, every pen carefully finished.</p></div>
    <div><h4>Legacy</h4><p>Trusted since 1995, built on quality and integrity.</p></div>
  </div>
  <p class="tags">Premium writing instruments · Corporate gifting · Customization</p>
</section>
<section class="howto">
  <header class="sec"><h2>How to Order</h2><p>Everything you need to know before you buy.</p></header>
  <div class="howgrid">
    <div class="box key"><h4>Landed prices: nothing more to pay</h4>
      <p>Every price in this catalogue is a US retail price in US dollars, <b>landed</b>. Freight from our factory in India, US customs duty and import tariffs are already included, so there are no customs charges or surprise fees when your order arrives.</p></div>
    <div class="box"><h4>Shipping</h4>
      <p>{money(ship["flatRateUsd"])} flat rate anywhere in the US. <b>Free shipping on orders over {money(ship["freeOverUsd"]).replace(".00", "")}.</b></p>
      <p>{e(ship["dispatch"])}, by {e(ship["method"])}.</p></div>
    <div class="box"><h4>Ordering</h4>
      <p>Quote the product code shown on each item. Order or ask a question:</p><ul>{contact}</ul></div>
    <div class="box"><h4>Wholesale &amp; corporate gifting</h4>
      <p>Retailers, offices and event organizers: ask for wholesale pricing, volume discounts and custom branding of pens and gift sets.</p></div>
  </div>
  {overview_html(by_section)}
  <div class="legend">
    <div><span class="new">NEW</span> New in the 2026–27 collection</div>
    <div><span class="code">0109320100</span> Product code: quote it when you order</div>
  </div>
  <p class="small">Prices effective {date.today():%B %Y} and subject to change. Sales tax is added where it applies. Colors in photos may vary slightly from the product.
  Packaging may differ from what is shown.</p>
</section>'''


def back_html():
    c = CONFIG["contact"]
    lines = "".join(f"<p>{e(l)}</p>" for l in [c["location"]] + contact_lines())
    return f'''<section class="back">
  <img class="logo" src="img/logo-white.png" alt="Submarine, Power to Express">
  <h2>{e(c["business"])}</h2>{lines}
  <p class="maker">Manufactured by Submarine Pens Limited, Mumbai, India · ISO 9001:2015 certified</p>
</section>'''


def page(body):
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Submarine Pens USA Catalogue 2026-27</title>
<link rel="stylesheet" href="../catalogue.css"></head><body>{body}</body></html>'''


# ---------------------------------------------------------------- main


def main():
    items = extract(pymupdf.open(SOURCE))
    price_all(items, CONFIG)
    excluded = CONFIG["excludeFromUS"]
    for it in items:
        it["excludedFromUS"] = excluded.get(it["code"])
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir()
    us = [it for it in items if not it["excludedFromUS"] and it.get("retailUsd")]
    save_photos(us)
    missing = [it["code"] for it in us if not it.get("_photo")]
    if missing:
        print(f"! no photo for {missing}", file=sys.stderr)

    by_section = [(h, intro, [it for it in us if it["pricingGroup"] in groups]) for h, groups, intro in SECTIONS]
    (WORK / "front.html").write_text(page(front_html(by_section)))
    (WORK / "body.html").write_text(page("".join(section_html(h, i, its) for h, i, its in by_section)
                                         + price_list_html([(h, its) for h, _, its in by_section])))
    (WORK / "back.html").write_text(page(back_html()))
    footer = f'{e(CONFIG["contact"]["business"])} · USA Collection 2026–27 · Retail prices in USD, landed'
    parts = []
    for name, show_footer in (("front", False), ("body", True), ("back", False)):
        out = WORK / f"{name}.pdf"
        subprocess.run(["node", str(ROOT / "render.cjs"), str(WORK / f"{name}.html"), str(out),
                        footer if show_footer else ""], check=True)
        parts.append(out)
    doc = pymupdf.open()
    for p in parts:
        doc.insert_pdf(pymupdf.open(p))
    doc.set_metadata({"title": "Submarine Pens USA Catalogue 2026-27", "author": CONFIG["contact"]["business"],
                      "subject": "Retail price catalogue, USD, landed"})
    OUT_PDF.parent.mkdir(exist_ok=True)
    doc.save(OUT_PDF, garbage=4, deflate=True)

    for it in items:
        it.pop("_photo", None)
        it.pop("_wide", None)
    (ROOT / "products-2026-27.json").write_text(json.dumps(items, indent=1, ensure_ascii=False) + "\n")
    with open(ROOT / "us-pricing-workbook.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Code", "Section", "Product", "Detail", "New", "India MRP (INR)", "Factory (USD)", "Duty (USD)",
                    "India tariff (USD)", "Freight (USD)", "Fees (USD)", "Landed (USD)", "Retail (USD)",
                    "Wholesale (USD)", "Retail / landed", "HTS", "Weight (g)", "Left out of US catalogue"])
        for it in items:
            if not it.get("retailUsd"):
                continue
            b = it["landedBreakdown"]
            title, note = title_and_note(it)
            w.writerow([it["code"], it["section"], title, note, "NEW" if it["new"] else "", it["inrMrp"],
                        f'{b["factory"]:.2f}', f'{b["duty"]:.2f}', f'{b["tariff"]:.2f}', f'{b["freight"]:.2f}',
                        f'{b["fees"]:.2f}', f'{it["landedUsd"]:.2f}', f'{it["retailUsd"]:.2f}', f'{it["wholesaleUsd"]:.2f}',
                        f'{it["retailUsd"] / it["landedUsd"]:.1f}', it["hts"],
                        round(it["landedBreakdown"]["freight"] / CONFIG["landedCost"]["freightUsdPerKg"] * 1000),
                        it["excludedFromUS"] or ""])
    print(f"{len(us)} products in the US catalogue ({len(items) - len(us)} left out), {len(doc)} pages, "
          f"{OUT_PDF.stat().st_size / 1e6:.1f} MB -> {OUT_PDF.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
