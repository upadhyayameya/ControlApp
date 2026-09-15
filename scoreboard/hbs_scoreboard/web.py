"""Dashboard. Lightweight Flask app serving HTML.

Every number links to the project list behind it. Duplicates and repeats are
greyed, not hidden. Dollars sit next to every count, because a mix shift to
prescriptive dropped average preapproval value from $11,666 to $3,640 in a
month -- count alone is actively misleading.
"""
from __future__ import annotations

import datetime as dt
import logging
from pathlib import Path
from typing import Optional

from flask import Flask, abort, jsonify, render_template, request

from . import etl, metrics, store
from .config import Config, load as load_config
from .models import Exclusion, Stage
from .monday_client import MondayClient

log = logging.getLogger(__name__)


def money(v: Optional[float]) -> str:
    return "—" if v is None else f"${v:,.0f}"


def number(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"{v:,.0f}" if float(v).is_integer() else f"{v:,.1f}"


def pct(v: Optional[float]) -> str:
    return "—" if v is None else f"{v * 100:,.0f}%"


def create_app(config_path: Optional[str] = None, db_path: Optional[str] = None,
               offline: bool = False) -> Flask:
    app = Flask(__name__, template_folder="templates")
    app.config["HBS_CONFIG_PATH"] = config_path
    app.config["HBS_DB_PATH"] = db_path or str(store.DEFAULT_DB)
    app.config["HBS_OFFLINE"] = offline
    app.jinja_env.filters.update(money=money, number=number, pct=pct)

    cache: dict = {"scoreboard": None, "built_at": None}

    def build(force: bool = False) -> metrics.Scoreboard:
        cfg: Config = load_config(app.config["HBS_CONFIG_PATH"])
        fresh_enough = (cache["built_at"] and not force
                        and (dt.datetime.now() - cache["built_at"]).seconds < 300)
        if cache["scoreboard"] is not None and fresh_enough:
            return cache["scoreboard"]

        conn = store.connect(app.config["HBS_DB_PATH"])
        try:
            client = MondayClient()
            if force and client.configured and not app.config["HBS_OFFLINE"]:
                ds = etl.pull(cfg, client)
                store.save_events(conn, [e.event for e in ds.entries], ds.pulled_at)
                store.record_pull(conn, f"{cfg.year}-{cfg.month:02d}",
                                  len(ds.entries), all(ds.sources_ok.values()))
            else:
                events = store.load_events(conn, cfg.month_start, cfg.month_end)
                history = store.load_events(conn, end=cfg.month_start - dt.timedelta(days=1))
                hist_entries = etl.build(history, cfg).entries if history else None
                ds = etl.build(events, cfg, history=hist_entries)
                last = store.last_pull(conn)
                ds.pulled_at = None
                if not events:
                    ds.add_warning(
                        "error", "NO_CACHED_DATA",
                        "No cached monday data for this period — every monday-sourced "
                        "figure is empty, not zero.",
                        "Run `python -m hbs_scoreboard.cli pull` with MONDAY_API_KEY set."
                        + (f" Last pull: {last['started_at']}." if last else ""))
            sb = metrics.compute(ds, cfg)
            cache.update(scoreboard=sb, built_at=dt.datetime.now())
            return sb
        finally:
            conn.close()

    # -- routes ---------------------------------------------------------------
    @app.route("/")
    def dashboard():
        sb = build(force=request.args.get("refresh") == "1")
        return render_template("dashboard.html", sb=sb, Exclusion=Exclusion)

    @app.route("/program/<key>")
    def program(key: str):
        sb = build()
        pm = next((p for p in sb.programs if p.program.key == key), None)
        if pm is None:
            abort(404)
        return render_template("program.html", sb=sb, pm=pm)

    @app.route("/drill/<program_key>/<int:row>")
    def drill(program_key: str, row: int):
        """The project list behind one number. Duplicates and repeats are
        greyed, not hidden."""
        sb = build()
        cfg = sb.config
        prog = cfg.program_by_key(program_key)
        if prog is None:
            abort(404)
        kpi_row = next((r for r in prog.rows if r.row == row), None)
        if kpi_row is None:
            abort(404)

        entries = metrics._select(sb.dataset, prog, kpi_row, include_excluded=True)
        week = request.args.get("week", type=int)
        if week:
            entries = [e for e in entries if e.week_index == week]
        entries.sort(key=lambda e: (e.event.completion_date or dt.date.min,
                                    e.event.project_name))
        rm = next((r for r in next(p for p in sb.programs
                                   if p.program.key == program_key).rows
                   if r.row.row == row), None)
        return render_template("drill.html", sb=sb, program=prog, kpi_row=kpi_row,
                               entries=entries, week=week, rm=rm, Exclusion=Exclusion)

    @app.route("/audit")
    def audit():
        sb = build()
        return render_template("audit.html", sb=sb)

    @app.route("/api/scoreboard.json")
    def api():
        sb = build()
        return jsonify({
            "period": f"{sb.config.year}-{sb.config.month:02d}",
            "as_of": sb.as_of.isoformat(),
            "week_mode": sb.config.week_mode,
            "pace_pct": sb.pace_pct,
            "working_days": [sb.working_days_elapsed, sb.working_days_total],
            "weeks_remaining": sb.weeks_remaining,
            "repeat_rate": sb.repeat_rate,
            "warnings": [{"severity": w.severity, "code": w.code,
                          "message": w.message, "detail": w.detail}
                         for w in sb.warnings],
            "cross_checks": sb.cross_checks,
            "programs": [{
                "key": pm.program.key,
                "display": pm.program.display,
                "carries_utility": pm.program.carries_utility,
                "rows": [{
                    "row": rm.row.row, "kpi": rm.row.kpi, "owner": rm.row.owner,
                    "measure": rm.row.measure, "source": rm.row.source,
                    "goal": rm.goal, "mtd": rm.mtd, "raw_mtd": rm.raw_mtd,
                    "dollars": rm.dollars, "avg_value": rm.avg_value,
                    "pct_to_goal": rm.pct_to_goal, "pace_pct": rm.pace_pct,
                    "expected_to_date": rm.expected_to_date, "gap": rm.gap,
                    "required_run_rate": rm.required_run_rate, "status": rm.status,
                    "duplicates_removed": rm.duplicates_removed,
                    "repeats_flagged": rm.repeats_flagged,
                    "weekly": [{"week": c.week, "value": c.value,
                                "raw_value": c.raw_value,
                                "entries": c.entry_count, "unique": c.unique_count}
                               for c in rm.weekly],
                } for rm in pm.rows],
            } for pm in sb.programs],
        })

    @app.route("/healthz")
    def healthz():
        return {"ok": True}

    return app
