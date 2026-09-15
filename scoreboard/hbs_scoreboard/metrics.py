"""Turning the ledger into the numbers the meeting reads.

Two rules live here:

Rule 5 -- Payments and Revenue are accounting figures entered by hand. They
are never computed from monday. Where monday has a comparable figure
(Closeouts Received) it is shown alongside, clearly labelled, as a cross-check.

Rule 7 -- Utilization %, MRR and live contract counts are levels, not weekly
flows. Never summed across weeks, never a monthly target divided by the week
count. Show the latest reading.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Optional

from .config import Config, KpiRow, Program
from .etl import Dataset
from .models import Exclusion, LedgerEntry, Stage
from .rules import repeats as repeatrules
from .rules import weeks as weekrules


@dataclass
class Cell:
    """One week's figure for one KPI row."""

    week: int
    value: Optional[float]      # None = no data, which is not zero
    raw_value: Optional[float] = None   # before corrections
    entry_count: int = 0
    unique_count: int = 0


@dataclass
class RowMetrics:
    program: Program
    row: KpiRow
    weekly: list[Cell]
    mtd: Optional[float]
    raw_mtd: Optional[float]           # uncorrected, kept visible next to mtd
    goal: Optional[float]
    pct_to_goal: Optional[float]
    pace_pct: float                    # % of month elapsed, by working days
    expected_to_date: Optional[float]
    gap: Optional[float]               # goal - mtd
    required_run_rate: Optional[float]  # per remaining week
    weeks_remaining: int
    status: str                        # GREEN | YELLOW | RED | NO DATA | SET GOAL | MANUAL
    latest: Optional[float]
    dollars: Optional[float] = None    # dollar figure beside a count row
    avg_value: Optional[float] = None  # dollars / unique count
    duplicates_removed: int = 0
    repeats_flagged: int = 0
    note: str = ""

    @property
    def is_level(self) -> bool:
        return self.row.is_level


@dataclass
class ProgramMetrics:
    program: Program
    rows: list[RowMetrics]
    note: str = ""


@dataclass
class Scoreboard:
    config: Config
    dataset: Dataset
    programs: list[ProgramMetrics]
    as_of: dt.date
    pace_pct: float
    working_days_elapsed: int
    working_days_total: int
    weeks_remaining: int
    repeat_rate: dict = field(default_factory=dict)
    cross_checks: list[dict] = field(default_factory=list)

    @property
    def warnings(self):
        return self.dataset.warnings


# --- pace --------------------------------------------------------------------
def pace(cfg: Config, as_of: dt.date) -> tuple[float, int, int]:
    """% of the month elapsed by *working days*, not calendar days."""
    total = weekrules.working_days(cfg.month_start, cfg.month_end)
    clamped = min(max(as_of, cfg.month_start), cfg.month_end)
    elapsed = weekrules.working_days(cfg.month_start, clamped)
    return ((elapsed / total) if total else 0.0), elapsed, total


def weeks_remaining(cfg: Config, as_of: dt.date) -> int:
    return sum(1 for w in cfg.weeks if w.end >= as_of)


def status_for(mtd: Optional[float], goal: Optional[float], pace_pct: float,
               cfg: Config) -> tuple[str, Optional[float]]:
    """Colour on pace-to-date, not on the latest week.

    This work batches hard -- 40+ prescriptive preapprovals can land in a
    single day -- so a latest-week rule produces false reds constantly.
    """
    if goal in (None, 0):
        return "SET GOAL", None
    if mtd is None:
        return "NO DATA", None
    expected = goal * pace_pct
    if expected <= 0:
        return ("GREEN" if mtd >= 0 else "RED"), expected
    ratio = mtd / expected
    if ratio >= cfg.green_threshold:
        return "GREEN", expected
    if ratio >= cfg.yellow_threshold:
        return "YELLOW", expected
    return "RED", expected


# --- selection ---------------------------------------------------------------
def _select(ds: Dataset, program: Program, row: KpiRow,
            include_excluded: bool = False) -> list[LedgerEntry]:
    if row.stage is None:
        return []
    out = [e for e in ds.entries
           if e.program == program.name and e.event.stage is row.stage]
    if program.source_filter:
        allowed = {s.lower() for s in program.source_filter}
        out = [e for e in out if (e.event.source or "").lower() in allowed]
    if row.phase is not None:
        marker = f"(phase {row.phase})"
        out = [e for e in out if marker in (e.event.project_name or "").lower()]
    if not include_excluded:
        out = [e for e in out if e.counts]
    return out


def _measure(entries: list[LedgerEntry], measure: str) -> Optional[float]:
    if not entries:
        return None
    if measure == "dollars":
        vals = [e.event.hbs_share for e in entries if e.event.hbs_share is not None]
        return sum(vals) if vals else None
    return float(len(entries))


