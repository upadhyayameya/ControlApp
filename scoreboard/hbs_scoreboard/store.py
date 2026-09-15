"""Local SQLite cache of raw monday pulls.

Two jobs: keep the dashboard off the API on every page load, and keep
week-over-week history so cross-period repeat detection (rule 2) has
something to compare against after the reporting month rolls over.

Raw items are stored as pulled. Corrections are never baked into the cache --
they are re-applied on read, so a rule change re-scores history rather than
requiring a re-pull.
"""
from __future__ import annotations

import datetime as dt
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Iterable, Optional

from .models import KpiEvent, Stage

DEFAULT_DB = Path(__file__).resolve().parent.parent / "data" / "scoreboard.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS kpi_events (
    item_id         TEXT NOT NULL,
    board_id        TEXT NOT NULL,
    stage           TEXT NOT NULL,
    project_name    TEXT NOT NULL,
    utility_raw     TEXT,
    source          TEXT,
    completion_date TEXT,
    hbs_share       REAL,
    gross_incentive REAL,
    engineer        TEXT,
    pulled_at       TEXT NOT NULL,
    PRIMARY KEY (item_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_kpi_date  ON kpi_events(completion_date);
CREATE INDEX IF NOT EXISTS idx_kpi_stage ON kpi_events(stage);

CREATE TABLE IF NOT EXISTS pulls (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    period     TEXT NOT NULL,
    events     INTEGER NOT NULL,
    ok         INTEGER NOT NULL,
    detail     TEXT
);

CREATE TABLE IF NOT EXISTS week_snapshots (
    period      TEXT NOT NULL,
    week_index  INTEGER NOT NULL,
    program     TEXT NOT NULL,
    kpi_row     INTEGER NOT NULL,
    value       REAL,
    raw_value   REAL,
    captured_at TEXT NOT NULL,
    PRIMARY KEY (period, week_index, program, kpi_row)
);
"""


def connect(path: str | Path = DEFAULT_DB) -> sqlite3.Connection:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p)
    conn.row_factory = sqlite3.Row
    with closing(conn.cursor()) as cur:
        cur.executescript(SCHEMA)
    conn.commit()
    return conn


def save_events(conn: sqlite3.Connection, events: Iterable[KpiEvent],
                pulled_at: Optional[dt.datetime] = None) -> int:
    ts = (pulled_at or dt.datetime.now(dt.timezone.utc)).isoformat()
    rows = [(e.item_id, e.board_id, e.stage.value, e.project_name, e.utility_raw,
             e.source, e.completion_date.isoformat() if e.completion_date else None,
             e.hbs_share, e.gross_incentive, e.engineer, ts) for e in events]
    with closing(conn.cursor()) as cur:
        cur.executemany(
            "INSERT OR REPLACE INTO kpi_events (item_id, board_id, stage, project_name,"
            " utility_raw, source, completion_date, hbs_share, gross_incentive,"
            " engineer, pulled_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    return len(rows)


def load_events(conn: sqlite3.Connection, start: Optional[dt.date] = None,
                end: Optional[dt.date] = None) -> list[KpiEvent]:
    sql = "SELECT * FROM kpi_events WHERE 1=1"
    args: list = []
    if start:
        sql += " AND completion_date >= ?"
        args.append(start.isoformat())
    if end:
        sql += " AND completion_date <= ?"
        args.append(end.isoformat())
    with closing(conn.cursor()) as cur:
        cur.execute(sql, args)
        rows = cur.fetchall()
    out: list[KpiEvent] = []
    for r in rows:
        out.append(KpiEvent(
            item_id=r["item_id"], project_name=r["project_name"],
            stage=Stage(r["stage"]), utility_raw=r["utility_raw"] or "",
            source=r["source"] or "",
            completion_date=dt.date.fromisoformat(r["completion_date"])
            if r["completion_date"] else None,
            hbs_share=r["hbs_share"], gross_incentive=r["gross_incentive"],
            engineer=r["engineer"] or "", board_id=r["board_id"],
        ))
    return out


def record_pull(conn: sqlite3.Connection, period: str, events: int,
                ok: bool, detail: str = "") -> None:
    with closing(conn.cursor()) as cur:
        cur.execute("INSERT INTO pulls (started_at, period, events, ok, detail)"
                    " VALUES (?,?,?,?,?)",
                    (dt.datetime.now(dt.timezone.utc).isoformat(), period,
                     events, 1 if ok else 0, detail[:2000]))
    conn.commit()


def last_pull(conn: sqlite3.Connection) -> Optional[dict]:
    with closing(conn.cursor()) as cur:
        cur.execute("SELECT * FROM pulls ORDER BY id DESC LIMIT 1")
        row = cur.fetchone()
    return dict(row) if row else None


def snapshot_weeks(conn: sqlite3.Connection, scoreboard) -> int:
    """Freeze this week's computed figures so week-over-week history survives
    even after the source items are edited."""
    period = f"{scoreboard.config.year}-{scoreboard.config.month:02d}"
    ts = dt.datetime.now(dt.timezone.utc).isoformat()
    rows = []
    for pm in scoreboard.programs:
        for rm in pm.rows:
            for cell in rm.weekly:
                rows.append((period, cell.week, pm.program.key, rm.row.row,
                             cell.value, cell.raw_value, ts))
    with closing(conn.cursor()) as cur:
        cur.executemany(
            "INSERT OR REPLACE INTO week_snapshots (period, week_index, program,"
            " kpi_row, value, raw_value, captured_at) VALUES (?,?,?,?,?,?,?)", rows)
    conn.commit()
    return len(rows)
