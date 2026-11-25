"""FastAPI app: server-rendered pages over the cached monday data."""
from __future__ import annotations

import logging
import os
import tempfile
import threading
from datetime import date
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import aging as aging_mod
from . import config as config_mod
from . import etl, quality, refresh, rules, views
from .excel_export import ExportError, export_week
from .store import Store

log = logging.getLogger(__name__)
HERE = Path(__file__).resolve().parent


def money(v):
    if v is None:
        return "—"
    return f"-${abs(v):,.0f}" if v < 0 else f"${v:,.0f}"


def num(v, digits=0):
    if v is None:
        return "—"
    return f"{v:,.{digits}f}"


def pct(v):
    return "—" if v is None else f"{v * 100:.0f}%"


class Portal:
    """Holds config, data source and a computed-model cache."""

    def __init__(self, cfg: dict | None, store: Store | None, dataset_loader: Callable | None,
                 today: Callable[[], date] | None):
        self._fixed_cfg = cfg
        self._cfg = cfg
        self._cfg_mtime = None
        self.store = store
        self.dataset_loader = dataset_loader or (store.load_dataset if store else None)
        self._today = today
        self._cache: dict = {}
        self._lock = threading.Lock()

    @property
    def cfg(self) -> dict:
        if self._fixed_cfg is not None:
            return self._fixed_cfg
        path = os.environ.get("BTU_CONFIG") or config_mod.DEFAULT_CONFIG
        mtime = os.path.getmtime(path)
        if mtime != self._cfg_mtime:
            self._cfg = config_mod.load_config(path)
            self._cfg_mtime = mtime
            self._cache.clear()
        return self._cfg

    def today(self) -> date:
        return self._today() if self._today else config_mod.today(self.cfg)

    def model(self) -> etl.Model:
        cfg, today = self.cfg, self.today()
        run = self.store.latest_run() if self.store else None
        key = (run["id"] if run else None, today, self._cfg_mtime)
        with self._lock:
            if self.store and key in self._cache:
                return self._cache[key]
            ds = self.dataset_loader() if self.dataset_loader else etl.Dataset({})
            m = etl.compute(cfg, ds, today)
            self._cache = {key: m}
            return m


