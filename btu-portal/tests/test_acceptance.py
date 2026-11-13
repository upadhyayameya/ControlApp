"""The acceptance tests from the brief, one per bullet, plus the rules they lean on."""
from __future__ import annotations

from datetime import date

import openpyxl
import pytest

from btu import etl, rules, views
from btu.excel_export import ExportError, export_week
from tests.helpers import GROUP_IDS, cfg, dataset, kpi_item

TODAY = date(2026, 11, 13)


def counted(model, stage):
    return [e for e in model.events if e.stage == stage and e.counted]


# --- 1. Duplicates --------------------------------------------------------------------------

def test_two_identical_closeouts_count_as_one_project():
    items = [
        kpi_item("co_submitted", "Acme Tower", date(2026, 11, 4), "BGE", 12000, item_id=1),
        kpi_item("co_submitted", "Acme Tower", date(2026, 11, 4), "BGE", 12000, item_id=2),
    ]
    model = etl.compute(cfg(), dataset(items), TODAY)
    assert len(counted(model, "co_submitted")) == 1
    board = views.scoreboard(model, cfg(), "2026-11", "incentive", TODAY)
    cell = board.row("co_submitted", "BGE Tune-Up").mtd
    assert cell.count == 1
    assert cell.raw_count == 2          # original stays visible
    assert cell.dup_excluded == 1
    assert cell.dollars == 12000        # not 24000
    dup = next(e for e in model.events if e.item_id == "2")
    assert dup.duplicate_of == "1"
    assert any(c.rule == "duplicate" and c.item_id == "2" for c in model.corrections)


def test_same_building_same_day_different_programs_count_as_two():
    items = [
        kpi_item("pa_submitted", "Harbor Plaza", date(2026, 11, 5), "BGE", 8000),
        kpi_item("pa_submitted", "Harbor Plaza", date(2026, 11, 5), "HVAC Tune Up", 1500),
    ]
    model = etl.compute(cfg(), dataset(items), TODAY)
    evs = counted(model, "pa_submitted")
    assert len(evs) == 2
    assert {e.program for e in evs} == {"BGE Tune-Up", "Prescriptive"}


def test_dedup_key_is_case_and_whitespace_insensitive_on_name():
    items = [
        kpi_item("co_submitted", "Acme  Tower", date(2026, 11, 4), "BGE", 100),
        kpi_item("co_submitted", "acme tower", date(2026, 11, 4), "BGE", 100),
    ]
    model = etl.compute(cfg(), dataset(items), TODAY)
    assert len(counted(model, "co_submitted")) == 1


def test_duplicates_with_conflicting_values_are_flagged():
    items = [
        kpi_item("co_submitted", "Acme Tower", date(2026, 11, 4), "BGE", 100, item_id=11),
        kpi_item("co_submitted", "Acme Tower", date(2026, 11, 4), "BGE", 250, item_id=12),
    ]
    model = etl.compute(cfg(), dataset(items), TODAY)
    assert any(i.kind == "duplicate_value_conflict" for i in model.issues)


# --- 2. Repeats -----------------------------------------------------------------------------

def _repeat_items():
    return [
        kpi_item("pa_submitted", "Bay Office", date(2026, 10, 7), "BGE", 6610, item_id=21),
        kpi_item("pa_submitted", "Bay Office", date(2026, 11, 3), "BGE", 6610, item_id=22),
    ]


def test_preapproval_identical_to_prior_month_is_a_repeat_not_counted_by_default():
    model = etl.compute(cfg(), dataset(_repeat_items()), TODAY)
    rep = next(e for e in model.events if e.item_id == "22")
    assert rep.repeat_of == "21"
    assert rep.repeat_first_date == date(2026, 10, 7)
    assert not rep.counted
    board = views.scoreboard(model, cfg(), "2026-11", "incentive", TODAY)
    cell = board.row("pa_submitted", "BGE Tune-Up").mtd
    assert cell.count == 0
    assert cell.raw_count == 1
    assert cell.repeat_excluded == 1
    # October's first logging still counts in October.
    oct_board = views.scoreboard(model, cfg(), "2026-10", "incentive", TODAY)
    assert oct_board.row("pa_submitted", "BGE Tune-Up").mtd.count == 1
    assert board.repeat_rate["pa_submitted"].repeats == 1


