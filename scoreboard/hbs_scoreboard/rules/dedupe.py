"""Rule 1 -- unique projects, not log entries.

The Monthly KPIs board logs many closeouts twice: same project, same date,
same stage, same program, same value, two separate items. In one September
week 30 closeout entries represented 19 real projects; BGE showed 22 entries
for 12 projects.

Deduplicate on (completion_date, project_name, stage, program). Program is
part of the key on purpose: one building can legitimately carry both a BGE
building tune-up and a separate prescriptive tune-up submitted the same day,
and those are two real submissions.

Duplicates are marked, never dropped -- the raw entry count stays available
as a secondary figure so the correction is auditable.
"""
from __future__ import annotations

import re
from collections import defaultdict
from typing import Iterable

from ..models import Correction, Exclusion, LedgerEntry


def project_key(name: str) -> str:
    """Normalise a project name for matching: case, whitespace and trailing
    punctuation only. Deliberately conservative -- we do not fuzzy-match
    different buildings together."""
    return re.sub(r"\s+", " ", (name or "").strip()).strip(" -–—.").lower()


def dedupe_key(entry: LedgerEntry) -> tuple:
    return (
        entry.event.completion_date,
        project_key(entry.event.project_name),
        entry.event.stage,
        entry.program,
    )


def apply(entries: Iterable[LedgerEntry]) -> list[Correction]:
    """Mark same-day duplicates in place. Returns the corrections logged.

    The kept entry is the lowest item_id (the first logged); the rest are
    flagged SAME_DAY_DUPLICATE and point at the one that was kept.
    """
    groups: dict[tuple, list[LedgerEntry]] = defaultdict(list)
    for e in entries:
        if e.event.completion_date is None:
            continue
        groups[dedupe_key(e)].append(e)

    corrections: list[Correction] = []
    for key, group in groups.items():
        if len(group) < 2:
            continue
        group.sort(key=lambda e: (str(e.event.item_id)))
        keeper, dupes = group[0], group[1:]
        raw_value = sum(e.value for e in group)
        for d in dupes:
            # A duplicate already excluded for another reason keeps that reason.
            if d.exclusion is not Exclusion.NONE:
                continue
            d.exclusion = Exclusion.SAME_DAY_DUPLICATE
            d.duplicate_of = keeper.event.item_id
            d.note = (f"Same date, project, stage and program as item "
                      f"{keeper.event.item_id}; counted once.")
        corrections.append(Correction(
            rule="unique_projects",
            stage=keeper.event.stage,
            program=keeper.program,
            detail=(f"{len(group)} log entries for {keeper.event.project_name!r} on "
                    f"{key[0]} collapsed to 1 project."),
            item_ids=[e.event.item_id for e in group],
            raw_count=len(group),
            corrected_count=1,
            raw_value=raw_value,
            corrected_value=keeper.value,
        ))
    return corrections
