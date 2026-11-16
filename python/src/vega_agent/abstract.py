from __future__ import annotations

from dataclasses import replace
from functools import reduce

from .parser import parse
from .syntax import Alt, Node, Par, Repeat, Seq, Step, alt, children, par, seq

LEVELS = ("full", "names", "actors", "loops")


def abstract(node: Node | str, level: str = "actors") -> Node:
    if level not in LEVELS:
        raise ValueError(f"level must be one of {', '.join(LEVELS)}")
    return _fold(project(parse(node), level), loose=level == "loops")


def fold(node: Node) -> Node:
    return _fold(node, loose=False)


def project(node: Node, level: str) -> Node:
    match node:
        case Step():
            body = project(node.body, level) if node.body is not None else None
            if level == "full":
                return replace(node, body=body)
            return replace(node, name=node.name if level == "names" else None, sig=None, body=body)
        case Seq():
            return seq(*(project(item, level) for item in node.items))
        case Par():
            return par(*(project(branch, level) for branch in node.branches))
        case Alt():
            return alt(*(project(option, level) for option in node.options))
        case Repeat():
            return replace(node, node=project(node.node, level))
    return node


def _fold(node: Node, loose: bool) -> Node:
    match node:
        case Step(body=None):
            return node
        case Step(body=Node() as body):
            return replace(node, body=_fold(body, loose))
        case Seq():
            items = [_fold(item, loose) for item in node.items]
            while len(folded := _tandem(items, loose)) < len(items):
                items = folded
            return seq(*items)
        case Par():
            return _collapse([_fold(branch, loose) for branch in node.branches], loose)
        case Alt():
            return alt(*(_fold(option, loose) for option in node.options))
        case Repeat():
            return replace(node, node=_fold(node.node, loose))
    return node


def _key(node: Node, loose: bool) -> str:
    return str(_shape(node) if loose else node)


def _shape(node: Node) -> Node:
    match node:
        case Repeat():
            return _shape(node.node)
        case Step():
            return replace(node, failed=False, body=_shape(node.body) if node.body is not None else None)
        case Seq():
            return seq(*map(_shape, node.items))
        case Par():
            return par(*map(_shape, node.branches))
    return node


def _tandem(items: list[Node], loose: bool) -> list[Node]:
    keys = [_key(item, loose) for item in items]
    folded, start = [], 0
    while start < len(items):
        period, times = _longest_run(keys, start)
        if times == 1:
            folded.append(items[start])
            start += 1
            continue
        chunks = [seq(*items[start + k * period : start + (k + 1) * period]) for k in range(times)]
        body = _fold(reduce(_join, chunks), loose)
        folded.append(Repeat(body, 1, None) if loose else Repeat(body, times, times))
        start += period * times
    return folded


def _longest_run(keys: list[str], start: int) -> tuple[int, int]:
    best = (1, 1)
    rest = len(keys) - start
    period = 1
    while period <= rest // 2 and best[0] * best[1] < rest:
        times = 1
        while (times + 1) * period <= rest and _repeats(keys, start, start + times * period, period):
            times += 1
        if times > 1 and period * times > best[0] * best[1]:
            best = (period, times)
        period += 1
    return best


def _repeats(keys: list[str], first: int, second: int, length: int) -> bool:
    return keys[first] == keys[second] and all(keys[first + k] == keys[second + k] for k in range(1, length))


def _collapse(branches: list[Node], loose: bool) -> Node:
    groups: dict[str, list[Node]] = {}
    for branch in branches:
        groups.setdefault(_key(branch, loose), []).append(branch)
    return par(*(_deck(group, loose) for group in groups.values()))


def _deck(group: list[Node], loose: bool) -> Node:
    if len(group) == 1:
        return group[0]
    joined = reduce(_join, group)
    return Repeat(joined, 0, None, True) if loose else Repeat(joined, len(group), len(group), True)


def _join(a: Node, b: Node) -> Node:
    if isinstance(a, Repeat) or isinstance(b, Repeat):
        parallel = any(isinstance(node, Repeat) and node.parallel for node in (a, b))
        (alo, ahi), (blo, bhi) = _bounds(a, parallel), _bounds(b, parallel)
        hi = None if ahi is None or bhi is None else max(ahi, bhi)
        return Repeat(_join(_inner(a), _inner(b)), min(alo, blo), hi, parallel)
    match a, b:
        case Step(), Step():
            body = _join(a.body, b.body) if a.body is not None and b.body is not None else a.body
            return replace(a, body=body, failed=a.failed or b.failed)
        case Seq(), Seq() if len(a.items) == len(b.items):
            return Seq(tuple(_join(x, y) for x, y in zip(a.items, b.items, strict=True)))
        case Par(), Par() if len(a.branches) == len(b.branches):
            return Par(tuple(_join(x, y) for x, y in zip(a.branches, b.branches, strict=True)))
    return b if _loops(b) > _loops(a) else a


def _loops(node: Node) -> int:
    return isinstance(node, Repeat) + sum(map(_loops, children(node)))


def _inner(node: Node) -> Node:
    return node.node if isinstance(node, Repeat) else node


def _bounds(node: Node, parallel: bool) -> tuple[int, int | None]:
    if not isinstance(node, Repeat):
        return 1, 1
    return (node.lo, node.hi) if node.parallel == parallel else (0, None)
