from __future__ import annotations

import re

from .syntax import ACTORS, ANY, MAX_DEPTH, MAX_STEPS, Node, Rep, Repeat, Sig, Step, alt, par, seq

VISIBLE = re.compile(r"[^ \t\n\r]")
TOKEN = re.compile(r"(->|=>|\|\||[|(){}\[\]*+?!,:.])|([0-9]+)|([A-Za-z_][A-Za-z0-9_]*)")


class ParseError(ValueError):
    def __init__(self, reason: str, position: int, text: str):
        super().__init__(f"{reason} at {position}\n  {text}\n  {' ' * position}^")
        self.reason, self.position, self.text = reason, position, text


def parse(text: str | Node) -> Node:
    if isinstance(text, Node):
        return text
    if not isinstance(text, str):
        raise TypeError(f"parse expects an expression string or a Node, found {type(text).__name__}")
    return Parser(text).parse()


def tokenize(text: str) -> list[tuple[str, str, int]]:
    tokens, position = [], 0
    while found := VISIBLE.search(text, position):
        position = found.start()
        match = TOKEN.match(text, position)
        if not match:
            raise ParseError("unexpected character", position, text)
        symbol, number, _ = match.groups()
        tokens.append((symbol or ("number" if number else "name"), match.group(), position))
        position = match.end()
    return [*tokens, ("end", "", len(text))]


class Parser:
    def __init__(self, text: str):
        self.text = text
        self.tokens = tokenize(text)
        self.index = 0
        self.depth = 0

    def parse(self) -> Node:
        node = self.process()
        self.expect("end")
        return node

    def process(self) -> Node:
        options = [self.seq()]
        while self.accept("|"):
            options.append(self.seq())
        return alt(*options)

    def seq(self) -> Node:
        items = [self.par()]
        while self.accept("->"):
            items.append(self.par())
        return seq(*items)

    def par(self) -> Node:
        branches = [self.term()]
        while self.accept("||"):
            branches.append(self.term())
        return par(*branches)

    def term(self) -> Node:
        node = self.unit()
        while (quantified := self.quant(node)) is not None:
            node = quantified
        return node

    def unit(self) -> Node:
        return self.nested("(", ")") if self.peek() == "(" else self.step()

    def nested(self, opening: str, closing: str) -> Node:
        position = self.position
        self.expect(opening)
        self.depth += 1
        if self.depth > MAX_DEPTH:
            raise ParseError(f"nested more than {MAX_DEPTH} levels deep", position, self.text)
        node = self.process()
        self.expect(closing)
        self.depth -= 1
        return node

    def step(self) -> Step:
        position = self.position
        actor = self.expect("name")
        if actor not in (*ACTORS, ANY):
            raise ParseError(f"unknown actor '{actor}', expected one of {', '.join(ACTORS)}", position, self.text)
        name = self.expect("name") if self.accept(".") else None
        sig = self.sig() if self.peek() == "(" else None
        body = self.nested("{", "}") if self.peek() == "{" and self.peek(1) != "number" else None
        return Step(actor, name, sig, body, self.accept("!"))

    def sig(self) -> Sig:
        self.expect("(")
        inputs = self.reps(")", "=>")
        outputs = self.reps(")") if self.accept("=>") else ()
        self.expect(")")
        return Sig(inputs, outputs)

    def reps(self, *stops: str) -> tuple[Rep, ...]:
        if self.peek() in stops:
            return ()
        reps = [self.rep()]
        while self.accept(","):
            reps.append(self.rep())
        return tuple(reps)

    def rep(self) -> Rep:
        role = self.expect("name")
        medium = self.expect("name") if self.accept(":") else None
        many = self.accept("[") and bool(self.expect("]"))
        return Rep(role, medium, many)

    def quant(self, node: Node) -> Node | None:
        if self.accept("*"):
            return Repeat(node, 0, None)
        if self.accept("+"):
            return Repeat(node, 1, None)
        if self.accept("?"):
            return Repeat(node, 0, 1)
        if self.peek() == "[":
            return self.bounds(node, "[", "]")
        if self.peek() == "{":
            return self.bounds(node, "{", "}")
        return None

    def bounds(self, node: Node, opening: str, closing: str) -> Repeat:
        position = self.position
        parallel = opening == "["
        self.expect(opening)
        if parallel and self.accept(closing):
            return Repeat(node, 0, None, parallel)
        lo = hi = self.count()
        if self.accept(","):
            hi = self.count() if self.peek() == "number" else None
        self.expect(closing)
        if hi is not None and hi < lo:
            raise ParseError(f"empty bound {opening}{lo},{hi}{closing}", position, self.text)
        return Repeat(node, lo, hi, parallel)

    def count(self) -> int:
        position = self.position
        value = self.expect("number")
        n = int(value) if len(value) <= 9 else MAX_STEPS + 1
        if n > MAX_STEPS:
            raise ParseError(f"count above {MAX_STEPS}", position, self.text)
        return n

    @property
    def position(self) -> int:
        return self.tokens[self.index][2]

    def peek(self, ahead: int = 0) -> str:
        return self.tokens[min(self.index + ahead, len(self.tokens) - 1)][0]

    def accept(self, kind: str) -> bool:
        if self.peek() != kind:
            return False
        self.index += 1
        return True

    def expect(self, kind: str) -> str:
        found, value, position = self.tokens[self.index]
        if found != kind:
            shown = "end of input" if found == "end" else f"'{value}'"
            raise ParseError(f"expected {kind}, found {shown}", position, self.text)
        self.index += 1
        return value
