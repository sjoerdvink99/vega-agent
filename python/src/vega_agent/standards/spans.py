from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from ..syntax import EMPTY, Step
from ..trace import Trace, is_ground, parents, timing, walk
from .conventions import CONVENTIONS, OPERATIONS, classify, failed, kind, named
from .records import (
    MICROSECONDS,
    READ_DEPTH,
    Records,
    dicts,
    first,
    identifier,
    listed,
    mapping,
    records,
    seconds,
    text,
)
from .schedule import intervals
from .timed import Timed, arrange, timed_sequence, timed_step

NAMED = ("tool", "agent", "code")

Kind = tuple[str, str | None] | None


@dataclass(frozen=True)
class Span:
    id: str
    parent: str | None
    trace: str
    title: str
    start: float | None
    end: float | None
    failed: bool
    kind: Kind

    @property
    def begins(self) -> float:
        return next((value for value in (self.start, self.end) if value is not None), 0.0)

    @property
    def ends(self) -> float:
        return max(self.begins, self.end if self.end is not None else self.begins)


def otel(source: Records) -> list[Trace]:
    return build(_span(span, index) for index, span in enumerate(_otlp(records(source))))


def openai_agents(source: Records) -> list[Trace]:
    spans = _flatten(records(source), "spans")
    return build(_openai(span, index) for index, span in enumerate(spans) if isinstance(span.get("span_data"), dict))


def langsmith(source: Records) -> list[Trace]:
    return build(_langsmith(run, index) for index, run in enumerate(_flatten(records(source), "child_runs")))


def langfuse(source: Records) -> list[Trace]:
    return build(_langfuse(item, trace, index) for index, (item, trace) in enumerate(_observations(records(source))))


def build(spans: Iterable[Span]) -> list[Trace]:
    traces: dict[str, list[Span]] = defaultdict(list)
    for span in spans:
        traces[span.trace].append(span)
    return [run for trace_id, group in traces.items() if (run := _trace(trace_id, group)) is not None]


class _Tree:
    def __init__(self, spans: list[Span]):
        known = {span.id for span in spans}
        self.children: dict[str | None, list[Span]] = defaultdict(list)
        for span in spans:
            self.children[span.parent if span.parent in known else None].append(span)
        self.visited: set[int] = set()

    def arranged(self, spans: list[Span], depth: int) -> Timed:
        fresh = [span for span in spans if id(span) not in self.visited]
        built = ((span, self.built(span, depth)) for span in fresh)
        return arrange((span.begins, span.ends, each) for span, each in built if each.node != EMPTY)

    def built(self, span: Span, depth: int) -> Timed:
        self.visited.add(id(span))
        kids = self.children[span.id] if depth < READ_DEPTH else []
        if span.kind is None or (span.kind[0] == "code" and kids):
            return self.arranged(kids, depth)
        start, end = span.start, span.end
        interval = (start, end) if start is not None and end is not None and end >= start else None
        actor, name = span.kind
        body = self.arranged(kids, depth + 1) if kids else Timed()
        return timed_step(Step(actor, identifier(name), failed=span.failed), interval, body)


def _trace(trace_id: str, spans: list[Span]) -> Trace | None:
    tree = _Tree(spans)
    process = tree.arranged(tree.children[None], 0)
    while rest := [span for span in spans if id(span) not in tree.visited]:
        process = timed_sequence((process, tree.arranged([min(rest, key=lambda span: span.begins)], 0)))
    node, time = process.node, process.time
    if next(walk(node), None) is None or not is_ground(node):
        return None
    meta: dict[str, object] = {}
    if isinstance(node, Step) and node.actor == "agent" and node.body is not None:
        meta["agent"] = node.name
        node, time = node.body, time[1:]
    return Trace(node, trace_id, timing(time), meta)


def _kind(found: Kind, explicit: str | None, title: str) -> Kind:
    if found is None:
        return None
    actor, default = found
    words = title.split()
    fallback = words[-1] if actor in NAMED and words and words[-1] not in OPERATIONS else None
    return actor, explicit or default or fallback


