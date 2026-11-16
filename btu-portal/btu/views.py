"""Shapes the ETL model into the pages: scoreboard, pace, submissions, drill-through, levels."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from . import rules
from .etl import Event, Model

DOLLAR_LABELS = {
    "incentive": "Incentive (total utility incentive, numbers_2)",
    "share": "HBS Share (what HBS earns, dup__of_incentive)",
}


@dataclass
class Cell:
    count: int | None
    raw_count: int
    dollars: float | None
    raw_dollars: float | None
    dollars_missing: int
    dup_excluded: int
    repeat_excluded: int
    repeats_flagged: int
    unavailable: str | None = None
    dollars_unavailable: str | None = None
    caveat: str | None = None
    future: bool = False           # week has not started: shown blank, not as a zero
    drill: dict = field(default_factory=dict)

    @property
    def corrected(self) -> bool:
        return self.count is not None and (self.raw_count != self.count)


@dataclass
class Goal:
    count: float | None
    dollars: float | None
    reason: str | None


@dataclass
class Row:
    stage: str
    program: str
    weeks: list[Cell]
    unassigned: Cell | None
    mtd: Cell
    goal: Goal
    pct_count: float | None
    pct_dollars: float | None
    status: str | None
    expected_count: float | None
    expected_dollars: float | None


@dataclass
class RepeatRate:
    stage: str
    repeats: int
    submissions: int

    @property
    def rate(self) -> float | None:
        return self.repeats / self.submissions if self.submissions else None


@dataclass
class Scoreboard:
    month: str
    dollars_mode: str
    dollars_label: str
    weeks: list[rules.Week]
    week_warnings: list[str]
    has_unassigned: bool
    pace: rules.PaceInfo
    sections: dict[str, list[Row]]
    totals: dict[str, Row]
    repeat_rate: dict[str, RepeatRate]
    prescriptive_count: int

    def row(self, stage: str, program: str) -> Row:
        if program == "Total":
            return self.totals[stage]
        return next(r for r in self.sections[stage] if r.program == program)


def _sum(vals):
    vals = [v for v in vals if v is not None]
    return sum(vals) if vals else None


def make_cell(evs: list[Event], mode: str, unavailable=None, dollars_unavailable=None, drill=None) -> Cell:
    if unavailable:
        return Cell(None, len(evs), None, None, 0, 0, 0, 0, unavailable, None, drill=drill or {})
    counted = [e for e in evs if e.counted]
    if dollars_unavailable:
        dollars = raw_dollars = None
    else:
        # Missing values are never imputed: an all-blank set stays empty, not $0.
        dollars = _sum(e.dollars(mode) for e in counted) if counted else 0.0
        raw_dollars = _sum(e.dollars(mode) for e in evs) if evs else 0.0
    return Cell(
        count=len(counted),
        raw_count=len(evs),
        dollars=dollars,
        raw_dollars=raw_dollars,
        dollars_missing=sum(1 for e in counted if e.dollars(mode) is None),
        dup_excluded=sum(1 for e in evs if e.duplicate_of),
        repeat_excluded=sum(1 for e in evs if e.repeat_of and not e.duplicate_of and not e.counted),
        repeats_flagged=sum(1 for e in evs if e.repeat_of and not e.duplicate_of),
        dollars_unavailable=dollars_unavailable,
        drill=drill or {},
    )


def goal_for(cfg, month, stage, program, mode) -> Goal:
    goals = cfg.get("goals", {})
    g = goals.get(month, {}).get(stage, {}).get(program)
    if g is None:
        return Goal(None, None, "No goal configured")
    basis = bool(goals.get("repeats_counted_as_new", False))
    policy = bool(cfg["rules"].get("count_repeats_as_new", False))
    if basis != policy:
        return Goal(None, None,
                    f"Goal hidden: goals were set on a different repeat basis "
                    f"(repeats_counted_as_new = {str(basis).lower()}) from the current counting rule "
                    f"(count_repeats_as_new = {str(policy).lower()}).")
    return Goal(g.get("count"), g.get(mode),
                None if g.get(mode) is not None else f"No {mode} goal configured")


def _pct(a, b):
    if a is None or not b:
        return None
    return a / b


def _row(cfg, model, stage, program, month, mode, weeks, evs, pace, today=None) -> Row:
    reason = model.unavailable_reason(stage, program)
    dreason = model.dollars_reason(stage, program, mode)
    base = {"stage": stage, "program": program, "month": month, "dollars": mode}
    wcells = [make_cell([e for e in evs if w.contains(e.date)], mode, reason, dreason,
                        dict(base, week=str(w.index))) for w in weeks]
    for w, c in zip(weeks, wcells):
        c.future = bool(today and w.start > today and not c.raw_count)
    orphans = [e for e in evs if not any(w.contains(e.date) for w in weeks)]
    unassigned = make_cell(orphans, mode, reason, dreason, dict(base, week="none")) if weeks else None
    mtd = make_cell(evs, mode, reason, dreason, dict(base, week="mtd"))
    goal = goal_for(cfg, month, stage, program, mode)
    watch = cfg["rules"].get("pace_watch_ratio", 0.9)
    basis = cfg["rules"].get("pace_basis", "count")
    actual, target = (mtd.count, goal.count) if basis == "count" else (mtd.dollars, goal.dollars)
    return Row(stage, program, wcells, unassigned, mtd, goal,
               _pct(mtd.count, goal.count), _pct(mtd.dollars, goal.dollars),
               rules.pace_status(actual, target, pace.fraction, watch),
               None if goal.count is None else goal.count * pace.fraction,
               None if goal.dollars is None else goal.dollars * pace.fraction)


def scoreboard(model: Model, cfg: dict, month: str, mode: str, today: date) -> Scoreboard:
    weeks, warnings = rules.month_weeks(cfg, month)
    pace = rules.pace_info(month, today, cfg["rules"].get("holidays", []))
    sections, totals, rrates = {}, {}, {}
    has_unassigned = False
    for stage, _ in rules.STAGES:
        evs = model.events_for(stage, month)
        rows = [_row(cfg, model, stage, p, month, mode, weeks, [e for e in evs if e.program == p], pace, today)
                for p in rules.ALL_ROWS]
        sections[stage] = rows
        total = _row(cfg, model, stage, "Total", month, mode, weeks, evs, pace, today)
        # A total is only as available as its parts: say what it leaves out.
        missing = [r.program for r in rows if r.mtd.unavailable]
        if missing:
            if len(missing) == len(rows):
                reasons = sorted({r.mtd.unavailable for r in rows})
                reason = "; ".join(reasons)
                blank = lambda c: make_cell([], mode, reason, drill=c.drill)
                total.weeks = [blank(c) for c in total.weeks]
                total.mtd = blank(total.mtd)
                total.unassigned = blank(total.unassigned) if total.unassigned else None
                total.status = total.pct_count = total.pct_dollars = None
            else:
                note = f"Excludes {', '.join(missing)}: source unavailable"
                for c in total.weeks + [total.mtd] + ([total.unassigned] if total.unassigned else []):
                    c.caveat = note
        totals[stage] = total
        has_unassigned |= any(r.unassigned and r.unassigned.raw_count for r in rows)
        if stage in cfg["rules"].get("repeat_stages", []):
            uniq = [e for e in evs if not e.duplicate_of]
            rrates[stage] = RepeatRate(stage, sum(1 for e in uniq if e.repeat_of), len(uniq))
    presc = sum(1 for e in model.events if e.month == month and e.utility_is_type)
    return Scoreboard(month, mode, DOLLAR_LABELS[mode], weeks, warnings, has_unassigned, pace,
                      sections, totals, rrates, presc)


# --- Pace -----------------------------------------------------------------------------------

@dataclass
class PaceRow:
    stage: str
    program: str
    mtd_count: int | None
    mtd_dollars: float | None
    goal: Goal
    expected_count: float | None
    gap_count: float | None
    gap_dollars: float | None
    weeks_remaining: int
    need_per_week_count: float | None
    need_per_week_dollars: float | None
    need_per_day_count: float | None
    run_rate_per_day: float | None
    status: str | None
    unavailable: str | None


def pace_rows(board: Scoreboard, today: date) -> list[PaceRow]:
    remaining_weeks = [w for w in board.weeks if w.end >= today]
    nweeks = len(remaining_weeks)
    days_left = len(board.pace.remaining_days)
    out = []
    for stage, _ in rules.STAGES:
        for r in board.sections[stage] + [board.totals[stage]]:
            if r.goal.count is None and r.goal.dollars is None and r.program != "Total" and not r.mtd.raw_count:
                continue
            c, dol = r.mtd.count, r.mtd.dollars
            gap_c = None if (c is None or r.expected_count is None) else c - r.expected_count
            gap_d = None if (dol is None or r.expected_dollars is None) else dol - r.expected_dollars
            left_c = None if (c is None or r.goal.count is None) else max(r.goal.count - c, 0)
            left_d = None if (dol is None or r.goal.dollars is None) else max(r.goal.dollars - dol, 0)
            out.append(PaceRow(
                stage, r.program, c, dol, r.goal, r.expected_count, gap_c, gap_d, nweeks,
                None if left_c is None or not nweeks else left_c / nweeks,
                None if left_d is None or not nweeks else left_d / nweeks,
                None if left_c is None or not days_left else left_c / days_left,
                None if c is None or not board.pace.elapsed else c / board.pace.elapsed,
                r.status, r.mtd.unavailable))
    return out


# --- Drill-through & submissions -----------------------------------------------------------

def drill_events(model: Model, cfg: dict, stage: str | None, program: str | None, month: str,
                 week: str | None) -> list[Event]:
    weeks, _ = rules.month_weeks(cfg, month)
    stages = [stage] if stage else [s for s, _ in rules.STAGES]
    evs = [e for s in stages for e in model.events_for(s, month)]
    if program and program != "Total":
        evs = [e for e in evs if e.program == program]
    if week and week not in ("mtd", ""):
        if week == "none":
            evs = [e for e in evs if not any(w.contains(e.date) for w in weeks)]
        else:
            w = next((w for w in weeks if str(w.index) == week), None)
            evs = [e for e in evs if w and w.contains(e.date)]
    return sorted(evs, key=lambda e: (e.date, e.program, e.name.lower(), e.item_id))


def week_label(weeks: list[rules.Week], d: date) -> str:
    for w in weeks:
        if w.contains(d):
            return f"Week {w.index} ({w.label})"
    return "Not in any week"


def submissions(model: Model, cfg: dict, stage: str, month: str) -> list[tuple[str, list[Event]]]:
    weeks, _ = rules.month_weeks(cfg, month)
    evs = drill_events(model, cfg, stage, None, month, None)
    groups: dict[str, list[Event]] = {}
    for w in weeks:
        groups[f"Week {w.index} ({w.label})"] = []
    for e in evs:
        groups.setdefault(week_label(weeks, e.date), []).append(e)
    return list(groups.items())


# --- Levels ---------------------------------------------------------------------------------

@dataclass
class Reading:
    metric: str
    kind: str
    date: date
    value: float
    source: str


@dataclass
class LevelRow:
    metric: str
    kind: str
    weeks: list[Reading | None]
    latest: Reading | None
    goal: float | None


def _readings(cfg) -> list[Reading]:
    out = []
    for r in cfg.get("levels", []):
        d = r["date"] if isinstance(r["date"], date) else date.fromisoformat(str(r["date"]))
        out.append(Reading(r["metric"], r.get("kind", "count"), d, float(r["value"]), r.get("source", "")))
    return sorted(out, key=lambda r: r.date)


def _as_of(readings: list[Reading], d: date, not_before: date | None = None) -> Reading | None:
    cand = [r for r in readings if r.date <= d and (not_before is None or r.date >= not_before)]
    return cand[-1] if cand else None


def level_rows(cfg: dict, month: str, weeks: list[rules.Week], today: date) -> list[LevelRow]:
    """Levels are readings: each week shows the reading as of that week's end (or today), the
    month column the latest reading. Never summed, never pro-rated."""
    first, last = rules.month_bounds(month)
    readings = _readings(cfg)
    goals = cfg.get("goals", {}).get(month, {}).get("levels", {})
    rows = []
    for metric in dict.fromkeys(r.metric for r in readings):
        rs = [r for r in readings if r.metric == metric]
        wk = []
        for w in weeks:
            if w.start > today:
                wk.append(None)
            else:
                wk.append(_as_of(rs, min(w.end, today), not_before=w.start))
        latest = _as_of(rs, min(last, today))
        rows.append(LevelRow(metric, rs[-1].kind, wk, latest, goals.get(metric)))
    return rows
