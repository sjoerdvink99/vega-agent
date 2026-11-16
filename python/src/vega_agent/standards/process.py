from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from itertools import count, pairwise
from xml.sax.saxutils import quoteattr

from ..parser import parse
from ..syntax import ANY, Alt, Node, Par, Repeat, Seq, Step
from ..trace import Trace, parents, walk
from .schedule import intervals

XES = "http://www.xes-standard.org/"
BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL"
TASKS = {"model": "task", "tool": "serviceTask", "human": "userTask", "code": "scriptTask", "agent": "callActivity"}


def activity(step: Step) -> str:
    return f"{step.actor}.{step.name}" if step.name else step.actor


def _iso(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _events(run: Trace) -> list[tuple[int, Step, int, float, float]]:
    times = intervals(run)
    steps = [(position, step, depth, *times[position]) for position, (step, depth) in enumerate(walk(run.process))]
    return sorted(steps, key=lambda event: event[3])


def to_xes(traces: Iterable[Trace]) -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<log xes.version="1849-2016" xes.features="nested-attributes" xmlns="{XES}">',
        f'  <extension name="Concept" prefix="concept" uri="{XES}concept.xesext"/>',
        f'  <extension name="Time" prefix="time" uri="{XES}time.xesext"/>',
        '  <classifier name="Activity" keys="concept:name"/>',
    ]
    for run in traces:
        lines.append(f'  <trace>\n    <string key="concept:name" value={quoteattr(run.id)}/>')
        for _, step, depth, start, end in _events(run):
            lines += [
                "    <event>",
                f'      <string key="concept:name" value={quoteattr(activity(step))}/>',
                f'      <date key="time:timestamp" value="{_iso(start)}"/>',
                f'      <string key="vega_agent:actor" value="{step.actor}"/>',
                f'      <boolean key="vega_agent:failed" value="{str(step.failed).lower()}"/>',
                f'      <int key="vega_agent:depth" value="{depth}"/>',
                f'      <float key="vega_agent:duration" value="{end - start:.6f}"/>',
                "    </event>",
            ]
        lines.append("  </trace>")
    return "\n".join([*lines, "</log>", ""])


def to_ocel(traces: Iterable[Trace]) -> dict:
    objects, events, types = [], [], {}
    for run in traces:
        objects.append({"id": f"run:{run.id}", "type": "run", "attributes": [], "relationships": []})
        owners = parents(run.process)
        context = [f"run:{run.id}" if owner < 0 else f"agent:{run.id}:{owner}" for owner in owners]
        for position, (step, _) in enumerate(walk(run.process)):
            if step.body is not None:
                part = {"objectId": context[position], "qualifier": "part of"}
                objects.append(
                    {"id": f"agent:{run.id}:{position}", "type": "agent", "attributes": [], "relationships": [part]}
                )
        for position, step, _, start, end in _events(run):
            name = activity(step)
            types[name] = None
            related = [{"objectId": f"run:{run.id}", "qualifier": "run"}]
            if owners[position] >= 0:
                related.append({"objectId": context[position], "qualifier": "context"})
            if step.body is not None:
                related.append({"objectId": f"agent:{run.id}:{position}", "qualifier": "opens"})
            events.append(
                {
                    "id": f"{run.id}:{position}",
                    "type": name,
                    "time": _iso(start),
                    "attributes": [
                        {"name": "failed", "value": step.failed},
                        {"name": "duration", "value": round(end - start, 6)},
                    ],
                    "relationships": related,
                }
            )
    attributes = [{"name": "failed", "type": "boolean"}, {"name": "duration", "type": "float"}]
    return {
        "objectTypes": [{"name": "run", "attributes": []}, {"name": "agent", "attributes": []}],
        "eventTypes": [{"name": name, "attributes": attributes} for name in types],
        "objects": objects,
        "events": events,
    }


def to_process_tree(spec: Node | str) -> str:
    return _tree(parse(spec))


def _tree(node: Node) -> str:
    match node:
        case Step(actor=actor) if actor == ANY:
            raise ValueError("the wildcard '_' has no process tree equivalent")
        case Step(body=None):
            return f"'{activity(node)}'"
        case Step(body=Node() as body):
            return f"->( '{activity(node)}', {_tree(body)} )"
        case Seq(items=()):
            return "tau"
        case Seq():
            return _operator("->", node.items)
        case Par():
            return _operator("+", node.branches)
        case Alt():
            return _operator("X", node.options)
        case Repeat():
            return _repeat(node)
    raise TypeError(f"not a process node: {node!r}")


