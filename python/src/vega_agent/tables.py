from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import pandas as pd

from .abstract import LEVELS, abstract, fold, project
from .syntax import Node, Seq, Step, children
from .trace import Trace, trace

COLUMNS = {
    "runs": ["run", "id", "group", *LEVELS],
    "variants": ["variant", "level", "label", "length"],
    "tokens": ["variant", "index", "token", "actors", "failed"],
    "steps": ["variant", "index", "depth", "parent", "actor", "name", "signature", "failed"],
    "times": ["run", "index", "start", "end"],
}


@dataclass(frozen=True)
class Tables:
    runs: pd.DataFrame
    variants: pd.DataFrame
    tokens: pd.DataFrame
    steps: pd.DataFrame
    times: pd.DataFrame


def sequence(node: Node, level: str) -> tuple[Node, ...]:
    projected = abstract(node, level) if level == "loops" else project(node, level)
    items = projected.items if isinstance(projected, Seq) else (projected,)
    return items if level == "loops" else tuple(map(fold, items))


def actors_of(node: Node) -> list[str]:
    if isinstance(node, Step):
        return [node.actor]
    return list(dict.fromkeys(actor for child in children(node) for actor in actors_of(child)))


def failed(node: Node) -> bool:
    return (isinstance(node, Step) and node.failed) or any(map(failed, children(node)))


def tables(runs: Iterable[Trace | Node | str]) -> Tables:
    traced = [run if isinstance(run, Trace) else trace(run, id=str(k)) for k, run in enumerate(runs)]
    found: dict[str, list[dict]] = {name: [] for name in COLUMNS}
    known: dict[tuple[str, tuple[str, ...]], int] = {}
    assigned = {level: [_variant(run.process, level, known, found) for run in traced] for level in LEVELS}
    for index, run in enumerate(traced):
        levels = {level: assigned[level][index] for level in LEVELS}
        found["runs"].append({"run": index, "id": run.id, "group": run.meta.get("group"), **levels})
        for position, interval in enumerate(run.time):
            if interval is not None:
                found["times"].append({"run": index, "index": position, "start": interval[0], "end": interval[1]})
    return Tables(**{name: pd.DataFrame(rows, columns=pd.Index(COLUMNS[name])) for name, rows in found.items()})


def _variant(node: Node, level: str, known: dict, found: dict[str, list[dict]]) -> int:
    items = sequence(node, level)
    key = (level, tuple(map(str, items)))
    if key in known:
        return known[key]
    variant = known[key] = len(found["variants"])
    label = str(abstract(node, level))
    found["variants"].append({"variant": variant, "level": level, "label": label, "length": len(items)})
    for index, item in enumerate(items):
        token = {"token": str(item), "actors": actors_of(item), "failed": failed(item)}
        found["tokens"].append({"variant": variant, "index": index, **token})
    if level == "full":
        found["steps"] += [{"variant": variant, "index": index, **row} for index, row in enumerate(_walked(node))]
    return variant


def _walked(node: Node) -> list[dict]:
    found: list[dict] = []

    def visit(current: Node, depth: int, parent: int) -> None:
        if isinstance(current, Step):
            signature = str(current.sig) if current.sig is not None else None
            fields = {"actor": current.actor, "name": current.name, "signature": signature, "failed": current.failed}
            found.append({"depth": depth, "parent": parent, **fields})
            if current.body is not None:
                visit(current.body, depth + 1, len(found) - 1)
            return
        for child in children(current):
            visit(child, depth, parent)

    visit(node, 0, -1)
    return found
