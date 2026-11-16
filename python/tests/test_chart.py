import json
import shutil
from pathlib import Path

import pytest

import vega_agent as va

LOOP = "(model -> tool[])* -> model"


def test_diagram_spec():
    assert va.parse(LOOP).chart().to_dict() == {"mark": "diagram", "process": LOOP, "key": True}


def test_icicle_groups():
    runs = va.sample(LOOP, 4, seed=1)
    spec = va.icicle({"old": runs, "new": runs}, level="loops", highlight="tool[2]").to_dict()
    values = spec["data"]["values"]
    assert spec["trace"] == {"group": "group"} and [run["group"] for run in values] == ["old"] * 4 + ["new"] * 4
    assert spec["highlight"] == "tool[2]" and spec["level"] == "loops"
    assert all(va.conforms(run["process"], LOOP) for run in values)


def test_more_than_two_groups_become_panels():
    runs = va.sample(LOOP, 2, seed=2)
    spec = va.variants({"a": runs, "b": runs, "c": runs}, level="names").to_dict()
    assert spec["facet"] == {"field": "group"} and "trace" not in spec
    assert spec["spec"]["mark"] == "variants" and spec["spec"]["level"] == "names"
    assert sorted({run["group"] for run in spec["data"]["values"]}) == ["a", "b", "c"]
    if shutil.which("node"):
        assert len(va.variants({"a": runs, "b": runs, "c": runs}).to_vega()["marks"]) == 3
    with pytest.raises(ValueError):
        va.variants({})


def test_grouped_traces_keep_their_group():
    events = [{"arm": arm, "kind": "llm"} for arm in ("a", "b")]
    spec = va.variants(va.read(events, {"run": "arm", "actor": "kind", "group": "arm"})).to_dict()
    assert spec["trace"] == {"group": "group"} and [run["group"] for run in spec["data"]["values"]] == ["a", "b"]


def test_trace_with_time_is_diagram_over_timeline():
    [run] = va.read(
        [
            {
                "traceId": "t",
                "spanId": "1",
                "name": "chat",
                "startTimeUnixNano": "0",
                "endTimeUnixNano": "1000000000",
                "attributes": {"gen_ai.operation.name": "chat"},
            },
            {
                "traceId": "t",
                "spanId": "2",
                "name": "search",
                "startTimeUnixNano": "1000000000",
                "endTimeUnixNano": "1500000000",
                "attributes": {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "search"},
            },
        ]
    )
    spec = run.chart().to_dict()
    assert [part["mark"] for part in spec["vconcat"]] == ["diagram", "timeline"]
    assert spec["vconcat"][1]["data"]["values"][0]["time"] == [[0.0, 1.0], [1.0, 1.5]]
    assert all(part["highlight"] == {"param": "step"} for part in spec["vconcat"])


def test_vega_is_the_compiled_view(tmp_path):
    if shutil.which("node") is None:
        pytest.skip("needs Node.js")
    chart = va.variants(va.sample(LOOP, 4, seed=7), level="names")
    vega = chart.to_vega()
    assert vega["$schema"].endswith("vega/v6.json")
    assert {"selected_store", "runs", "variants"} <= {data["name"] for data in vega["data"]}
    assert json.loads(chart.save(tmp_path / "figure.vg.json").read_text()) == vega
    assert chart.save(tmp_path / "figure.json").read_text() == chart.to_json()


def test_html_is_self_contained():
    html = va.diagram(LOOP).to_html()
    assert "vegaAgent.embed" in html and json.dumps(LOOP)[1:-1] in html


