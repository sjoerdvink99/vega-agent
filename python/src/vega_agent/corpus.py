from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from functools import cached_property
from typing import TYPE_CHECKING

import pandas as pd

from .abstract import LEVELS
from .display import Displayable
from .parser import parse
from .semantics import conforms, find
from .syntax import Node
from .tables import Tables, tables
from .trace import Trace, trace

if TYPE_CHECKING:
    from .chart import Chart

Runs = Iterable[Trace | Node | str]
Queries = Mapping[str, Node | str] | Iterable[Node | str]


class Corpus(Displayable):
    def __init__(self, runs: Runs, name: str = ""):
        self.traces = [run if isinstance(run, Trace) else trace(run, id=str(k)) for k, run in enumerate(runs)]
        self.name = name

    def __len__(self) -> int:
        return len(self.traces)

    def __iter__(self):
        return iter(self.traces)

    def __getitem__(self, index: int) -> Trace:
        return self.traces[index]

    def __repr__(self) -> str:
        name = f"{self.name} · " if self.name else ""
        return f"<Corpus {name}{len(self)} runs>"

    def chart(self, mark: str = "icicle", **options) -> Chart:
        from .chart import chart

        return chart(self, mark=mark, **options)

    @cached_property
    def tables(self) -> Tables:
        return tables(self.traces)

    def variants(self, level: str = "actors") -> pd.DataFrame:
        if level not in LEVELS:
            raise ValueError(f"level must be one of {', '.join(LEVELS)}")
        found = self.tables
        counts = found.runs.groupby(level).size().to_frame("runs")
        frame = (
            found.variants.set_index("variant")
            .join(counts, how="inner")
            .sort_values("runs", ascending=False, kind="stable")
        )
        runs = frame["runs"].to_numpy()
        return pd.DataFrame({"process": frame["label"].to_numpy(dtype=str), "runs": runs, "share": runs / _size(self)})

    def find(self, query: Node | str) -> pd.DataFrame:
        query = parse(query)
        rows = [{"trace": run.id, "match": hit.text, "steps": hit.steps} for run in self for hit in find(run, query)]
        return pd.DataFrame(rows, columns=pd.Index(["trace", "match", "steps"]))

    def where(self, query: Node | str) -> Corpus:
        query = parse(query)
        kept = self._holding(lambda run: bool(find(run, query)))
        return Corpus([run for index, run in enumerate(self) if index in kept], self.name)

    def conformance(self, spec: Node | str) -> float:
        spec = parse(spec)
        return len(self._holding(lambda run: conforms(run, spec))) / _size(self)

    def _holding(self, test: Callable[[Trace], bool]) -> set[int]:
        full = self.tables.runs["full"].tolist()
        first: dict[int, int] = {}
        for index, variant in enumerate(full):
            first.setdefault(variant, index)
        passing = {variant for variant, index in first.items() if test(self.traces[index])}
        return {index for index, variant in enumerate(full) if variant in passing}

    def select(self, ids: Iterable[str]) -> Corpus:
        wanted = set(ids)
        return Corpus([run for run in self if run.id in wanted], self.name)


class Diff(Displayable):
    def __init__(
        self,
        a: Corpus | Runs,
        b: Corpus | Runs,
        spec: Node | str | None = None,
        queries: Queries = (),
        labels: tuple[str, str] = ("A", "B"),
    ):
        self.a, self.b = (side if isinstance(side, Corpus) else Corpus(side) for side in (a, b))
        self.spec = parse(spec) if spec is not None else None
        self.queries = _named(queries)
        self.labels = tuple(labels)

    def __repr__(self) -> str:
        return f"<Diff {self.labels[0]} ({len(self.a)} runs) vs {self.labels[1]} ({len(self.b)} runs)>"

    def chart(self, mark: str = "icicle", **options) -> Chart:
        from .chart import chart

        return chart(self, mark=mark, **options)

    def metrics(self) -> pd.DataFrame:
        rows = [("conforms to spec", self.spec, Corpus.conformance)] if self.spec else []
        rows += [(name, query, _rate) for name, query in self.queries.items()]
        frame = pd.DataFrame(
            [(name, str(node), measure(self.a, node), measure(self.b, node)) for name, node, measure in rows],
            columns=pd.Index(["metric", "process", *self.labels]),
        )
        return frame.assign(delta=frame[self.labels[1]] - frame[self.labels[0]])

    def variants(self, level: str = "actors") -> pd.DataFrame:
        a, b = (side.variants(level).set_index("process")["share"] for side in (self.a, self.b))
        frame = pd.concat([a, b], axis=1, keys=self.labels).fillna(0.0)
        frame["delta"] = frame[self.labels[1]] - frame[self.labels[0]]
        return frame.sort_values("delta", key=abs, ascending=False).reset_index(names="process")


def _rate(runs: Corpus, query: Node) -> float:
    return len(runs.where(query)) / _size(runs)


def _size(runs: Corpus) -> int:
    return max(len(runs), 1)


def _named(queries: Queries) -> dict[str, Node]:
    if isinstance(queries, Mapping):
        return {str(name): parse(query) for name, query in queries.items()}
    return {str(query): parse(query) for query in queries}
