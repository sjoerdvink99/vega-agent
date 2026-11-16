import json
from pathlib import Path

import pytest

import vega_agent as va

CASES = json.loads((Path(__file__).parents[2] / "grammar" / "tables.json").read_text())


def _traces(runs):
    for run in runs:
        process = va.trace(run["process"]).process
        time = tuple(tuple(each) if each else None for each in run["time"])
        meta = {"group": run["group"]} if "group" in run else {}
        yield va.Trace(process, run["id"], time, meta)


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_tables(case):
    found = va.tables(_traces(case["runs"]))
    for name, rows in case["tables"].items():
        assert json.loads(getattr(found, name).to_json(orient="records")) == rows
