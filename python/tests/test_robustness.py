import json
import random
from pathlib import Path

import pytest

import vega_agent as va

ROOT = Path(__file__).parents[2]
CHAT = {"gen_ai.operation.name": "chat"}
TOOL = {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "search"}
FORMATS = [
    None,
    "otel",
    "openai_agents",
    "langsmith",
    "langfuse",
    "messages",
    "codex",
    "claude_code",
    "atif",
    "swe_agent",
    "openhands",
]


@pytest.mark.parametrize("format", FORMATS)
@pytest.mark.parametrize("source", [None, 3, b"spans"])
def test_readers_reject_non_records(format, source):
    with pytest.raises(TypeError):
        va.read(source, format)


def test_unknown_formats_are_named():
    with pytest.raises(TypeError, match="unknown format 'jaeger'"):
        va.read([], "jaeger")


@pytest.mark.parametrize("format", FORMATS)
@pytest.mark.parametrize(
    "source", [[], [1, "x", None, []], [{"foo": 1}], [{"traceId": "t", "spanId": "1", "name": "GET"}]]
)
def test_readers_drop_records_without_agent_steps(format, source):
    assert va.read(source, format) == []


def test_parent_cycles_are_broken():
    spans = [
        {"traceId": "t", "spanId": "1", "parentSpanId": "2", "attributes": CHAT},
        {"traceId": "t", "spanId": "2", "parentSpanId": "1", "attributes": TOOL},
    ]
    assert [str(run.process) for run in va.read(spans)] == ["model{ tool.search }"]


def test_spans_without_ids_stay_apart():
    spans = [{"traceId": "t", "attributes": CHAT, "startTimeUnixNano": "1"}, {"traceId": "t", "attributes": CHAT}]
    assert str(va.read(spans)[0].process) == "model -> model"


def test_unreadable_times_fall_back_to_a_schedule():
    [run] = va.read([{"traceId": "t", "spanId": "1", "startTimeUnixNano": "soon", "attributes": CHAT}])
    assert run.time == ()
    assert va.to_xes([run]).count("<event>") == 1
    assert va.timeline(run).to_dict()["data"]["values"][0]["time"] == [None]


def test_parse_errors_point_at_the_problem():
    with pytest.raises(va.ParseError) as error:
        va.parse("model -> robot")
    assert (error.value.position, error.value.reason.startswith("unknown actor")) == (9, True)
    with pytest.raises(TypeError):
        va.parse(None)


@pytest.mark.parametrize(
    "build",
    [
        lambda: va.icicle(["model"], level="steps"),
        lambda: va.variants(["model"], limit=0),
        lambda: va.transitions(["model"], limit=2.5),
        lambda: va.icicle(["model"], height=-1),
        lambda: va.icicle({}),
        lambda: va.Corpus(["model"]).chart(mark="pie"),
    ],
)
def test_chart_arguments_are_checked(build):
    with pytest.raises(ValueError):
        build()


def test_view_specs_follow_the_shared_contract():
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((ROOT / "grammar" / "view.schema.json").read_text())
    cases = json.loads((ROOT / "grammar" / "specs.json").read_text())
    validator = jsonschema.Draft7Validator(schema)
    for spec in cases["valid"]:
        assert not list(validator.iter_errors(spec)), spec
    for case in cases["invalid"]:
        if case["schema"]:
            assert list(validator.iter_errors(case["spec"])), case["path"]


def test_versions_agree():
    package = json.loads((ROOT / "js" / "package.json").read_text())
    assert va.__version__ == package["version"]
    assert f'"{va.__version__}"' in (ROOT / "js" / "src" / "version.ts").read_text()


@pytest.mark.parametrize("seed", range(25))
def test_sampled_runs_survive_every_export(seed):
    spec = random.Random(seed).choice(
        [
            "(model -> tool[])* -> model",
            "model.route -> (agent.billing{ model -> tool.refund? } | model.answer) -> human.approve?",
            "model.plan -> agent.worker{ (model -> tool[])+ -> model }[] -> model",
        ]
    )
    runs = va.sample(spec, 4, seed=seed)
    assert all(va.conforms(run, spec) for run in runs)
    back = va.read(va.to_otel(runs))
    assert [str(run.process) for run in back] == [str(run.process) for run in runs]
    va.to_xes(back)
    va.to_ocel(back)
    for mark in ("icicle", "variants", "transitions"):
        va.Corpus(back).chart(mark=mark).to_json()


def test_html_export_escapes_the_title():
    page = va.diagram("model", title="</title><script>alert(1)</script>").to_html()
    assert "<script>alert(1)" not in page and "&lt;/title&gt;" in page


def test_empty_parallel_copies_export_as_silent_steps():
    assert va.to_process_tree("model[0] -> tool") == "->( tau, 'tool' )"


def test_readers_skip_runs_larger_than_a_trace():
    spans = [{"traceId": "t", "spanId": str(k), "attributes": CHAT} for k in range(va.MAX_STEPS + 1)]
    assert va.read(spans) == []


def test_deep_inputs_raise_located_errors():
    with pytest.raises(va.ParseError) as error:
        va.parse("(" * (va.MAX_DEPTH + 1) + "model" + ")" * (va.MAX_DEPTH + 1))
    assert error.value.position == va.MAX_DEPTH