def _flatten(items: Iterable, key: str) -> Iterator[dict]:
    for item in dicts(items):
        yield item
        yield from _flatten(listed(item.get(key)), key)


def _otlp(items: Iterable) -> Iterator[dict]:
    for item in dicts(items):
        batches = first(item.get("resourceSpans"), item.get("batches"))
        data = item.get("data")
        if isinstance(batches, list):
            for resource in dicts(batches):
                scopes = first(resource.get("scopeSpans"), resource.get("instrumentationLibrarySpans"))
                for scope in dicts(listed(scopes)):
                    yield from dicts(listed(scope.get("spans")))
        elif isinstance(data, dict) and "spans" in data:
            yield from dicts(listed(data["spans"]))
        elif isinstance(data, list) or ("traceID" in item and "spans" in item):
            for each in dicts(data if isinstance(data, list) else [item]):
                yield from dicts(listed(each.get("spans")))
        else:
            yield item


def _attributes(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    pairs = (item for item in dicts(listed(raw)) if "key" in item)
    return {str(item["key"]): _attribute(item.get("value")) for item in pairs}


def _attribute(value):
    if isinstance(value, dict):
        return next(iter(value.values()), None)
    return value


def parent(value, ident: str) -> str | None:
    parent = text(value) if value else None
    return None if parent == ident else parent


def _span(span: dict, index: int) -> Span:
    return _jaeger(span, index) if "spanID" in span else _otel(span, index)


def _otel(span: dict, index: int) -> Span:
    context = mapping(span.get("context"))
    status = mapping(span.get("status"))
    attributes = _attributes(span.get("attributes"))
    title = text(span.get("name")) or ""
    found = classify(attributes)
    ident = text(first(span.get("spanId"), span.get("span_id"), context.get("span_id"))) or f"#{index}"
    code = first(status.get("code"), status.get("status_code"), span.get("status_code"))
    return Span(
        id=ident,
        parent=parent(span.get("parentSpanId") or span.get("parent_span_id") or span.get("parent_id"), ident),
        trace=text(first(span.get("traceId"), span.get("trace_id"), context.get("trace_id"))) or "",
        title=title,
        start=seconds(first(span.get("startTimeUnixNano"), span.get("start_time_unix_nano"), span.get("start_time"))),
        end=seconds(first(span.get("endTimeUnixNano"), span.get("end_time_unix_nano"), span.get("end_time"))),
        failed=failed(code, attributes, span.get("events")),
        kind=_kind(found, found and named(found[0], attributes), title),
    )


def _jaeger(span: dict, index: int) -> Span:
    tags = _attributes(span.get("tags"))
    title = text(span.get("operationName")) or ""
    found = classify(tags)
    ident = text(span.get("spanID")) or f"#{index}"
    parents = [ref for ref in dicts(listed(span.get("references"))) if ref.get("refType") == "CHILD_OF"]
    start = seconds(span.get("startTime"), MICROSECONDS)
    duration = seconds(span.get("duration"), MICROSECONDS)
    erred = tags.get("error") is True or tags.get("error") == "true" or tags.get("otel.status_code") == "ERROR"
    return Span(
        id=ident,
        parent=parent(parents[0].get("spanID") if parents else None, ident),
        trace=text(span.get("traceID")) or "",
        title=title,
        start=start,
        end=start + duration if start is not None and duration is not None else None,
        failed=erred
        or failed(
            None,
            tags,
            [{"name": _attributes(log.get("fields")).get("event")} for log in dicts(listed(span.get("logs")))],
        ),
        kind=_kind(found, found and named(found[0], tags), title),
    )


def _openai(span: dict, index: int) -> Span:
    data = span["span_data"]
    title = text(data.get("name")) or text(data.get("type")) or ""
    found = kind("openai-agents", data.get("type"))
    ident = text(span.get("id")) or f"#{index}"
    return Span(
        id=ident,
        parent=parent(span.get("parent_id"), ident),
        trace=text(span.get("trace_id")) or "",
        title=title,
        start=seconds(span.get("started_at")),
        end=seconds(span.get("ended_at")),
        failed=bool(span.get("error")),
        kind=_kind(found, text(data.get("name")), title),
    )


def _observations(items: Iterable) -> Iterator[tuple[dict, str]]:
    for item in dicts(items):
        if isinstance(item.get("observations"), list):
            for observation in dicts(item["observations"]):
                yield observation, text(first(observation.get("traceId"), item.get("id"))) or ""
        else:
            yield item, text(item.get("traceId")) or ""


def _langfuse(observation: dict, trace: str, index: int) -> Span:
    title = text(observation.get("name")) or ""
    found = classify({"langfuse.observation.type": (text(observation.get("type")) or "").lower()})
    ident = text(observation.get("id")) or f"#{index}"
    return Span(
        id=ident,
        parent=parent(observation.get("parentObservationId"), ident),
        trace=trace,
        title=title,
        start=seconds(observation.get("startTime")),
        end=seconds(observation.get("endTime")),
        failed=observation.get("level") == "ERROR",
        kind=_kind(found, title if found and found[0] in NAMED else None, title),
    )


def _langsmith(run: dict, index: int) -> Span:
    found = kind("langsmith", run.get("run_type"))
    ident = text(run.get("id")) or f"#{index}"
    title = text(run.get("name")) or ""
    start = seconds(run.get("start_time"))
    return Span(
        id=ident,
        parent=parent(run.get("parent_run_id"), ident),
        trace=text(run.get("trace_id")) or ident,
        title=title,
        start=start,
        end=seconds(run.get("end_time")) or start,
        failed=bool(run.get("error")),
        kind=_kind(found, title if found and found[0] in NAMED else None, title),
    )


def to_otel(traces: Iterable[Trace], service: str = "vega-agent") -> dict:
    spans = []
    for run in traces:
        trace_id = _hex(run.id, 32)
        times = intervals(run)
        root = None
        if run.meta.get("agent"):
            root = _hex(f"{run.id}/root", 16)
            whole = (min(start for start, _ in times), max(end for _, end in times))
            spans.append(_otlp_span(Step("agent", run.meta["agent"]), trace_id, root, None, whole))
        owners = parents(run.process)
        for position, (step, _) in enumerate(walk(run.process)):
            owner = root if owners[position] < 0 else _span_id(run.id, owners[position])
            spans.append(_otlp_span(step, trace_id, _span_id(run.id, position), owner, times[position]))
    resource = {"attributes": [_value("service.name", service)]}
    return {
        "resourceSpans": [{"resource": resource, "scopeSpans": [{"scope": {"name": "vega-agent"}, "spans": spans}]}]
    }


def _otlp_span(step: Step, trace_id: str, span_id: str, parent: str | None, interval: tuple[float, float]) -> dict:
    operation = CONVENTIONS["export"].get(step.actor)
    attributes = [_value("vega_agent.actor", step.actor)]
    if operation:
        attributes.append(_value("gen_ai.operation.name", operation))
    if step.name:
        attributes.append(_value("vega_agent.name", step.name))
        if step.actor in ("tool", "agent"):
            attributes.append(_value(f"gen_ai.{step.actor}.name", step.name))
    if step.failed:
        attributes.append(_value("error.type", "_OTHER"))
    return {
        "traceId": trace_id,
        "spanId": span_id,
        "parentSpanId": parent or "",
        "name": " ".join(part for part in (operation or step.actor, step.name) if part),
        "kind": 1,
        "startTimeUnixNano": str(round(interval[0] * 1e9)),
        "endTimeUnixNano": str(round(interval[1] * 1e9)),
        "attributes": attributes,
        "status": {"code": 2 if step.failed else 1},
    }


def _span_id(run_id: str, position: int) -> str:
    return _hex(f"{run_id}/{position}", 16)


def _value(key: str, value: str) -> dict:
    return {"key": key, "value": {"stringValue": value}}


def _hex(text: str, width: int) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:width]
