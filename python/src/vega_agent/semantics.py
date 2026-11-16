from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from itertools import accumulate, product

from .abstract import fold
from .parser import parse
from .syntax import ANY, Alt, Node, Par, Rep, Repeat, Seq, Sig, Step, seq
from .trace import Trace, trace, walk


@dataclass(frozen=True)
class Hit:
    text: str
    steps: tuple[int, ...]


@dataclass(frozen=True)
class _Pool:
    node: Node
    lo: int
    hi: int | None


Layout = tuple[_Pool, ...]


def conforms(run: Trace | Node | str, spec: Node | str) -> bool:
    return _Matcher().full(parse(spec), _ground(run))


def find(run: Trace | Node | str, query: Node | str) -> list[Hit]:
    query, matcher, hits = parse(query), _Matcher(), []
    for items, at in _sequences(_ground(run), matcher, 0):
        start = 0
        while start < len(items):
            end = max((end for end in matcher.ends(query, items, start) if end > start), default=None)
            if end is None:
                start += 1
                continue
            matched = seq(*items[start:end])
            hits.append(Hit(str(fold(matched)), tuple(range(at[start], at[start] + _count(matched)))))
            start = end
    return hits


def _ground(run: Trace | Node | str) -> Node:
    return run.process if isinstance(run, Trace) else trace(run).process


def _sequences(node: Node, matcher: _Matcher, base: int) -> Iterator[tuple[tuple[Node, ...], list[int]]]:
    items = matcher.items(node)
    at = _offsets(items, base)
    yield items, at
    for item, start in zip(items, at, strict=True):
        if isinstance(item, Step) and item.body is not None:
            yield from _sequences(item.body, matcher, start + 1)
        if isinstance(item, Par):
            for branch, offset in zip(item.branches, _offsets(item.branches, start), strict=True):
                yield from _sequences(branch, matcher, offset)


def _offsets(nodes: tuple[Node, ...], base: int) -> list[int]:
    return list(accumulate(map(_count, nodes), initial=base))[: len(nodes)]


def _count(node: Node) -> int:
    return sum(1 for _ in walk(node))


