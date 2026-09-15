"""Command line entry points.

    python -m hbs_scoreboard.cli pull          # pull monday -> local cache
    python -m hbs_scoreboard.cli report        # print the scoreboard
    python -m hbs_scoreboard.cli excel  ...    # fill the workbook
    python -m hbs_scoreboard.cli upload ...    # push to SharePoint
    python -m hbs_scoreboard.cli serve         # dashboard
    python -m hbs_scoreboard.cli schedule      # nightly + Friday 5pm ET
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import sys
from pathlib import Path

from . import etl, excel_writer, metrics, store
from .config import load as load_config
from .monday_client import MondayClient, MondayError

log = logging.getLogger("hbs_scoreboard")


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S")


def _load(args) -> tuple:
    cfg = load_config(args.config)
    if getattr(args, "week_mode", None):
        cfg.week_mode = args.week_mode
    if getattr(args, "count_repeats", None) is not None:
        cfg.count_repeats_as_new = args.count_repeats
    return cfg, store.connect(args.db)


def _scoreboard_from_cache(cfg, conn) -> metrics.Scoreboard:
    events = store.load_events(conn, cfg.month_start, cfg.month_end)
    history = store.load_events(conn, end=cfg.month_start - dt.timedelta(days=1))
    hist = etl.build(history, cfg).entries if history else None
    ds = etl.build(events, cfg, history=hist)
    if not events:
        ds.add_warning("error", "NO_CACHED_DATA",
                       "No cached monday data for this period — every monday-sourced "
                       "figure is empty, not zero.",
                       "Run `pull` with MONDAY_API_KEY set.")
    return metrics.compute(ds, cfg)


# -- commands -----------------------------------------------------------------
def cmd_pull(args) -> int:
    cfg, conn = _load(args)
    client = MondayClient()
    if not client.configured:
        log.error("MONDAY_API_KEY is not set. Refusing to invent numbers.")
        return 2
    try:
        ds = etl.pull(cfg, client)
    except MondayError as exc:
        log.error("pull failed: %s", exc)
        store.record_pull(conn, f"{cfg.year}-{cfg.month:02d}", 0, False, str(exc))
        return 1
    n = store.save_events(conn, [e.event for e in ds.entries], ds.pulled_at)
    ok = all(ds.sources_ok.values())
    store.record_pull(conn, f"{cfg.year}-{cfg.month:02d}", n, ok,
                      "; ".join(f"{k}={v}" for k, v in ds.sources_ok.items()))
    sb = metrics.compute(ds, cfg)
    store.snapshot_weeks(conn, sb)
    log.info("cached %s raw items; %s counted after corrections", n, len(ds.counted))
    for w in ds.warnings:
        log.log(logging.ERROR if w.severity == "error" else logging.WARNING,
                "[%s] %s", w.code, w.message)
    return 0 if ok else 1


def cmd_report(args) -> int:
    cfg, conn = _load(args)
    sb = _scoreboard_from_cache(cfg, conn)
    _print_report(sb)
    return 0


def _print_report(sb: metrics.Scoreboard) -> None:
    cfg = sb.config
    print(f"\nHBS Weekly Scoreboard — {cfg.year}-{cfg.month:02d}  (as of {sb.as_of})")
    print(f"Weeks: {cfg.week_mode}  "
          + "  ".join(f"Wk{w.index} {w.range_label}" for w in cfg.weeks))
    print(f"Month elapsed by working days: {sb.pace_pct:.0%} "
          f"({sb.working_days_elapsed}/{sb.working_days_total}); "
          f"{sb.weeks_remaining} week(s) remaining")
    print(f"Repeat rate: {sb.repeat_rate['rate']:.0%} "
          f"({sb.repeat_rate['repeats_flagged']}/{sb.repeat_rate['submissions_considered']}), target 0")

    if sb.warnings:
        print("\n--- warnings " + "-" * 60)
        for w in sb.warnings:
            print(f"[{w.severity.upper():5}] {w.code}: {w.message}")
            if w.detail:
                print(f"         {w.detail}")

    for pm in sb.programs:
        print(f"\n=== {pm.program.display} " + "=" * max(0, 58 - len(pm.program.display)))
        if pm.note:
            print(f"    ! {pm.note}")
        print(f"    {'KPI':<46}{'Goal':>12}{'MTD':>12}{'%Goal':>8}{'Pace':>7}"
              f"{'Gap':>12}{'Rate/wk':>11}  Status")
        for rm in pm.rows:
            fmt = (lambda v: "—" if v is None else
                   (f"${v:,.0f}" if rm.row.measure == "dollars" else f"{v:,.0f}"))
            corr = ""
            if rm.duplicates_removed or rm.repeats_flagged:
                bits = []
                if rm.duplicates_removed:
                    bits.append(f"-{rm.duplicates_removed}dup")
                if rm.repeats_flagged:
                    bits.append(f"{rm.repeats_flagged}rep")
                corr = "  [" + ",".join(bits) + "]"
            print(f"    {rm.row.kpi[:45]:<46}{fmt(rm.goal):>12}{fmt(rm.mtd):>12}"
                  f"{(f'{rm.pct_to_goal:.0%}' if rm.pct_to_goal is not None else '—'):>8}"
                  f"{(f'{rm.pace_pct:.0%}' if not rm.is_level else 'lvl'):>7}"
                  f"{fmt(rm.gap):>12}{fmt(rm.required_run_rate):>11}  {rm.status}{corr}")


def cmd_excel(args) -> int:
    cfg, conn = _load(args)
    sb = _scoreboard_from_cache(cfg, conn)

    info = excel_writer.detect_week_convention(args.workbook)
    if info.get("weeks_in_month") and info["weeks_in_month"] != len(cfg.weeks):
        log.warning("workbook says %s weeks, config has %s",
                    info["weeks_in_month"], len(cfg.weeks))
    if cfg.week_mode == "calendar" and info.get("headers"):
        log.warning("workbook week headers are %s (the team convention starting 9/7); "
                    "config is calendar coverage. The figures written follow the "
                    "config, not the header text.", info["headers"])

    report = excel_writer.write(sb, args.workbook, output_path=args.output,
                                week_index=args.week, dry_run=args.dry_run)
    print(report.summary())
    for s in report.skipped:
        if s.get("reason") == "manually owned — never written":
            continue
        log.debug("skipped %s!%s: %s", s.get("sheet"), s.get("cell"), s.get("reason"))
    if report.broken_formulas:
        log.warning("workbook contains %s pre-existing #REF! formula(s): %s",
                    len(report.broken_formulas),
                    ", ".join(f"{b['sheet']}!{b['cell']}" for b in report.broken_formulas[:6]))
    if not args.dry_run:
        print(f"saved: {report.output_path}")
    return 0


def cmd_upload(args) -> int:
    from .sharepoint import SharePointClient
    sp = SharePointClient()
    if args.auth == "device":
        sp.token_device_code()
    else:
        sp.token_client_credentials()
    item_id = args.item_id
    if not item_id:
        found = sp.find_item(Path(args.workbook).name, args.drive_id)
        if not found:
            log.error("could not find %s on the drive; pass --item-id",
                      Path(args.workbook).name)
            return 1
        item_id = found["id"]
    result = sp.upload(args.workbook, item_id, args.drive_id)
    print(f"uploaded: {result.get('name', item_id)}")
    return 0


def cmd_serve(args) -> int:
    from .web import create_app

    db = Path(args.db)
    if not db.exists():
        log.error("no cache at %s. Load the sample first:\n"
                  "    python scripts/load_sample.py %s\n"
                  "or pull live data with MONDAY_API_KEY set:\n"
                  "    python -m hbs_scoreboard.cli --db %s pull",
                  db, db, db)
        return 2

    app = create_app(config_path=args.config, db_path=args.db, offline=args.offline)
    url = f"http://{args.host}:{args.port}"
    # Say it plainly and early: a silent start is indistinguishable from a
    # process that died, and the browser just shows connection refused.
    print(f"\n  HBS scoreboard serving at  {url}\n"
          f"  cache: {db}  ({'offline' if args.offline else 'live'})\n"
          f"  press Ctrl+C to stop. This window stays busy while it runs.\n",
          flush=True)
    try:
        app.run(host=args.host, port=args.port, debug=args.debug)
    except OSError as exc:
        if getattr(exc, "errno", None) in (48, 98, 10048) or "in use" in str(exc).lower():
            log.error("port %s is already in use. Try a different one:\n"
                      "    ... serve --port %s", args.port, args.port + 1)
            return 2
        raise
    return 0


def cmd_schedule(args) -> int:
    from .scheduler import run
    run(args)
    return 0


# -- parser -------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="hbs-scoreboard",
                                description="HBS weekly scoreboard")
    p.add_argument("--config", help="path to scoreboard.yml")
    p.add_argument("--db", default=str(store.DEFAULT_DB), help="SQLite cache path")
    p.add_argument("--week-mode", choices=["calendar", "team"],
                   help="override the configured week convention")
    p.add_argument("--count-repeats", dest="count_repeats", action="store_true",
                   default=None, help="count repeat submissions as new work")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("pull", help="pull monday into the local cache").set_defaults(func=cmd_pull)
    sub.add_parser("report", help="print the scoreboard").set_defaults(func=cmd_report)

    e = sub.add_parser("excel", help="fill the week column in the workbook")
    e.add_argument("workbook")
    e.add_argument("-o", "--output", help="write to a copy instead of in place")
    e.add_argument("--week", type=int, help="week index (default: week of today)")
    e.add_argument("--dry-run", action="store_true")
    e.set_defaults(func=cmd_excel)

    u = sub.add_parser("upload", help="push the workbook to SharePoint")
    u.add_argument("workbook")
    u.add_argument("--item-id")
    u.add_argument("--drive-id")
    u.add_argument("--auth", choices=["device", "client"], default="device")
    u.set_defaults(func=cmd_upload)

    s = sub.add_parser("serve", help="run the dashboard")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--debug", action="store_true")
    s.add_argument("--offline", action="store_true",
                   help="never call monday; serve the cache only")
    s.set_defaults(func=cmd_serve)

    sc = sub.add_parser("schedule", help="nightly pull + Friday 5pm ET publish")
    sc.add_argument("--workbook")
    sc.add_argument("--item-id")
    sc.add_argument("--drive-id")
    sc.add_argument("--once", action="store_true", help="run one cycle and exit")
    sc.set_defaults(func=cmd_schedule)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    _setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
