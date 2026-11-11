#!/usr/bin/env python3
"""Build the online catalogue portal (one self-contained HTML page) from the catalogue data.

  python3 catalogue/build.py     # first: prices, photos (catalogue/.work/img)
  python3 catalogue/portal.py    # then: catalogue/.work/portal.html

The page shows US retail prices only. It never contains India M.R.P., landed cost or wholesale.
"""
import base64
import json
from pathlib import Path

from build import CONFIG, SECTIONS, WORK, title_and_note

ROOT = Path(__file__).resolve().parent
SLUGS = {"Ball Pens": "ball-pens", "Roller Pens": "roller-pens", "Fountain Pens": "fountain-pens",
         "Gift Sets": "gift-sets", "Diaries & Pen Sets": "diaries", "Inks": "inks",
         "Refills & Cartridges": "refills"}


def data_uri(path):
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def main():
    items = json.loads((ROOT / "products-2026-27.json").read_text())
    img = WORK / "img"
    sections, products = [], []
    for heading, groups, intro in SECTIONS:
        slug = SLUGS[heading]
        sections.append({"id": slug, "name": heading, "intro": intro})
        for it in items:
            if it["pricingGroup"] not in groups or it["excludedFromUS"] or not it.get("retailUsd"):
                continue
            title, note = title_and_note(it)
            photo = img / f"{it['code']}.jpg"
            products.append({
                "code": it["code"], "name": title, "note": note, "section": slug, "new": it["new"],
                "price": it["retailUsd"], "img": data_uri(photo) if photo.exists() else "",
            })
    ship, contact = CONFIG["customerShipping"], CONFIG["contact"]
    data = {
        "sections": sections, "products": products,
        "shipping": {"flat": ship["flatRateUsd"], "freeOver": ship["freeOverUsd"], "method": ship["method"],
                     "dispatch": ship["dispatch"]},
        "contact": {k: contact[k] for k in ("business", "location", "instagram", "email", "phone", "website")},
        "logo": data_uri(img / "logo-white.png"), "cover": data_uri(img / "cover.jpg"),
    }
    page = (ROOT / "portal-template.html").read_text()
    page = page.replace("/*DATA*/null", json.dumps(data, separators=(",", ":")))
    out = WORK / "portal.html"
    out.write_text(page)
    print(f"{len(products)} products -> {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
