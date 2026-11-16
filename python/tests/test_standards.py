import json
from pathlib import Path

import pytest

import vega_agent as va

CASES = json.loads((Path(__file__).parents[2] / "grammar" / "standards.json").read_text())
MAPPINGS = json.loads((Path(__file__).parents[2] / "grammar" / "mappings.json").read_text())
SPEC = (
    "model -> (tool.search | tool.fetch) -> (model -> tool.write!? || code.check)* -> agent.review{ model -> human? }"
)


@pytest.mark.parametrize("case", CASES, ids=[case["standard"] for case in CASES])
def test_reads_standard(case):
    [run] = va.read(case["input"], case["reader"])
    assert str(run) == case["expected"]
    assert run.meta.get("agent") == case.get("agent", run.meta.get("agent"))


@pytest.mark.parametrize("case", CASES, ids=[case["standard"] for case in CASES])
def test_detects_standard(case):
    assert [str(run) for run in va.read(case["input"])] == [case["expected"]]


@pytest.mark.parametrize("case", MAPPINGS["valid"], ids=[case["name"] for case in MAPPINGS["valid"]])
def test_reads_mapping(case):
    runs = va.read(case["input"], case["trace"])
    found = [(run.id, str(run), run.meta.get("group"), run.meta.get("agent")) for run in runs]
    assert found == [(run["id"], run["process"], run.get("group"), run.get("agent")) for run in case["expected"]]
    for run, expected in zip(runs, case["expected"], strict=True):
        if "time" in expected:
            time = run.time or [None] * len(list(run.steps()))
            assert [list(each) if each else None for each in time] == expected["time"]


@pytest.mark.parametrize("case", MAPPINGS["invalid"], ids=[case["reason"] for case in MAPPINGS["invalid"]])
def test_rejects_mapping(case):
    with pytest.raises(TypeError):
        va.read([], case["trace"])


def test_otel_round_trip():
    runs = va.sample(SPEC, 20, seed=3)
    back = va.read(va.to_otel(runs))
    assert [str(run) for run in back] == [str(run) for run in runs]


def test_otel_export_follows_genai_conventions():
    [span] = va.to_otel([va.trace("tool.search!")])["resourceSpans"][0]["scopeSpans"][0]["spans"]
    attributes = {item["key"]: item["value"]["stringValue"] for item in span["attributes"]}
    assert span["name"] == "execute_tool search" and span["status"]["code"] == 2
    assert attributes["gen_ai.operation.name"] == "execute_tool" and attributes["gen_ai.tool.name"] == "search"


def test_process_tree_text():
    assert (
        va.to_process_tree("model -> (tool.a || tool.b) -> (model | human)?")
        == "->( 'model', +( 'tool.a', 'tool.b' ), X( tau, X( 'model', 'human' ) ) )"
    )


pm4py = pytest.importorskip("pm4py")


def _log(tmp_path, runs):
    path = tmp_path / "log.xes"
    path.write_text(va.to_xes(runs))
    return pm4py.read_xes(str(path))


def test_pm4py_reads_xes(tmp_path):
    runs = va.sample(SPEC, 10, seed=1)
    log = _log(tmp_path, runs)
    assert len(log) == sum(len(list(run.steps())) for run in runs)


def test_pm4py_reads_ocel(tmp_path):
    runs = va.sample(SPEC, 10, seed=2)
    path = tmp_path / "log.jsonocel"
    path.write_text(json.dumps(va.to_ocel(runs)))
    ocel = pm4py.read_ocel2_json(str(path))
    assert len(ocel.events) == sum(len(list(run.steps())) for run in runs)
    assert set(ocel.objects["ocel:type"]) == {"run", "agent"}


def test_sampled_runs_fit_the_exported_process_tree(tmp_path):
    runs = va.sample(SPEC, 40, seed=4)
    tree = pm4py.parse_process_tree(va.to_process_tree(SPEC))
    fitness = pm4py.fitness_alignments(_log(tmp_path, runs), *pm4py.convert_to_petri_net(tree))
    assert fitness["percentage_of_fitting_traces"] == 100


def test_sampled_runs_fit_the_exported_bpmn(tmp_path):
    spec = "model -> (tool.search || tool.fetch) -> (tool.write | human.approve) -> model"
    path = tmp_path / "model.bpmn"
    path.write_text(va.to_bpmn(spec))
    net = pm4py.convert_to_petri_net(pm4py.read_bpmn(str(path)))
    fitness = pm4py.fitness_alignments(_log(tmp_path, va.sample(spec, 20, seed=5)), *net)
    assert fitness["percentage_of_fitting_traces"] == 100


def test_pm4py_reads_bpmn_with_scopes_and_loops(tmp_path):
    path = tmp_path / "model.bpmn"
    path.write_text(va.to_bpmn(SPEC))
    assert pm4py.read_bpmn(str(path)) is not None
