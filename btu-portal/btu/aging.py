"""Aging from the ICF/HBS Project Tracker.

The tracker's own formula columns (Days for Response, Days In Current Phase, Aging Bucket) do
the aging maths. They are read via FormulaValue.display_value and never recomputed here.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

from .etl import Dataset, Issue, resolve_columns
from .values import Item, number_of, text_of


@dataclass
class AgingItem:
    item_id: str
    name: str
    status: str | None
    holder: str | None
    kind: str | None
    days_for_response: float | None
    days_in_phase: float | None
    bucket: str | None
    value: float | None
    icf_engineer: str | None
    hbs_engineer: str | None
    program: str | None
    group: str | None


@dataclass
class Aging:
    available: bool
    reason: str | None = None
    board_id: str | None = None
    pulled_at: str | None = None
    items: list[AgingItem] = field(default_factory=list)
    columns: dict = field(default_factory=dict)
    issues: list[Issue] = field(default_factory=list)
    loop: list[AgingItem] = field(default_factory=list)
    by_kind: dict = field(default_factory=dict)          # kind -> (count, dollars)
    by_holder: dict = field(default_factory=dict)        # HBS/ICF -> (count, dollars)
    by_person: list = field(default_factory=list)        # (holder, person, count, dollars, max days)
    rfi_count: int = 0
    rfi_overdue: list[AgingItem] = field(default_factory=list)
    overdue_days: int = 7
    buckets: list = field(default_factory=list)          # (bucket, count, dollars)
    missing_value: int = 0
    status_counts: Counter = field(default_factory=Counter)


def _sum(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) if vals else 0.0


def compute(cfg: dict, ds: Dataset) -> Aging:
    board = ds.boards.get("icf")
    icf = cfg.get("icf", {})
    if board is None:
        return Aging(False, "The ICF/HBS Project Tracker has not been pulled from monday.")
    issues: list[Issue] = []
    cols = resolve_columns(icf.get("columns", {}), board, "icf", issues)
    cid = {k: v["id"] for k, v in cols.items()}
    a = Aging(True, board_id=str(board.meta.get("id")), pulled_at=board.pulled_at, columns=cols,
              issues=issues, overdue_days=int(icf.get("rfi_overdue_days", 7)))
    if not cid.get("status"):
        a.available = False
        a.reason = "ICF tracker status column could not be resolved; see Data quality."
        return a
    loop_map = {k.strip().lower(): v for k, v in icf.get("loop", {}).items()}
    for raw in board.items:
        it = Item(raw)
        status = text_of(it, cid.get("status"))
        role = loop_map.get((status or "").strip().lower(), {})
        a.items.append(AgingItem(
            it.id, it.name, status, role.get("holder"), role.get("kind"),
            number_of(it, cid.get("days_for_response"))[0], number_of(it, cid.get("days_in_phase"))[0],
            text_of(it, cid.get("aging_bucket")), number_of(it, cid.get("value"))[0],
            text_of(it, cid.get("icf_engineer")), text_of(it, cid.get("hbs_engineer")),
            text_of(it, cid.get("program")), it.group_title))
        a.status_counts[status or "(blank)"] += 1

    a.loop = [x for x in a.items if x.holder]
    kinds = defaultdict(list)
    holders = defaultdict(list)
    people = defaultdict(list)
    for x in a.loop:
        kinds[x.kind].append(x)
        holders[x.holder].append(x)
        person = (x.hbs_engineer if x.holder == "HBS" else x.icf_engineer) or "(unassigned)"
        people[(x.holder, person)].append(x)
    a.by_kind = {k: (len(v), _sum(i.value for i in v)) for k, v in kinds.items()}
    a.by_holder = {k: (len(v), _sum(i.value for i in v)) for k, v in holders.items()}
    a.by_person = sorted(((h, p, len(v), _sum(i.value for i in v),
                           max((i.days_for_response or 0) for i in v)) for (h, p), v in people.items()),
                         key=lambda r: (r[0], -r[2]))
    rfis = [x for x in a.loop if x.kind == "RFI"]
    a.rfi_count = len(rfis)
    if cid.get("days_for_response"):
        a.rfi_overdue = sorted((x for x in rfis if (x.days_for_response or 0) > a.overdue_days),
                               key=lambda x: -(x.days_for_response or 0))
    order = {"critical": 0, "watch": 1, "ok": 2}
    bk = defaultdict(list)
    for x in a.items:
        if x.bucket:
            bk[x.bucket].append(x)
    a.buckets = sorted(((b, len(v), _sum(i.value for i in v)) for b, v in bk.items()),
                       key=lambda r: order.get(r[0].lower(), 9))
    a.missing_value = sum(1 for x in a.loop if x.value is None)
    return a
