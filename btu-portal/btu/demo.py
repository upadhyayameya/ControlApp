"""A synthetic, clearly-labelled data set that exercises every rule. Never mixed with real data:
it is written to its own database, flagged demo=1, and every page shows a DEMO banner."""
from __future__ import annotations

import json
import random
from datetime import date, timedelta
from pathlib import Path

from .config import ROOT

KPI_GROUPS = [("group_mknza884", "Audits Performed", "audits"),
              ("new_group53745", "Preapprovals Submitted", "pa_submitted"),
              ("new_group85910", "Preapprovals Approved", "pa_approved"),
              ("group_mm41h4cn", "Implementations Scheduled", "impl_scheduled"),
              ("new_group47105", "Closeouts Submitted", "co_submitted"),
              ("new_group30190", "Closeouts Approved", "co_approved")]

UTILS = [("BGE", 30), ("HVAC Tune Up", 14), ("HVAC BTU", 6), ("HVAC BPTU", 3), ("Pepco", 8),
         ("Washington Gas", 4), ("Delmarva", 4), ("SMECO", 3), ("GA Power", 3), ("Dominion - TRC", 3),
         ("Potomac Edison", 1), ("Met ED", 1), ("National Grid", 1), ("", 1)]
STREETS = ["Harbor", "Pratt", "Light", "Calvert", "Charles", "Eutaw", "Howard", "Paca", "Fayette",
           "Lombard", "Fleet", "Boston", "Aliceanna", "Thames", "Key", "Fort", "Hanover", "Greene"]
KINDS = ["Tower", "Plaza", "Center", "Office Park", "Medical", "Hall", "Annex", "Court", "Commons"]
ENGINEERS = ["A. Rivera", "B. Okafor", "C. Lindqvist", "D. Patel", "E. Novak"]


def _col(cid, text, ctype="text"):
    v = json.dumps({"date": text}) if ctype == "date" and text else None
    return {"id": cid, "type": ctype, "text": text, "value": v}


def _names(rng, n):
    out = set()
    while len(out) < n:
        out.add(f"{rng.randint(10, 999)} {rng.choice(STREETS)} {rng.choice(KINDS)}")
    return sorted(out)