# --- build -------------------------------------------------------------------
def compute(ds: Dataset, cfg: Config, as_of: Optional[dt.date] = None) -> Scoreboard:
    as_of = as_of or min(dt.date.today(), cfg.month_end)
    pace_pct, wd_elapsed, wd_total = pace(cfg, as_of)
    remaining = weeks_remaining(cfg, as_of)
    weeks = cfg.weeks

    program_metrics: list[ProgramMetrics] = []
    for program in cfg.programs:
        rows: list[RowMetrics] = []
        for row in program.rows:
            rows.append(_row_metrics(ds, cfg, program, row, weeks,
                                     pace_pct, remaining))
        note = ""
        if not program.carries_utility:
            note = ("Prescriptive is a project type, not a utility. These records carry "
                    "no utility and are absent from every utility program's totals.")
        program_metrics.append(ProgramMetrics(program, rows, note))

    sb = Scoreboard(
        config=cfg, dataset=ds, programs=program_metrics, as_of=as_of,
        pace_pct=pace_pct, working_days_elapsed=wd_elapsed,
        working_days_total=wd_total, weeks_remaining=remaining,
        repeat_rate=repeatrules.repeat_rate(ds.entries),
        cross_checks=_cross_checks(ds, cfg),
    )
    return sb


def _row_metrics(ds: Dataset, cfg: Config, program: Program, row: KpiRow,
                 weeks: list[weekrules.Week], pace_pct: float,
                 remaining: int) -> RowMetrics:
    # Rule 5: manually-owned rows are never computed from monday.
    # Rule 7 still applies to a manual row that is a level (e.g. utilization %):
    # being hand-entered does not make it summable.
    if row.is_manual:
        if "Payment" in row.kpi or "Revenue" in row.kpi:
            note = "Accounting-owned, entered by hand. Never written from monday."
        else:
            note = "Entered by hand; not available from monday."
        if row.is_level:
            note += (" Level, not a flow: never summed across weeks and never a "
                     "monthly target divided by the week count. Latest reading shown.")
        return RowMetrics(
            program=program, row=row,
            weekly=[Cell(w.index, None) for w in weeks],
            mtd=None, raw_mtd=None, goal=row.goal, pct_to_goal=None,
            pace_pct=pace_pct, expected_to_date=None, gap=None,
            required_run_rate=None, weeks_remaining=remaining,
            status="MANUAL", latest=None, note=note,
        )

    counted = _select(ds, program, row)
    everything = _select(ds, program, row, include_excluded=True)

    weekly: list[Cell] = []
    for w in weeks:
        wk_counted = [e for e in counted if e.week_index == w.index]
        wk_all = [e for e in everything if e.week_index == w.index]
        weekly.append(Cell(
            week=w.index,
            value=_measure(wk_counted, row.measure),
            raw_value=_measure(wk_all, row.measure),
            entry_count=len(wk_all),
            unique_count=len(wk_counted),
        ))

    # Rule 7: levels are never summed. Show the latest reading.
    if row.is_level:
        latest = next((c.value for c in reversed(weekly) if c.value is not None), None)
        return RowMetrics(
            program=program, row=row, weekly=weekly,
            mtd=latest, raw_mtd=latest, goal=row.goal,
            pct_to_goal=(latest / row.goal) if (latest is not None and row.goal) else None,
            pace_pct=pace_pct, expected_to_date=row.goal, gap=None,
            required_run_rate=None, weeks_remaining=remaining,
            status=("NO DATA" if latest is None else
                    ("GREEN" if (row.goal and latest >= row.goal) else
                     "SET GOAL" if not row.goal else "RED")),
            latest=latest,
            note="Level, not a flow: never summed across weeks and never a monthly "
                 "target divided by the week count. Latest reading shown.",
        )

    mtd = _measure(counted, row.measure)
    raw_mtd = _measure(everything, row.measure)
    goal = row.goal
    pct = (mtd / goal) if (mtd is not None and goal) else None
    status, expected = status_for(mtd, goal, pace_pct, cfg)
    gap = (goal - (mtd or 0.0)) if goal else None
    rrr = (max(gap, 0.0) / remaining) if (gap is not None and remaining > 0) else None
    latest = next((c.value for c in reversed(weekly) if c.value is not None), None)

    dollars = _measure(counted, "dollars")
    unique = len(counted)
    avg = (dollars / unique) if (dollars is not None and unique) else None

    dupes = sum(1 for e in everything if e.exclusion is Exclusion.SAME_DAY_DUPLICATE)
    reps = sum(1 for e in everything if e.repeat_of)

    return RowMetrics(
        program=program, row=row, weekly=weekly, mtd=mtd, raw_mtd=raw_mtd,
        goal=goal, pct_to_goal=pct, pace_pct=pace_pct, expected_to_date=expected,
        gap=gap, required_run_rate=rrr, weeks_remaining=remaining, status=status,
        latest=latest, dollars=dollars, avg_value=avg,
        duplicates_removed=dupes, repeats_flagged=reps,
    )


def _cross_checks(ds: Dataset, cfg: Config) -> list[dict]:
    """Rule 5 cross-check: monday's Closeouts Received beside the hand-entered
    payments figure, clearly labelled as not the same number."""
    out: list[dict] = []
    for program in cfg.programs:
        entries = [e for e in ds.entries
                   if e.program == program.name
                   and e.event.stage is Stage.CO_RECEIVED and e.counts]
        if not entries:
            continue
        vals = [e.event.hbs_share for e in entries if e.event.hbs_share is not None]
        out.append({
            "program": program.display,
            "program_key": program.key,
            "monday_closeouts_received": sum(vals) if vals else None,
            "unique_projects": len(entries),
            "label": "monday 'Closeouts Received' — incentive cash recorded against a "
                     "project. NOT the accounting Payments Received figure.",
        })
    return out