def _operator(symbol: str, nodes: tuple[Node, ...]) -> str:
    if len(nodes) == 1:
        return _tree(nodes[0])
    return f"{symbol}( {', '.join(map(_tree, nodes))} )"


def _repeat(node: Repeat) -> str:
    body = _tree(node.node)
    required = [body] * node.lo
    optional = [f"X( tau, *( {body}, tau ) )"] if node.hi is None else [f"X( tau, {body} )"] * (node.hi - node.lo)
    parts = required + optional
    if not parts:
        return "tau"
    return parts[0] if len(parts) == 1 else f"{'+' if node.parallel else '->'}( {', '.join(parts)} )"


def to_bpmn(spec: Node | str, name: str = "process") -> str:
    builder = _Bpmn()
    start, end = builder.node("startEvent"), builder.node("endEvent")
    entry, leave = builder.fragment(parse(spec))
    builder.flow(start, entry)
    builder.flow(leave, end)
    body = "\n".join(f"    {line}" for line in builder.lines)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<definitions xmlns="{BPMN}" id="definitions" targetNamespace="https://sjoerdvink99.github.io/vega-agent/bpmn">\n'
        f'  <process id="process" name={quoteattr(name)} isExecutable="false">\n{body}\n  </process>\n'
        "</definitions>\n"
    )


class _Bpmn:
    def __init__(self):
        self.lines: list[str] = []
        self.ids = count()

    def node(self, tag: str, name: str | None = None, inner: str = "") -> str:
        ident = f"{tag}_{next(self.ids)}"
        label = f" name={quoteattr(name)}" if name else ""
        self.lines.append(f'<{tag} id="{ident}"{label}>{inner}</{tag}>' if inner else f'<{tag} id="{ident}"{label}/>')
        return ident

    def flow(self, source: str, target: str) -> None:
        self.lines.append(f'<sequenceFlow id="flow_{next(self.ids)}" sourceRef="{source}" targetRef="{target}"/>')

    def fragment(self, node: Node) -> tuple[str, str]:
        match node:
            case Step(actor=actor) if actor == ANY:
                raise ValueError("the wildcard '_' has no BPMN equivalent")
            case Step(body=None):
                task = self.node(TASKS[node.actor], activity(node))
                return task, task
            case Step(body=Node() as body):
                return self.scope(body, activity(node), "")
            case Seq(items=()):
                gateway = self.node("exclusiveGateway")
                return gateway, gateway
            case Seq():
                parts = [self.fragment(item) for item in node.items]
                for (_, left), (right, _) in pairwise(parts):
                    self.flow(left, right)
                return parts[0][0], parts[-1][1]
            case Par():
                return self.gateway("parallelGateway", node.branches)
            case Alt():
                return self.gateway("exclusiveGateway", node.options)
            case Repeat(parallel=True):
                cardinality = f"<loopCardinality>{node.lo}</loopCardinality>" if node.lo == node.hi else ""
                marker = f'<multiInstanceLoopCharacteristics isSequential="false">{cardinality}'
                return self.scope(node.node, None, f"{marker}</multiInstanceLoopCharacteristics>")
            case Repeat():
                maximum = f' loopMaximum="{node.hi}"' if node.hi is not None else ""
                before = "true" if node.lo == 0 else "false"
                return self.scope(node.node, None, f'<standardLoopCharacteristics testBefore="{before}"{maximum}/>')
        raise TypeError(f"not a process node: {node!r}")

    def gateway(self, tag: str, nodes: tuple[Node, ...]) -> tuple[str, str]:
        split, join = self.node(tag), self.node(tag)
        for node in nodes:
            entry, leave = self.fragment(node)
            self.flow(split, entry)
            self.flow(leave, join)
        return split, join

    def scope(self, body: Node, name: str | None, marker: str) -> tuple[str, str]:
        outer = self.lines
        self.lines = []
        start, end = self.node("startEvent"), self.node("endEvent")
        entry, leave = self.fragment(body)
        self.flow(start, entry)
        self.flow(leave, end)
        inner, self.lines = self.lines, outer
        content = marker + "".join(inner)
        process = self.node("subProcess", name, content)
        return process, process