def build(seed: int = 7, today: date = date(2026, 11, 13)):
    rng = random.Random(seed)
    names = _names(rng, 260)
    iid = [500000]
    kpi = []

    def add(stage_gid, gtitle, name, d, util, inc, share, src="", eng=None):
        iid[0] += rng.randint(1, 4)
        kpi.append({"id": str(iid[0]), "name": name, "group": {"id": stage_gid, "title": gtitle},
                    "column_values": [_col("date4", d.isoformat(), "date"), _col("text", util),
                                      _col("text8", src), _col("person", eng or rng.choice(ENGINEERS), "people"),
                                      _col("numbers_2", f"{inc:.0f}" if inc is not None else None, "numbers"),
                                      _col("dup__of_incentive", f"{share:.0f}" if share is not None else None, "numbers"),
                                      _col("numbers5", str(rng.randint(2000, 90000)), "numbers")]})

    def pick_util():
        r = rng.uniform(0, sum(w for _, w in UTILS))
        for u, w in UTILS:
            r -= w
            if r <= 0:
                return u
        return "BGE"

    start = date(2026, 9, 1)
    d = start
    while d <= today:
        if d.weekday() < 5:
            for gid, gtitle, stage in KPI_GROUPS:
                per_day = {"audits": 2, "pa_submitted": 3, "pa_approved": 2, "impl_scheduled": 2,
                           "co_submitted": 1.5, "co_approved": 1.2}[stage]
                for _ in range(int(rng.expovariate(1 / per_day))):
                    util = pick_util()
                    name = rng.choice(names)
                    if util == "BGE" and rng.random() < 0.35:
                        name = f"{name} (Phase {rng.choice([1, 2])})"
                    presc = util.startswith("HVAC")
                    inc = rng.choice([1800, 2400, 3200, 3640, 4100]) if presc else rng.choice(
                        [6610, 8200, 9800, 11666, 14500, 18200, 24000])
                    src = rng.choice(["", "", "", "MDEA", "Energy Tech"])
                    share = inc * (0.5 if src else 1.0)
                    if rng.random() < 0.03:
                        inc = share = None  # value not entered yet
                    add(gid, gtitle, name, d, util, inc, share, src)
                    if rng.random() < 0.12:  # logged twice
                        add(gid, gtitle, name, d, util, inc, share, src)
        d += timedelta(days=1)

    # A prescriptive batch: 40+ preapprovals in one day.
    for i in range(42):
        add("new_group53745", "Preapprovals Submitted", f"RTU batch site {i + 1:02d}", date(2026, 11, 10),
            "HVAC Tune Up", 3640, 3640)
    # The $6,610 BGE repeat, four times across months.
    for dd in (date(2026, 9, 9), date(2026, 10, 7), date(2026, 10, 28), date(2026, 11, 4)):
        add("new_group53745", "Preapprovals Submitted", "414 Pratt Medical", dd, "BGE", 6610, 6610)
    # Same building, two real programs, same day.
    add("new_group53745", "Preapprovals Submitted", "88 Light Tower", date(2026, 11, 5), "BGE", 9800, 9800)
    add("new_group53745", "Preapprovals Submitted", "88 Light Tower", date(2026, 11, 5), "HVAC BTU", 2400, 2400)
    # Same building audited twice, with and without the Phase tag.
    add("group_mknza884", "Audits Performed", "21 Calvert Commons (Phase 1)", date(2026, 11, 3), "BGE", None, None)
    add("group_mknza884", "Audits Performed", "21 Calvert Commons", date(2026, 11, 9), "BGE", None, None)
    # An item in a group that isn't a stage.
    kpi.append({"id": "599999", "name": "Template row", "group": {"id": "topics", "title": "Archive me"},
                "column_values": []})

    kpi_meta = {"id": "1069742731", "name": "Monthly KPIs", "items_count": 8600,
                "groups": [{"id": g, "title": t} for g, t, _ in KPI_GROUPS] + [{"id": "topics", "title": "Archive me"}],
                "columns": [{"id": "date4", "title": "Completion Date", "type": "date"},
                            {"id": "text", "title": "Utility", "type": "text"},
                            {"id": "text8", "title": "Source", "type": "text"},
                            {"id": "person", "title": "Engineer", "type": "people"},
                            {"id": "numbers_2", "title": "Incentive", "type": "numbers"},
                            {"id": "dup__of_incentive", "title": "HBS Share", "type": "numbers"},
                            {"id": "numbers5", "title": "kWh/Therms", "type": "numbers"}]}

    def tracker(board_id, title, date_col, n, utilities=None):
        items = []
        for k in range(n):
            dd = today + timedelta(days=rng.randint(-60, 25))
            status = rng.choice(["Scheduled", "Tune Up Complete", "Tune Up Complete", "Complete-Need PA", "CO Submitted"])
            if dd > today:
                status = "Scheduled"
            inc = rng.choice([2400, 3640, 9800, 14500])
            cv = [_col(date_col, dd.isoformat(), "date"), _col("status", status, "status"),
                  _col("incentive_amount", str(inc), "numbers"),
                  _col("dup__of_incentive_amount", str(inc), "numbers")]
            if utilities:
                cv.append(_col("text_util", rng.choice(utilities)))
            items.append({"id": str(board_id)[-4:] + f"{k:04d}", "name": rng.choice(names),
                          "group": {"id": "g_active", "title": "Active"}, "column_values": cv})
        cols = [{"id": date_col, "title": "Implementation Date", "type": "date"},
                {"id": "status", "title": "Status", "type": "status"},
                {"id": "incentive_amount", "title": "Incentive Amount", "type": "numbers"},
                {"id": "dup__of_incentive_amount", "title": "HBS Share", "type": "numbers"}]
        if utilities:
            cols.append({"id": "text_util", "title": "Utility", "type": "text"})
        return {"meta": {"id": str(board_id), "name": title, "items_count": n,
                         "groups": [{"id": "g_active", "title": "Active"}], "columns": cols}, "items": items}

    bptu_names = sorted({it["name"] for it in kpi if "(Phase" in it["name"] and "Calvert" not in it["name"]})
    bptu = tracker(6530139050, "BGE BPTU Tracker", "date_mm0whh86", 0)
    bptu["items"] = [{"id": f"65{k:05d}", "name": n, "group": {"id": "g_active", "title": "Active"},
                      "column_values": [_col("date_mm0whh86", (today - timedelta(days=rng.randint(-20, 50))).isoformat(), "date"),
                                        _col("status", rng.choice(["Scheduled", "Tune Up Complete"]), "status"),
                                        _col("incentive_amount", "14500", "numbers"),
                                        _col("dup__of_incentive_amount", "14500", "numbers")]}
                     for k, n in enumerate(bptu_names)]
    bptu["items"].append({"id": "6599999", "name": "21 Calvert Commons (Phase 1)", "group": {"id": "g_active", "title": "Active"},
                          "column_values": []})
    master = tracker(1069746645, "Master TU Tracker", "date_mm4b5x2", 120,
                     ["BGE", "Pepco", "Washington Gas", "Delmarva", "SMECO", "GA Power", "Dominion - TRC"])
    presc = tracker(18409151061, "Prescriptive Tune Up Tracker", "date_mm0r6qv7", 150)

    icf_items = []
    statuses = ["RFI Sent to HBS"] * 6 + ["RFI Responed by HBS"] * 5 + ["HBS Revising Submission"] * 7 + \
               ["HBS Resubmitted"] * 6 + ["Under ICF Review"] * 30 + ["Approved"] * 40
    for k in range(491):
        st = rng.choice(statuses)
        phase_days = rng.randint(0, 110)
        bucket = "Critical" if phase_days > 60 else "Watch" if phase_days > 30 else "OK"
        icf_items.append({"id": f"184{k:05d}", "name": rng.choice(names), "group": {"id": "g1", "title": "Active"},
                          "column_values": [
                              _col("status", st, "status"),
                              {"id": "formula_resp", "type": "formula", "text": None, "value": None, "display_value": str(rng.randint(0, 40))},
                              {"id": "formula_phase", "type": "formula", "text": None, "value": None, "display_value": str(phase_days)},
                              {"id": "formula_bucket", "type": "formula", "text": None, "value": None, "display_value": bucket},
                              _col("numbers", str(rng.choice([2400, 3640, 9800, 14500, 24000])), "numbers"),
                              _col("icf_person", rng.choice(["ICF: J. Moore", "ICF: K. Tran", "ICF: L. Ahmed"]), "people"),
                              _col("person", rng.choice(ENGINEERS), "people"),
                              {"id": "lookup_mm70wevh", "type": "mirror", "text": None, "value": None, "display_value": rng.choice(["BGE", "Pepco"])}]})
    icf = {"meta": {"id": "18424932045", "name": "ICF/HBS Project Tracker", "items_count": 491,
                    "groups": [{"id": "g1", "title": "Active"}],
                    "columns": [{"id": "status", "title": "Status", "type": "status"},
                                {"id": "formula_resp", "title": "Days for Response", "type": "formula"},
                                {"id": "formula_phase", "title": "Days In Current Phase", "type": "formula"},
                                {"id": "formula_bucket", "title": "Aging Bucket", "type": "formula"},
                                {"id": "numbers", "title": "Incentive Amount", "type": "numbers"},
                                {"id": "icf_person", "title": "ICF Engineer", "type": "people"},
                                {"id": "person", "title": "HBS Engineer", "type": "people"},
                                {"id": "lookup_mm70wevh", "title": "Program", "type": "mirror"}]},
           "items": icf_items}
    return {"kpi": {"meta": kpi_meta, "items": kpi}, "bptu": bptu, "master_tu": master,
            "prescriptive": presc, "icf": icf}


def load_demo(cfg) -> Path:
    from .refresh import recompute_and_snapshot
    from .store import Store
    path = ROOT / "data" / "demo.sqlite"
    if path.exists():
        path.unlink()
    store = Store(path)
    store.set_meta("demo", "1")
    data = build()
    run = store.start_run("demo")
    for key, b in data.items():
        store.save_board(key, b["meta"], b["items"])
    store.finish_run(run, "ok", {"boards": {k: {"ok": True, "items": len(v["items"]), "new": len(v["items"]),
                                                "changed": 0, "deleted": 0} for k, v in data.items()}})
    recompute_and_snapshot(cfg, store, run)
    return path
