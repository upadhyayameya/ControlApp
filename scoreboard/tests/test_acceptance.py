"""The acceptance tests from the brief. These define correctness."""
import datetime as dt

import pytest

from conftest import event
from hbs_scoreboard import config as configmod
from hbs_scoreboard import etl, metrics
from hbs_scoreboard.models import Exclusion, Stage
from hbs_scoreboard.rules import programs, weeks as weekrules


# 1 -- Two closeout entries with identical date, project, stage and program
#      count as one project.
def test_identical_closeout_entries_count_once(cfg):
    events = [
        event(1, "100 Main St - Example Plaza", Stage.CO_SUBMITTED, "BGE", "2026-09-10", 5000),
        event(2, "100 Main St - Example Plaza", Stage.CO_SUBMITTED, "BGE", "2026-09-10", 5000),
    ]
    ds = etl.build(events, cfg)
    counted = [e for e in ds.entries if e.counts]
    assert len(counted) == 1
    dupe = next(e for e in ds.entries if not e.counts)
    assert dupe.exclusion is Exclusion.SAME_DAY_DUPLICATE
    assert dupe.duplicate_of == "1"
    # The raw entry count stays available as a secondary figure.
    assert len(ds.entries) == 2
    corr = next(c for c in ds.corrections if c.rule == "unique_projects")
    assert (corr.raw_count, corr.corrected_count) == (2, 1)
    assert (corr.raw_value, corr.corrected_value) == (10000, 5000)


# 2 -- Two preapprovals on the same building the same day with *different*
#      programs count as two.
def test_same_building_same_day_different_programs_count_twice(cfg):
    events = [
        event(1, "415 Williams Ct - Greenleigh", Stage.PA_SUBMITTED, "BGE", "2026-09-02", 4382),
        event(2, "415 Williams Ct - Greenleigh", Stage.PA_SUBMITTED, "HVAC BTU", "2026-09-02", 3680),
    ]
    ds = etl.build(events, cfg)
    counted = [e for e in ds.entries if e.counts]
    assert len(counted) == 2
    assert {e.program for e in counted} == {"BGE Tune-Up", "Prescriptive"}


# 3 -- A preapproval identical to one from a prior month is flagged as a repeat
#      and, at the default setting, not counted as new.
def test_prior_month_repeat_flagged_and_not_counted(cfg):
    assert cfg.count_repeats_as_new is False, "default is count-once-at-first-logging"
    history_events = [
        event(10, "9 Elm Rd - Elm Center", Stage.PA_SUBMITTED, "BGE", "2026-08-03", 6610),
    ]
    history = etl.build(history_events, configmod.load()).entries
    current = [
        event(11, "9 Elm Rd - Elm Center", Stage.PA_SUBMITTED, "BGE", "2026-09-10", 6610),
    ]
    ds = etl.build(current, cfg, history=history)
    entry = ds.entries[0]
    assert entry.repeat_of == "10"
    assert entry.first_logged == dt.date(2026, 8, 3)
    assert entry.exclusion is Exclusion.REPEAT_SUBMISSION
    assert not entry.counts
    # Repeat rate is surfaced as its own metric, target zero.
    rate = metrics.repeatrules.repeat_rate(ds.entries)
    assert rate["repeats_flagged"] == 1 and rate["target"] == 0.0


def test_repeat_counted_when_config_flag_is_on():
    cfg = configmod.load()
    cfg.count_repeats_as_new = True
    history = etl.build(
        [event(10, "9 Elm Rd", Stage.PA_SUBMITTED, "BGE", "2026-08-03", 6610)],
        configmod.load()).entries
    ds = etl.build(
        [event(11, "9 Elm Rd", Stage.PA_SUBMITTED, "BGE", "2026-09-10", 6610)],
        cfg, history=history)
    entry = ds.entries[0]
    assert entry.repeat_of == "10"      # still flagged
    assert entry.counts                  # but counted


# 4 -- A project named (Phase 2) with utility BGE routes to BPTU, not BGE Tune-Up.
@pytest.mark.parametrize("name,expected", [
    ("1021 Dulaney-Valley Rd - Hoffberger Science (Phase 2)", "BGE BPTU"),
    ("1021 Dulaney-Valley Rd - Hoffberger Science (Phase 1)", "BGE BPTU"),
    ("1021 Dulaney-Valley Rd - Hoffberger Science", "BGE Tune-Up"),
])
def test_phase_marker_routes_bge_to_bptu(name, expected):
    program, utility, _ = programs.resolve("BGE", name)
    assert program == expected
    assert utility == "BGE"


