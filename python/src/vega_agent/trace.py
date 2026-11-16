from __future__ import annotations

from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field, replace

from .abstract import fold
from .display import Displayable
from .parser import parse
from .syntax import ANY, MAX_STEPS, Node, Par, Repeat, Seq, Step, children, par, seq

Interval = tuple[float, float] | None


@dataclass(frozen=True, repr=False)
class Trace(Displayable):
    process: Node
    id: str = ""
    time: tuple[Interval, ...] = ()
    meta: dict = field(default_factory=dict, compare=False, hash=False)

    def __post_init__(self):
        if self.time and len(self.time) != sum(1 for _ in walk(self.process)):
            raise ValueError("time needs one interval or None per step")

    def __str__(self) -> str:
        return str(fold(self.process))

    def __repr__(self) -> str:
        return f"<Trace {self.id or '?'}: {self}>"

    def steps(self) -> Iterator[tuple[Step, int]]:
        return walk(self.process)


def trace(process: str | Node, id: str = "", **meta) -> Trace:
    return Trace(ground(parse(process)), str(id), (), meta)


def timing(intervals: Iterable[Interval]) -> tuple[Interval, ...]:
    found = tuple(intervals)
    return found if any(each is not None for each in found) else ()


class TraceError(ValueError):
    pass


def size(node: Node) -> int:
    match node:
        case Step(actor=actor) if actor == ANY:
            raise TraceError("a trace cannot contain the wildcard '_'")
        case Step():
            return 1 + (size(node.body) if node.body is not None else 0)
        case Seq(items=nodes) | Par(branches=nodes):
            return sum(map(size, nodes))
        case Repeat(lo=lo, hi=hi) if lo == hi:
            return lo and lo * size(node.node)
    raise TraceError(f"a trace has no choice or open repetition: {node}")


def is_ground(node: Node) -> bool:
    try:
        return size(node) <= MAX_STEPS
    except TraceError:
        return False


def ground(node: Node) -> Node:
    if size(node) > MAX_STEPS:
        raise TraceError(f"a trace has at most {MAX_STEPS} steps")
    return _expand(node)


def _expand(node: Node) -> Node:
    match node:
        case Step(body=None):
            return node
        case Step(body=Node() as body):
            return replace(node, body=_expand(body))
        case Seq():
            return seq(*map(_expand, node.items))
        case Par():
            return _ordered(par(*map(_expand, node.branches)))
        case Repeat(parallel=True):
            return _ordered(par(*[_expand(node.node)] * node.lo))
        case Repeat():
            return seq(*[_expand(node.node)] * node.lo)
    raise TraceError(f"a trace has no choice: {node}")


def _ordered(node: Node) -> Node:
    return Par(tuple(sorted(node.branches, key=str))) if isinstance(node, Par) else node


def walk(node: Node, depth: int = 0) -> Iterator[tuple[Step, int]]:
    if isinstance(node, Step):
        yield node, depth
        depth += 1
    for child in children(node):
        yield from walk(child, depth)


def parents(node: Node) -> list[int]:
    found: list[int] = []

    def visit(current: Node, owner: int) -> None:
        if isinstance(current, Step):
            found.append(owner)
            if current.body is not None:
                visit(current.body, len(found) - 1)
            return
        for child in children(current):
            visit(child, owner)

    visit(node, -1)
    return found
