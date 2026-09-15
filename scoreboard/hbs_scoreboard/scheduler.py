"""Scheduler: pull nightly, publish every Friday 5pm ET.

Deliberately dependency-free -- a loop with a clock, so it runs anywhere a
process runs. For a managed host, the same two commands work fine as cron:

    0 2 * * *   hbs-scoreboard pull
    0 17 * * 5  hbs-scoreboard pull && hbs-scoreboard excel <wb> && hbs-scoreboard upload <wb>
"""
from __future__ import annotations

import datetime as dt
import logging
import time
from typing import Optional
from zoneinfo import ZoneInfo

from . import excel_writer, metrics, store
from .cli import _scoreboard_from_cache
from .config import load as load_config
from . import etl
from .monday_client import MondayClient, MondayError

log = logging.getLogger(__name__)
ET = ZoneInfo("America/New_York")

NIGHTLY_HOUR = 2       # 02:00 ET
FRIDAY_HOUR = 17       # 17:00 ET, Friday


def pull_once(args) -> Optional[metrics.Scoreboard]:
    cfg = load_config(getattr(args, "config", None))
    conn = store.connect(args.db)
    try:
        client = MondayClient()
        if not client.configured:
            log.error("MONDAY_API_KEY is not set; skipping pull rather than "
                      "publishing stale or invented numbers.")
            return None
        try:
            ds = etl.pull(cfg, client)
        except MondayError as exc:
            log.error("pull failed: %s", exc)
            store.record_pull(conn, f"{cfg.year}-{cfg.month:02d}", 0, False, str(exc))
            return None
        store.save_events(conn, [e.event for e in ds.entries], ds.pulled_at)
        store.record_pull(conn, f"{cfg.year}-{cfg.month:02d}", len(ds.entries),
                          all(ds.sources_ok.values()))
        sb = metrics.compute(ds, cfg)
        store.snapshot_weeks(conn, sb)
        for w in ds.warnings:
            if w.severity in ("error", "warn"):
                log.warning("[%s] %s", w.code, w.message)
        return sb
    finally:
        conn.close()


def publish(args, sb: Optional[metrics.Scoreboard] = None) -> bool:
    """Fill the workbook and push it to SharePoint."""
    if not args.workbook:
        log.info("no --workbook configured; skipping publish")
        return False
    if sb is None:
        cfg = load_config(getattr(args, "config", None))
        conn = store.connect(args.db)
        try:
            sb = _scoreboard_from_cache(cfg, conn)
        finally:
            conn.close()

    blocking = [w for w in sb.warnings if w.severity == "error"]
    if blocking:
        for w in blocking:
            log.error("not publishing: [%s] %s", w.code, w.message)
        return False

    report = excel_writer.write(sb, args.workbook, week_index=None)
    log.info("excel: %s", report.summary())

    if not (args.item_id or args.drive_id):
        log.info("no SharePoint target configured; workbook written locally only")
        return True
    try:
        from .sharepoint import SharePointClient
        sp = SharePointClient()
        sp.token_client_credentials()
        sp.upload(args.workbook, args.item_id, args.drive_id)
        log.info("uploaded to SharePoint")
        return True
    except Exception as exc:                    # noqa: BLE001
        log.error("SharePoint upload failed: %s", exc)
        return False


def run(args) -> None:
    if args.once:
        sb = pull_once(args)
        publish(args, sb)
        return

    log.info("scheduler up: nightly pull %02d:00 ET, publish Fri %02d:00 ET",
             NIGHTLY_HOUR, FRIDAY_HOUR)
    last_pull: Optional[dt.date] = None
    last_publish: Optional[dt.date] = None

    while True:
        now = dt.datetime.now(ET)
        today = now.date()

        if now.hour >= NIGHTLY_HOUR and last_pull != today:
            log.info("nightly pull")
            pull_once(args)
            last_pull = today

        if now.weekday() == 4 and now.hour >= FRIDAY_HOUR and last_publish != today:
            log.info("Friday publish")
            sb = pull_once(args)
            publish(args, sb)
            last_publish = today

        time.sleep(300)
