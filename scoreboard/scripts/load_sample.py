#!/usr/bin/env python3
"""Load the captured monday sample into a local cache, for smoke-testing.

The sample is REAL data from board 1069742731, but only the first page of a
September pull. It exists so the pipeline and dashboard can be exercised
without an API key. It is never a reporting source -- run `cli pull` for that.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from hbs_scoreboard import store                       # noqa: E402
from hbs_scoreboard.models import GROUP_TO_STAGE, KpiEvent  # noqa: E402
from hbs_scoreboard.monday_client import parse_date    # noqa: E402

FIXTURE = Path(__file__).parent.parent / "tests" / "fixtures" / "monday_sept_sample.json"


def main(db: str) -> int:
    blob = json.loads(FIXTURE.read_text())
    print(f"provenance: {blob['_provenance']['completeness']}")
    events = []
    for item_id, name, group, utility, source, date, gross, share in blob["items"]:
        stage = GROUP_TO_STAGE.get(group)
        if stage is None:
            continue
        events.append(KpiEvent(
            item_id=item_id, project_name=name, stage=stage, utility_raw=utility,
            source=source, completion_date=parse_date(date), hbs_share=share,
            gross_incentive=gross, board_id="1069742731"))
    conn = store.connect(db)
    n = store.save_events(conn, events)
    store.record_pull(conn, "2026-09", n, True, "sample fixture (partial)")
    conn.close()
    print(f"loaded {n} real monday items into {db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1] if len(sys.argv) > 1 else str(store.DEFAULT_DB)))