def test_repeat_policy_flag_counts_repeats_and_is_applied_to_goals_too():
    c = cfg(count_repeats_as_new=True)
    c["goals"]["2026-11"] = {"pa_submitted": {"BGE Tune-Up": {"count": 4, "incentive": 20000}}}
    model = etl.compute(c, dataset(_repeat_items()), TODAY)
    rep = next(e for e in model.events if e.item_id == "22")
    assert rep.repeat_of == "21" and rep.counted       # still flagged, now counted
    row = views.scoreboard(model, c, "2026-11", "incentive", TODAY).row("pa_submitted", "BGE Tune-Up")
    assert row.mtd.count == 1
    # Goals were declared on the "repeats not counted" basis -> must not be compared.
    assert row.goal.count is None and "basis" in row.goal.reason
    c["goals"]["repeats_counted_as_new"] = True
    row = views.scoreboard(model, c, "2026-11", "incentive", TODAY).row("pa_submitted", "BGE Tune-Up")
    assert row.goal.count == 4


def test_different_incentive_is_not_a_repeat():
    items = [
        kpi_item("pa_submitted", "Bay Office", date(2026, 10, 7), "BGE", 6610),
        kpi_item("pa_submitted", "Bay Office", date(2026, 11, 3), "BGE", 7100),
    ]
    model = etl.compute(cfg(), dataset(items), TODAY)
    assert all(e.repeat_of is None for e in model.events)


# --- 3. Programs ----------------------------------------------------------------------------

def test_phase_2_with_utility_bge_routes_to_bptu():
    assert rules.map_program("BGE", "Riverside Hall (Phase 2)").program == "BPTU"
    assert rules.map_program("BGE", "Riverside Hall (phase 1)").program == "BPTU"
    assert rules.map_program("BGE", "Riverside Hall").program == "BGE Tune-Up"


@pytest.mark.parametrize("label", ["HVAC BTU", "HVAC BPTU", "HVAC Tune Up", "hvac tune-up"])
def test_hvac_type_labels_route_to_prescriptive(label):
    r = rules.map_program(label, "Some RTU job (Phase 1)")
    assert r.program == "Prescriptive"
    assert r.utility_is_type


@pytest.mark.parametrize("utility", ["Potomac Edison", "Met ED", "National Grid"])
def test_utilities_without_a_row_land_in_other(utility):
    assert rules.map_program(utility, "X").program == "Other"
    model = etl.compute(cfg(), dataset([kpi_item("audits", "X", date(2026, 11, 2), utility, 10)]), TODAY)
    board = views.scoreboard(model, cfg(), "2026-11", "incentive", TODAY)
    assert board.row("audits", "Other").mtd.count == 1


@pytest.mark.parametrize("utility,program", [
    ("Pepco", "Pepco/WGL"), ("Washington Gas", "Pepco/WGL"), ("GA Power", "Georgia"),
    ("Dominion - TRC", "Virginia/CGS"), ("Delmarva", "Delmarva"), ("SMECO", "SMECO"),
])
def test_utility_mapping(utility, program):
    assert rules.map_program(utility, "X").program == program


def test_blank_and_unknown_utility_are_kept_visible():
    items = [kpi_item("audits", "Blank One", date(2026, 11, 2), ""),
             kpi_item("audits", "Odd One", date(2026, 11, 2), "Duke Energy")]
    model = etl.compute(cfg(), dataset(items), TODAY)
    assert {e.program for e in model.events} == {"Unmapped"}
    kinds = {i.kind for i in model.issues}
    assert "blank_utility" in kinds and "unknown_utility" in kinds


def test_program_column_preferred_when_configured():
    c = cfg()
    c["kpi"]["columns"]["program"] = {"id": "program_col"}
    it = kpi_item("audits", "Riverside Hall", date(2026, 11, 2), "BGE")
    it["column_values"].append({"id": "program_col", "type": "status", "text": "BPTU", "value": None})
    ds = dataset([it])
    ds.boards["kpi"].meta["columns"].append({"id": "program_col", "title": "Program", "type": "status"})
    model = etl.compute(c, ds, TODAY)
    assert model.events[0].program == "BPTU"
    assert any(i.kind == "phase_rule_disagreement" for i in model.issues)


