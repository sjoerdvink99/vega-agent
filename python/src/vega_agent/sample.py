from __future__ import annotations

import random
from dataclasses import replace

from .parser import parse
from .syntax import ACTORS, ANY, Alt, Node, Par, Repeat, Seq, Step, par, seq
from .trace import Trace, trace


def sample(spec: Node | str, n: int = 1, seed: int | None = None, again: float = 0.6) -> list[Trace]:
    if isinstance(n, bool) or not isinstance(n, int) or n < 0:
        raise ValueError(f"n must be a non-negative integer, found {n!r}")
    if isinstance(again, bool) or not isinstance(again, (int, float)) or not 0 <= again < 1:
        raise ValueError(f"again must be a probability in [0, 1), found {again!r}")
    spec, rng = parse(spec), random.Random(seed)
    return [trace(_draw(spec, rng, again), id=str(k)) for k in range(n)]


def _draw(node: Node, rng: random.Random, again: float) -> Node:
    match node:
        case Step():
            actor = rng.choice(ACTORS) if node.actor == ANY else node.actor
            body = _draw(node.body, rng, again) if node.body is not None else None
            return replace(node, actor=actor, body=body)
        case Seq():
            return seq(*(_draw(item, rng, again) for item in node.items))
        case Par():
            return par(*(_draw(branch, rng, again) for branch in node.branches))
        case Alt():
            return _draw(rng.choice(node.options), rng, again)
        case Repeat():
            compose = par if node.parallel else seq
            return compose(*(_draw(node.node, rng, again) for _ in range(_times(node, rng, again))))
    raise TypeError(f"cannot sample {node!r}")


def _times(node: Repeat, rng: random.Random, again: float) -> int:
    if node.hi is not None:
        return rng.randint(node.lo, node.hi)
    times = node.lo
    while rng.random() < again:
        times += 1
    return times
