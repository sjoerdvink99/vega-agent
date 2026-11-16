from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import replace
from pathlib import Path

from ..parser import ParseError
from ..trace import Trace, TraceError, timing, trace, walk
from .mapping import check, group_of, mapped
from .messages import claude_code, codex, messages
from .records import Records, category, dicts, listed, mapping, pick, records, text
from .spans import langfuse, langsmith, openai_agents, otel
from .trajectories import atif, openhands, swe_agent


def runs(source: Records) -> list[Trace]:
    return [run for item in records(source) if (run := _run(item)) is not None]


def _run(item) -> Trace | None:
    record = {"process": item} if isinstance(item, str) else item if isinstance(item, dict) else {}
    if not isinstance(record.get("process"), str):
        return None
    try:
        run = trace(record["process"], text(record.get("id")) or "")
    except (ParseError, TraceError, RecursionError):
        return None
    count = sum(1 for _ in walk(run.process))
    time = record.get("time")
    intervals = time if isinstance(time, list) and len(time) == count else [None] * count
    agent = text(record.get("agent"))
    return Trace(run.process, run.id, timing(map(_interval, intervals)), {"agent": agent} if agent else {})


def _interval(value) -> tuple[float, float] | None:
    if not isinstance(value, list) or len(value) != 2:
        return None
    if not all(isinstance(each, (int, float)) and not isinstance(each, bool) for each in value):
        return None
    start, end = value
    return (start, end) if end >= start and end - start < float("inf") else None


READERS: dict[str, Callable[[Records], list[Trace]]] = {
    "runs": runs,
    "otel": otel,
    "openai_agents": openai_agents,
    "langsmith": langsmith,
    "langfuse": langfuse,
    "messages": messages,
    "codex": codex,
    "claude_code": claude_code,
    "atif": atif,
    "swe_agent": swe_agent,
    "openhands": openhands,
}
FILES = {".json", ".jsonl", ".eval", ".traj"}
CODEX = {"session_meta", "response_item", "turn_context", "event_msg", "compacted"}
SAMPLE = 64


def read(source: Records, format: str | Mapping | None = None) -> list[Trace]:
    how = check(format) if isinstance(format, Mapping) else {}
    known = None if isinstance(format, Mapping) else format
    if known is not None and known not in READERS:
        raise TypeError(f"unknown format {known!r}, expected one of {', '.join(READERS)}")
    if isinstance(source, (str, Path)) and Path(source).expanduser().is_dir():
        return _directory(Path(source).expanduser(), format)
    items = list(records(source))
    reader = READERS[known or detect(items)]
    found = mapped(items, how) if "actor" in how else _partitioned(items, reader, group_of(how))
    return [run if run.id else replace(run, id=str(index)) for index, run in enumerate(found)]


def _partitioned(items: list, reader: Callable[[Records], list[Trace]], group: str | None) -> list[Trace]:
    if group is None:
        return reader(items)
    parts: dict[str, list] = {}
    for item in items:
        if (value := category(pick(item, group))) is not None:
            parts.setdefault(value, []).append(item)
    return [replace(run, meta={**run.meta, "group": name}) for name, part in parts.items() for run in reader(part)]


def detect(items: Iterable) -> str:
    for item in [item for item in items if isinstance(item, (str, dict))][:SAMPLE]:
        if isinstance(item, str) or isinstance(item.get("process"), str):
            return "runs"
        if (found := _format(item)) is not None:
            return found
    return "messages"


def _format(item: dict) -> str | None:
    data, context = item.get("data"), mapping(item.get("context"))
    if "resourceSpans" in item or "batches" in item:
        return "otel"
    if item.get("object") == "trace.span" or isinstance(item.get("span_data"), dict):
        return "openai_agents"
    if "run_type" in item or "child_runs" in item:
        return "langsmith"
    if isinstance(item.get("observations"), list) or "parentObservationId" in item:
        return "langfuse"
    if str(item.get("schema_version", "")).startswith("ATIF") or ("steps" in item and "agent" in item):
        return "atif"
    if text(item.get("type")) in CODEX and isinstance(item.get("payload"), dict):
        return "codex"
    if item.get("type") in ("user", "assistant") and "sessionId" in item and isinstance(item.get("message"), dict):
        return "claude_code"
    if isinstance(item.get("trajectory"), list) or str(item.get("trajectory_format", "")).startswith("mini-swe-agent"):
        return "swe_agent"
    if ("action" in item or "observation" in item) and "source" in item:
        return "openhands"
    if any(_format(event) == "openhands" for event in dicts(listed(item.get("history"))[:1])):
        return "openhands"
    if (nested := next((_format(span) for span in dicts(listed(item.get("spans"))[:1])), None)) is not None:
        return nested
    spans = isinstance(data, dict) and "spans" in data
    jaeger = ("traceID" in item and "spans" in item) or any("spans" in each for each in dicts(listed(data)))
    keys = ("spanId", "span_id", "spanID", "traceId", "trace_id", "attributes")
    if spans or jaeger or any(key in item for key in keys) or "span_id" in context:
        return "otel"
    return None


def _directory(directory: Path, format: str | Mapping | None) -> list[Trace]:
    found: list[Trace] = []
    seen: set[str] = set()
    for path in sorted(
        path for path in directory.rglob("*") if path.suffix in FILES and path.parent.name != "subagents"
    ):
        try:
            runs = read(path, format) if path.is_file() else []
        except (OSError, UnicodeError):
            continue
        for run in runs:
            unique = run if run.id not in seen else replace(run, id=f"{path.stem}/{run.id}")
            seen.add(unique.id)
            found.append(unique)
    return found
