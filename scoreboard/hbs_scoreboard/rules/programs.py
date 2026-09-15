"""Rules 3 and 4 -- resolving a record to a reportable program.

The `text` (Utility) column on the Monthly KPIs board is overloaded: it mixes
real utilities with project *types*. Rule 3 maps the three type labels onto a
single Prescriptive program and records that those rows carry no real utility.
Rule 4 splits utility BGE into two separately reported programs on the
`(Phase 1)` / `(Phase 2)` marker in the project name.
"""
from __future__ import annotations

import re
from typing import Optional

# --- program constants -------------------------------------------------------
PRESCRIPTIVE = "Prescriptive"
BGE_TUNE_UP = "BGE Tune-Up"
BGE_BPTU = "BGE BPTU"
UNKNOWN = "Unmapped"

# Real utilities, normalised spelling -> canonical name.
REAL_UTILITIES = {
    "bge": "BGE",
    "pepco": "Pepco",
    "washington gas": "Washington Gas",
    "wgl": "Washington Gas",
    "delmarva": "Delmarva",
    "smeco": "SMECO",
    "ga power": "GA Power",
    "georgia power": "GA Power",
    "dominion - trc": "Dominion - TRC",
    "dominion-trc": "Dominion - TRC",
    "dominion": "Dominion - TRC",
    "potomac edison": "Potomac Edison",
    "met ed": "Met ED",
    "met-ed": "Met ED",
    "national grid": "National Grid",
}

# Project types masquerading as utilities. All three mean the same thing.
PRESCRIPTIVE_LABELS = {"hvac btu", "hvac bptu", "hvac tune up", "hvac tune-up", "hvac tuneup"}

# Phase markers that route utility BGE to the BPTU program (rule 4).
_PHASE_RE = re.compile(r"\(\s*phase\s*[12]\s*\)", re.IGNORECASE)


def normalise(raw: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (raw or "").strip()).lower()


def is_prescriptive_label(raw: Optional[str]) -> bool:
    return normalise(raw) in PRESCRIPTIVE_LABELS


def has_phase_marker(project_name: Optional[str]) -> bool:
    """True when the project name carries `(Phase 1)` or `(Phase 2)`."""
    return bool(_PHASE_RE.search(project_name or ""))


def resolve(utility_raw: Optional[str], project_name: Optional[str],
            bptu_member: Optional[bool] = None) -> tuple[str, Optional[str], list[str]]:
    """Resolve one record to (program, real_utility, notes).

    `real_utility` is None for Prescriptive: those records carry no utility at
    all, which is exactly why the dashboard must not imply the BGE line is all
    BGE work.

    `bptu_member` is the optional cross-check against membership of board
    6530139050. Disagreement with the name-based rule is reported in `notes`
    rather than silently resolved either way -- the name rule wins, because it
    was validated against the team's own hand-kept figures.
    """
    notes: list[str] = []
    key = normalise(utility_raw)

    # Rule 3: the three type labels all mean prescriptive HVAC tune-ups.
    if key in PRESCRIPTIVE_LABELS:
        notes.append(
            f"Utility field held project type {utility_raw!r}; mapped to Prescriptive. "
            "This record carries no real utility and is absent from every utility total."
        )
        return PRESCRIPTIVE, None, notes

    utility = REAL_UTILITIES.get(key)
    if utility is None:
        if not key:
            notes.append("Utility field is empty; program could not be resolved.")
        else:
            notes.append(f"Utility {utility_raw!r} is not a known utility or project type.")
        return UNKNOWN, None, notes

    # Rule 4: BGE covers two separately reported programs.
    if utility == "BGE":
        by_name = BGE_BPTU if has_phase_marker(project_name) else BGE_TUNE_UP
        if bptu_member is not None:
            by_board = BGE_BPTU if bptu_member else BGE_TUNE_UP
            if by_board != by_name:
                notes.append(
                    f"Phase-marker rule says {by_name}, but BPTU Tracker membership "
                    f"(board 6530139050) says {by_board}. Using {by_name} (the validated "
                    "rule); logged for review rather than silently picking one."
                )
        return by_name, "BGE", notes

    return utility, utility, notes
