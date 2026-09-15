"""Thin wrapper over the monday.com GraphQL API v2.

Handles auth, retry with backoff, cursor pagination and mirror columns.
Board ids, group ids and column ids below were verified against the live
account (board 1069742731, 7,756 items) rather than taken on trust.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import time
from typing import Any, Iterator, Optional

import requests

log = logging.getLogger(__name__)

API_URL = "https://api.monday.com/v2"
API_VERSION = "2024-10"

# --- boards ------------------------------------------------------------------
BOARD_MONTHLY_KPIS = 1069742731      # authoritative KPI event log
BOARD_MASTER_TU = 1069746645         # BGE Tune-Up + all non-BPTU programs
BOARD_BGE_BPTU = 6530139050          # BGE BPTU only
BOARD_PRESCRIPTIVE = 18409151061     # prescriptive HVAC tune-ups
BOARD_PREAPPROVAL_WORKLOAD = 9889346356
BOARD_CLOSEOUT_WORKLOAD = 10030690180

# --- Monthly KPIs columns ----------------------------------------------------
COL_COMPLETION_DATE = "date4"        # the event date. Never __creation_log__.
COL_UTILITY = "text"                 # overloaded: utilities AND project types
COL_SOURCE = "text8"
COL_HBS_SHARE = "dup__of_incentive"  # use this, NOT numbers_2
COL_GROSS_INCENTIVE = "numbers_2"    # audit cross-check only
COL_ENGINEER = "person"

KPI_COLUMNS = [COL_COMPLETION_DATE, COL_UTILITY, COL_SOURCE,
               COL_HBS_SHARE, COL_GROSS_INCENTIVE, COL_ENGINEER]

# --- project trackers: Implementations Completed lives here, not on KPIs ------
COL_IMPL_DATE_MASTER = "date_mm4b5x2"
COL_IMPL_DATE_BPTU = "date_mm0whh86"
COL_TRACKER_HBS_SHARE = "dup__of_incentive_amount"   # note: different id

# --- mirror columns ----------------------------------------------------------
COL_ESTIMATED_CO = "lookup_mm70wevh"  # Estimated $CO on Closeout Workload


class MondayError(RuntimeError):
    pass


class MondayAuthError(MondayError):
    pass


class MondayClient:
    """Retrying, paginating GraphQL client.

    Raises rather than returning a plausible wrong number: a caller that
    cannot reach monday must leave cells empty and say why.
    """

    def __init__(self, api_key: Optional[str] = None, *, timeout: int = 60,
                 max_retries: int = 5, session: Optional[requests.Session] = None):
        self.api_key = api_key or os.environ.get("MONDAY_API_KEY", "")
        self.timeout = timeout
        self.max_retries = max_retries
        self.session = session or requests.Session()

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    # -- transport ------------------------------------------------------------
    def execute(self, query: str, variables: Optional[dict] = None) -> dict:
        if not self.configured:
            raise MondayAuthError(
                "MONDAY_API_KEY is not set. Refusing to guess: set the key or run "
                "with a cached snapshot (--offline)."
            )
        headers = {
            "Authorization": self.api_key,
            "API-Version": API_VERSION,
            "Content-Type": "application/json",
        }
        payload = {"query": query, "variables": variables or {}}
        delay = 1.0
        last: Optional[Exception] = None

        for attempt in range(1, self.max_retries + 1):
            try:
                r = self.session.post(API_URL, json=payload, headers=headers,
                                      timeout=self.timeout)
                if r.status_code in (429, 500, 502, 503, 504):
                    raise MondayError(f"HTTP {r.status_code}: {r.text[:300]}")
                if r.status_code == 401:
                    raise MondayAuthError("monday rejected the API key (401).")
                r.raise_for_status()
                body = r.json()
                if body.get("errors"):
                    msg = "; ".join(e.get("message", "?") for e in body["errors"])
                    # Complexity budget exhausted is retryable; the rest are not.
                    if "complexity" in msg.lower() or "rate" in msg.lower():
                        raise MondayError(msg)
                    raise MondayError(f"GraphQL error: {msg}")
                return body["data"]
            except MondayAuthError:
                raise
            except Exception as exc:              # noqa: BLE001 - retried below
                last = exc
                if attempt == self.max_retries:
                    break
                log.warning("monday call failed (attempt %s/%s): %s; retrying in %.1fs",
                            attempt, self.max_retries, exc, delay)
                time.sleep(delay)
                delay = min(delay * 2, 30.0)

        raise MondayError(f"monday API failed after {self.max_retries} attempts: {last}")

    # -- reads ----------------------------------------------------------------
    def items_by_date_range(self, board_id: int, date_column: str,
                            start: dt.date, end: dt.date,
                            columns: Optional[list[str]] = None,
                            page_size: int = 250) -> Iterator[dict]:
        """Every item whose `date_column` falls in [start, end], paginated.

        Filtering server-side on the date column keeps us off the 7,600-item
        full scan and, more importantly, uses the event date rather than any
        creation/update proxy.
        """
        col_arg = ""
        if columns:
            ids = ", ".join(f'"{c}"' for c in columns)
            col_arg = f"(ids: [{ids}])"

        query = f"""
        query ($boardId: ID!, $limit: Int!, $cursor: String,
               $col: String!, $from: CompareValue!, $to: CompareValue!) {{
          boards(ids: [$boardId]) {{
            items_page(
              limit: $limit
              cursor: $cursor
              query_params: {{
                rules: [{{column_id: $col, compare_value: [$from, $to], operator: between}}]
                operator: and
              }}
            ) {{
              cursor
              items {{
                id
                name
                group {{ id title }}
                column_values{col_arg} {{
                  id
                  text
                  value
                  ... on MirrorValue {{ display_value }}
                }}
              }}
            }}
          }}
        }}
        """
        cursor: Optional[str] = None
        seen = 0
        while True:
            data = self.execute(query, {
                "boardId": str(board_id), "limit": page_size, "cursor": cursor,
                "col": date_column, "from": start.isoformat(), "to": end.isoformat(),
            })
            boards = data.get("boards") or []
            if not boards:
                return
            page = boards[0]["items_page"]
            for item in page["items"]:
                seen += 1
                yield item
            cursor = page.get("cursor")
            if not cursor:
                break
        log.info("board %s: %s items in %s..%s", board_id, seen, start, end)

    def items_by_ids(self, item_ids: list[str], columns: Optional[list[str]] = None) -> list[dict]:
        """Fetch specific items, for drill-down and cross-checks."""
        if not item_ids:
            return []
        col_arg = ""
        if columns:
            ids = ", ".join(f'"{c}"' for c in columns)
            col_arg = f"(ids: [{ids}])"
        query = f"""
        query ($ids: [ID!]!) {{
          items(ids: $ids) {{
            id
            name
            board {{ id }}
            group {{ id title }}
            column_values{col_arg} {{
              id
              text
              value
              ... on MirrorValue {{ display_value }}
            }}
          }}
        }}
        """
        out: list[dict] = []
        for i in range(0, len(item_ids), 100):
            data = self.execute(query, {"ids": item_ids[i:i + 100]})
            out.extend(data.get("items") or [])
        return out

    def board_item_names(self, board_id: int, page_size: int = 500) -> set[str]:
        """All item names on a board -- used for the BPTU membership cross-check."""
        query = """
        query ($boardId: ID!, $limit: Int!, $cursor: String) {
          boards(ids: [$boardId]) {
            items_page(limit: $limit, cursor: $cursor) {
              cursor
              items { id name }
            }
          }
        }
        """
        names: set[str] = set()
        cursor: Optional[str] = None
        while True:
            data = self.execute(query, {"boardId": str(board_id),
                                        "limit": page_size, "cursor": cursor})
            boards = data.get("boards") or []
            if not boards:
                break
            page = boards[0]["items_page"]
            for item in page["items"]:
                names.add(item["name"])
            cursor = page.get("cursor")
            if not cursor:
                break
        return names


# --- helpers -----------------------------------------------------------------
def column_map(item: dict) -> dict[str, str]:
    """Flatten column_values to {id: text}, preferring a mirror's display_value.

    Mirror columns return null through `text`; they must be read from
    display_value and, since monday cannot aggregate them server-side,
    summed in code.
    """
    out: dict[str, str] = {}
    for cv in item.get("column_values") or []:
        value = cv.get("display_value") or cv.get("text") or ""
        out[cv["id"]] = value
    return out


def parse_number(raw: Optional[str]) -> Optional[float]:
    """None when blank -- an absent value is not zero."""
    if raw is None:
        return None
    s = str(raw).replace("$", "").replace(",", "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_date(raw: Optional[str]) -> Optional[dt.date]:
    if not raw:
        return None
    s = str(raw).strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(s[:len(fmt) + 2], fmt).date()
        except ValueError:
            continue
    try:
        return dt.date.fromisoformat(s[:10])
    except ValueError:
        return None
