from __future__ import annotations

import pytest

from btu.monday_client import MondayAuthError, MondayClient, MondayError


class Resp:
    def __init__(self, status=200, body=None, headers=None):
        self.status_code = status
        self._body = body
        self.headers = headers or {}

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


def client(responses, **kw):
    calls, sleeps = [], []
    seq = iter(responses)

    def post(url, json, headers, timeout):
        calls.append(json)
        r = next(seq)
        if isinstance(r, Exception):
            raise r
        return r

    c = MondayClient("tok", post=post, sleep=sleeps.append, **kw)
    return c, calls, sleeps


def item(i):
    return {"id": str(i), "name": f"P{i}", "group": {"id": "g", "title": "G"}, "column_values": []}


def test_paginates_with_cursor_and_dedupes():
    meta = Resp(body={"data": {"boards": [{"id": "1", "name": "B", "items_count": 3, "groups": [], "columns": []}]}})
    p1 = Resp(body={"data": {"boards": [{"items_page": {"cursor": "c1", "items": [item(1), item(2)]}}]}})
    p2 = Resp(body={"data": {"next_items_page": {"cursor": None, "items": [item(2), item(3)]}}})
    c, calls, _ = client([meta, p1, p2])
    out = c.fetch_board(1)
    assert [i["id"] for i in out["items"]] == ["1", "2", "3"]
    assert calls[2]["variables"]["cursor"] == "c1"
    assert "MirrorValue" in calls[1]["query"] and "display_value" in calls[1]["query"]


def test_retries_complexity_budget_with_server_wait():
    limited = Resp(body={"errors": [{"message": "Complexity budget exhausted",
                                     "extensions": {"code": "COMPLEXITY_BUDGET_EXHAUSTED", "retry_in_seconds": 12}}]})
    ok = Resp(body={"data": {"me": {"id": 1}}})
    c, _, sleeps = client([limited, ok])
    assert c.execute("{ me { id } }") == {"me": {"id": 1}}
    assert sleeps == [13.0]


def test_retries_legacy_complexity_exception_and_429_and_5xx():
    legacy = Resp(body={"error_code": "ComplexityException",
                        "error_message": "Complexity budget exhausted, budget will reset in 7 seconds"})
    r429 = Resp(status=429, headers={"Retry-After": "3"})
    r502 = Resp(status=502)
    ok = Resp(body={"data": {"x": 1}})
    c, _, sleeps = client([legacy, r429, r502, ok])
    assert c.execute("q") == {"x": 1}
    assert sleeps[0] == 8.0 and sleeps[1] == 4.0 and len(sleeps) == 3


def test_auth_error_is_not_retried():
    c, calls, _ = client([Resp(status=401)])
    with pytest.raises(MondayAuthError):
        c.execute("q")
    assert len(calls) == 1


def test_graphql_error_fails_rather_than_returning_partial_data():
    c, _, _ = client([Resp(body={"data": {"boards": []}, "errors": [{"message": "Column not found"}]})])
    with pytest.raises(MondayError):
        c.execute("q")


def test_gives_up_after_max_retries():
    c, _, _ = client([Resp(status=503)] * 3, max_retries=2)
    with pytest.raises(MondayError, match="after 3 attempts"):
        c.execute("q")
