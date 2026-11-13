"""Write one week column of the existing scoreboard workbook.

Rules, in order of precedence:
  1. Rows whose label matches excel.protected_row_labels (payments, revenue …) or that are listed
     in excel.protected_rows are never written, even if a mapping points at them. Those are the
     Director of Accounting's figures.
  2. Cells that hold a formula are never overwritten.
  3. Only cells named in [excel.rows] are touched. Everything else, including formatting, is left
     as openpyxl loaded it.
  4. A figure that is unavailable is not written; the cell keeps whatever it had and the report
     says why.

openpyxl caveat: it does not round-trip charts, images or pivot caches. The export therefore
always writes to a new file and never overwrites the source workbook.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl
from openpyxl.utils import column_index_from_string

from .views import Scoreboard


class ExportError(Exception):
    pass


@dataclass
class CellNote:
    key: str
    row: int
    cell: str
    reason: str


@dataclass
class ExportReport:
    written: list[CellNote] = field(default_factory=list)
    skipped: list[CellNote] = field(default_factory=list)
    refused: list[CellNote] = field(default_factory=list)
    protected_rows: list[int] = field(default_factory=list)


def protected_rows(ws, cfg_excel: dict) -> set[int]:
    labels = [l.lower() for l in cfg_excel.get("protected_row_labels", [])]
    col = column_index_from_string(cfg_excel.get("label_column", "A"))
    rows = set(int(r) for r in cfg_excel.get("protected_rows", []))
    for (cell,) in ws.iter_rows(min_col=col, max_col=col):
        v = cell.value
        if isinstance(v, str) and any(l in v.lower() for l in labels):
            rows.add(cell.row)
    return rows


def _value(board: Scoreboard, stage: str, program: str, metric: str, week_index: int):
    try:
        row = board.row(stage, program)
    except (StopIteration, KeyError):
        return None, f"no scoreboard row for {stage} / {program}"
    if week_index < 1 or week_index > len(row.weeks):
        return None, f"week {week_index} is not configured for {board.month}"
    cell = row.weeks[week_index - 1]
    if cell.unavailable:
        return None, cell.unavailable
    if metric == "count":
        return cell.count, None
    if metric == "raw_count":
        return cell.raw_count, None
    if metric in ("incentive", "share"):
        if metric != board.dollars_mode:
            return None, f"scoreboard was built in {board.dollars_mode} mode; {metric} not available"
        if cell.dollars_unavailable:
            return None, cell.dollars_unavailable
        return cell.dollars, None
    return None, f"unknown metric {metric!r}"


def export_week(src, dst, cfg: dict, board: Scoreboard, week_index: int,
                board_other_mode: Scoreboard | None = None) -> ExportReport:
    src, dst = Path(src), Path(dst)
    if src.resolve() == dst.resolve():
        raise ExportError("Refusing to overwrite the source workbook; write to a new file.")
    xc = cfg.get("excel", {})
    cols = xc.get("week_columns", [])
    if week_index < 1 or week_index > len(cols):
        raise ExportError(f"No workbook column configured for week {week_index}.")
    letter = cols[week_index - 1]
    wb = openpyxl.load_workbook(src, keep_vba=src.suffix.lower() == ".xlsm")
    if xc.get("sheet") not in wb.sheetnames:
        raise ExportError(f"Sheet {xc.get('sheet')!r} not found; sheets are {wb.sheetnames}.")
    ws = wb[xc["sheet"]]
    report = ExportReport()
    prot = protected_rows(ws, xc)
    report.protected_rows = sorted(prot)
    for key, row in (xc.get("rows") or {}).items():
        row = int(row)
        ref = f"{letter}{row}"
        try:
            stage, program, metric = key.split("|")
        except ValueError:
            report.skipped.append(CellNote(key, row, ref, "mapping key must be stage|program|metric"))
            continue
        if row in prot:
            report.refused.append(CellNote(key, row, ref, "protected row (payments / revenue are "
                                                          "owned by accounting)"))
            continue
        cell = ws[ref]
        if cell.data_type == "f" or (isinstance(cell.value, str) and cell.value.startswith("=")):
            report.skipped.append(CellNote(key, row, ref, "cell holds a formula"))
            continue
        b = board
        if metric in ("incentive", "share") and metric != board.dollars_mode and board_other_mode:
            b = board_other_mode
        value, why = _value(b, stage, program, metric, week_index)
        if value is None:
            report.skipped.append(CellNote(key, row, ref, why or "no value"))
            continue
        cell.value = value
        report.written.append(CellNote(key, row, ref, str(value)))
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    wb.save(tmp)
    os.replace(tmp, dst)
    return report


def inspect(path) -> list[tuple[str, int, str]]:
    """Row labels per sheet, to help fill in [excel.rows]."""
    wb = openpyxl.load_workbook(path)
    out = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=1, max_row=ws.max_row):
            labels = [str(c.value) for c in row[:3] if c.value is not None and not re.match(r"^=", str(c.value))]
            if labels:
                out.append((ws.title, row[0].row, " | ".join(labels)))
    return out
