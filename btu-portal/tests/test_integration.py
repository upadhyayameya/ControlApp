from __future__ import annotations

import io
from datetime import date

import openpyxl
from fastapi.testclient import TestClient

from btu import refresh
from btu.store import Store
from btu.web import create_app
from tests.helpers import cfg, kpi_item, kpi_meta

TODAY = date(2026, 11, 13)


class FakeClient:
    def __init__(self, boards, fail=()):
        self.boards, self.fail, self.requests_made = boards, set(fail), 0

    def fetch_board(self, board_id, page_size=None):
        self.requests_made += 1
        if str(board_id) in self.fail:
            raise RuntimeError("HTTP 503 from monday")
        return self.boards[str(board_id)]


def _cfg():
    c = cfg()
    c["refresh"]["pull"] = ["kpi"]
    return c


def test_refresh_stores_versions_and_snapshots_and_survives_a_failed_board(tmp_path, monkeypatch):
    monkeypatch.setenv("BTU_TODAY", TODAY.isoformat())
    store = Store(tmp_path / "t.sqlite")
    c = _cfg()
    items = [kpi_item("pa_submitted", "Bay", date(2026, 11, 3), "BGE", 6610, item_id=1)]
    r = refresh.run_refresh(c, store, "test", FakeClient({"1069742731": {"meta": kpi_meta(), "items": items}}))
    assert r["status"] == "ok"

    # The figure moves after the week closed: value corrected in monday.
    items2 = [kpi_item("pa_submitted", "Bay", date(2026, 11, 3), "BGE", 7000, item_id=1)]
    refresh.run_refresh(c, store, "test", FakeClient({"1069742731": {"meta": kpi_meta(), "items": items2}}))
    assert len(store.item_history("kpi", "1")) == 2
    snaps = store.snapshots("2026-11", "incentive")
    assert [s["stages"]["pa_submitted"]["Total"]["mtd"][1] for s in snaps] == [7000, 6610]

    # A failed pull keeps the last good data and says so.
    r = refresh.run_refresh(c, store, "test", FakeClient({}, fail={"1069742731"}))
    assert r["status"] == "partial"
    ds = store.load_dataset()
    assert ds.boards["kpi"].error and len(ds.boards["kpi"].items) == 1


def test_items_removed_from_monday_drop_out(tmp_path, monkeypatch):
    monkeypatch.setenv("BTU_TODAY", TODAY.isoformat())
    store = Store(tmp_path / "t.sqlite")
    c = _cfg()
    a = kpi_item("audits", "A", date(2026, 11, 3), "BGE", item_id=1)
    b = kpi_item("audits", "B", date(2026, 11, 3), "BGE", item_id=2)
    refresh.run_refresh(c, store, "t", FakeClient({"1069742731": {"meta": kpi_meta(), "items": [a, b]}}))
    refresh.run_refresh(c, store, "t", FakeClient({"1069742731": {"meta": kpi_meta(), "items": [a]}}))
    assert [i["id"] for i in store.load_dataset().boards["kpi"].items] == ["1"]


def test_no_token_records_a_failed_run(tmp_path, monkeypatch):
    monkeypatch.delenv("MONDAY_API_KEY", raising=False)
    store = Store(tmp_path / "t.sqlite")
    r = refresh.run_refresh(_cfg(), store, "t")
    assert r["status"] == "failed" and "MONDAY_API_KEY" in r["error"]


def test_pages_render_and_pace_colours_follow_goals(tmp_path, monkeypatch):
    monkeypatch.setenv("BTU_TODAY", TODAY.isoformat())
    store = Store(tmp_path / "t.sqlite")
    c = _cfg()
    c["goals"]["2026-11"] = {"pa_submitted": {"BGE Tune-Up": {"count": 21, "incentive": 100000}}}
    items = [kpi_item("pa_submitted", f"P{i}", date(2026, 11, 3), "BGE", 1000) for i in range(5)]
    refresh.run_refresh(c, store, "t", FakeClient({"1069742731": {"meta": kpi_meta(), "items": items}}))
    app = create_app(c, store=store, today=lambda: TODAY, start_scheduler=False)
    client = TestClient(app)
    for url in ["/", "/?dollars=share", "/pace", "/submissions", "/aging", "/quality", "/history",
                "/export", "/drill?stage=pa_submitted&program=BGE%20Tune-Up&week=1", "/item/kpi/1",
                "/api/scoreboard.json"]:
        assert client.get(url).status_code == 200, url
    html = client.get("/").text
    assert 'class="st behind"' in html          # 5 of 21 with 48% of working days gone
    assert "not recognised revenue" in html
    assert "Implementations Completed" in html and "unavailable" in html
    aging = client.get("/aging").text
    assert "Aging is unavailable" in aging


def test_web_export_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("BTU_TODAY", TODAY.isoformat())
    store = Store(tmp_path / "t.sqlite")
    c = _cfg()
    c["excel"]["rows"] = {"pa_submitted|BGE Tune-Up|count": 5, "pa_submitted|BGE Tune-Up|share": 6,
                          "co_approved|Total|incentive": 9}
    items = [kpi_item("pa_submitted", "Bay", date(2026, 11, 10), "BGE", 10000, share=5000)]
    refresh.run_refresh(c, store, "t", FakeClient({"1069742731": {"meta": kpi_meta(), "items": items}}))
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Scoreboard"
    ws["A9"] = "Payments (accounting)"
    ws["D9"] = 123
    buf = io.BytesIO()
    wb.save(buf)
    client = TestClient(create_app(c, store=store, today=lambda: TODAY, start_scheduler=False))
    r = client.post("/export?month=2026-11", data={"week": "2", "month": "2026-11"},
                    files={"workbook": ("score.xlsx", buf.getvalue())})
    assert r.status_code == 200
    out = openpyxl.load_workbook(io.BytesIO(r.content))["Scoreboard"]
    assert out["D5"].value == 1
    assert out["D6"].value == 5000               # share mapping uses share, not incentive
    assert out["D9"].value == 123                # payments row untouched