def create_app(cfg: dict | None = None, store: Store | None = None,
               dataset_loader: Callable | None = None, today: Callable[[], date] | None = None,
               start_scheduler: bool = True) -> FastAPI:
    if store is None and dataset_loader is None:
        store = Store(config_mod.db_path())
    portal = Portal(cfg, store, dataset_loader, today)
    app = FastAPI(title="HBS BTU Scoreboard")
    app.state.portal = portal
    app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
    templates = Jinja2Templates(directory=HERE / "templates")
    env = templates.env
    env.filters.update(money=money, num=num, pct=pct, qs=lambda d: urlencode(d))
    env.globals.update(STAGES=rules.STAGES, STAGE_LABEL=rules.STAGE_LABEL, STAGE_NOTES=rules.STAGE_NOTES,
                       DOLLAR_LABELS=views.DOLLAR_LABELS)

    def item_url(board_id, item_id):
        return portal.cfg["monday"]["item_url"].format(board_id=board_id, item_id=item_id)

    env.globals["item_url"] = item_url

    def params(request: Request):
        cfg = portal.cfg
        t = portal.today()
        month = request.query_params.get("month") or rules.month_of(t)
        try:
            rules.month_bounds(month)
        except ValueError:
            month = rules.month_of(t)
        dollars = request.query_params.get("dollars") or cfg["rules"].get("default_dollars", "incentive")
        if dollars not in ("incentive", "share"):
            dollars = "incentive"
        return cfg, t, month, dollars

    def render(request: Request, name: str, **ctx):
        cfg, t, month, dollars = params(request)
        model = ctx.get("model") or portal.model()
        ds = model.dataset
        months = sorted(set(cfg.get("weeks", {})) | {rules.month_of(t), month}, reverse=True)
        _, week_warnings = rules.month_weeks(cfg, month)
        base = dict(request=request, cfg=cfg, today=t, month=month, dollars=dollars, months=months,
                    demo=ds.demo, refreshed_at=ds.refreshed_at, boards=ds.boards,
                    refreshing=refresh.is_running(), week_warnings=week_warnings,
                    refresh_errors=[i for i in model.issues if i.kind == "refresh_error"],
                    path=request.url.path,
                    has_token=bool(os.environ.get(cfg["monday"].get("token_env", "MONDAY_API_KEY"))),
                    repeats_policy=cfg["rules"].get("count_repeats_as_new", False))
        base.update(ctx)
        return templates.TemplateResponse(request, name, base)

    @app.get("/", response_class=HTMLResponse)
    def scoreboard_page(request: Request):
        cfg, t, month, dollars = params(request)
        model = portal.model()
        board = views.scoreboard(model, cfg, month, dollars, t)
        levels = views.level_rows(cfg, month, board.weeks, t)
        return render(request, "scoreboard.html", model=model, board=board, levels=levels)

    @app.get("/pace", response_class=HTMLResponse)
    def pace_page(request: Request):
        cfg, t, month, dollars = params(request)
        model = portal.model()
        board = views.scoreboard(model, cfg, month, dollars, t)
        return render(request, "pace.html", model=model, board=board, rows=views.pace_rows(board, t))

    @app.get("/submissions", response_class=HTMLResponse)
    def submissions_page(request: Request, stage: str = "pa_submitted"):
        cfg, t, month, dollars = params(request)
        if stage not in rules.STAGE_LABEL:
            stage = "pa_submitted"
        model = portal.model()
        groups = views.submissions(model, cfg, stage, month)
        return render(request, "submissions.html", model=model, stage=stage, groups=groups)

    @app.get("/drill", response_class=HTMLResponse)
    def drill_page(request: Request, stage: str = "", program: str = "", week: str = "mtd"):
        cfg, t, month, dollars = params(request)
        model = portal.model()
        evs = views.drill_events(model, cfg, stage or None, program or None, month, week)
        weeks, _ = rules.month_weeks(cfg, month)
        wl = {"mtd": "Month to date", "none": "Not in any week"}.get(week)
        if wl is None:
            w = next((w for w in weeks if str(w.index) == week), None)
            wl = f"Week {w.index} ({w.label})" if w else week
        reason = model.unavailable_reason(stage, program) if stage else None
        return render(request, "drill.html", model=model, events=evs, stage=stage, program=program,
                      week_label=wl, weeks=weeks, reason=reason,
                      corrections={(c.board_id, c.item_id): c for c in model.corrections
                                   if c.rule in ("duplicate", "repeat")},
                      week_of=lambda d: views.week_label(weeks, d))

    @app.get("/aging", response_class=HTMLResponse)
    def aging_page(request: Request):
        model = portal.model()
        return render(request, "aging.html", model=model, a=aging_mod.compute(portal.cfg, model.dataset))

    @app.get("/quality", response_class=HTMLResponse)
    def quality_page(request: Request):
        cfg, t, month, dollars = params(request)
        model = portal.model()
        q = quality.compute(cfg, model, month, t)
        a = aging_mod.compute(cfg, model.dataset)
        return render(request, "quality.html", model=model, q=q, aging_columns=a.columns,
                      aging_issues=a.issues)

    @app.get("/history", response_class=HTMLResponse)
    def history_page(request: Request, stage: str = "pa_submitted"):
        cfg, t, month, dollars = params(request)
        snaps = portal.store.snapshots(month, dollars) if portal.store else []
        runs = portal.store.runs(30) if portal.store else []
        return render(request, "history.html", snaps=snaps, runs=runs, stage=stage)

    @app.get("/item/{board_key}/{item_id}", response_class=HTMLResponse)
    def item_page(request: Request, board_key: str, item_id: str):
        hist = portal.store.item_history(board_key, item_id) if portal.store else []
        model = portal.model()
        evs = [e for e in model.events if e.board_key == board_key and e.item_id == item_id]
        corr = [c for c in model.corrections if c.item_id == item_id]
        return render(request, "item.html", model=model, board_key=board_key, item_id=item_id,
                      history=hist, events=evs, corr=corr)

    @app.post("/refresh")
    def refresh_now(request: Request):
        if portal.store is None:
            return RedirectResponse("/", status_code=303)
        cfg = portal.cfg
        threading.Thread(target=refresh.run_refresh, args=(cfg, portal.store, "manual"), daemon=True).start()
        return RedirectResponse(request.headers.get("referer") or "/", status_code=303)

    @app.get("/export", response_class=HTMLResponse)
    def export_form(request: Request):
        return render(request, "export.html", report=None, error=None)

    @app.post("/export")
    async def export_run(request: Request, workbook: UploadFile = File(...), week: int = Form(...)):
        cfg, t, month, dollars = params(request)
        form = await request.form()
        month = str(form.get("month") or month)
        model = portal.model()
        inc = views.scoreboard(model, cfg, month, "incentive", t)
        shr = views.scoreboard(model, cfg, month, "share", t)
        tmpdir = Path(tempfile.mkdtemp(prefix="btu-export-"))
        src = tmpdir / Path(workbook.filename or "scoreboard.xlsx").name
        src.write_bytes(await workbook.read())
        dst = tmpdir / f"{src.stem} - week {week} {month}{src.suffix}"
        try:
            report = export_week(src, dst, cfg, inc, week, board_other_mode=shr)
        except (ExportError, Exception) as e:  # bad file, missing sheet …
            return render(request, "export.html", report=None, error=str(e))
        if form.get("preview"):
            return render(request, "export.html", report=report, error=None)
        return FileResponse(dst, filename=dst.name,
                            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    @app.get("/api/scoreboard.json")
    def scoreboard_json(request: Request):
        cfg, t, month, dollars = params(request)
        board = views.scoreboard(portal.model(), cfg, month, dollars, t)
        return JSONResponse({"month": month, "dollars": dollars, "refreshed_at": portal.model().dataset.refreshed_at,
                             **refresh.snapshot_payload(board)})

    if start_scheduler and store is not None:
        from .scheduler import start
        start(portal, store)
    return app
