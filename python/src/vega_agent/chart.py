from __future__ import annotations

import html
import json
import shutil
import subprocess
from collections.abc import Iterable, Mapping
from pathlib import Path

import anywidget
import traitlets

from .abstract import LEVELS
from .corpus import Corpus, Diff
from .parser import parse
from .syntax import Node
from .trace import Trace, trace, walk

STATIC = Path(__file__).parent / "static"

PAGE = """<!doctype html>
<html>
<head><meta charset="utf-8"><title>{title}</title></head>
<body style="margin:24px">
<div id="view"></div>
<script>{library}</script>
<script>vegaAgent.embed(document.getElementById("view"), {spec});</script>
</body>
</html>
"""

Runs = Corpus | Iterable[Trace | Node | str]


class Host(anywidget.AnyWidget):
    _esm = STATIC / "widget.js"
    spec = traitlets.Dict().tag(sync=True)
    selection = traitlets.Dict().tag(sync=True)


class Chart:
    def __init__(self, spec: dict):
        self.spec = spec
        self._host: Host | None = None

    def __repr__(self) -> str:
        return f"<Chart {self.spec.get('mark', 'vconcat')}>"

    @property
    def host(self) -> Host:
        if self._host is None:
            self._host = Host(spec=self.spec)
        return self._host

    @property
    def selection(self) -> dict[str, list[str]]:
        return {name: list(ids) for name, ids in self.host.selection.items()}

    @property
    def selected(self) -> list[str]:
        return self.selection.get(SELECTED, [])

    def properties(self, **properties) -> Chart:
        return Chart({**self.spec, **properties})

    def to_dict(self) -> dict:
        return self.spec

    def to_json(self, indent: int | None = 2) -> str:
        return json.dumps(self.spec, indent=indent)

    def to_html(self) -> str:
        spec = self.to_json(None).replace("<", "\\u003c")
        library = (STATIC / "vega-agent.min.js").read_text()
        title = html.escape(str(self.spec.get("title", "vega-agent")))
        return PAGE.format(title=title, library=library, spec=spec)

    def to_svg(self) -> str:
        return self._node()

    def to_vega(self) -> dict:
        return json.loads(self._node("--vega"))

    def save(self, path: str | Path) -> Path:
        path = Path(path)
        writers = {
            ".vg.json": lambda: json.dumps(self.to_vega(), indent=2),
            ".json": self.to_json,
            ".html": self.to_html,
            ".svg": self.to_svg,
        }
        suffix = next((suffix for suffix in writers if path.name.endswith(suffix)), None)
        if suffix is None:
            raise ValueError(f"save to one of {', '.join(writers)}")
        path.write_text(writers[suffix]())
        return path

    def _node(self, *flags: str) -> str:
        node = shutil.which("node")
        if node is None:
            raise RuntimeError("to_svg and to_vega need Node.js on the PATH; to_html works without it")
        command = [node, str(STATIC / "cli.mjs"), "-", *flags]
        result = subprocess.run(command, input=self.to_json(None), capture_output=True, text=True, check=False)
        if result.returncode:
            raise ValueError(result.stderr.strip().removeprefix("vega-agent: "))
        return result.stdout

    def _repr_mimebundle_(self, **kwargs):
        bundle = self.host._repr_mimebundle_(**kwargs)
        data, metadata = bundle if isinstance(bundle, tuple) else (bundle, {})
        return {**(data or {}), "text/plain": repr(self)}, metadata


def diagram(process: Node | Trace | str, title: str | None = None, key: bool = True) -> Chart:
    node = process.process if isinstance(process, Trace) else parse(process)
    return Chart(_spec({"mark": "diagram", "process": str(node), "key": key}, title))


def timeline(run: Trace, title: str | None = None, lanes: str = "step") -> Chart:
    if lanes not in LANES:
        raise ValueError(f"lanes must be one of {', '.join(LANES)}")
    spec = {"mark": "timeline", "data": {"values": [_run(run, True)]}, "width": "container"}
    return Chart(_spec({**spec, "lanes": lanes} if lanes != "step" else spec, title))