def test_phase_rule_disagreement_with_bptu_board_is_logged():
    items = [
        kpi_item("audits", "Elm Court (Phase 1)", date(2026, 11, 2), "BGE"),
        kpi_item("audits", "Elm Court", date(2026, 11, 9), "BGE"),        # same building, no tag
        kpi_item("audits", "Oak Annex (Phase 2)", date(2026, 11, 9), "BGE"),  # tagged, not on board
    ]
    model = etl.compute(cfg(), dataset(items, bptu_names=["Elm Court (Phase 1)"]), TODAY)
    flagged = {i.items[0].name for i in model.issues if i.kind == "phase_rule_disagreement"}
    assert flagged == {"Elm Court", "Oak Annex (Phase 2)"}


# --- 4. Weeks -------------------------------------------------------------------------------

def test_week_config_leaving_a_day_uncovered_raises_a_visible_warning():
    weeks = [rules.Week(1, date(2026, 9, 7), date(2026, 9, 13)),
             rules.Week(2, date(2026, 9, 14), date(2026, 9, 20)),
             rules.Week(3, date(2026, 9, 21), date(2026, 9, 30))]
    warnings = rules.validate_weeks("2026-09", weeks)
    assert any("9/1" in w and "9/6" in w for w in warnings)


def test_uncovered_day_warning_and_orphan_events_show_on_the_page():
    from fastapi.testclient import TestClient
    from btu.web import create_app

    c = cfg()
    c["weeks"]["2026-09"] = c["weeks"]["2026-09"][1:]   # orphan 9/1-9/6, as once happened
    items = [kpi_item("audits", "Early Bird", date(2026, 9, 3), "BGE", 10)]
    app = create_app(c, dataset_loader=lambda: dataset(items), today=lambda: TODAY,
                     start_scheduler=False)
    html = TestClient(app).get("/?month=2026-09").text
    assert "not covered by any configured week" in html
    assert "Not in any week" in html


def test_configured_weeks_cover_their_months():
    c = cfg()
    for month in c["weeks"]:
        weeks, warnings = rules.month_weeks(c, month)
        assert warnings == [], (month, warnings)


def test_month_without_week_config_warns_and_derives_nothing():
    weeks, warnings = rules.month_weeks(cfg(), "2027-01")
    assert weeks == [] and warnings


def test_only_events_in_the_month_count_at_the_stage_that_happened_that_month():
    items = [kpi_item("pa_submitted", "Pier 9", date(2026, 10, 28), "BGE", 500),
             kpi_item("pa_approved", "Pier 9", date(2026, 11, 6), "BGE", 500)]
    model = etl.compute(cfg(), dataset(items), TODAY)
    b = views.scoreboard(model, cfg(), "2026-11", "incentive", TODAY)
    assert b.row("pa_submitted", "BGE Tune-Up").mtd.count == 0
    assert b.row("pa_approved", "BGE Tune-Up").mtd.count == 1


# --- 5. Stage groups ------------------------------------------------------------------------

def test_stage_groups_resolve_by_id_and_survive_a_title_change():
    gid, _ = GROUP_IDS["co_approved"]
    items = [
        kpi_item("co_approved", "A", date(2026, 11, 3), "BGE", 1, group=(gid, "Closeouts Received")),
        kpi_item("co_approved", "B", date(2026, 11, 3), "BGE", 1, group=(gid, "Closeouts Paid??")),
        # Right title, unknown id: must NOT be counted as a closeout approval.
        kpi_item("co_approved", "C", date(2026, 11, 3), "BGE", 1, group=("new_group_xyz", "Closeouts Approved")),
    ]
    model = etl.compute(cfg(), dataset(items), TODAY)
    assert {e.name for e in model.events if e.stage == "co_approved"} == {"A", "B"}
    assert any(i.kind == "unmapped_group" for i in model.issues)


