"""Scheduled pulls: each weekday evening and Monday morning (times in config [schedule])."""
from __future__ import annotations

import logging
import os

log = logging.getLogger(__name__)


def start(portal, store):
    cfg = portal.cfg
    sched_cfg = cfg.get("schedule", {})
    if not sched_cfg.get("enabled", True) or os.environ.get("BTU_SCHEDULER") == "0":
        return None
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger

    from .refresh import run_refresh

    s = BackgroundScheduler(timezone=sched_cfg.get("timezone", "America/New_York"))
    for name in ("weekday_evening", "monday_morning"):
        spec = sched_cfg.get(name)
        if spec:
            s.add_job(lambda n=name: run_refresh(portal.cfg, store, f"scheduled:{n}"),
                      CronTrigger(timezone=s.timezone, **spec), id=name, coalesce=True,
                      misfire_grace_time=3600, max_instances=1)
    s.start()
    log.info("scheduler started: %s", [str(j.trigger) for j in s.get_jobs()])
    return s
