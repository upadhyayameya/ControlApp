"""Rule 2 -- repeat submissions across periods.

Separately from same-day duplicates, the same preapproval gets re-logged weeks
or months later with an identical project, program and value. One BGE project
was logged four times at $6,610 -- 7/20, 8/3, 8/19 and 9/10. Each re-entry
inflates that period's count and value.

Flag any submission whose (project_name, program, hbs_share) matches an
earlier submission in a *prior period*. Default: count it once, at first
logging. This is a config flag -- the business has not finally decided whether
a resubmission after an ICF/TRC RFI is new work. Whatever the setting, it is
applied to goals and actuals together (see metrics.apply_repeat_policy).

The repeat rate is surfaced as its own metric, target zero.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Iterable, Optional

from ..models import Correction, Exclusion, LedgerEntry, Stage
from .dedupe import project_key

# Stages where a re-logged record means a repeat submission.
REPEATABLE_STAGES = {Stage.PA_SUBMITTED, Stage.CO_SUBMITTED}


def period_of(d: dt.date) -> tuple[int, int]:
    return (d.year, d.month)


def repeat_key(entry: LedgerEntry) -> tuple:
    """(project, program, hbs_share) -- value is part of the key because an
    identical value is what distinguishes a re-log from genuine new work on
    the same building."""
    value = entry.event.hbs_share
    value = round(value, 2) if value is not None else None
    return (project_key(entry.event.project_name), entry.program, value)


def apply(entries: Iterable[LedgerEntry], history: Optional[Iterable[LedgerEntry]] = None,
          count_repeats: bool = False) -> list[Correction]:
    """Flag repeats in place. Returns the corrections logged.

    `history` is prior-period entries (from the local cache) used to detect a
    repeat of something first logged before the reporting month.

    `count_repeats=False` (default) excludes the repeat from the headline
    number. `True` keeps it counted but still flags it, so the repeat rate
    metric works under either setting.
    """
    first_seen: dict[tuple, tuple[dt.date, str]] = {}

    def observe(e: LedgerEntry) -> None:
        if e.event.completion_date is None or e.event.stage not in REPEATABLE_STAGES:
            return
        k = repeat_key(e)
        prior = first_seen.get(k)
        if prior is None or e.event.completion_date < prior[0]:
            first_seen[k] = (e.event.completion_date, e.event.item_id)

    for e in history or []:
        observe(e)

    current = [e for e in entries if e.event.stage in REPEATABLE_STAGES
               and e.event.completion_date is not None]
    # Earliest first, so the first logging in this month wins if there is no history.
    current.sort(key=lambda e: (e.event.completion_date, str(e.event.item_id)))

    corrections: list[Correction] = []
    by_key: dict[tuple, list[LedgerEntry]] = defaultdict(list)

    for e in current:
        k = repeat_key(e)
        prior = first_seen.get(k)
        if prior is not None and period_of(prior[0]) != period_of(e.event.completion_date):
            e.repeat_of = prior[1]
            e.first_logged = prior[0]
            by_key[k].append(e)
            if not count_repeats:
                if e.exclusion is Exclusion.NONE:
                    e.exclusion = Exclusion.REPEAT_SUBMISSION
                    e.note = (f"Identical project, program and value first logged "
                              f"{prior[0]} (item {prior[1]}); counted at first logging.")
            else:
                e.note = (f"Repeat of item {prior[1]} first logged {prior[0]}; "
                          "counted because count_repeats is on.")
        else:
            observe(e)

    for k, group in by_key.items():
        first = group[0]
        corrections.append(Correction(
            rule="repeat_submissions",
            stage=first.event.stage,
            program=first.program,
            detail=(f"{first.event.project_name!r} re-logged {len(group)} time(s) this period; "
                    f"first logged {first.first_logged}. "
                    f"{'Counted' if count_repeats else 'Not counted'} as new work."),
            item_ids=[e.event.item_id for e in group],
            raw_count=len(group),
            corrected_count=len(group) if count_repeats else 0,
            raw_value=sum(e.value for e in group),
            corrected_value=sum(e.value for e in group) if count_repeats else 0.0,
        ))
    return corrections


def repeat_rate(entries: Iterable[LedgerEntry]) -> dict:
    """Repeat rate as its own metric. Target zero."""
    considered = [e for e in entries if e.event.stage in REPEATABLE_STAGES]
    flagged = [e for e in considered if e.repeat_of]
    total = len(considered)
    return {
        "submissions_considered": total,
        "repeats_flagged": len(flagged),
        "rate": (len(flagged) / total) if total else 0.0,
        "value_flagged": sum(e.value for e in flagged),
        "target": 0.0,
    }