# --- 6. Levels ------------------------------------------------------------------------------

def test_utilization_is_never_summed_across_weeks():
    c = cfg()
    c["levels"] = [
        {"metric": "Utilization %", "kind": "percent", "date": "2026-11-07", "value": 0.70},
        {"metric": "Utilization %", "kind": "percent", "date": "2026-11-14", "value": 0.80},
        {"metric": "Utilization %", "kind": "percent", "date": "2026-11-12", "value": 0.75},
    ]
    c["goals"]["2026-11"] = {"levels": {"Utilization %": 0.85}}
    weeks, _ = rules.month_weeks(c, "2026-11")
    (row,) = views.level_rows(c, "2026-11", weeks, TODAY)
    assert [w.value if w else None for w in row.weeks] == [0.70, 0.75, None, None]
    assert row.latest.value == 0.75            # latest reading as of today, not 1.45 or 2.25
    assert row.goal == 0.85                    # not divided by the week count
    # A reading dated after "today" is not shown yet.
    assert row.latest.date == date(2026, 11, 12)


# --- 7. Implementations completed -----------------------------------------------------------

def _tracker(items):
    return etl.BoardData(
        meta={"id": "18409151061", "name": "Prescriptive Tune Up Tracker", "items_count": len(items),
              "groups": [{"id": "g_active", "title": "Active"}, {"id": "g_co", "title": "Closeout"}],
              "columns": [{"id": "date_mm0r6qv7", "title": "Tune Up Date", "type": "date"},
                          {"id": "dup__of_incentive_amount", "title": "HBS Share", "type": "numbers"},
                          {"id": "incentive_amount", "title": "Incentive Amount", "type": "numbers"},
                          {"id": "status", "title": "Status", "type": "status"}]},
        items=items, pulled_at="2026-11-13T18:30:00")


def _titem(iid, when, status, group="g_active"):
    from tests.helpers import col
    return {"id": iid, "name": f"RTU {iid}", "group": {"id": group, "title": group},
            "column_values": [col("date_mm0r6qv7", when, "date"), col("status", status, "status"),
                              col("incentive_amount", "900", "numbers"),
                              col("dup__of_incentive_amount", "450", "numbers")]}


def test_implementation_complete_needs_past_date_and_done_status():
    c = cfg()
    c["trackers"]["prescriptive"]["closeout_group_ids"] = ["g_co"]
    items = [_titem("p1", "2026-11-05", "Tune Up Complete"),
             _titem("p2", "2026-11-05", "Scheduled"),            # past, not done -> not complete
             _titem("p3", "2026-11-20", "Tune Up Complete"),     # future -> not yet
             _titem("p4", "2026-11-06", "Scheduled", group="g_co")]  # moved to closeout group
    ds = dataset([], extra={"prescriptive": _tracker(items)})
    model = etl.compute(c, ds, TODAY)
    done = {e.item_id for e in model.events if e.stage == "impl_completed"}
    assert done == {"p1", "p4"}
    stale = [i for i in model.issues if i.kind == "impl_past_not_complete"]
    assert [r.item_id for r in stale[0].items] == ["p2"]


def test_missing_tracker_leaves_cells_empty_with_reason():
    model = etl.compute(cfg(), dataset([]), TODAY)
    b = views.scoreboard(model, cfg(), "2026-11", "incentive", TODAY)
    cell = b.row("impl_completed", "Prescriptive").mtd
    assert cell.count is None and cell.unavailable


# --- 8. Excel export ------------------------------------------------------------------------

