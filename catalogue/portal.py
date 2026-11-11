#!/usr/bin/env python3
"""Build the USA catalogue portal: one self-contained page with the whole catalogue and, behind a
"Costs & margins" tab, every product's India M.R.P., landed cost, markup, profit and margin with live
what-if controls.

  python3 catalogue/build.py     # first: prices, photos (catalogue/.work/img)
  python3 catalogue/portal.py    # then: catalogue/.work/portal.html

The page carries your costs. It is for you; send customers the PDF catalogue.
"""
import base64
import json
from pathlib import Path

from build import CONFIG, SECTIONS, WORK, title_and_note
from pricing import kind, pieces, weight_grams

ROOT = Path(__file__).resolve().parent
SLUGS = {"Ball Pens": "ball-pens", "Roller Pens": "roller-pens", "Fountain Pens": "fountain-pens",
         "Gift Sets": "gift-sets", "Diaries & Pen Sets": "diaries", "Inks": "inks",
         "Refills & Cartridges": "refills"}


def data_uri(path):
    mime = "image/png" if path.suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def main():
    items = json.loads((ROOT / "products-2026-27.json").read_text())
    lc, rc = CONFIG["landedCost"], CONFIG["retail"]
    img = WORK / "img"
    sections, products = [], []
    for heading, groups, intro in SECTIONS:
        slug = SLUGS[heading]
        sections.append({"id": slug, "name": heading, "intro": intro})
        for it in items:
            if it["pricingGroup"] not in groups or not it.get("retailUsd"):
                continue
            title, note = title_and_note(it)
            group = kind(it)
            d = lc["duty"][group]
            photo = img / f"{it['code']}.jpg"
            products.append({
                "code": it["code"], "name": title, "note": note, "section": slug, "new": it["new"],
                "img": data_uri(photo) if photo.exists() else "",
                # cost inputs, recomputed in the page so the what-if controls work
                "group": group, "mrp": it["inrMrp"], "perPiece": it["perPiece"],
                "factoryInr": lc["factoryPriceInr"].get(it["code"]), "dutyPct": d["pct"], "cents": d["centsEach"],
                "hts": d["hts"], "pieces": pieces(it), "grams": weight_grams(it, lc),
                "override": rc["overrides"].get(it["code"]), "excluded": it["excludedFromUS"] or "",
                "retailPy": it["retailUsd"], "landedPy": it["landedUsd"],
            })
    ship, contact = CONFIG["customerShipping"], CONFIG["contact"]
    data = {
        "sections": sections, "products": products,
        "settings": {
            "inrPerUsd": lc["inrPerUsd"], "factoryShare": lc["factoryPriceShareOfMrp"], "freightPerKg": lc["freightUsdPerKg"],
            "indiaTariffPct": lc["indiaAdditionalTariffPct"], "mpfPct": lc["merchandiseProcessingFeePct"],
            "otherPct": lc["brokerBankAndOtherPct"], "markup": rc["markupOnLanded"], "ending": rc["priceEnding"],
            "wholesaleShare": rc["wholesaleShareOfRetail"], "minimum": rc["minimumUsd"],
        },
        "shipping": {"flat": ship["flatRateUsd"], "freeOver": ship["freeOverUsd"], "method": ship["method"],
                     "dispatch": ship["dispatch"]},
        "contact": {k: contact[k] for k in ("business", "location", "instagram", "email", "phone", "website")},
        "logo": data_uri(img / "logo-white.png"), "cover": data_uri(img / "cover.jpg"),
    }
    page = (ROOT / "portal-template.html").read_text()
    page = page.replace("/*DATA*/null", json.dumps(data, separators=(",", ":")))
    out = WORK / "portal.html"
    out.write_text(page)
    shown = sum(1 for p in products if not p["excluded"])
    print(f"{shown} products in the catalogue, {len(products)} in the cost view -> {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