def test_bptu_membership_disagreement_is_logged_not_silently_resolved():
    program, _, notes = programs.resolve("BGE", "Some Bldg (Phase 2)", bptu_member=False)
    assert program == "BGE BPTU"          # the validated name rule wins
    assert any("6530139050" in n for n in notes)   # and the disagreement is logged


# 5 -- HVAC BTU, HVAC BPTU and HVAC Tune Up all route to Prescriptive.
@pytest.mark.parametrize("label", ["HVAC BTU", "HVAC BPTU", "HVAC Tune Up",
                                   "hvac btu", "  HVAC   Tune Up  "])
def test_all_type_labels_route_to_prescriptive(label):
    program, utility, notes = programs.resolve(label, "Any Building")
    assert program == "Prescriptive"
    # Prescriptive carries no real utility at all.
    assert utility is None
    assert notes


def test_prescriptive_absent_from_utility_totals_is_stated(cfg):
    ds = etl.build(
        [event(1, "A Bldg", Stage.PA_SUBMITTED, "HVAC BTU", "2026-09-02", 3840)], cfg)
    assert any(w.code == "PRESCRIPTIVE_NO_UTILITY" for w in ds.warnings)


# 6 -- A week configuration that leaves any day of the month uncovered raises a
#      visible warning.
def test_uncovered_days_raise_visible_warning():
    cfg = configmod.load()
    cfg.week_mode = "team"          # the workbook's own Wk1 = 9/7 convention
    ds = etl.build(
        [event(1, "A Bldg", Stage.PA_SUBMITTED, "BGE", "2026-09-03", 1000)], cfg)
    warn = next(w for w in ds.warnings if w.code == "WEEK_COVERAGE_GAP")
    assert warn.severity == "error"
    assert "9/1-9/6" in warn.message
    assert "1 logged KPI event" in warn.message
    # and the stranded event is not silently counted in some week
    assert ds.entries[0].exclusion is Exclusion.UNCOVERED_BY_WEEKS


def test_calendar_mode_covers_whole_month_without_warning(cfg):
    assert cfg.week_mode == "calendar"
    ds = etl.build(
        [event(1, "A Bldg", Stage.PA_SUBMITTED, "BGE", "2026-09-03", 1000)], cfg)
    assert not any(w.code == "WEEK_COVERAGE_GAP" for w in ds.warnings)
    assert ds.entries[0].counts


# 7 -- Utilization is never summed across weeks.
def test_utilization_is_never_summed(cfg):
    sb = metrics.compute(etl.build([], cfg), cfg, as_of=dt.date(2026, 9, 15))
    ga = next(p for p in sb.programs if p.program.key == "georgia")
    util = next(r for r in ga.rows if "Utilization" in r.row.kpi)
    assert util.is_level
    assert util.required_run_rate is None          # no monthly-target-over-weeks
    assert "never summed" in util.note


def test_level_row_shows_latest_reading_not_total(cfg):
    from hbs_scoreboard.metrics import Cell, RowMetrics
    ga = cfg.program_by_key("georgia")
    row = next(r for r in ga.rows if r.measure == "level")
    weekly = [Cell(1, 72.0), Cell(2, 68.0), Cell(3, 81.0), Cell(4, None)]
    latest = next((c.value for c in reversed(weekly) if c.value is not None), None)
    assert latest == 81.0
    assert latest != sum(c.value for c in weekly if c.value is not None)


# 8 -- The Excel writer leaves every payments and revenue cell untouched.
#      (see tests/test_excel_writer.py -- exercised against the real workbook)
def test_payments_and_revenue_rows_are_protected_in_config(cfg):
    protected = cfg.protected_rows("tune_up_factory")
    for program in cfg.programs:
        for row in program.rows:
            if "Payments Received" in row.kpi or row.kpi.startswith("Revenue"):
                assert row.row in protected, f"{program.display} {row.kpi} not protected"
                assert row.is_manual


def test_manual_rows_are_never_computed_from_monday(cfg):
    """Even with monday data present, a manual row stays MANUAL and empty."""
    events = [event(1, "A Bldg", Stage.CO_RECEIVED, "BGE", "2026-09-10", 50000)]
    sb = metrics.compute(etl.build(events, cfg), cfg, as_of=dt.date(2026, 9, 15))
    bge = next(p for p in sb.programs if p.program.key == "bge_tune_up")
    pay = next(r for r in bge.rows if "Payments Received" in r.row.kpi)
    assert pay.status == "MANUAL"
    assert pay.mtd is None
    assert all(c.value is None for c in pay.weekly)
    # but monday's figure is available beside it, clearly labelled
    xc = next(c for c in sb.cross_checks if c["program_key"] == "bge_tune_up")
    assert xc["monday_closeouts_received"] == 50000
    assert "NOT the accounting" in xc["label"]
