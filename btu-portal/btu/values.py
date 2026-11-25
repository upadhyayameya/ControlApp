"""Reading values out of monday column_values, including mirror and formula columns.

Mirror (and formula, and connect) columns return null `text` through ordinary item queries;
their value arrives in `display_value` via the MirrorValue / FormulaValue fragments. Every read
here prefers display_value and falls back to text.
"""
from __future__ import annotations

import json
import re
from datetime import date


class Item:
    __slots__ = ("id", "name", "group_id", "group_title", "cols", "raw")

    def __init__(self, raw: dict):
        self.raw = raw
        self.id = str(raw["id"])
        self.name = (raw.get("name") or "").strip()
        g = raw.get("group") or {}
        self.group_id = g.get("id")
        self.group_title = g.get("title")
        self.cols = {c["id"]: c for c in raw.get("column_values") or []}


def text_of(item: Item, cid: str | None) -> str | None:
    if not cid:
        return None
    c = item.cols.get(cid)
    if not c:
        return None
    for key in ("display_value", "text"):
        v = c.get(key)
        # Empty formula columns come back as the literal text "null".
        if v is not None and str(v).strip() != "" and str(v).strip().lower() != "null":
            return str(v).strip()
    return None


def date_of(item: Item, cid: str | None) -> date | None:
    if not cid:
        return None
    c = item.cols.get(cid)
    if not c:
        return None
    raw = c.get("value")
    if raw:
        try:
            v = json.loads(raw)
            if isinstance(v, dict) and v.get("date"):
                return date.fromisoformat(v["date"][:10])
        except (ValueError, TypeError):
            pass
    t = text_of(item, cid)
    if t:
        try:
            return date.fromisoformat(t[:10])
        except ValueError:
            return None
    return None


_NUM = re.compile(r"^-?\d+(\.\d+)?$")


def parse_number(text: str | None) -> tuple[float | None, str | None]:
    """Returns (value, problem). Never guesses: anything unparseable is (None, reason).

    Mirror display values join multiple linked values with ", "; those are summed in code
    (mirrors cannot be aggregated server-side). A bare comma is a thousands separator.
    """
    if text is None or str(text).strip() == "":
        return None, None
    parts = [p.strip() for p in str(text).split(", ")]
    total = 0.0
    for p in parts:
        s = p.replace("$", "").replace(",", "").strip()
        if not _NUM.match(s):
            return None, f"not a number: {text!r}"
        total += float(s)
    return total, None


def number_of(item: Item, cid: str | None) -> tuple[float | None, str | None]:
    return parse_number(text_of(item, cid))


def norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())
