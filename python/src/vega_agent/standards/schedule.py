from __future__ import annotations

from ..syntax import Node, Par, Seq, Step
from ..trace import Trace

DURATION = {"model": 1.0, "tool": 0.3, "agent": 0.0, "human": 2.0, "code": 0.1}
EPOCH = 1_767_225_600.0


def intervals(run: Trace) -> list[tuple[float, float]]:
    if run.time and all(each is not None for each in run.time):
        return [each for each in run.time if each is not None]
    found: list[tuple[float, float]] = []
    _place(run.process, EPOCH, found)
    return found


def _place(node: Node, start: float, found: list[tuple[float, float]]) -> float:
    match node:
        case Step():
            position = len(found)
            found.append((start, start))
            end = _place(node.body, start, found) if node.body is not None else start + DURATION[node.actor]
            found[position] = (start, end)
            return end
        case Seq():
            for item in node.items:
                start = _place(item, start, found)
            return start
        case Par():
            return max(_place(branch, start, found) for branch in node.branches)
    raise ValueError(f"not a ground trace: {node}")
