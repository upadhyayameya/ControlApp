"""ETL: raw monday items -> ledger entries with every correction logged.

Order matters. Program resolution first (the dedup key needs the program),
then same-day dedup, then cross-period repeats. Week assignment last, so the
coverage warning can count events stranded in a gap.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field
from typing import Iterable, Optional

from . import monday_client as mc
from .config import Config
from .models import (GROUP_TO_STAGE, Correction, Exclusion, KpiEvent, LedgerEntry,
                     Stage, Warning)
from .rules import dedupe, programs, repeats
from .rules import weeks as weekrules

log = logging.getLogger(__name__)


@dataclass
class Dataset:
    """Everything the dashboard and the Excel writer need, plus the audit trail."""

    entries: list[LedgerEntry] = field(default_factory=list)
    corrections: list[Correction] = field(default_factory=list)
    warnings: list[Warning] = field(default_factory=list)
    pulled_at: Optional[dt.datetime] = None
    sources_ok: dict[str, bool] = field(default_factory=dict)

    @property
    def counted(self) -> list[LedgerEntry]:
        return [e for e in self.entries if e.counts]

    def for_program(self, program_name: str, stage: Optional[Stage] = None,
                    include_excluded: bool = False) -> list[LedgerEntry]:
        out = [e for e in self.entries if e.program == program_name]
        if stage is not None:
            out = [e for e in out if e.event.stage is stage]
        if not include_excluded:
            out = [e for e in out if e.counts]
        return out

    def add_warning(self, severity: str, code: str, message: str, detail: str = "") -> None:
        self.warnings.append(Warning(severity, code, message, detail))


# --- parsing -----------------------------------------------------------------
def event_from_item(item: dict, board_id: str) -> Optional[KpiEvent]:
    """Build a KpiEvent from a Monthly KPIs item. Returns None if the group is
    not a KPI stage."""
    group_id = (item.get("group") or {}).get("id", "")
    stage = GROUP_TO_STAGE.get(group_id)
    if stage is None:
        return None
    cols = mc.column_map(item)
    return KpiEvent(
        item_id=str(item["id"]),
        project_name=item.get("name", ""),
        stage=stage,
        utility_raw=cols.get(mc.COL_UTILITY, ""),
        source=cols.get(mc.COL_SOURCE, ""),
        completion_date=mc.parse_date(cols.get(mc.COL_COMPLETION_DATE)),
        hbs_share=mc.parse_number(cols.get(mc.COL_HBS_SHARE)),
        gross_incentive=mc.parse_number(cols.get(mc.COL_GROSS_INCENTIVE)),
        engineer=cols.get(mc.COL_ENGINEER, ""),
        board_id=str(board_id),
    )


def implementation_event(item: dict, spec: mc.TrackerSpec) -> Optional[KpiEvent]:
    """Implementations Completed is not on the Monthly KPIs board -- it comes
    from the Implementation Date field on the project trackers.

    Every column is read through the board's own spec. The trackers do not
    share the Monthly KPIs layout: BPTU names its utility column
    `text_mkpea39n`, `text8` is Project ID rather than Source, and Source is a
    dropdown. Reading the KPI ids here would return blank utilities and drop
    every record into `Unmapped` without a word.
    """
    cols = mc.column_map(item)
    d = mc.parse_date(cols.get(spec.impl_date)) if spec.impl_date else None
    if d is None:
        return None
    return KpiEvent(
        item_id=str(item["id"]),
        project_name=item.get("name", ""),
        stage=Stage.IMP_COMPLETED,
        utility_raw=cols.get(spec.utility, ""),
        source=cols.get(spec.source, ""),
        completion_date=d,
        hbs_share=mc.parse_number(cols.get(spec.hbs_share)),
        gross_incentive=mc.parse_number(cols.get(spec.gross)) if spec.gross else None,
        engineer=cols.get(mc.COL_ENGINEER, ""),
        board_id=str(spec.board_id),
    )


# --- pipeline ----------------------------------------------------------------
def build(events: Iterable[KpiEvent], cfg: Config,
          history: Optional[Iterable[LedgerEntry]] = None,
          bptu_names: Optional[set[str]] = None) -> Dataset:
    """Apply every counting rule to a set of raw events."""
    ds = Dataset()
    weeks = cfg.weeks
    unmapped: dict[str, int] = {}

    # 1. Resolve program (rules 3 and 4), attach week (rule 6).
    for ev in events:
        member = None
        if bptu_names is not None and programs.normalise(ev.utility_raw) == "bge":
            member = ev.project_name in bptu_names
        program, utility, notes = programs.resolve(ev.utility_raw, ev.project_name, member)

        entry = LedgerEntry(
            event=ev, program=program, utility=utility,
            week_index=weekrules.week_for(ev.completion_date, weeks),
        )
        if notes:
            entry.note = " ".join(notes)

        if ev.completion_date is None:
            entry.exclusion = Exclusion.MISSING_DATE
            entry.note = ("No Completion Date; cannot be placed in a month or week. "
                          "Left out rather than guessed.")
        elif not (cfg.month_start <= ev.completion_date <= cfg.month_end):
            entry.exclusion = Exclusion.OUTSIDE_MONTH
        elif entry.week_index is None:
            entry.exclusion = Exclusion.UNCOVERED_BY_WEEKS
            entry.note = ("Falls on a day the configured weeks do not cover. "
                          "See the week-coverage warning.")

        if program == programs.UNKNOWN:
            unmapped[ev.utility_raw or "(blank)"] = unmapped.get(ev.utility_raw or "(blank)", 0) + 1

        ds.entries.append(entry)

    # 2. Rule 1 -- unique projects, not log entries.
    in_month = [e for e in ds.entries
                if e.exclusion in (Exclusion.NONE, Exclusion.UNCOVERED_BY_WEEKS)]
    ds.corrections.extend(dedupe.apply(in_month))

    # 3. Rule 2 -- repeat submissions across periods.
    ds.corrections.extend(repeats.apply(
        in_month, history=history, count_repeats=cfg.count_repeats_as_new))

    # 4. Rule 6 -- loud warning when the weeks leave days uncovered.
    dates = [e.event.completion_date for e in ds.entries
             if e.event.completion_date is not None
             and cfg.month_start <= e.event.completion_date <= cfg.month_end]
    ds.warnings.extend(weekrules.coverage_warnings(cfg.year, cfg.month, weeks, dates))

    # 5. Rule 3 -- say so when prescriptive work is missing from utility totals.
    presc = [e for e in ds.entries if e.program == programs.PRESCRIPTIVE and e.counts]
    if presc:
        value = sum(e.value for e in presc)
        ds.add_warning(
            "info", "PRESCRIPTIVE_NO_UTILITY",
            f"{len(presc)} prescriptive record(s) (${value:,.0f}) carry no real utility.",
            "Prescriptive is a source/type, not a utility. These are absent from every "
            "utility total -- the BGE line is not all BGE work.",
        )

    if unmapped:
        detail = ", ".join(f"{k!r} x{v}" for k, v in sorted(unmapped.items()))
        ds.add_warning(
            "warn", "UNMAPPED_UTILITY",
            f"{sum(unmapped.values())} record(s) have a Utility value that maps to no "
            "known program and are excluded from every program total.",
            detail,
        )

    missing_value = [e for e in ds.counted
                     if e.event.stage.is_dollar_stage and e.event.hbs_share is None]
    if missing_value:
        ds.add_warning(
            "warn", "MISSING_HBS_SHARE",
            f"{len(missing_value)} counted record(s) at a dollar stage have no HBS Share. "
            "Their count is included; their dollars are not.",
            "An absent value is left empty, not treated as zero.",
        )

    missing_date = [e for e in ds.entries if e.exclusion is Exclusion.MISSING_DATE]
    if missing_date:
        ds.add_warning(
            "warn", "MISSING_COMPLETION_DATE",
            f"{len(missing_date)} record(s) have no Completion Date and are counted nowhere.",
            "Completion Date is the event date; creation/update timestamps are not a proxy.",
        )
    return ds


def pull(cfg: Config, client: mc.MondayClient,
         history: Optional[Iterable[LedgerEntry]] = None) -> Dataset:
    """Pull the reporting month from monday and run it through `build`.

    A source that fails is recorded in `sources_ok` and surfaced as a warning;
    it never becomes a zero.
    """
    start, end = cfg.month_start, cfg.month_end
    events: list[KpiEvent] = []
    sources_ok: dict[str, bool] = {}
    failures: list[tuple[str, Exception]] = []

    # Monthly KPIs -- the authoritative event log.
    try:
        for item in client.items_by_date_range(
                mc.BOARD_MONTHLY_KPIS, mc.COL_COMPLETION_DATE, start, end, mc.KPI_COLUMNS):
            ev = event_from_item(item, str(mc.BOARD_MONTHLY_KPIS))
            if ev is not None:
                events.append(ev)
        sources_ok["monthly_kpis"] = True
    except Exception as exc:                      # noqa: BLE001
        sources_ok["monthly_kpis"] = False
        failures.append(("Monthly KPIs", exc))

    # Implementations Completed -- from the project trackers that carry it,
    # each read through its own column spec.
    for spec in mc.IMPLEMENTATION_TRACKERS:
        try:
            cols = spec.columns + [mc.COL_ENGINEER]
            for item in client.items_by_date_range(
                    spec.board_id, spec.impl_date, start, end, cols):
                ev = implementation_event(item, spec)
                if ev is not None:
                    events.append(ev)
            sources_ok[spec.name] = True
        except Exception as exc:                  # noqa: BLE001
            sources_ok[spec.name] = False
            failures.append((spec.label, exc))

    # Optional BPTU membership cross-check (rule 4).
    bptu_names: Optional[set[str]] = None
    if cfg.bptu_membership_crosscheck:
        try:
            bptu_names = client.board_item_names(mc.BOARD_BGE_BPTU)
            sources_ok["bptu_membership"] = True
        except Exception as exc:                  # noqa: BLE001
            sources_ok["bptu_membership"] = False
            failures.append(("BPTU membership cross-check", exc))

    ds = build(events, cfg, history=history, bptu_names=bptu_names)
    ds.pulled_at = dt.datetime.now(dt.timezone.utc)
    ds.sources_ok = sources_ok

    for name, exc in failures:
        ds.add_warning(
            "error", "SOURCE_UNAVAILABLE",
            f"Source {name} could not be read; its figures are left empty, not zero.",
            str(exc)[:400],
        )
    return ds
