"""monday.com GraphQL API v2 client: retry, cursor pagination, rate-limit handling.

Item queries always include the MirrorValue / FormulaValue / BoardRelationValue fragments —
those column types return null `text` through plain item queries.
"""
from __future__ import annotations

import logging
import random
import re
import time
from typing import Callable, Iterator

import requests

log = logging.getLogger(__name__)

ITEM_FIELDS = """
fragment ItemFields on Item {
  id
  name
  group { id title }
  column_values {
    id
    type
    text
    value
    ... on MirrorValue { display_value }
    ... on FormulaValue { display_value }
    ... on BoardRelationValue { display_value }
  }
}
"""

META_QUERY = """
query ($ids: [ID!]) {
  boards(ids: $ids) {
    id name items_count
    groups { id title }
    columns { id title type }
  }
}
"""

FIRST_PAGE = ITEM_FIELDS + """
query ($ids: [ID!], $limit: Int!) {
  boards(ids: $ids) {
    items_page(limit: $limit) { cursor items { ...ItemFields } }
  }
}
"""

NEXT_PAGE = ITEM_FIELDS + """
query ($cursor: String!, $limit: Int!) {
  next_items_page(limit: $limit, cursor: $cursor) { cursor items { ...ItemFields } }
}
"""

RATE_LIMIT_CODES = {
    "complexity_budget_exhausted", "complexityexception", "rate_limit_exceeded",
    "ratelimitexceeded", "maxconcurrencyexceeded", "max_concurrency_exceeded",
    "ip_rate_limit_exceeded", "field_limit_exceeded", "fieldminutelyratelimitexceeded",
}
RETRY_SECONDS_RE = re.compile(r"(\d+)\s*seconds?", re.I)


class MondayError(Exception):
    pass


class MondayAuthError(MondayError):
    pass


class CursorExpired(MondayError):
    pass


class MondayClient:
    def __init__(self, token: str, api_url: str = "https://api.monday.com/v2",
                 api_version: str = "2025-04", page_size: int = 500, max_retries: int = 6,
                 max_wait: float = 120.0, post: Callable | None = None,
                 sleep: Callable[[float], None] = time.sleep, timeout: float = 90.0):
        if not token:
            raise MondayAuthError("No monday API token (set MONDAY_API_KEY).")
        self.token = token
        self.api_url = api_url
        self.api_version = api_version
        self.page_size = page_size
        self.max_retries = max_retries
        self.max_wait = max_wait
        self.timeout = timeout
        self._sleep = sleep
        if post is None:
            session = requests.Session()
            post = session.post
        self._post = post
        self.requests_made = 0

    # -- transport ----------------------------------------------------------------------

    def _backoff(self, attempt: int) -> float:
        return min(self.max_wait, (2 ** attempt) + random.uniform(0, 1))

    def _wait(self, seconds: float, why: str) -> None:
        if seconds > self.max_wait:
            raise MondayError(f"{why}; monday asks to wait {seconds:.0f}s, longer than max_wait.")
        log.warning("monday: %s — waiting %.1fs", why, seconds)
        self._sleep(seconds)

    @staticmethod
    def _rate_limit_wait(errors: list[dict], body: dict) -> float | None:
        """Seconds to wait if the response is a rate/complexity limit, else None."""
        candidates = []
        if body.get("error_code"):
            candidates.append({"code": body.get("error_code"), "message": body.get("error_message", ""),
                               "extensions": {}})
        for e in errors:
            ext = e.get("extensions") or {}
            candidates.append({"code": ext.get("code") or "", "message": e.get("message", ""),
                               "extensions": ext})
        for c in candidates:
            code = str(c["code"]).lower()
            msg = str(c["message"])
            if code in RATE_LIMIT_CODES or "complexity budget" in msg.lower() or "rate limit" in msg.lower():
                ext = c["extensions"]
                secs = ext.get("retry_in_seconds")
                if secs is None:
                    m = RETRY_SECONDS_RE.search(msg)
                    secs = int(m.group(1)) if m else 30
                return float(secs) + 1
        return None

    def execute(self, query: str, variables: dict | None = None) -> dict:
        headers = {"Authorization": self.token, "API-Version": self.api_version,
                   "Content-Type": "application/json"}
        last = None
        for attempt in range(self.max_retries + 1):
            try:
                resp = self._post(self.api_url, json={"query": query, "variables": variables or {}},
                                  headers=headers, timeout=self.timeout)
                self.requests_made += 1
            except (requests.ConnectionError, requests.Timeout) as e:
                last = f"network error: {e}"
                self._wait(self._backoff(attempt), last)
                continue
            status = resp.status_code
            if status in (401, 403):
                raise MondayAuthError(f"monday rejected the token (HTTP {status}).")
            if status == 429:
                ra = resp.headers.get("Retry-After")
                last = "HTTP 429"
                self._wait(float(ra) + 1 if ra and ra.isdigit() else self._backoff(attempt), last)
                continue
            if status >= 500:
                last = f"HTTP {status}"
                self._wait(self._backoff(attempt), last)
                continue
            try:
                body = resp.json()
            except ValueError:
                last = f"non-JSON response (HTTP {status})"
                self._wait(self._backoff(attempt), last)
                continue
            errors = body.get("errors") or []
            wait = self._rate_limit_wait(errors, body)
            if wait is not None:
                last = "rate/complexity limit"
                self._wait(wait, last)
                continue
            if errors or body.get("error_code") or body.get("error_message"):
                msgs = "; ".join(e.get("message", "?") for e in errors) or body.get("error_message")
                if any("cursor" in (e.get("message", "").lower()) and "expire" in e.get("message", "").lower()
                       for e in errors):
                    raise CursorExpired(msgs)
                # Partial data is not trusted: an error anywhere fails the pull.
                raise MondayError(f"monday API error: {msgs}")
            if status >= 400:
                raise MondayError(f"HTTP {status}: {str(body)[:300]}")
            return body.get("data") or {}
        raise MondayError(f"monday request failed after {self.max_retries + 1} attempts ({last}).")

    # -- boards -------------------------------------------------------------------------

    def board_meta(self, board_id: int | str) -> dict:
        data = self.execute(META_QUERY, {"ids": [str(board_id)]})
        boards = data.get("boards") or []
        if not boards:
            raise MondayError(f"Board {board_id} not found or not visible to this token.")
        return boards[0]

    def iter_items(self, board_id: int | str, page_size: int | None = None) -> Iterator[dict]:
        limit = page_size or self.page_size
        data = self.execute(FIRST_PAGE, {"ids": [str(board_id)], "limit": limit})
        boards = data.get("boards") or []
        if not boards:
            raise MondayError(f"Board {board_id} not found or not visible to this token.")
        page = boards[0]["items_page"]
        yield from page["items"]
        cursor = page.get("cursor")
        while cursor:
            page = self.execute(NEXT_PAGE, {"cursor": cursor, "limit": limit})["next_items_page"]
            yield from page["items"]
            cursor = page.get("cursor")

    def fetch_board(self, board_id: int | str, page_size: int | None = None) -> dict:
        """Full pull of one board. Restarts once if the 60-minute cursor expires mid-pull."""
        meta = self.board_meta(board_id)
        for attempt in range(2):
            try:
                items = list(self.iter_items(board_id, page_size))
                break
            except CursorExpired:
                if attempt:
                    raise
                log.warning("monday: cursor expired on board %s, restarting pull", board_id)
        seen, unique = set(), []
        for it in items:  # pagination can repeat an item if the board changes mid-pull
            if it["id"] not in seen:
                seen.add(it["id"])
                unique.append(it)
        return {"meta": meta, "items": unique}
