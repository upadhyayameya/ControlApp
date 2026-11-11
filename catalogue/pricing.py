"""US retail prices built up from landed cost (what one unit costs you, delivered to Virginia, duty paid)."""
import math
import re


def kind(item):
    """Pricing group: the catalogue section, with diaries and cartridges split out."""
    code, desc, section = item["code"], (item["description"] or ""), item["section"]
    if code.startswith("16-0011"):
        return "Cartridges"
    if section == "Sets" and "Diary" in desc:
        return "Diary combos"
    return section


def pieces(item):
    """Pens in the unit, for the per-piece part of the duty."""
    text = (item["name"] or "") + " " + (item["description"] or "")
    m = re.search(r"\((\d+)\s*Pcs\)", text, re.I)
    if m:
        return int(m.group(1))
    if "&" in text and kind(item) == "Sets":
        return 2
    if "Calligraphy" in text:
        return 3
    return 1


def weight_grams(item, cfg):
    w = cfg["weightGrams"]
    k = kind(item)
    if k in ("Ball Pens", "Roller Pens", "Fountain Pen"):
        desc = item["description"] or ""
        for key in ("Silver Tin", "Transparent FP", "Transparent Tin", "Inner Blister", "Plastic Tin", "Metal Tin", "P.A Box"):
            if key in desc:
                return w[key] + (30 if k == "Fountain Pen" else 0)
        return w[k]
    if k == "Sets" and re.search(r"\(\d+\s*Pcs\)", item["description"] or "", re.I):
        return w["Sets (Pcs)"]
    return w[k]


def landed(item, cfg):
    """Itemised landed cost of one unit in USD."""
    k = kind(item)
    inr = cfg["factoryPriceInr"].get(item["code"], item["inrMrp"] * cfg["factoryPriceShareOfMrp"])
    factory = inr / cfg["inrPerUsd"]
    d = cfg["duty"][k]
    duty = factory * d["pct"] / 100 + pieces(item) * d["centsEach"] / 100
    tariff = factory * cfg["indiaAdditionalTariffPct"] / 100
    freight = weight_grams(item, cfg) / 1000 * cfg["freightUsdPerKg"]
    fees = factory * (cfg["merchandiseProcessingFeePct"] + cfg["brokerBankAndOtherPct"]) / 100
    total = factory + duty + tariff + freight + fees
    return {"factory": factory, "duty": duty, "tariff": tariff, "freight": freight, "fees": fees, "total": total,
            "hts": d["hts"], "weightGrams": weight_grams(item, cfg)}


def retail(item, landed_total, cfg):
    r = cfg
    if item["code"] in r["overrides"]:
        return float(r["overrides"][item["code"]])
    keep = 1 - r["cardFeePct"] / 100
    mode = r.get("mode", "markup")
    if mode == "margin":  # profit after the card fee is targetMarginPct of retail
        raw = landed_total / max(0.05, keep - r["targetMarginPct"] / 100)
    elif mode == "profit":  # the same dollar profit on every product
        raw = (landed_total + r["targetProfitUsd"]) / keep
    else:
        raw = landed_total * r["markupOnLanded"]
    price = math.ceil(raw - r["priceEnding"] + 1e-9) + r["priceEnding"]  # next price ending in .99
    floor = r["minimumUsd"].get(kind(item), r["minimumUsd"]["default"])
    return round(max(price, floor), 2)


def price_all(items, config):
    lc, rc = config["landedCost"], config["retail"]
    for it in items:
        if it["inrMrp"] is None:
            continue
        c = landed(it, lc)
        it["pricingGroup"] = kind(it)
        it["hts"] = c["hts"]
        it["landedUsd"] = round(c["total"], 2)
        it["landedBreakdown"] = {k: round(c[k], 3) for k in ("factory", "duty", "tariff", "freight", "fees")}
        it["retailUsd"] = retail(it, c["total"], rc)
        it["wholesaleUsd"] = round(it["retailUsd"] * rc["wholesaleShareOfRetail"], 2)
    return items
