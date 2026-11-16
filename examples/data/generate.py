import json
import random
from pathlib import Path

HERE = Path(__file__).parent

MODELS = {
    "model-a": {
        "explore": 0.15,
        "verify": 0.9,
        "fail": 0.06,
        "parallel": 0.15,
        "delegate": 0.05,
        "think": (1.2, 3.2),
    },
    "model-b": {
        "explore": 0.55,
        "verify": 0.5,
        "fail": 0.2,
        "parallel": 0.6,
        "delegate": 0.3,
        "think": (0.6, 1.8),
    },
}


class Run:
    def __init__(self, rng: random.Random, trace_id: str):
        self.rng = rng
        self.trace_id = trace_id
        self.spans = []
        self.clock = 0.0

    def span(
        self,
        name: str,
        attributes: dict,
        start: float,
        end: float,
        parent: str | None,
        failed: bool = False,
    ) -> str:
        span_id = f"{self.rng.getrandbits(64):016x}"
        self.spans.append(
            {
                "traceId": self.trace_id,
                "spanId": span_id,
                "parentSpanId": parent or "",
                "name": name,
                "startTimeUnixNano": str(int(start * 1e9)),
                "endTimeUnixNano": str(int(end * 1e9)),
                "attributes": [{"key": key, "value": {"stringValue": value}} for key, value in attributes.items()],
                "status": {"code": 2 if failed else 1},
            }
        )
        return span_id

    def chat(self, parent: str, think: tuple[float, float], model: str) -> None:
        start = self.clock
        self.clock += self.rng.uniform(*think)
        self.span(
            f"chat {model}",
            {"gen_ai.operation.name": "chat", "gen_ai.request.model": model},
            start,
            self.clock,
            parent,
        )

    def tools(self, parent: str, calls: list[tuple[str, bool]]) -> None:
        start, ends = self.clock, []
        for name, failed in calls:
            end = start + self.rng.uniform(0.08, 0.6)
            attributes = {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": name,
            }
            self.span(
                f"execute_tool {name}",
                attributes,
                start + self.rng.uniform(0, 0.02),
                end,
                parent,
                failed,
            )
            ends.append(end)
        self.clock = max(ends) + 0.01


def copilot(model: str, behaviour: dict, rng: random.Random, index: int) -> list[dict]:
    run = Run(rng, f"{model}-{index:03d}")
    root = run.span(
        "invoke_agent copilot",
        {"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": "copilot"},
        0,
        0,
        None,
    )
    turns = [[("read_range", False)] + ([("list_sheets", False)] if rng.random() < behaviour["explore"] else [])]
    for _ in range(rng.choice([1, 1, 2, 3])):
        write = [("write_range", rng.random() < behaviour["fail"])]
        if rng.random() < behaviour["parallel"]:
            write.append(("format_cells", False))
        turns.append(write)
        if write[0][1]:
            turns.append([("write_range", False)])
        if rng.random() < behaviour["verify"]:
            turns.append([("read_range", False)])
    for calls in turns:
        run.chat(root, behaviour["think"], model)
        run.tools(root, calls)
    if rng.random() < behaviour["delegate"]:
        run.chat(root, behaviour["think"], model)
        designer = run.span(
            "invoke_agent chart_designer",
            {
                "gen_ai.operation.name": "invoke_agent",
                "gen_ai.agent.name": "chart_designer",
            },
            run.clock,
            0,
            root,
        )
        start = run.clock
        run.chat(designer, behaviour["think"], model)
        run.tools(designer, [("create_chart", False)])
        run.chat(designer, behaviour["think"], model)
        delegated = next(span for span in run.spans if span["spanId"] == designer)
        delegated["startTimeUnixNano"], delegated["endTimeUnixNano"] = (
            str(int(start * 1e9)),
            str(int(run.clock * 1e9)),
        )
    run.chat(root, behaviour["think"], model)
    run.spans[0]["endTimeUnixNano"] = str(int(run.clock * 1e9))
    return run.spans


def otlp(spans: list[dict]) -> dict:
    resource = {"attributes": [{"key": "service.name", "value": {"stringValue": "excel-copilot"}}]}
    return {
        "resourceSpans": [
            {
                "resource": resource,
                "scopeSpans": [{"scope": {"name": "copilot"}, "spans": spans}],
            }
        ]
    }


def atif() -> dict:
    def call(ident, name):
        return {"tool_call_id": ident, "function_name": name, "arguments": {}}

    explorer = {
        "schema_version": "ATIF-v1.8",
        "trajectory_id": "explore-1",
        "agent": {"name": "explorer", "version": "1.0"},
        "steps": [
            {
                "step_id": 1,
                "source": "user",
                "message": "Find where totals are computed.",
            },
            {
                "step_id": 2,
                "source": "agent",
                "message": "",
                "tool_calls": [call("e1", "grep"), call("e2", "grep")],
                "observation": {
                    "results": [
                        {"source_call_id": "e1", "content": "..."},
                        {"source_call_id": "e2", "content": "..."},
                    ]
                },
            },
            {
                "step_id": 3,
                "source": "agent",
                "message": "",
                "tool_calls": [call("e3", "read_file")],
                "observation": {"results": [{"source_call_id": "e3", "content": "..."}]},
            },
            {"step_id": 4, "source": "agent", "message": "Totals live in report.py."},
        ],
    }
    return {
        "schema_version": "ATIF-v1.8",
        "trajectory_id": "fix-totals",
        "agent": {"name": "coder", "version": "1.0", "model_name": "model-b"},
        "steps": [
            {"step_id": 1, "source": "system", "message": "You are a coding agent."},
            {
                "step_id": 2,
                "source": "user",
                "message": "The monthly totals are off by one.",
            },
            {
                "step_id": 3,
                "source": "agent",
                "message": "",
                "tool_calls": [call("c1", "explore")],
                "observation": {
                    "results": [
                        {
                            "source_call_id": "c1",
                            "subagent_trajectory_ref": [{"trajectory_id": "explore-1"}],
                        }
                    ]
                },
            },
            {
                "step_id": 4,
                "source": "agent",
                "message": "",
                "tool_calls": [call("c2", "edit_file")],
                "observation": {"results": [{"source_call_id": "c2", "content": "patched"}]},
            },
            {
                "step_id": 5,
                "source": "agent",
                "message": "",
                "tool_calls": [call("c3", "run_tests")],
                "observation": {
                    "results": [
                        {
                            "source_call_id": "c3",
                            "content": "1 failed",
                            "extra": {"is_error": True},
                        }
                    ]
                },
            },
            {
                "step_id": 6,
                "source": "agent",
                "message": "",
                "tool_calls": [call("c4", "edit_file")],
                "observation": {"results": [{"source_call_id": "c4", "content": "patched"}]},
            },
            {
                "step_id": 7,
                "source": "agent",
                "message": "",
                "tool_calls": [call("c5", "run_tests")],
                "observation": {"results": [{"source_call_id": "c5", "content": "all passed"}]},
            },
            {
                "step_id": 8,
                "source": "agent",
                "message": "Fixed the off-by-one in the month boundary.",
            },
        ],
        "subagent_trajectories": [explorer],
    }


def main() -> None:
    for seed, (model, behaviour) in enumerate(MODELS.items()):
        rng = random.Random(seed)
        lines = [json.dumps(otlp(copilot(model, behaviour, rng, index))) for index in range(200)]
        (HERE / f"copilot-{model}.jsonl").write_text("\n".join(lines) + "\n")
    (HERE / "coder.atif.json").write_text(json.dumps(atif(), indent=2) + "\n")


if __name__ == "__main__":
    main()