def handoffs(process: Node | Trace | str, title: str | None = None) -> Chart:
    run = process if isinstance(process, Trace) else trace(process)
    values = [_run(run, bool(run.time))]
    return Chart(_spec({"mark": "handoffs", "data": {"values": values}, "width": "container"}, title))


def icicle(
    data: Runs | Mapping[str, Runs] | Diff,
    level: str = "actors",
    highlight: Node | str | None = None,
    title: str | None = None,
    height: int = 380,
    select: str | None = "click",
) -> Chart:
    return _corpus("icicle", data, title, select, level=level, highlight=highlight, height=height)


def variants(
    data: Runs | Mapping[str, Runs] | Diff,
    level: str = "actors",
    highlight: Node | str | None = None,
    title: str | None = None,
    limit: int = 12,
    select: str | None = "click",
) -> Chart:
    return _corpus("variants", data, title, select, level=level, highlight=highlight, limit=limit)


def transitions(
    data: Runs | Mapping[str, Runs] | Diff,
    level: str = "names",
    title: str | None = None,
    limit: int = 16,
    select: str | None = "click",
) -> Chart:
    return _corpus("transitions", data, title, select, level=level, limit=limit)


def graph(
    data: Runs | Mapping[str, Runs] | Diff,
    level: str = "names",
    title: str | None = None,
    limit: int = 16,
    select: str | None = "click",
) -> Chart:
    return _corpus("graph", data, title, select, level=level, limit=limit)


def sankey(
    data: Runs | Mapping[str, Runs] | Diff,
    level: str = "actors",
    title: str | None = None,
    limit: int = 8,
    height: int = 300,
    select: str | None = "click",
) -> Chart:
    return _corpus("sankey", data, title, select, level=level, limit=limit, height=height)


def activities(
    data: Runs | Mapping[str, Runs] | Diff,
    level: str = "names",
    title: str | None = None,
    limit: int = 16,
    select: str | None = "click",
) -> Chart:
    return _corpus("activities", data, title, select, level=level, limit=limit)


def sequences(
    data: Runs | Mapping[str, Runs] | Diff,
    highlight: Node | str | None = None,
    title: str | None = None,
    limit: int = 50,
    x: str = "step",
    select: str | None = "click",
) -> Chart:
    if x not in AXES:
        raise ValueError(f"x must be one of {', '.join(AXES)}")
    return _corpus(
        "sequences", data, title, select, highlight=highlight, options={"x": x}, timed=x == "time", limit=limit
    )


def distribution(
    data: Runs | Mapping[str, Runs] | Diff,
    measure: str = "steps",
    highlight: Node | str | None = None,
    title: str | None = None,
    select: str | None = "click",
) -> Chart:
    if measure not in MEASURES:
        raise ValueError(f"measure must be one of {', '.join(MEASURES)}")
    return _corpus(
        "distribution",
        data,
        title,
        select,
        highlight=highlight,
        options={"measure": measure},
        timed=measure == "duration",
    )


def durations(
    data: Runs | Mapping[str, Runs] | Diff,
    level: str = "names",
    title: str | None = None,
    limit: int = 16,
    select: str | None = "click",
) -> Chart:
    return _corpus("durations", data, title, select, level=level, timed=True, limit=limit)


def projection(
    data: Runs | Mapping[str, Runs] | Diff,
    level: str = "names",
    highlight: Node | str | None = None,
    title: str | None = None,
    height: int = 300,
    select: str | None = "click",
) -> Chart:
    return _corpus("projection", data, title, select, level=level, highlight=highlight, height=height)


MARKS = {
    "icicle": icicle,
    "variants": variants,
    "transitions": transitions,
    "graph": graph,
    "sankey": sankey,
    "activities": activities,
    "sequences": sequences,
    "distribution": distribution,
    "durations": durations,
    "projection": projection,
}
AXES = ("step", "time")
MEASURES = ("steps", "failures", "duration")
LANES = ("step", "agent")
EVENTS = ("click", "hover")
SELECTED = "selected"
GROUP = "group"
MAX_GROUPS = 2
STEP = {"params": [{"name": "step", "select": "hover"}], "highlight": {"param": "step"}}


