"""Data-quality page: every correction and every reason a number might be wrong."""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date

from . import rules
from .etl import Model


@dataclass
class Capacity:
    items_count: int | None
    limit: int
    monthly_rate: float | None
    months_left: float | None


@dataclass
class Quality:
    capacity: Capacity
    week_warnings: dict[str, list[str]]
    duplicates: list[list]          # groups of events, canonical first
    raw_vs_unique: dict[str, tuple[int, int]]
    repeats: list
    issues_by_kind: dict[str, list]
    corrections: Counter
    columns: dict
    month: str
    refresh_errors: list = field(default_factory=list)


def capacity(cfg: dict, model: Model, today: date) -> Capacity:
    limit = int(cfg["monday"].get("board_item_limit", 10000))
    board = model.dataset.boards.get("kpi")
    if board is None:
        return Capacity(None, limit, None, None)
    count = board.meta.get("items_count")
    if count is None:
        count = len(board.items)
    # Growth rate from items per completed month (by Completion Date) over the last 3 months.
    per_month = Counter(e.month for e in model.events if e.board_key == "kpi")
    months, y, m = [], today.year, today.month
    for _ in range(3):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        months.append(f"{y:04d}-{m:02d}")
    rates = [per_month[mo] for mo in months if per_month.get(mo)]
    rate = sum(rates) / len(rates) if rates else None
    left = (limit - count) / rate if rate else None
    return Capacity(count, limit, rate, left)


def compute(cfg: dict, model: Model, month: str, today: date) -> Quality:
    week_warnings = {}
    for mo in sorted(set(cfg.get("weeks", {})) | {month}):
        _, w = rules.month_weeks(cfg, mo)
        if w:
            week_warnings[mo] = w
    dup_groups = defaultdict(list)
    for e in model.events:
        if e.month == month and e.dup_group_size > 1:
            key = e.duplicate_of or e.item_id
            dup_groups[key].append(e)
    duplicates = sorted((sorted(g, key=lambda e: e.duplicate_of is not None) for g in dup_groups.values()),
                        key=lambda g: (g[0].stage, g[0].date))
    raw_vs_unique = {}
    for stage, _ in rules.STAGES:
        evs = model.events_for(stage, month)
        raw_vs_unique[stage] = (len(evs), sum(1 for e in evs if not e.duplicate_of))
    repeats = sorted((e for e in model.events if e.repeat_of and not e.duplicate_of and e.month == month),
                     key=lambda e: e.date)
    by_kind = defaultdict(list)
    for i in model.issues:
        by_kind[i.kind].append(i)
    return Quality(capacity(cfg, model, today), week_warnings, duplicates, raw_vs_unique, repeats,
                   dict(by_kind), Counter(c.rule for c in model.corrections), model.columns, month,
                   by_kind.get("refresh_error", []))
