"""Tracker boards do not share the Monthly KPIs column layout.

Reading the KPI column ids against a tracker silently produced blank utilities
(every BPTU implementation fell into `Unmapped` and vanished from the BPTU
program) and used the Project ID string as the Source. These fixtures are real
items pulled from the live boards.
"""
import datetime as dt

import pytest

from hbs_scoreboard import etl
from hbs_scoreboard import monday_client as mc
from hbs_scoreboard.models import Stage

# Real item, BGE BPTU Tracker (6530139050). Utility lives in text_mkpea39n.
BPTU_ITEM = {
    "id": "11981540887",
    "name": "800 Kenilworth Ave - The Shops at Kenilworth (Phase 2)",
    "column_values": [
        {"id": "dropdown", "text": "HBS"},
        {"id": "text_mkpea39n", "text": "BGE"},
        {"id": "date_mm0whh86", "text": "2026-09-15"},
        {"id": "numbers", "text": "87250"},
        {"id": "dup__of_incentive_amount", "text": "87250"},
    ],
}

# Real item, Master TU Tracker (1069746645). text8 is a Project ID, not Source.
MASTER_ITEM = {
    "id": "12256517516",
    "name": "7735 Old Georgetown Rd - Fairmont Building",
    "column_values": [
        {"id": "dropdown", "text": "HBS"},
        {"id": "text", "text": "Pepco"},
        {"id": "text8", "text": "PCRCVA1562891509"},
        {"id": "date_mm4b5x2", "text": "2026-09-10"},
        {"id": "dup__of_incentive_amount", "text": "2562"},
    ],
}


def test_bptu_utility_is_read_from_its_own_column():
    """Regression: reading `text` here returns nothing and the record is lost."""
    spec = mc.TRACKERS["bge_bptu"]
    ev = etl.implementation_event(BPTU_ITEM, spec)
    assert ev is not None
    assert ev.utility_raw == "BGE"          # not "" -- the whole point
    assert ev.stage is Stage.IMP_COMPLETED
    assert ev.completion_date == dt.date(2026, 9, 15)
    assert ev.hbs_share == 87250


def test_bptu_implementation_resolves_to_the_bptu_program(cfg):
    """With the utility blank this landed in Unmapped and silently disappeared."""
    ev = etl.implementation_event(BPTU_ITEM, mc.TRACKERS["bge_bptu"])
    ds = etl.build([ev], cfg)
    entry = ds.entries[0]
    assert entry.program == "BGE BPTU"
    assert entry.counts
    assert not any(w.code == "UNMAPPED_UTILITY" for w in ds.warnings)


def test_tracker_source_is_the_dropdown_not_the_project_id():
    """Regression: `text8` on a tracker is Project ID; using it as Source fed
    a string like 'PCRCVA1562891509' into the Virginia/CGS source filter."""
    ev = etl.implementation_event(MASTER_ITEM, mc.TRACKERS["master_tu"])
    assert ev.source == "HBS"
    assert "PCRCVA" not in ev.source
    assert ev.utility_raw == "Pepco"
    assert ev.hbs_share == 2562


def test_no_tracker_reuses_the_monthly_kpis_share_column():
    """The KPI board's HBS Share id does not exist on any tracker."""
    for spec in mc.TRACKERS.values():
        assert spec.hbs_share != mc.COL_HBS_SHARE
        assert spec.source != mc.COL_SOURCE          # text8 is Project ID there
        assert spec.gross != mc.COL_GROSS_INCENTIVE  # numbers_2 is KPI-board only


def test_prescriptive_tracker_uses_numbers_for_share():
    """This board names HBS Share `numbers`, not dup__of_incentive_amount."""
    spec = mc.TRACKERS["prescriptive"]
    assert spec.hbs_share == "numbers"
    assert spec.impl_date is None          # carries no Implementation Date column
    assert spec not in mc.IMPLEMENTATION_TRACKERS


def test_spec_columns_cover_every_field_it_reads():
    for spec in mc.IMPLEMENTATION_TRACKERS:
        cols = set(spec.columns)
        assert {spec.utility, spec.source, spec.hbs_share, spec.impl_date} <= cols


def test_implementation_event_returns_none_without_a_date():
    item = {"id": "1", "name": "x", "column_values": [
        {"id": "text_mkpea39n", "text": "BGE"}]}
    assert etl.implementation_event(item, mc.TRACKERS["bge_bptu"]) is None