def _workbook(path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Scoreboard"
    ws["A5"] = "BGE Tune-Up PA count"
    ws["A6"] = "BGE Tune-Up PA $"
    ws["A7"] = "Total PA (formula)"
    ws["C7"] = "=SUM(C5:C5)"
    ws["A20"] = "Payments received"
    ws["C20"] = 41000
    ws["D20"] = "=C20*2"
    ws["A21"] = "Revenue recognised"
    ws["C21"] = 55500
    ws["C5"].number_format = "0"
    wb.save(path)


def test_excel_export_leaves_payments_and_revenue_untouched(tmp_path):
    src, dst = tmp_path / "in.xlsx", tmp_path / "out.xlsx"
    _workbook(src)
    c = cfg()
    c["excel"]["rows"] = {
        "pa_submitted|BGE Tune-Up|count": 5,
        "pa_submitted|BGE Tune-Up|incentive": 6,
        "pa_submitted|Total|count": 7,         # formula cell: must be skipped
        "co_approved|Total|incentive": 20,     # payments row: must be refused
        "co_approved|Total|count": 21,         # revenue row: must be refused
    }
    items = [kpi_item("pa_submitted", "Bay", date(2026, 11, 3), "BGE", 6610),
             kpi_item("co_approved", "Pier", date(2026, 11, 3), "BGE", 9999)]
    model = etl.compute(c, dataset(items), TODAY)
    board = views.scoreboard(model, c, "2026-11", "incentive", TODAY)
    report = export_week(src, dst, c, board, week_index=1)

    out = openpyxl.load_workbook(dst)["Scoreboard"]
    assert out["C5"].value == 1 and out["C5"].number_format == "0"
    assert out["C6"].value == 6610
    assert out["C7"].value == "=SUM(C5:C5)"
    assert out["C20"].value == 41000 and out["D20"].value == "=C20*2"
    assert out["C21"].value == 55500
    refused = {r.row for r in report.refused}
    assert {20, 21} <= refused
    assert any(r.row == 7 for r in report.skipped)


def test_excel_export_refuses_to_overwrite_source(tmp_path):
    src = tmp_path / "in.xlsx"
    _workbook(src)
    model = etl.compute(cfg(), dataset([]), TODAY)
    board = views.scoreboard(model, cfg(), "2026-11", "incentive", TODAY)
    with pytest.raises(ExportError):
        export_week(src, src, cfg(), board, week_index=1)


# --- 9. Dollars & pace ----------------------------------------------------------------------

def test_dollar_toggle_switches_between_incentive_and_share():
    items = [kpi_item("pa_submitted", "MDEA job", date(2026, 11, 3), "BGE", 10000, share=5000)]
    model = etl.compute(cfg(), dataset(items), TODAY)
    inc = views.scoreboard(model, cfg(), "2026-11", "incentive", TODAY)
    shr = views.scoreboard(model, cfg(), "2026-11", "share", TODAY)
    assert inc.row("pa_submitted", "BGE Tune-Up").mtd.dollars == 10000
    assert shr.row("pa_submitted", "BGE Tune-Up").mtd.dollars == 5000
    assert inc.dollars_label != shr.dollars_label


def test_missing_dollar_values_are_not_imputed():
    items = [kpi_item("pa_submitted", "A", date(2026, 11, 3), "BGE", 1000),
             kpi_item("pa_submitted", "B", date(2026, 11, 3), "BGE", None)]
    model = etl.compute(cfg(), dataset(items), TODAY)
    cell = views.scoreboard(model, cfg(), "2026-11", "incentive", TODAY).row("pa_submitted", "BGE Tune-Up").mtd
    assert cell.count == 2 and cell.dollars == 1000 and cell.dollars_missing == 1


def test_working_day_pace():
    info = rules.pace_info("2026-11", TODAY, holidays=[])
    # November 2026: 21 weekdays; Nov 2-13 inclusive = 10 weekdays.
    assert info.total == 21 and info.elapsed == 10
    assert rules.pace_status(10, 21, info.fraction, 0.9) == "on_pace"
    assert rules.pace_status(9, 21, info.fraction, 0.9) == "watch"
    assert rules.pace_status(5, 21, info.fraction, 0.9) == "behind"


def test_never_use_creation_or_update_logs_as_dates():
    # Item with no completion date but with creation/update metadata is not placed in any week.
    it = kpi_item("audits", "No Date", "", "BGE", 5)
    it["created_at"] = "2026-11-05T10:00:00Z"
    it["updated_at"] = "2026-11-06T10:00:00Z"
    model = etl.compute(cfg(), dataset([it]), TODAY)
    assert model.events == []
    assert any(i.kind == "missing_date" for i in model.issues)
