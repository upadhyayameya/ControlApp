"""Builders for monday-shaped fixture items, so tests read like the brief."""
from __future__ import annotations

import copy
import json
from datetime import date
from pathlib import Path

from btu.config import load_config
from btu.etl import BoardData, Dataset

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.toml"

GROUP_IDS = {
    "audits": ("group_mknza884", "Audits Performed"),
    "pa_submitted": ("new_group53745", "Preapprovals Submitted"),
    "pa_approved": ("new_group85910", "Preapprovals Approved"),
    "impl_scheduled": ("group_mm41h4cn", "Implementations Scheduled"),
    "co_submitted": ("new_group47105", "Closeouts Submitted"),
    "co_approved": ("new_group30190", "Closeouts Approved"),
}

KPI_COLUMNS = [
    ("date4", "Completion Date", "date"),
    ("text", "Utility", "text"),
    ("text8", "Source", "text"),
    ("person", "Engineer", "people"),
    ("numbers_2", "Incentive", "numbers"),
    ("dup__of_incentive", "HBS Share", "numbers"),
    ("numbers5", "kWh/Therms", "numbers"),
]

_next_id = [1000]


def cfg(**rule_overrides):
    c = copy.deepcopy(load_config(CONFIG_PATH))
    c["rules"].update(rule_overrides)
    return c


def col(cid, text, ctype="text"):
    value = None
    if ctype == "date" and text:
        value = json.dumps({"date": text})
    return {"id": cid, "type": ctype, "text": text, "value": value}


def kpi_item(stage, name, when, utility, incentive=None, share=None, item_id=None,
             group=None, source="", engineer="Pat Engineer"):
    if item_id is None:
        _next_id[0] += 1
        item_id = _next_id[0]
    gid, gtitle = group or GROUP_IDS[stage]
    return {
        "id": str(item_id),
        "name": name,
        "group": {"id": gid, "title": gtitle},
        "column_values": [
            col("date4", when.isoformat() if isinstance(when, date) else when, "date"),
            col("text", utility),
            col("text8", source),
            col("person", engineer, "people"),
            col("numbers_2", None if incentive is None else str(incentive), "numbers"),
            col("dup__of_incentive", None if share is None else str(share), "numbers"),
            col("numbers5", None, "numbers"),
        ],
    }


def kpi_meta(groups=None):
    gs = groups or [{"id": g, "title": t} for g, t in GROUP_IDS.values()]
    return {
        "id": "1069742731",
        "name": "Monthly KPIs",
        "items_count": 8600,
        "groups": gs,
        "columns": [{"id": i, "title": t, "type": ty} for i, t, ty in KPI_COLUMNS],
    }


def dataset(kpi_items, bptu_names=None, extra=None):
    boards = {"kpi": BoardData(meta=kpi_meta(), items=kpi_items, pulled_at="2026-11-13T18:30:00")}
    if bptu_names is not None:
        boards["bptu"] = BoardData(
            meta={"id": "6530139050", "name": "BGE BPTU Tracker", "items_count": len(bptu_names),
                  "groups": [{"id": "topics", "title": "Active"}],
                  "columns": [{"id": "date_mm0whh86", "title": "Implementation Date", "type": "date"},
                              {"id": "dup__of_incentive_amount", "title": "HBS Share", "type": "numbers"},
                              {"id": "status", "title": "Status", "type": "status"}]},
            items=[{"id": str(9000 + i), "name": n, "group": {"id": "topics", "title": "Active"},
                    "column_values": []} for i, n in enumerate(bptu_names)],
            pulled_at="2026-11-13T18:30:00")
    boards.update(extra or {})
    return Dataset(boards=boards)