def _corpus(
    mark: str,
    data,
    title: str | None,
    select: str | None,
    level: str | None = None,
    highlight: Node | str | None = None,
    options: Mapping[str, str] | None = None,
    timed: bool = False,
    **counts: int,
) -> Chart:
    if level is not None and level not in LEVELS:
        raise ValueError(f"level must be one of {', '.join(LEVELS)}")
    for key, value in counts.items():
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError(f"{key} must be a positive integer, found {value!r}")
    source = _data(data, timed)
    spec: dict = {"mark": mark, **counts, **(options or {})}
    if level is not None:
        spec["level"] = level
    if highlight is not None:
        spec["highlight"] = str(parse(highlight))
    if select is not None:
        if select not in EVENTS:
            raise ValueError(f"select must be one of {', '.join(EVENTS)}, or None")
        spec["params"] = [{"name": SELECTED, "select": select}]
        if highlight is None and mark != "icicle":
            spec["highlight"] = {"param": SELECTED}
    whole = {**source, "spec": spec} if "facet" in source else {**spec, **source}
    return Chart(_spec({**whole, "width": "container"}, title))


def vconcat(*charts: Chart, title: str | None = None) -> Chart:
    return Chart(_spec({"vconcat": _views(charts), "width": "container"}, title))


def hconcat(*charts: Chart, title: str | None = None) -> Chart:
    return Chart(_spec({"hconcat": _views(charts), "width": "container"}, title))


def _views(charts: tuple[Chart, ...]) -> list[dict]:
    if not charts:
        raise ValueError("expected at least one chart")
    nested = [chart for chart in charts if "mark" not in chart.spec]
    if nested:
        raise ValueError("views cannot be nested: vconcat and hconcat take charts with one mark")
    return [chart.spec for chart in charts]


def chart(subject, **options) -> Chart:
    match subject:
        case Trace(time=time) if time:
            return vconcat(
                diagram(subject).properties(**STEP), timeline(subject).properties(**STEP), title=_title(subject)
            )
        case Trace():
            return diagram(subject, title=_title(subject))
        case Corpus() | Diff():
            mark = options.pop("mark", "icicle")
            if mark not in MARKS:
                raise ValueError(f"mark must be one of {', '.join(MARKS)}")
            return MARKS[mark](subject, **options)
        case Node():
            return diagram(subject)
    raise TypeError(f"no chart for {type(subject).__name__}")


def _spec(spec: dict, title: str | None) -> dict:
    return {"title": title, **spec} if title else spec


def _title(run: Trace) -> str:
    agent = run.meta.get("agent")
    return f"trace {run.id}" + (f" · agent {agent}" if agent else "")


def _data(data, timed: bool) -> dict:
    if isinstance(data, Diff):
        data = {data.labels[0]: data.a, data.labels[1]: data.b}
    if isinstance(data, Mapping):
        if not data:
            raise ValueError("expected at least one group of runs")
        values = [{**_run(run, timed), GROUP: str(name)} for name, runs in data.items() for run in Corpus(runs)]
    else:
        values = [_run(run, timed) for run in Corpus(data)]
    groups = {run[GROUP] for run in values if GROUP in run}
    if len(groups) > MAX_GROUPS:
        return {"data": {"values": values}, "facet": {"field": GROUP}}
    return {"data": {"values": values}, **({"trace": {"group": GROUP}} if groups else {})}


def _run(run: Trace, timed: bool) -> dict:
    found = {"id": run.id, "process": str(run.process)}
    if "group" in run.meta:
        found[GROUP] = run.meta["group"]
    return {**found, "time": _intervals(run)} if timed else found


def _intervals(run: Trace) -> list[list[float] | None]:
    if not run.time:
        return [None for _ in walk(run.process)]
    return [list(each) if each is not None else None for each in run.time]
