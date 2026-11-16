import copy
import json
import math
import random
import zipfile
from pathlib import Path

import pytest

import vega_agent as va

DATA = Path(__file__).parents[2] / "examples" / "data"


def span(ident, parent, name, start, end, attributes, failed=False):
    return {
        "traceId": "t",
        "spanId": ident,
        "parentSpanId": parent,
        "name": name,
        "startTimeUnixNano": str(int(start * 1e9)),
        "endTimeUnixNano": str(int(end * 1e9)),
        "attributes": [{"key": key, "value": {"stringValue": value}} for key, value in attributes.items()],
        "status": {"code": 2 if failed else 1},
    }


def test_otel_nesting_and_parallelism():
    chat = {"gen_ai.operation.name": "chat"}
    spans = [
        span(
            "r",
            "",
            "invoke_agent copilot",
            0,
            3,
            {"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "copilot"},
        ),
        span("1", "r", "chat", 0, 1, chat),
        span("2", "r", "execute_tool a", 1, 2, {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "a"}),
        span(
            "3",
            "r",
            "execute_tool b",
            1.1,
            1.5,
            {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "b"},
            failed=True,
        ),
        span("4", "r", "chat", 2, 3, chat),
    ]
    [trace] = va.read(spans)
    assert trace.meta["agent"] == "copilot"
    assert str(trace) == "model -> tool.a || tool.b! -> model"


def test_openinference_kinds():
    spans = [
        {
            "traceId": "t",
            "spanId": "1",
            "name": "llm",
            "start_time": "2026-01-01T00:00:00Z",
            "end_time": "2026-01-01T00:00:01Z",
            "attributes": {"openinference.span.kind": "LLM"},
        },
        {
            "traceId": "t",
            "spanId": "2",
            "name": "search",
            "start_time": "2026-01-01T00:00:01Z",
            "end_time": "2026-01-01T00:00:02Z",
            "attributes": {"openinference.span.kind": "TOOL", "tool.name": "web-search"},
        },
    ]
    assert str(va.read(spans)[0]) == "model -> tool.web_search"


def test_example_files():
    assert len(va.read(DATA / "copilot-model-a.jsonl")) == 200
    [coder] = va.read(DATA / "coder.atif.json")
    assert va.conforms(coder, "human -> (model -> (tool | agent{ _* })[])* -> model")
    assert va.find(coder, "tool.run_tests! -> model -> tool.edit_file")


def _lines(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(record) for record in records) + "\n{broken\n")


def _claude(kind, content, at, **extra):
    message = (
        {"role": kind, "content": content} if kind == "user" else {"id": f"m{at}", "role": kind, "content": content}
    )
    line = {
        "type": kind,
        "sessionId": "s",
        "uuid": f"u{at}",
        "timestamp": f"2026-01-01T00:00:0{at}Z",
        "message": message,
    }
    return {**line, "isSidechain": False, **extra}


def test_claude_code_sessions_pick_up_their_subagent_files(tmp_path):
    task = {"type": "tool_use", "id": "t1", "name": "Task", "input": {"subagent_type": "Explore"}}
    _lines(
        tmp_path / "s.jsonl",
        [
            _claude("user", "Look around.", 0),
            _claude("assistant", [task], 1),
            _claude("user", [{"type": "tool_result", "tool_use_id": "t1"}], 5, toolUseResult={"agentId": "a1"}),
        ],
    )
    side = {"isSidechain": True, "agentId": "a1"}
    _lines(
        tmp_path / "s" / "subagents" / "agent-a1.jsonl",
        [
            _claude("user", "Look around.", 2, **side),
            _claude("assistant", [{"type": "tool_use", "id": "g", "name": "Glob", "input": {}}], 3, **side),
            _claude("user", [{"type": "tool_result", "tool_use_id": "g"}], 4, **side),
        ],
    )
    [run] = va.read(tmp_path / "s.jsonl")
    assert str(run) == "human -> model -> agent.Explore{ model -> tool.Glob }"
    assert [str(each) for each in va.read(tmp_path)] == [str(run)]


def test_inspect_eval_archives(tmp_path):
    path = tmp_path / "log.eval"
    sample = {
        "id": 1,
        "epoch": 2,
        "messages": [{"role": "user", "content": "go"}, {"role": "assistant", "content": "ok"}],
    }
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("header.json", json.dumps({"version": 2}))
        archive.writestr("samples/1_epoch_2.json", json.dumps(sample))
    [run] = va.read(path)
    assert (run.id, str(run)) == ("1:2", "human -> model")


def test_directories_read_every_format_and_keep_ids_apart(tmp_path):
    conversation = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]
    (tmp_path / "a.json").write_text(json.dumps(conversation))
    (tmp_path / "b.json").write_text(json.dumps(conversation))
    (tmp_path / "notes.txt").write_text("ignored")
    (tmp_path / "broken.json").write_text("{")
    runs = va.read(tmp_path)
    assert [run.id for run in runs] == ["0", "b/0"]
    assert {str(run) for run in runs} == {"human -> model"}


def test_missing_files_raise():
    with pytest.raises(FileNotFoundError):
        va.read(DATA / "missing.jsonl")


def test_timestamps_are_read_strictly_and_in_utc():
    from vega_agent.standards.records import instant, seconds

    assert seconds("2026-01-01T00:00:00Z") == seconds("2026-01-01 01:00:00+01:00") == seconds("2026-01-01T00:00:00")
    assert seconds("2026-01-01T00:00:00.5Z") - seconds("2026-01-01T00:00:00Z") == 0.5
    assert [seconds(value) for value in ("2026-02-30", "2026-01-01T24:00:00Z", "Jan 1 2026", "1e400", "nan")] == [
        None
    ] * 5
    assert instant(1767225600) == instant(1767225600000) == instant(1767225600000000) == instant("2026-01-01T00:00:00Z")


CASES = json.loads((Path(__file__).parents[2] / "grammar" / "standards.json").read_text())
JUNK = [
    None,
    0,
    -1,
    3.5,
    math.nan,
    math.inf,
    True,
    "",
    "x",
    "ERROR",
    "2026-13-45T99:00:00Z",
    "1e400",
    [],
    {},
    [None],
    10**30,
    "Task",
]


def _slots(node):
    children = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else ()
    for key, child in list(children):
        yield node, key
        yield from _slots(child)


def _mutated(document, rng):
    document = copy.deepcopy(document)
    for _ in range(rng.randint(1, 4)):
        if found := list(_slots(document)):
            parent, key = rng.choice(found)
            parent[key] = copy.deepcopy(rng.choice(JUNK))
    return document


def test_readers_survive_mutated_records():
    rng = random.Random(5)
    for _ in range(600):
        case = rng.choice(CASES)
        document = _mutated(case["input"], rng)
        for kind in (case["reader"], None):
            for run in va.read(document, kind):
                assert va.is_ground(run.process)
                va.to_xes([run])
                va.to_otel([run])
