"""Pull every configured board, store it, recompute, and snapshot the scoreboard.

Closed weeks are re-pulled on every run (the whole board is pulled each time): figures have
moved after weeks ended, so nothing is cached as settled.
"""
from __future__ import annotations

import logging
import os
import threading

from . import config as config_mod
from . import etl, rules, views
from .monday_client import MondayClient
from .store import Store

log = logging.getLogger(__name__)
_lock = threading.Lock()


def make_client(cfg: dict) -> MondayClient:
    m = cfg["monday"]
    return MondayClient(os.environ.get(m.get("token_env", "MONDAY_API_KEY"), ""), m["api_url"],
                        m["api_version"], m.get("page_size", 500))


def snapshot_payload(board: views.Scoreboard) -> dict:
    out = {"weeks": [w.label for w in board.weeks], "stages": {}}
    for stage, _ in rules.STAGES:
        rows = board.sections[stage] + [board.totals[stage]]
        out["stages"][stage] = {
            r.program: {"weeks": [[c.count, c.dollars, c.raw_count] for c in r.weeks],
                        "mtd": [r.mtd.count, r.mtd.dollars, r.mtd.raw_count]}
            for r in rows}
    return out


def recompute_and_snapshot(cfg: dict, store: Store, run_id: int) -> etl.Model:
    today = config_mod.today(cfg)
    model = etl.compute(cfg, store.load_dataset(), today)
    store.save_corrections(run_id, model.corrections)
    month = rules.month_of(today)
    for mode in ("incentive", "share"):
        store.save_snapshot(run_id, month, mode,
                            snapshot_payload(views.scoreboard(model, cfg, month, mode, today)))
    return model


def run_refresh(cfg: dict, store: Store, trigger: str = "manual", client: MondayClient | None = None) -> dict:
    if not _lock.acquire(blocking=False):
        return {"status": "skipped", "reason": "a refresh is already running"}
    try:
        run_id = store.start_run(trigger)
        detail: dict = {"boards": {}}
        try:
            client = client or make_client(cfg)
        except Exception as e:  # no token
            detail["error"] = str(e)
            store.finish_run(run_id, "failed", detail)
            return {"status": "failed", "run_id": run_id, **detail}
        for key in cfg["refresh"]["pull"]:
            board_id = cfg["boards"][key]
            try:
                pulled = client.fetch_board(board_id, cfg["refresh"].get("page_size", {}).get(key))
                stats = store.save_board(key, pulled["meta"], pulled["items"])
                detail["boards"][key] = {"ok": True, **stats}
                log.info("pulled %s: %s", key, stats)
            except Exception as e:
                log.exception("pull failed for %s", key)
                store.board_error(key, str(e))
                detail["boards"][key] = {"ok": False, "error": str(e)}
        ok = all(b["ok"] for b in detail["boards"].values())
        detail["requests"] = client.requests_made
        store.finish_run(run_id, "ok" if ok else "partial", detail)
        recompute_and_snapshot(cfg, store, run_id)
        return {"status": "ok" if ok else "partial", "run_id": run_id, **detail}
    finally:
        _lock.release()


def is_running() -> bool:
    return _lock.locked()
