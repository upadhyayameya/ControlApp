#!/usr/bin/env python3
"""Build the INTERNAL pricing console: every product's India M.R.P., landed cost breakdown, US prices,
markup, profit and margin, with the pricing assumptions as live controls.

  python3 catalogue/build.py     # first: prices and photos
  python3 catalogue/costs.py     # then: catalogue/.work/costs.html   (private: shows your costs)
"""
import base64
import json
from pathlib import Path

from build import CONFIG, SECTIONS, WORK, title_and_note
from pricing import kind, pieces, weight_grams

ROOT = Path(__file__).resolve().parent


def main():
    items = json.loads((ROOT / "products-2026-27.json").read_text())
    lc, rc = CONFIG["landedCost"], CONFIG["retail"]
    section_of = {g: h for h, groups, _ in SECTIONS for g in groups}
    rows = []
    for it in items:
        if it["inrMrp"] is None:
            continue
        group = kind(it)
        d = lc["duty"][group]
        title, note = title_and_note(it)
        photo = WORK / "img" / f"{it['code']}.jpg"
        rows.append({
            "code": it["code"], "name": title, "note": note, "section": section_of[group], "group": group,
            "new": it["new"], "mrp": it["inrMrp"], "perPiece": it["perPiece"],
            "factoryInr": lc["factoryPriceInr"].get(it["code"]),
            "dutyPct": d["pct"], "cents": d["centsEach"], "hts": d["hts"], "pieces": pieces(it),
            "grams": weight_grams(it, lc), "override": rc["overrides"].get(it["code"]),
            "excluded": it["excludedFromUS"] or "",
            "retailPy": it.get("retailUsd"), "landedPy": it.get("landedUsd"),
            "img": "data:image/jpeg;base64," + base64.b64encode(photo.read_bytes()).decode() if photo.exists() else "",
        })
    settings = {
        "inrPerUsd": lc["inrPerUsd"], "factoryShare": lc["factoryPriceShareOfMrp"], "freightPerKg": lc["freightUsdPerKg"],
        "indiaTariffPct": lc["indiaAdditionalTariffPct"], "mpfPct": lc["merchandiseProcessingFeePct"],
        "otherPct": lc["brokerBankAndOtherPct"], "markup": rc["markupOnLanded"], "ending": rc["priceEnding"],
        "wholesaleShare": rc["wholesaleShareOfRetail"], "minimum": rc["minimumUsd"],
    }
    data = {"rows": rows, "settings": settings, "sections": [h for h, _, _ in SECTIONS]}
    page = (ROOT / "costs-template.html").read_text().replace("/*DATA*/null", json.dumps(data, separators=(",", ":")))
    out = WORK / "costs.html"
    out.write_text(page)
    print(f"{len(rows)} products -> {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
