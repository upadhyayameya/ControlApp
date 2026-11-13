"""Business rules that don't need the data set: programs, weeks, working-day pace."""
from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from .values import norm_name

PROGRAMS = ["Prescriptive", "BGE Tune-Up", "BPTU", "Pepco/WGL", "Delmarva", "SMECO",
            "Georgia", "Virginia/CGS"]
OTHER = "Other"
UNMAPPED = "Unmapped"
ALL_ROWS = PROGRAMS + [OTHER, UNMAPPED]

STAGES = [
    ("audits", "Audits Performed"),
    ("pa_submitted", "Preapprovals Submitted"),
    ("pa_approved", "Preapprovals Approved"),
    ("impl_scheduled", "Implementations Scheduled"),
    ("impl_completed", "Implementations Completed"),
    ("co_submitted", "Closeouts Submitted"),
    ("co_approved", "Closeouts Approved"),
]
STAGE_LABEL = dict(STAGES)
STAGE_NOTES = {
    "impl_completed": "From the project trackers' implementation dates (the KPI board has no such "
                      "stage). Counted only once the date has passed and the tracker shows the work done.",
    "co_approved": "monday proxy for payments only — not recognised revenue. Payments and revenue are "
                   "accounting figures owned by the Director of Accounting.",
}


def _key(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


# Utility field values -> scoreboard program. "BGE" is split further by the Phase rule.
UTILITY_MAP = {
    "bge": "BGE",
    "pepco": "Pepco/WGL",
    "washingtongas": "Pepco/WGL",
    "delmarva": "Delmarva",
    "smeco": "SMECO",
    "gapower": "Georgia",
    "dominiontrc": "Virginia/CGS",
    "potomacedison": OTHER,
    "meted": OTHER,
    "nationalgrid": OTHER,
}
# Project types wearing a utility's clothes. All mean prescriptive HVAC tune-ups.
TYPE_LABELS = {"hvacbtu", "hvacbptu", "hvactuneup"}
PROGRAM_KEYS = {_key(p): p for p in ALL_ROWS}

PHASE_RE = re.compile(r"\(\s*phase\s*[12]\s*\)", re.I)


def has_phase_tag(name: str) -> bool:
    return bool(PHASE_RE.search(name or ""))


def base_name(name: str) -> str:
    """Building name with any (Phase n) tag removed — for matching across the two BGE programs."""
    return norm_name(PHASE_RE.sub(" ", name or ""))


def bge_split(name: str) -> str:
    return "BPTU" if has_phase_tag(name) else "BGE Tune-Up"


@dataclass
class ProgramResult:
    program: str
    basis: str                     # how it was decided, shown on drill-through
    utility_is_type: bool = False  # Utility field held a project type, not a utility
    name_rule: str | None = None   # what the Phase name rule says, for BGE records
    blank: bool = False
    unknown: bool = False


def map_program(utility: str | None, name: str, program_col: str | None = None) -> ProgramResult:
    u = _key(utility)
    name_rule = None
    if u == "bge" or _key(program_col) in ("bgetuneup", "bptu"):
        name_rule = bge_split(name)

    if program_col and _key(program_col) in PROGRAM_KEYS:
        return ProgramResult(PROGRAM_KEYS[_key(program_col)], f"Program column = {program_col!r}",
                             name_rule=name_rule)
    if not u:
        return ProgramResult(UNMAPPED, "Utility is blank", blank=True)
    if u in TYPE_LABELS:
        return ProgramResult("Prescriptive", f"Utility {utility!r} is a project type → Prescriptive",
                             utility_is_type=True)
    mapped = UTILITY_MAP.get(u)
    if mapped is None:
        return ProgramResult(UNMAPPED, f"Utility {utility!r} has no mapping", unknown=True)
    if mapped == "BGE":
        tag = "has" if name_rule == "BPTU" else "has no"
        return ProgramResult(name_rule, f"Utility BGE; name {tag} (Phase 1)/(Phase 2) tag",
                             name_rule=name_rule)
    if mapped == OTHER:
        return ProgramResult(OTHER, f"Utility {utility!r} has live work but no scoreboard row")
    return ProgramResult(mapped, f"Utility {utility!r} → {mapped}")


# --- Weeks ----------------------------------------------------------------------------------

@dataclass
class Week:
    index: int
    start: date
    end: date

    @property
    def label(self) -> str:
        return f"{self.start.month}/{self.start.day}–{self.end.month}/{self.end.day}"

    def contains(self, d: date) -> bool:
        return self.start <= d <= self.end


def month_bounds(month: str) -> tuple[date, date]:
    y, m = (int(x) for x in month.split("-"))
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def month_of(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _md(d: date) -> str:
    return f"{d.month}/{d.day}"


def _ranges(days: list[date]) -> list[tuple[date, date]]:
    out: list[tuple[date, date]] = []
    for d in days:
        if out and d - out[-1][1] == timedelta(days=1):
            out[-1] = (out[-1][0], d)
        else:
            out.append((d, d))
    return out


def validate_weeks(month: str, weeks: list[Week]) -> list[str]:
    """Loud, human-readable problems with a month's configured weeks."""
    first, last = month_bounds(month)
    problems = []
    seen: dict[date, int] = {}
    for w in weeks:
        if w.start > w.end:
            problems.append(f"Week {w.index} ends ({_md(w.end)}) before it starts ({_md(w.start)}).")
            continue
        if w.start < first or w.end > last:
            problems.append(f"Week {w.index} ({w.label}) runs outside {month}.")
        d = max(w.start, first)
        while d <= min(w.end, last):
            if d in seen:
                problems.append(f"{_md(d)} is in both week {seen[d]} and week {w.index}.")
            seen[d] = w.index
            d += timedelta(days=1)
    missing = []
    d = first
    while d <= last:
        if d not in seen:
            missing.append(d)
        d += timedelta(days=1)
    for a, b in _ranges(missing):
        span = _md(a) if a == b else f"{_md(a)}-{_md(b)}"
        problems.insert(0, f"{span} is not covered by any configured week for {month}: events "
                           f"dated then would fall out of every week column.")
    return problems


def month_weeks(cfg: dict, month: str) -> tuple[list[Week], list[str]]:
    spec = cfg.get("weeks", {}).get(month)
    if not spec:
        return [], [f"No week boundaries configured for {month}. Week columns are left empty "
                    f"(boundaries are set by the business each month and are never derived). "
                    f"Add them under [weeks] in config.toml."]
    weeks = [Week(i + 1, date.fromisoformat(a), date.fromisoformat(b)) for i, (a, b) in enumerate(spec)]
    return weeks, validate_weeks(month, weeks)


# --- Working-day pace -----------------------------------------------------------------------

@dataclass
class PaceInfo:
    month: str
    total: int
    elapsed: int
    remaining_days: list[date] = field(default_factory=list)

    @property
    def fraction(self) -> float:
        return self.elapsed / self.total if self.total else 0.0


def working_days(start: date, end: date, holidays) -> list[date]:
    hol = {date.fromisoformat(h) if isinstance(h, str) else h for h in holidays}
    out, d = [], start
    while d <= end:
        if d.weekday() < 5 and d not in hol:
            out.append(d)
        d += timedelta(days=1)
    return out


def pace_info(month: str, today: date, holidays) -> PaceInfo:
    first, last = month_bounds(month)
    days = working_days(first, last, holidays)
    elapsed = [d for d in days if d <= today]
    return PaceInfo(month, len(days), len(elapsed), [d for d in days if d > today])


def pace_status(actual, goal, fraction: float, watch_ratio: float) -> str | None:
    if actual is None or goal is None:
        return None
    expected = goal * fraction
    if expected <= 0:
        return "on_pace"
    r = actual / expected
    if r >= 1:
        return "on_pace"
    if r >= watch_ratio:
        return "watch"
    return "behind"
