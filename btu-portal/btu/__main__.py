"""Command line: python -m btu <command>

  serve            run the portal (with the scheduled pulls)
  refresh          pull every configured board from monday now
  discover         list each board's groups and columns (to fill config.toml)
  export           fill one week column of the Excel workbook
  inspect-excel    list a workbook's row labels (to fill [excel.rows])
  demo             load a clearly-labelled synthetic data set into a separate database
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from . import config as config_mod


def main(argv=None):
    p = argparse.ArgumentParser(prog="btu", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    sub.add_parser("refresh")
    d = sub.add_parser("discover")
    d.add_argument("boards", nargs="*", help="board keys (default: all in [boards])")
    e = sub.add_parser("export")
    e.add_argument("--workbook", required=True)
    e.add_argument("--out", required=True)
    e.add_argument("--month")
    e.add_argument("--week", type=int, required=True)
    e.add_argument("--dollars", default=None)
    i = sub.add_parser("inspect-excel")
    i.add_argument("workbook")
    sub.add_parser("demo")
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = config_mod.load_config()

    if args.cmd == "serve":
        import uvicorn
        from .web import create_app
        uvicorn.run(create_app(), host=args.host, port=args.port)

    elif args.cmd == "refresh":
        from .refresh import run_refresh
        from .store import Store
        print(json.dumps(run_refresh(cfg, Store(config_mod.db_path()), "cli"), indent=2))

    elif args.cmd == "discover":
        from .refresh import make_client
        client = make_client(cfg)
        keys = args.boards or list(cfg["boards"])
        for k in keys:
            m = client.board_meta(cfg["boards"][k])
            print(f"\n== {k}: {m['name']} ({m['id']}) — {m.get('items_count')} items")
            print("  groups:")
            for g in m["groups"]:
                print(f"    {g['id']:<24} {g['title']}")
            print("  columns:")
            for c in m["columns"]:
                print(f"    {c['id']:<28} {c['type']:<14} {c['title']}")

    elif args.cmd == "export":
        from . import etl, rules, views
        from .excel_export import export_week
        from .store import Store
        today = config_mod.today(cfg)
        month = args.month or rules.month_of(today)
        model = etl.compute(cfg, Store(config_mod.db_path()).load_dataset(), today)
        inc = views.scoreboard(model, cfg, month, "incentive", today)
        shr = views.scoreboard(model, cfg, month, "share", today)
        rep = export_week(args.workbook, args.out, cfg, inc, args.week, board_other_mode=shr)
        for label, notes in (("wrote", rep.written), ("skipped", rep.skipped), ("REFUSED", rep.refused)):
            for n in notes:
                print(f"{label:8} {n.cell:6} {n.key:45} {n.reason}")
        print(f"protected rows: {rep.protected_rows}\nsaved {args.out}")

    elif args.cmd == "inspect-excel":
        from .excel_export import inspect
        for sheet, row, label in inspect(args.workbook):
            print(f"{sheet:20} row {row:<4} {label}")

    elif args.cmd == "demo":
        from .demo import load_demo
        path = load_demo(cfg)
        print(f"Demo data loaded into {path}.\nRun:  BTU_DB={path} BTU_TODAY=2026-11-13 python -m btu serve")


if __name__ == "__main__":
    sys.exit(main())
