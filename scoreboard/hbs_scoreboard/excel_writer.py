"""Write the week column into the existing workbook.

Constraints, in priority order:

  1. Never touch a payments or revenue cell, or any other manually-owned row
     (rule 5). These are accounting figures owned by the Director of
     Accounting. The writer verifies this after the fact and refuses to save
     if any protected cell changed.
  2. Never overwrite a formula. Every computed column (Weekly Target, MTD,
     % to Goal, Latest, Status) stays a formula.
  3. Leave formatting alone. openpyxl preserves cell styles on load/save; we
     only assign `.value` on data cells that are already plain numbers.
  4. An unavailable figure leaves the cell as it was and is reported. An empty
     cell is recoverable; a plausible wrong number is not.
"""
from __future__ import annotations

import datetime as dt
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from openpyxl import load_workbook
from openpyxl.worksheet.formula import ArrayFormula

from .config import Config
from .metrics import Scoreboard

log = logging.getLogger(__name__)

# Columns that hold formulas in the workbook and must never be written.
FORMULA_COLUMNS = {"D", "I", "J", "K", "L"}


@dataclass
class WriteReport:
    written: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    protected_checked: int = 0
    formulas_preserved: int = 0
    broken_formulas: list[dict] = field(default_factory=list)
    week_index: Optional[int] = None
    target_column: Optional[str] = None
    output_path: Optional[str] = None
    saved: bool = False

    def summary(self) -> str:
        return (f"wrote {len(self.written)} cell(s) into column {self.target_column} "
                f"(Wk{self.week_index}); skipped {len(self.skipped)}; "
                f"{self.protected_checked} protected cell(s) verified unchanged")


def _is_formula(value) -> bool:
    if isinstance(value, ArrayFormula):
        return True
    return isinstance(value, str) and value.startswith("=")


def _snapshot(ws, rows: set[int], columns: list[str]) -> dict[str, object]:
    out: dict[str, object] = {}
    for r in rows:
        for c in columns:
            cell = ws[f"{c}{r}"]
            out[cell.coordinate] = (cell.value.text
                                    if isinstance(cell.value, ArrayFormula)
                                    else cell.value)
    return out


def write(scoreboard: Scoreboard, workbook_path: str | Path,
          output_path: Optional[str | Path] = None,
          week_index: Optional[int] = None,
          dry_run: bool = False) -> WriteReport:
    """Fill one week's column for every monday-sourced row.

    `week_index` defaults to the week containing `scoreboard.as_of`.
    """
    cfg = scoreboard.config
    src = Path(workbook_path)
    if not src.exists():
        raise FileNotFoundError(f"workbook not found: {src}")

    if week_index is None:
        week_index = next((w.index for w in cfg.weeks if w.contains(scoreboard.as_of)),
                          cfg.weeks[-1].index)
    try:
        column = cfg.week_columns[week_index - 1]
    except IndexError as exc:
        raise ValueError(f"no Excel column configured for week {week_index}") from exc

    report = WriteReport(week_index=week_index, target_column=column)

    out = Path(output_path) if output_path else src
    if not dry_run and out != src:
        shutil.copyfile(src, out)

    wb = load_workbook(src)   # formulas preserved: data_only stays False

    # -- snapshot every protected cell across every sheet we may touch --------
    guards: dict[str, dict[str, object]] = {}
    all_cols = list(cfg.week_columns) + sorted(FORMULA_COLUMNS) + ["A", "B", "C"]
    for sheet_key, sheet_name in cfg.sheets.items():
        if sheet_name not in wb.sheetnames:
            continue
        rows = cfg.protected_rows(sheet_key)
        if rows:
            guards[sheet_name] = _snapshot(wb[sheet_name], rows, all_cols)
            report.protected_checked += len(guards[sheet_name])

    # -- write ---------------------------------------------------------------
    for pm in scoreboard.programs:
        sheet_name = cfg.sheets.get(pm.program.sheet)
        if not sheet_name or sheet_name not in wb.sheetnames:
            report.skipped.append({"program": pm.program.display,
                                   "reason": f"sheet {sheet_name!r} not in workbook"})
            continue
        ws = wb[sheet_name]
        protected = cfg.protected_rows(pm.program.sheet)

        for rm in pm.rows:
            coord = f"{column}{rm.row.row}"
            base = {"sheet": sheet_name, "cell": coord, "program": pm.program.display,
                    "kpi": rm.row.kpi}

            if rm.row.row in protected or rm.row.is_manual:
                report.skipped.append({**base, "reason": "manually owned — never written"})
                continue
            if column in FORMULA_COLUMNS:
                report.skipped.append({**base, "reason": "formula column"})
                continue

            cell = ws[coord]
            if _is_formula(cell.value):
                report.formulas_preserved += 1
                report.skipped.append({**base, "reason": "cell holds a formula"})
                continue

            cellmetric = next((c for c in rm.weekly if c.week == week_index), None)
            value = cellmetric.value if cellmetric else None
            if value is None:
                report.skipped.append({**base, "reason": "no data — cell left as-is"})
                continue

            before = cell.value
            if not dry_run:
                cell.value = round(value, 2) if rm.row.measure == "dollars" else value
            report.written.append({**base, "before": before, "after": value})

    # -- verify protected cells are untouched --------------------------------
    for sheet_name, snap in guards.items():
        ws = wb[sheet_name]
        for coord, before in snap.items():
            now = ws[coord].value
            now = now.text if isinstance(now, ArrayFormula) else now
            if now != before:
                raise AssertionError(
                    f"protected cell {sheet_name}!{coord} changed "
                    f"({before!r} -> {now!r}); refusing to save")

    # -- report formulas already broken in the workbook ----------------------
    report.broken_formulas = _find_broken_formulas(wb)

    if not dry_run:
        wb.save(out)
        report.saved = True
        report.output_path = str(out)
    log.info(report.summary())
    return report


def _find_broken_formulas(wb) -> list[dict]:
    """The live workbook carries #REF! errors from a deleted row. Report them
    rather than writing numbers into a sheet that will compute them wrongly."""
    out: list[dict] = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                v = cell.value
                v = v.text if isinstance(v, ArrayFormula) else v
                if isinstance(v, str) and "#REF!" in v:
                    out.append({"sheet": ws.title, "cell": cell.coordinate,
                                "formula": v[:160]})
    return out


def detect_week_convention(workbook_path: str | Path) -> dict:
    """Read the workbook's own week setup so a mismatch with the configured
    convention can be reported instead of silently overwriting the wrong column."""
    wb = load_workbook(workbook_path)
    info: dict = {"weeks_in_month": None, "current_week": None, "headers": []}
    if "Start Here" in wb.sheetnames:
        ws = wb["Start Here"]
        info["weeks_in_month"] = ws["B10"].value
        info["current_week"] = ws["D10"].value
    if "Tune-Up Factory" in wb.sheetnames:
        ws = wb["Tune-Up Factory"]
        info["headers"] = [ws[f"{c}5"].value for c in ("E", "F", "G", "H")]
    return info
