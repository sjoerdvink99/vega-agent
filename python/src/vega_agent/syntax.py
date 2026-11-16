from __future__ import annotations

from dataclasses import dataclass

from .display import Displayable

ACTORS = ("model", "tool", "agent", "human", "code")
ANY = "_"
MAX_DEPTH = 64
MAX_STEPS = 100_000


class Node(Displayable):
    def __str__(self) -> str:
        return render(self)

    def __repr__(self) -> str:
        return f"parse({str(self)!r})"


@dataclass(frozen=True)
class Rep:
    role: str
    medium: str | None = None
    many: bool = False

    def __str__(self) -> str:
        medium = f":{self.medium}" if self.medium else ""
        return f"{self.role}{medium}{'[]' if self.many else ''}"


@dataclass(frozen=True)
class Sig:
    inputs: tuple[Rep, ...] = ()
    outputs: tuple[Rep, ...] = ()

    def __str__(self) -> str:
        inputs = ", ".join(map(str, self.inputs))
        outputs = "=> " + ", ".join(map(str, self.outputs)) if self.outputs else ""
        return f"({' '.join(part for part in (inputs, outputs) if part)})"


@dataclass(frozen=True, repr=False)
class Step(Node):
    actor: str
    name: str | None = None
    sig: Sig | None = None
    body: Node | None = None
    failed: bool = False


@dataclass(frozen=True, repr=False)
class Seq(Node):
    items: tuple[Node, ...]


@dataclass(frozen=True, repr=False)
class Par(Node):
    branches: tuple[Node, ...]


@dataclass(frozen=True, repr=False)
class Alt(Node):
    options: tuple[Node, ...]


@dataclass(frozen=True, repr=False)
class Repeat(Node):
    node: Node
    lo: int = 0
    hi: int | None = None
    parallel: bool = False


EMPTY = Seq(())


def seq(*items: Node) -> Node:
    flat = tuple(part for item in items for part in (item.items if isinstance(item, Seq) else (item,)))
    return flat[0] if len(flat) == 1 else Seq(flat)


def par(*branches: Node) -> Node:
    flat = tuple(
        part
        for branch in branches
        if branch != EMPTY
        for part in (branch.branches if isinstance(branch, Par) else (branch,))
    )
    return flat[0] if len(flat) == 1 else Par(flat) if flat else EMPTY


def alt(*options: Node) -> Node:
    flat = tuple(part for option in options for part in (option.options if isinstance(option, Alt) else (option,)))
    return flat[0] if len(flat) == 1 else Alt(flat)


def children(node: Node) -> tuple[Node, ...]:
    match node:
        case Step(body=None):
            return ()
        case Step(body=Node() as body):
            return (body,)
        case Seq(items=nodes) | Par(branches=nodes) | Alt(options=nodes):
            return nodes
        case Repeat():
            return (node.node,)
    return ()


def head(step: Step) -> str:
    name = f".{step.name}" if step.name else ""
    return f"{step.actor}{name}{step.sig or ''}"


def label(step: Step) -> str:
    return head(step) + ("!" if step.failed else "")


def bound(lo: int, hi: int | None, parallel: bool = False) -> str:
    if parallel:
        if lo == 0 and hi is None:
            return "[]"
        return f"[{lo}]" if lo == hi else f"[{lo},{'' if hi is None else hi}]"
    match lo, hi:
        case 0, None:
            return "*"
        case 1, None:
            return "+"
        case 0, 1:
            return "?"
        case _, None:
            return f"{{{lo},}}"
        case _ if lo == hi:
            return f"{{{lo}}}"
        case _:
            return f"{{{lo},{hi}}}"


def render(node: Node, outer: int = 0) -> str:
    text, precedence = _text(node)
    return f"({text})" if precedence < outer else text


def _text(node: Node) -> tuple[str, int]:
    match node:
        case Step(body=None):
            return label(node), 4
        case Step(body=Node() as body):
            return f"{head(node)}{{ {render(body)} }}{'!' if node.failed else ''}", 4
        case Repeat():
            return render(node.node, 3) + bound(node.lo, node.hi, node.parallel), 3
        case Par():
            return " || ".join(render(branch, 3) for branch in node.branches), 2
        case Seq():
            return " -> ".join(render(item, 2) for item in node.items), 1
        case Alt():
            return " | ".join(render(option, 1) for option in node.options), 0
    raise TypeError(f"not a process node: {node!r}")
