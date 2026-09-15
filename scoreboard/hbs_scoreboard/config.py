"""Typed configuration loaded from config/scoreboard.yml."""
from __future__ import annotations

import datetime as dt
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml

from .models import Stage
from .rules import weeks as weekrules

DEFAULT_CONFIG = Path(__file__).resolve().parent.parent / "config" / "scoreboard.yml"


@dataclass
class KpiRow:
    row: int                       # workbook row number
    kpi: str
    measure: str                   # count | dollars | level
    owner: str = ""
    stage: Optional[Stage] = None
    goal: Optional[float] = None
    source: str = "monday"         # monday | manual
    phase: Optional[int] = None    # BPTU phase-1/phase-2 dollar splits

    @property
    def is_manual(self) -> bool:
        return self.source == "manual"

    @property
    def is_level(self) -> bool:
        return self.measure == "level"

    @property
    def key(self) -> str:
        return f"{self.row}"


@dataclass
class Program:
    key: str
    name: str                      # canonical program name from rules.programs
    display: str
    sheet: str
    rows: list[KpiRow]
    priority: bool = False
    carries_utility: bool = True
    also_utilities: list[str] = field(default_factory=list)
    source_filter: list[str] = field(default_factory=list)

    @property
    def matches(self) -> set[str]:
        return {self.name, *self.also_utilities}


@dataclass
class Config:
    year: int
    month: int
    week_mode: str
    week_count: int
    team_starts: list[str]
    count_repeats_as_new: bool
    bptu_membership_crosscheck: bool
    status_basis: str
    yellow_threshold: float
    green_threshold: float
    week_columns: list[str]
    sheets: dict[str, str]
    programs: list[Program]
    protected: list[dict]
    path: Path

    # -- derived --------------------------------------------------------------
    @property
    def weeks(self) -> list[weekrules.Week]:
        if self.week_mode == "team":
            return weekrules.weeks_from_starts(self.year, self.month, self.team_starts)
        return weekrules.calendar_weeks(self.year, self.month, self.week_count)

    @property
    def month_start(self) -> dt.date:
        return weekrules.month_bounds(self.year, self.month)[0]

    @property
    def month_end(self) -> dt.date:
        return weekrules.month_bounds(self.year, self.month)[1]

    def program_by_name(self, name: str) -> Optional[Program]:
        for p in self.programs:
            if name in p.matches:
                return p
        return None

    def program_by_key(self, key: str) -> Optional[Program]:
        return next((p for p in self.programs if p.key == key), None)

    def protected_rows(self, sheet_key: str) -> set[int]:
        """Row numbers the Excel writer must never touch on a given sheet."""
        out: set[int] = set()
        for block in self.protected:
            if block["sheet"] == sheet_key:
                out.update(block["rows"])
        for p in self.programs:
            if p.sheet != sheet_key:
                continue
            out.update(r.row for r in p.rows if r.is_manual)
        return out


def load(path: Optional[str | Path] = None, **overrides) -> Config:
    p = Path(path or os.environ.get("HBS_SCOREBOARD_CONFIG") or DEFAULT_CONFIG)
    raw = yaml.safe_load(p.read_text())

    programs: list[Program] = []
    for pr in raw["programs"]:
        rows = []
        for r in pr["rows"]:
            stage = Stage(r["stage"]) if r.get("stage") else None
            rows.append(KpiRow(
                row=r["row"], kpi=r["kpi"], measure=r["measure"],
                owner=r.get("owner", ""), stage=stage, goal=r.get("goal"),
                source=r.get("source", "monday"), phase=r.get("phase"),
            ))
        programs.append(Program(
            key=pr["key"], name=pr["name"], display=pr["display"], sheet=pr["sheet"],
            rows=rows, priority=pr.get("priority", False),
            carries_utility=pr.get("carries_utility", True),
            also_utilities=pr.get("also_utilities", []),
            source_filter=pr.get("source_filter", []),
        ))

    cfg = Config(
        year=raw["period"]["year"],
        month=raw["period"]["month"],
        week_mode=raw["weeks"]["mode"],
        week_count=raw["weeks"]["count"],
        team_starts=raw["weeks"].get("team_starts", []),
        count_repeats_as_new=raw["rules"]["count_repeats_as_new"],
        bptu_membership_crosscheck=raw["rules"]["bptu_membership_crosscheck"],
        status_basis=raw["status"]["basis"],
        yellow_threshold=raw["status"]["yellow_threshold"],
        green_threshold=raw["status"]["green_threshold"],
        week_columns=raw["excel"]["week_columns"],
        sheets=raw["excel"]["sheets"],
        programs=programs,
        protected=raw.get("protected", []),
        path=p,
    )
    for k, v in overrides.items():
        if v is not None and hasattr(cfg, k):
            setattr(cfg, k, v)
    return cfg
