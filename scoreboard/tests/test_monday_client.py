"""The GraphQL contract, and which failures are worth retrying.

The date-range query declared `$col: String!` while monday's ItemsQueryRule
expects `ID!`. Every pull failed with a schema error, and because the retry
loop treated it as transient it failed five times over 15 seconds before
surfacing anything. Validated against the live API after the fix.
"""
import pytest

from hbs_scoreboard import monday_client as mc


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = str(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, payload, status=200):
        self.payload, self.status, self.calls = payload, status, 0

    def post(self, *a, **kw):
        self.calls += 1
        self.captured = kw.get("json")
        return FakeResponse(self.payload, self.status)


def client(session):
    return mc.MondayClient(api_key="test-key", session=session, max_retries=5)


def test_column_id_variable_is_declared_as_id_not_string():
    """Regression: `$col: String!` is rejected where ItemsQueryRule wants ID!."""
    session = FakeSession({"data": {"boards": [{"items_page": {"cursor": None,
                                                               "items": []}}]}})
    import datetime as dt
    list(client(session).items_by_date_range(
        1069742731, "date4", dt.date(2026, 9, 1), dt.date(2026, 9, 30), ["date4"]))
    query = session.captured["query"]
    assert "$col: ID!" in query
    assert "$col: String!" not in query


def test_a_bad_query_fails_immediately_instead_of_retrying():
    """A schema error fails identically every time; retrying only buries it."""
    session = FakeSession({"errors": [
        {"message": 'Variable "$col" of type "String!" used in position '
                    'expecting type "ID!".'}]})
    with pytest.raises(mc.MondayQueryError):
        client(session).execute("query { me { id } }")
    assert session.calls == 1, "a malformed query must not be retried"


def test_rate_and_complexity_limits_are_retried():
    session = FakeSession({"errors": [{"message": "Complexity budget exhausted"}]})
    with pytest.raises(mc.MondayError) as exc:
        client(session).execute("query { me { id } }")
    assert not isinstance(exc.value, mc.MondayQueryError)
    assert session.calls == 5, "a transient limit should use every attempt"


def test_missing_key_is_refused_before_any_call(monkeypatch):
    monkeypatch.delenv("MONDAY_API_KEY", raising=False)
    session = FakeSession({"data": {}})
    with pytest.raises(mc.MondayAuthError):
        mc.MondayClient(api_key="", session=session).execute("query { me { id } }")
    assert session.calls == 0


def test_mirror_columns_are_read_from_display_value():
    """Mirror columns return null through `text`; only display_value has it."""
    item = {"column_values": [
        {"id": "lookup_mm70wevh", "text": None, "display_value": "12,500"},
        {"id": "text", "text": "BGE"},
    ]}
    cols = mc.column_map(item)
    assert cols["lookup_mm70wevh"] == "12,500"
    assert cols["text"] == "BGE"
