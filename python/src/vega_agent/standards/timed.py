from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from ..syntax import EMPTY, Node, Par, Seq, Step, par, seq

Interval = tuple[float, float] | None


@dataclass(frozen=True)
class Timed:
    node: Node = EMPTY
    time: tuple[Interval, ...] = ()
    branches: tuple[Timed, ...] = field(default=(), compare=False)


NONE = Timed()


def timed_step(step: Step, interval: Interval, body: Timed = NONE) -> Timed:
    inner = None if body.node == EMPTY else body.node
    return Timed(Step(step.actor, step.name, step.sig, inner, step.failed), (interval, *body.time))


def timed_sequence(parts: Iterable[Timed]) -> Timed:
    parts = tuple(parts)
    return Timed(seq(*(part.node for part in parts)), tuple(each for part in parts for each in part.time))


def timed_parallel(parts: Iterable[Timed]) -> Timed:
    flat = (branch for part in parts for branch in (part.branches if isinstance(part.node, Par) else (part,)))
    branches = tuple(sorted((part for part in flat if not _empty(part.node)), key=lambda part: str(part.node)))
    if not branches:
        return NONE
    if len(branches) == 1:
        return branches[0]
    time = tuple(each for branch in branches for each in branch.time)
    return Timed(par(*(branch.node for branch in branches)), time, branches)


def arrange(spans: Iterable[tuple[float, float, Timed]]) -> Timed:
    blocks: list[list[tuple[float, float, Timed]]] = []
    reach = float("-inf")
    for span in sorted(spans, key=lambda span: (span[0], span[1])):
        if not blocks or span[0] >= reach:
            blocks.append([])
            reach = span[0]
        blocks[-1].append(span)
        reach = max(reach, span[1])
    return timed_sequence(_lanes(block) for block in blocks)


def _lanes(block: list[tuple[float, float, Timed]]) -> Timed:
    lanes: list[list[tuple[float, float, Timed]]] = []
    for span in block:
        lane = next((lane for lane in lanes if lane[-1][1] <= span[0]), None)
        if lane is None:
            lanes.append([span])
        else:
            lane.append(span)
    return timed_parallel(timed_sequence(each for _, _, each in lane) for lane in lanes)


def _empty(node: Node) -> bool:
    return isinstance(node, Seq) and not node.items