def test_specs_follow_the_view_schema():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((Path(__file__).parents[2] / "grammar" / "view.schema.json").read_text())
    runs = va.read(va.to_otel(va.sample(LOOP, 3, seed=2)))
    corpus = va.Corpus(runs)
    charts = (
        va.diagram(LOOP),
        runs[0].chart(),
        va.icicle({"a": runs, "b": runs}, highlight="tool"),
        corpus.chart(mark="variants", highlight="tool"),
        va.Diff(runs, runs).chart(mark="transitions"),
        corpus.chart(mark="sequences", x="time", highlight="tool"),
        va.hconcat(va.diagram(LOOP, title="spec"), va.sequences(corpus, limit=2)),
        va.graph(corpus, level="actors"),
        va.sankey({"a": runs, "b": runs}, level="loops", height=200),
        va.activities(corpus, limit=4),
        va.timeline(runs[0], lanes="agent"),
        va.handoffs(runs[0]),
        va.handoffs("human.user -> agent.coder{ model -> tool } -> model"),
        va.distribution({"a": runs, "b": runs}, measure="duration"),
        va.durations(corpus, level="actors", limit=3),
        va.projection(corpus, highlight="tool", height=200),
    )
    for chart in charts:
        jsonschema.validate(chart.to_dict(), schema)


def test_corpus_marks():
    runs = va.Corpus(va.sample(LOOP, 5, seed=3))
    marks = (
        "icicle",
        "variants",
        "transitions",
        "graph",
        "sankey",
        "activities",
        "sequences",
        "distribution",
        "projection",
    )
    assert [runs.chart(mark=mark).to_dict()["mark"] for mark in marks] == list(marks)
    assert va.variants(runs, limit=3).to_dict()["limit"] == 3
    with pytest.raises(ValueError):
        runs.chart(mark="pie")


def test_timed_marks_carry_time():
    runs = va.read(va.to_otel(va.sample(LOOP, 2, seed=4)))
    assert "time" not in va.distribution(runs).to_dict()["data"]["values"][0]
    assert "time" in va.distribution(runs, measure="duration").to_dict()["data"]["values"][0]
    assert "time" in va.durations(runs).to_dict()["data"]["values"][0]
    assert "time" in va.handoffs(runs[0]).to_dict()["data"]["values"][0]
    assert "time" not in va.handoffs("model -> tool").to_dict()["data"]["values"][0]
    with pytest.raises(ValueError):
        va.distribution(runs, measure="tokens")


def test_sequences_carry_time_only_when_positioned_by_time():
    runs = va.read(va.to_otel(va.sample(LOOP, 2, seed=4)))
    by_step = va.sequences(runs).to_dict()
    by_time = va.sequences(runs, x="time").to_dict()
    assert "time" not in by_step["data"]["values"][0]
    assert all(interval is not None for interval in by_time["data"]["values"][0]["time"])
    with pytest.raises(ValueError):
        va.sequences(runs, x="index")


def test_views_compose_without_nesting():
    side = va.hconcat(va.diagram("model"), va.diagram("tool"))
    assert [view["process"] for view in side.to_dict()["hconcat"]] == ["model", "tool"]
    with pytest.raises(ValueError):
        va.vconcat(side, va.diagram("model"))
    with pytest.raises(ValueError):
        va.hconcat()


def test_corpus_views_select_runs_on_click():
    runs = va.sample(LOOP, 3, seed=5)
    spec = va.variants(runs).to_dict()
    assert spec["params"] == [{"name": "selected", "select": "click"}]
    assert spec["highlight"] == {"param": "selected"}
    assert "highlight" not in va.icicle(runs).to_dict()
    assert va.variants(runs, highlight="tool").to_dict()["highlight"] == "tool"
    assert "params" not in va.sankey(runs, select=None).to_dict()
    assert va.sequences(runs, select="hover").to_dict()["params"][0]["select"] == "hover"
    with pytest.raises(ValueError):
        va.graph(runs, select="drag")


def test_properties_extend_the_spec():
    chart = va.variants(va.sample(LOOP, 2, seed=6)).properties(tooltip=["runs", {"field": "share", "title": "of runs"}])
    assert chart.to_dict()["tooltip"][1] == {"field": "share", "title": "of runs"}
    assert chart.selected == [] and chart.selection == {}


def test_timeline_lanes_are_checked():
    run = va.trace("model -> agent.worker{ model -> tool }")
    assert "lanes" not in va.timeline(run).to_dict()
    assert va.timeline(run, lanes="agent").to_dict()["lanes"] == "agent"
    with pytest.raises(ValueError):
        va.timeline(run, lanes="tool")