class _Matcher:
    def __init__(self):
        self.memo: dict = {}

    def items(self, node: Node) -> tuple[Node, ...]:
        return self._remember(("items", id(node)), node, lambda: node.items if isinstance(node, Seq) else (node,))

    def full(self, spec: Node, node: Node) -> bool:
        items = self.items(node)
        return len(items) in self.ends(spec, items, 0)

    def ends(self, spec: Node, items: tuple[Node, ...], start: int) -> frozenset[int]:
        return self._remember((id(spec), id(items), start), spec, lambda: frozenset(self._ends(spec, items, start)))

    def _remember(self, key, anchor, compute):
        if key not in self.memo:
            self.memo[key] = (anchor, compute())
        return self.memo[key][1]

    def _ends(self, spec: Node, items: tuple[Node, ...], start: int) -> set[int]:
        here = items[start] if start < len(items) else None
        match spec:
            case Step(actor=actor, name=None, sig=None, body=None, failed=False) if actor == ANY:
                return {start + 1} if here is not None else set()
            case Step():
                return {start + 1} if isinstance(here, Step) and self.step(spec, here) else set()
            case Seq():
                positions = {start}
                for item in spec.items:
                    positions = {end for position in positions for end in self.ends(item, items, position)}
                return positions
            case Alt():
                return {end for option in spec.options for end in self.ends(option, items, start)}
            case Repeat(parallel=True):
                return self.copies(spec, items, start)
            case Repeat():
                return self.repeat(spec, items, start)
            case Par():
                return self.branches(spec, items, start)
        return set()

    def repeat(self, spec: Repeat, items: tuple[Node, ...], start: int) -> set[int]:
        reached = {start} if spec.lo == 0 else set()
        frontier = {start}
        limit = spec.hi if spec.hi is not None else len(items) - start + spec.lo + 1
        for rounds in range(1, limit + 1):
            frontier = {end for position in frontier for end in self.ends(spec.node, items, position)}
            if not frontier or (rounds > spec.lo and frontier <= reached):
                break
            if rounds >= spec.lo:
                reached |= frontier
        return reached

    def copies(self, spec: Repeat, items: tuple[Node, ...], start: int) -> set[int]:
        empty = self.nullable(spec.node)
        ends = {start} if spec.lo == 0 or empty else set()
        if spec.hi != 0 and (spec.lo <= 1 or empty):
            ends |= self.ends(spec.node, items, start)
        if self.spread(spec, items, start):
            ends.add(start + 1)
        return ends

    def branches(self, spec: Par, items: tuple[Node, ...], start: int) -> set[int]:
        ends = {start} if all(map(self.nullable, spec.branches)) else set()
        for k, branch in enumerate(spec.branches):
            if self.alone(spec.branches, k):
                ends |= self.ends(branch, items, start)
        if self.spread(spec, items, start):
            ends.add(start + 1)
        return ends

    def spread(self, spec: Node, items: tuple[Node, ...], start: int) -> bool:
        here = items[start] if start < len(items) else None
        if not isinstance(here, Par):
            return False
        return any(self.assign(pools, here.branches) for pools in self.layouts(spec, len(here.branches)))

    def nullable(self, spec: Node) -> bool:
        return 0 in self.ends(spec, (), 0)

    def alone(self, nodes: tuple[Node, ...], k: int) -> bool:
        return all(j == k or self.nullable(other) for j, other in enumerate(nodes))

    def spreads(self, spec: Node) -> bool:
        return self._remember(("spreads", id(spec)), spec, lambda: self._spreads(spec))

    def _spreads(self, spec: Node) -> bool:
        match spec:
            case Par():
                return True
            case Alt():
                return any(map(self.spreads, spec.options))
            case Seq():
                return any(self.spreads(item) and self.alone(spec.items, k) for k, item in enumerate(spec.items))
            case Repeat(hi=0):
                return False
            case Repeat(parallel=True):
                return spec.hi is None or spec.hi > 1 or self.spreads(spec.node)
            case Repeat():
                return self.spreads(spec.node) and (spec.lo <= 1 or self.nullable(spec.node))
        return False

    def layouts(self, spec: Node, n: int) -> list[Layout]:
        single = [(_Pool(spec, 1, 1),)]
        if not self.spreads(spec):
            return single
        match spec:
            case Par():
                choices = [self.layouts(branch, n) for branch in spec.branches]
                return [tuple(pool for pools in combination for pool in pools) for combination in product(*choices)]
            case Alt():
                return [layout for option in spec.options for layout in self.layouts(option, n)]
            case Seq():
                alone = (self.layouts(item, n) for k, item in enumerate(spec.items) if self.alone(spec.items, k))
                return single + [layout for layouts in alone for layout in layouts]
            case Repeat(parallel=True):
                return self.scaled(spec, n)
            case Repeat():
                return single + self.layouts(spec.node, n)
        return single

    def scaled(self, spec: Repeat, n: int) -> list[Layout]:
        if not self.spreads(spec.node):
            return [(_Pool(spec.node, spec.lo, spec.hi),)]
        options = self.layouts(spec.node, n)
        least = 0 if self.nullable(spec.node) else spec.lo
        most = min(n if spec.hi is None else spec.hi, n)
        found: dict[tuple, Layout] = {}
        reached: dict[tuple, Layout] = {(): ()}
        for copies in range(most + 1):
            if not reached:
                break
            if copies >= least:
                found |= reached
            merged = (self.merge(pools + option, n) for pools in reached.values() for option in options)
            reached = {_key(pools): pools for pools in merged if pools is not None}
        return list(found.values())

    def merge(self, pools: Layout, n: int) -> Layout | None:
        merged: dict[int, _Pool] = {}
        for pool in pools:
            top = n if pool.hi is None else pool.hi
            held = merged.get(id(pool.node), _Pool(pool.node, 0, 0))
            merged[id(pool.node)] = _Pool(pool.node, held.lo + pool.lo, min((held.hi or 0) + top, n))
        least = sum(0 if self.nullable(pool.node) else pool.lo for pool in merged.values())
        return None if least > n else tuple(merged.values())

    def assign(self, pools: Layout, branches: tuple[Node, ...]) -> bool:
        lows = [0 if self.nullable(pool.node) else pool.lo for pool in pools]
        highs = [min(len(branches) if pool.hi is None else pool.hi, len(branches)) for pool in pools]
        fits = [[k for k, pool in enumerate(pools) if self.full(pool.node, branch)] for branch in branches]
        owner: list[int | None] = [None] * len(branches)
        taken = [0] * len(pools)

        def seat(branch: int, caps: list[int], seen: set[int]) -> bool:
            for pool in fits[branch]:
                if pool in seen:
                    continue
                seen.add(pool)
                held = (other for other, owned in enumerate(owner) if owned == pool)
                if taken[pool] < caps[pool] or any(seat(other, caps, seen) for other in held):
                    previous = owner[branch]
                    if previous is not None:
                        taken[previous] -= 1
                    owner[branch] = pool
                    taken[pool] += 1
                    return True
            return False

        for branch in range(len(branches)):
            seat(branch, lows, set())
        if any(count < low for count, low in zip(taken, lows, strict=True)):
            return False
        return all(owner[branch] is not None or seat(branch, highs, set()) for branch in range(len(branches)))

    def step(self, spec: Step, step: Step) -> bool:
        return (
            spec.actor in (ANY, step.actor)
            and spec.name in (None, step.name)
            and (step.failed or not spec.failed)
            and (spec.sig is None or _covers(spec.sig, step.sig))
            and (spec.body is None or (step.body is not None and self.full(spec.body, step.body)))
        )


def _key(pools: Layout) -> tuple:
    return tuple(sorted((id(pool.node), pool.lo, pool.hi) for pool in pools))


def _covers(spec: Sig, sig: Sig | None) -> bool:
    return sig is not None and _subset(spec.inputs, sig.inputs) and _subset(spec.outputs, sig.outputs)


def _subset(wanted: tuple[Rep, ...], given: tuple[Rep, ...]) -> bool:
    return all(any(_fits(rep, other) for other in given) for rep in wanted)


def _fits(rep: Rep, other: Rep) -> bool:
    return rep.role == other.role and rep.medium in (None, other.medium) and (other.many or not rep.many)
