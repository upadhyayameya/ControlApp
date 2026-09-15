"""Core domain types for the HBS weekly scoreboard.

Everything downstream of the monday.com pull is expressed with these types.
A KpiEvent is one raw item on the Monthly KPIs board; a LedgerEntry is that
event plus the ETL's decision about whether it counts, and why.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class Stage(str, Enum):
    """KPI stages. Values match the Monthly KPIs board groups, except
    IMP_COMPLETED which lives on the project trackers instead."""

    AUDIT = "audits_performed"
    PA_SUBMITTED = "preapprovals_submitted"
    PA_APPROVED = "preapprovals_received"
    IMP_SCHEDULED = "implementations_scheduled"
    IMP_COMPLETED = "implementations_completed"
    CO_SUBMITTED = "closeouts_submitted"
    CO_RECEIVED = "closeouts_received"

    @property
    def label(self) -> str:
        return _STAGE_LABELS[self]

    @property
    def is_dollar_stage(self) -> bool:
        """Stages where the dollar figure is the headline number."""
        return self in (
            Stage.PA_SUBMITTED,
            Stage.PA_APPROVED,
            Stage.IMP_SCHEDULED,
            Stage.CO_SUBMITTED,
            Stage.CO_RECEIVED,
        )


_STAGE_LABELS = {
    Stage.AUDIT: "Audits Completed",
    Stage.PA_SUBMITTED: "Pre-Approvals Submitted",
    Stage.PA_APPROVED: "Pre-Approvals Approved",
    Stage.IMP_SCHEDULED: "Implementations Scheduled",
    Stage.IMP_COMPLETED: "Implementations Completed",
    Stage.CO_SUBMITTED: "Closeouts Submitted",
    Stage.CO_RECEIVED: "Closeouts Received (monday)",
}

# Monthly KPIs board group id -> stage. Verified against board 1069742731.
GROUP_TO_STAGE = {
    "group_mknza884": Stage.AUDIT,
    "new_group53745": Stage.PA_SUBMITTED,
    "new_group85910": Stage.PA_APPROVED,
    "group_mm41h4cn": Stage.IMP_SCHEDULED,
    "new_group47105": Stage.CO_SUBMITTED,
    "new_group30190": Stage.CO_RECEIVED,
}


class Exclusion(str, Enum):
    """Why an entry does not count toward the headline number."""

    NONE = "counted"
    SAME_DAY_DUPLICATE = "same_day_duplicate"
    REPEAT_SUBMISSION = "repeat_submission"
    OUTSIDE_MONTH = "outside_month"
    UNCOVERED_BY_WEEKS = "uncovered_by_weeks"
    MISSING_DATE = "missing_completion_date"


@dataclass(frozen=True)
class KpiEvent:
    """One raw item from monday. Field names mirror the board's meaning,
    not its column ids."""

    item_id: str
    project_name: str
    stage: Stage
    utility_raw: str            # `text` column, overloaded (see rules.programs)
    source: str                 # `text8` column: HBS, CGS, MDEA, ...
    completion_date: Optional[dt.date]   # `date4` -- the event date, always
    hbs_share: Optional[float]  # dup__of_incentive -- NOT numbers_2
    gross_incentive: Optional[float]     # numbers_2, kept for audit only
    engineer: str = ""
    board_id: str = ""

    @property
    def monday_url(self) -> str:
        if not (self.board_id and self.item_id):
            return ""
        return f"https://hbs-solutions-team.monday.com/boards/{self.board_id}/pulses/{self.item_id}"


@dataclass
class LedgerEntry:
    """A KpiEvent plus the ETL's verdict. Every number on the dashboard is a
    sum over ledger entries, so any figure can be traced back to raw items."""

    event: KpiEvent
    program: str                     # resolved program (rules.programs)
    utility: Optional[str]           # real utility, or None for Prescriptive
    week_index: Optional[int]        # 1-based; None if not in a configured week
    exclusion: Exclusion = Exclusion.NONE
    note: str = ""
    duplicate_of: Optional[str] = None   # item_id of the entry kept instead
    repeat_of: Optional[str] = None      # item_id of the earlier submission
    first_logged: Optional[dt.date] = None

    @property
    def counts(self) -> bool:
        return self.exclusion is Exclusion.NONE

    @property
    def value(self) -> float:
        return self.event.hbs_share or 0.0


@dataclass
class Correction:
    """A single logged correction, for the audit trail."""

    rule: str
    stage: Stage
    program: str
    detail: str
    item_ids: list[str] = field(default_factory=list)
    raw_count: int = 0
    corrected_count: int = 0
    raw_value: float = 0.0
    corrected_value: float = 0.0


@dataclass
class Warning:
    """A loud, user-visible problem. Never silently swallowed."""

    severity: str   # "error" | "warn" | "info"
    code: str
    message: str
    detail: str = ""
