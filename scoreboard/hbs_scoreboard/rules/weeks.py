"""Rule 6 -- week boundaries.

Two conventions are in play and they disagree:

  * team workbook      Wk1 = 9/7-9/13, which leaves 9/1-9/6 in no week at all
  * calendar coverage  Wk1 = 9/1-9/7 ... Wk4 = 9/22-9/30, whole month covered

Default is calendar coverage. Whichever is configured, any day of the month
that falls outside every week raises a loud warning and the events in the gap
are reported, not dropped quietly.
"""
from __future__ import annotations

import calendar
import datetime as dt
from dataclasses import dataclass
from typing import Iterable, Optional

from ..models import Warning


@dataclass(frozen=True)
class Week:
    index: int          # 1-based
    start: dt.date
    end: dt.date        # inclusive

    def contains(self, d: dt.date) -> bool:
        return self.start <= d <= self.end

    @property
    def label(self) -> str:
        return f"Wk{self.index}"

    @property
    def range_label(self) -> str:
        return f"{self.start.month}/{self.start.day}-{self.end.month}/{self.end.day}"


def month_bounds(year: int, month: int) -> tuple[dt.date, dt.date]:
    last = calendar.monthrange(year, month)[1]
    return dt.date(year, month, 1), dt.date(year, month, last)


def calendar_weeks(year: int, month: int, count: int = 4) -> list[Week]:
    """Calendar-month coverage: `count` weeks spanning the entire month.

    The first weeks are 7 days; the final week absorbs the remainder so the
    last day of the month is always covered (e.g. Sept Wk4 = 9/22-9/30).
    """
    first, last = month_bounds(year, month)
    weeks: list[Week] = []
    cursor = first
    for i in range(1, count + 1):
        if i == count:
            end = last
        else:
            end = min(cursor + dt.timedelta(days=6), last)
        weeks.append(Week(i, cursor, end))
        if end >= last:
            break
        cursor = end + dt.timedelta(days=1)
    return weeks


def weeks_from_starts(year: int, month: int, starts: Iterable[str | dt.date],
                      clamp_to_month: bool = True) -> list[Week]:
    """Explicit week starts, e.g. the team workbook's 9/7, 9/14, 9/21, 9/28.

    Each week runs until the day before the next start; the last runs 7 days
    or to month end when clamped. This reproduces the team convention exactly,
    gap and all -- the gap is then reported by `coverage_warnings`.
    """
    _, last = month_bounds(year, month)
    parsed: list[dt.date] = []
    for s in starts:
        parsed.append(s if isinstance(s, dt.date) else dt.date.fromisoformat(str(s)))
    parsed.sort()

    weeks: list[Week] = []
    for i, start in enumerate(parsed):
        if i + 1 < len(parsed):
            end = parsed[i + 1] - dt.timedelta(days=1)
        else:
            end = start + dt.timedelta(days=6)
        if clamp_to_month:
            end = min(end, last)
        weeks.append(Week(i + 1, start, end))
    return weeks


def uncovered_days(year: int, month: int, weeks: list[Week]) -> list[dt.date]:
    """Every day of the month that no configured week contains."""
    first, last = month_bounds(year, month)
    out: list[dt.date] = []
    d = first
    while d <= last:
        if not any(w.contains(d) for w in weeks):
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def week_for(d: Optional[dt.date], weeks: list[Week]) -> Optional[int]:
    if d is None:
        return None
    for w in weeks:
        if w.contains(d):
            return w.index
    return None


def coverage_warnings(year: int, month: int, weeks: list[Week],
                      event_dates: Optional[list[dt.date]] = None) -> list[Warning]:
    """Loud warning when the configured weeks leave any day uncovered, and a
    count of how many real KPI events fall in the gap."""
    warnings: list[Warning] = []
    gap = uncovered_days(year, month, weeks)
    if not gap:
        return warnings

    stranded = 0
    if event_dates:
        gapset = set(gap)
        stranded = sum(1 for d in event_dates if d in gapset)

    ranges = _compress(gap)
    msg = (f"Week configuration leaves {len(gap)} day(s) of "
           f"{calendar.month_name[month]} {year} in no week at all: {ranges}.")
    if event_dates:
        msg += f" {stranded} logged KPI event(s) fall in that gap and are NOT counted in any week."
    warnings.append(Warning(
        severity="error",
        code="WEEK_COVERAGE_GAP",
        message=msg,
        detail=("Switch week_mode to 'calendar' for whole-month coverage, or accept "
                "the gap knowingly. Goals and actuals must use the same convention."),
    ))
    return warnings


def _compress(days: list[dt.date]) -> str:
    if not days:
        return ""
    out, start, prev = [], days[0], days[0]
    for d in days[1:]:
        if (d - prev).days == 1:
            prev = d
            continue
        out.append(_span(start, prev))
        start = prev = d
    out.append(_span(start, prev))
    return ", ".join(out)


def _span(a: dt.date, b: dt.date) -> str:
    return f"{a.month}/{a.day}" if a == b else f"{a.month}/{a.day}-{b.month}/{b.day}"


def working_days(start: dt.date, end: dt.date) -> int:
    """Mon-Fri count, inclusive. Used for pace-to-date, not calendar days."""
    n, d = 0, start
    while d <= end:
        if d.weekday() < 5:
            n += 1
        d += dt.timedelta(days=1)
    return n
