"""SQLite cache of raw monday pulls, with item version history and per-refresh snapshots.

- items: latest raw JSON per (board, item), with first/last seen and deletion marks.
- item_versions: every distinct version of an item ever pulled, so a figure that moved after a
  week closed can be explained.
- runs: each refresh, its status and per-board errors.
- snapshots: the computed scoreboard after each refresh — week-over-week history survives.
- corrections: the ETL's correction log for each run.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .etl import BoardData, Dataset

SCHEMA = """
CREATE TABLE IF NOT EXISTS boards (
  board_key TEXT PRIMARY KEY, board_id TEXT, meta_json TEXT, pulled_at TEXT, error TEXT, error_at TEXT
);
CREATE TABLE IF NOT EXISTS items (
  board_key TEXT, item_id TEXT, data_json TEXT, hash TEXT, first_seen TEXT, last_seen TEXT,
  deleted_at TEXT, PRIMARY KEY (board_key, item_id)
);
CREATE TABLE IF NOT EXISTS item_versions (
  board_key TEXT, item_id TEXT, seen_at TEXT, hash TEXT, data_json TEXT
);
CREATE INDEX IF NOT EXISTS iv_item ON item_versions(board_key, item_id);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT, finished_at TEXT, trigger TEXT,
  status TEXT, detail_json TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  run_id INTEGER, month TEXT, dollars TEXT, payload_json TEXT, PRIMARY KEY (run_id, month, dollars)
);
CREATE TABLE IF NOT EXISTS corrections (
  run_id INTEGER, rule TEXT, board_id TEXT, item_id TEXT, name TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _hash(d: dict) -> str:
    return hashlib.sha256(json.dumps(d, sort_keys=True).encode()).hexdigest()[:16]


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as c:
            c.executescript(SCHEMA)

    def _conn(self) -> sqlite3.Connection:
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        return c

    # -- runs ------------------------------------------------------------------------------

    def start_run(self, trigger: str) -> int:
        with self._lock, self._conn() as c:
            cur = c.execute("INSERT INTO runs(started_at, trigger, status) VALUES (?,?,?)",
                            (now(), trigger, "running"))
            return cur.lastrowid

    def finish_run(self, run_id: int, status: str, detail: dict) -> None:
        with self._lock, self._conn() as c:
            c.execute("UPDATE runs SET finished_at=?, status=?, detail_json=? WHERE id=?",
                      (now(), status, json.dumps(detail), run_id))

    def runs(self, limit: int = 50) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM runs ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r, detail=json.loads(r["detail_json"] or "{}")) for r in rows]

    def latest_run(self) -> dict | None:
        with self._conn() as c:
            r = c.execute("SELECT * FROM runs WHERE status != 'running' ORDER BY id DESC LIMIT 1").fetchone()
        return dict(r) if r else None

    # -- boards ----------------------------------------------------------------------------

    def save_board(self, key: str, meta: dict, items: list[dict], when: str | None = None) -> dict:
        """Replace the board's current items with a complete pull. Returns change counts."""
        when = when or now()
        stats = {"items": len(items), "new": 0, "changed": 0, "deleted": 0}
        with self._lock, self._conn() as c:
            existing = {r["item_id"]: r["hash"] for r in
                        c.execute("SELECT item_id, hash FROM items WHERE board_key=? AND deleted_at IS NULL", (key,))}
            seen = set()
            for it in items:
                iid = str(it["id"])
                seen.add(iid)
                h = _hash(it)
                blob = json.dumps(it)
                if iid not in existing:
                    stats["new"] += 1
                    c.execute("INSERT INTO items VALUES (?,?,?,?,?,?,NULL) ON CONFLICT(board_key,item_id) "
                              "DO UPDATE SET data_json=excluded.data_json, hash=excluded.hash, "
                              "last_seen=excluded.last_seen, deleted_at=NULL",
                              (key, iid, blob, h, when, when))
                    c.execute("INSERT INTO item_versions VALUES (?,?,?,?,?)", (key, iid, when, h, blob))
                elif existing[iid] != h:
                    stats["changed"] += 1
                    c.execute("UPDATE items SET data_json=?, hash=?, last_seen=? WHERE board_key=? AND item_id=?",
                              (blob, h, when, key, iid))
                    c.execute("INSERT INTO item_versions VALUES (?,?,?,?,?)", (key, iid, when, h, blob))
                else:
                    c.execute("UPDATE items SET last_seen=? WHERE board_key=? AND item_id=?", (when, key, iid))
            gone = set(existing) - seen
            stats["deleted"] = len(gone)
            c.executemany("UPDATE items SET deleted_at=? WHERE board_key=? AND item_id=?",
                          [(when, key, i) for i in gone])
            c.execute("INSERT INTO boards(board_key, board_id, meta_json, pulled_at, error, error_at) "
                      "VALUES (?,?,?,?,NULL,NULL) ON CONFLICT(board_key) DO UPDATE SET "
                      "board_id=excluded.board_id, meta_json=excluded.meta_json, "
                      "pulled_at=excluded.pulled_at, error=NULL, error_at=NULL",
                      (key, str(meta.get("id")), json.dumps(meta), when))
        return stats

    def board_error(self, key: str, error: str) -> None:
        with self._lock, self._conn() as c:
            c.execute("INSERT INTO boards(board_key, error, error_at) VALUES (?,?,?) "
                      "ON CONFLICT(board_key) DO UPDATE SET error=excluded.error, error_at=excluded.error_at",
                      (key, error, now()))

    def load_dataset(self) -> Dataset:
        boards = {}
        with self._conn() as c:
            for b in c.execute("SELECT * FROM boards"):
                if not b["meta_json"]:
                    continue  # never pulled successfully
                items = [json.loads(r["data_json"]) for r in c.execute(
                    "SELECT data_json FROM items WHERE board_key=? AND deleted_at IS NULL", (b["board_key"],))]
                boards[b["board_key"]] = BoardData(json.loads(b["meta_json"]), items, b["pulled_at"], b["error"])
            demo = c.execute("SELECT value FROM meta WHERE key='demo'").fetchone()
        run = self.latest_run()
        return Dataset(boards, run_id=run["id"] if run else None,
                       refreshed_at=run["finished_at"] if run else None,
                       demo=bool(demo and demo["value"] == "1"))

    def item_history(self, key: str, item_id: str) -> list[dict]:
        with self._conn() as c:
            return [dict(r, data=json.loads(r["data_json"])) for r in c.execute(
                "SELECT seen_at, hash, data_json FROM item_versions WHERE board_key=? AND item_id=? "
                "ORDER BY seen_at", (key, item_id))]

    def set_meta(self, key: str, value: str) -> None:
        with self._lock, self._conn() as c:
            c.execute("INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                      (key, value))

    # -- snapshots & corrections -----------------------------------------------------------

    def save_snapshot(self, run_id: int, month: str, dollars: str, payload: dict) -> None:
        with self._lock, self._conn() as c:
            c.execute("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)",
                      (run_id, month, dollars, json.dumps(payload)))

    def snapshots(self, month: str, dollars: str, limit: int = 30) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT s.run_id, r.finished_at, s.payload_json FROM snapshots s JOIN runs r ON r.id=s.run_id "
                "WHERE s.month=? AND s.dollars=? ORDER BY s.run_id DESC LIMIT ?", (month, dollars, limit)).fetchall()
        return [{"run_id": r["run_id"], "at": r["finished_at"], **json.loads(r["payload_json"])} for r in rows]

    def save_corrections(self, run_id: int, corrections) -> None:
        with self._lock, self._conn() as c:
            c.execute("DELETE FROM corrections WHERE run_id=?", (run_id,))
            c.executemany("INSERT INTO corrections VALUES (?,?,?,?,?,?)",
                          [(run_id, x.rule, x.board_id, x.item_id, x.name, x.detail) for x in corrections])
