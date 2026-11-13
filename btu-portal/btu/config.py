from __future__ import annotations

import os
import tomllib
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config.toml"


def load_config(path: str | os.PathLike | None = None) -> dict:
    p = Path(path or os.environ.get("BTU_CONFIG") or DEFAULT_CONFIG)
    with open(p, "rb") as f:
        cfg = tomllib.load(f)
    cfg["_path"] = str(p)
    cfg.setdefault("goals", {})
    cfg.setdefault("levels", [])
    cfg.setdefault("weeks", {})
    return cfg


def today(cfg: dict) -> date:
    """Business 'today' in the configured timezone. BTU_TODAY=YYYY-MM-DD overrides (demo/tests)."""
    override = os.environ.get("BTU_TODAY")
    if override:
        return date.fromisoformat(override)
    tz = ZoneInfo(cfg.get("schedule", {}).get("timezone", "America/New_York"))
    return datetime.now(tz).date()


def db_path() -> Path:
    return Path(os.environ.get("BTU_DB") or ROOT / "data" / "btu.sqlite")
