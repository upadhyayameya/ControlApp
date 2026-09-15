import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hbs_scoreboard import config as configmod  # noqa: E402
from hbs_scoreboard.models import KpiEvent, Stage  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_credentials():
    """Keep credential env vars from leaking between tests.

    load_dotenv assigns to os.environ directly, so a test that exercises it
    can otherwise leave MONDAY_API_KEY set and quietly make a later test
    ("refuses to run without a key") pass for the wrong reason.
    """
    import os
    names = ("MONDAY_API_KEY", "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET")
    saved = {n: os.environ.get(n) for n in names}
    try:
        yield
    finally:
        for n, v in saved.items():
            if v is None:
                os.environ.pop(n, None)
            else:
                os.environ[n] = v


@pytest.fixture
def cfg():
    return configmod.load()


def event(item_id, name, stage, utility, date, share=None, source="HBS", gross=None):
    return KpiEvent(
        item_id=str(item_id), project_name=name, stage=stage, utility_raw=utility,
        source=source, completion_date=dt.date.fromisoformat(date) if date else None,
        hbs_share=share, gross_incentive=gross if gross is not None else share,
        board_id="1069742731",
    )
