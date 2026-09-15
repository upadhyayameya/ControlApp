import datetime as dt
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hbs_scoreboard import config as configmod  # noqa: E402
from hbs_scoreboard.models import KpiEvent, Stage  # noqa: E402


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
