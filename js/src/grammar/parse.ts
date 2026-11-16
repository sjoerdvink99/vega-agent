import {
  ACTORS,
  ANY,
  MAX_DEPTH,
  MAX_STEPS,
  choice,
  parallel,
  repeat,
  sequence,
  step,
  type Actor,
  type Node,
  type Rep,
  type Repeat,
  type Sig,
  type Step,
} from "./ast";

const SPACE = /[ \t\n\r]*/y;
const TOKEN = /(->|=>|\|\||[|(){}[\]*+?!,:.])|([0-9]+)|([A-Za-z_][A-Za-z0-9_]*)/y;

type Token = { kind: string; value: string; at: number };

export class ParseError extends Error {
  constructor(
    readonly reason: string,
    readonly position: number,
    readonly text: string,
  ) {
    super(`${reason} at ${position}\n  ${text}\n  ${" ".repeat(position)}^`);
    this.name = "ParseError";
  }
}

function pointer(text: string, at: number, message: string): ParseError {
  return new ParseError(message, at, text);
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  for (;;) {
    SPACE.lastIndex = position;
    SPACE.exec(text);
    position = SPACE.lastIndex;
    if (position >= text.length) break;
    TOKEN.lastIndex = position;
    const match = TOKEN.exec(text);
    if (!match) throw pointer(text, position, "unexpected character");
    const [value, symbol, number] = match;
    tokens.push({ kind: symbol ?? (number ? "number" : "name"), value, at: position });
    position = TOKEN.lastIndex;
  }
  return [...tokens, { kind: "end", value: "", at: text.length }];
}

export function parse(text: string): Node {
  if (typeof text !== "string") throw new TypeError(`parse expects a string, found ${text === null ? "null" : typeof text}`);
  return new Parser(text).parse();
}

class Parser {
  private tokens: Token[];
  private index = 0;
  private depth = 0;

  constructor(private text: string) {
    this.tokens = tokenize(text);
  }

  parse(): Node {
    const node = this.process();
    this.expect("end");
    return node;
  }

  private process(): Node {
    const options = [this.seq()];
    while (this.accept("|")) options.push(this.seq());
    return choice(options);
  }

  private seq(): Node {
    const items = [this.par()];
    while (this.accept("->")) items.push(this.par());
    return sequence(items);
  }

  private par(): Node {
    const branches = [this.term()];
    while (this.accept("||")) branches.push(this.term());
    return parallel(branches);
  }

  private term(): Node {
    let node = this.unit();
    for (let quantified = this.quant(node); quantified; quantified = this.quant(node)) node = quantified;
    return node;
  }

  private unit(): Node {
    if (this.peek().kind !== "(") return this.step();
    return this.nested("(", ")");
  }

  private nested(open: string, close: string): Node {
    const at = this.peek().at;
    this.expect(open);
    if (++this.depth > MAX_DEPTH) throw pointer(this.text, at, `nested more than ${MAX_DEPTH} levels deep`);
    const node = this.process();
    this.expect(close);
    this.depth -= 1;
    return node;
  }

  private step(): Step {
    const at = this.peek().at;
    const actor = this.expect("name");
    if (![...ACTORS, ANY].includes(actor as Actor)) {
      throw pointer(this.text, at, `unknown actor '${actor}', expected one of ${ACTORS.join(", ")}`);
    }
    const name = this.accept(".") ? this.expect("name") : null;
    const sig = this.peek().kind === "(" ? this.sig() : null;
    const body = this.peek().kind === "{" && this.peek(1).kind !== "number" ? this.nested("{", "}") : null;
    return step(actor as Actor, { name, sig, body, failed: this.accept("!") });
  }

  private sig(): Sig {
    this.expect("(");
    const inputs = this.reps(")", "=>");
    const outputs = this.accept("=>") ? this.reps(")") : [];
    this.expect(")");
    return { inputs, outputs };
  }

  private reps(...stops: string[]): Rep[] {
    if (stops.includes(this.peek().kind)) return [];
    const reps = [this.rep()];
    while (this.accept(",")) reps.push(this.rep());
    return reps;
  }

  private rep(): Rep {
    const role = this.expect("name");
    const medium = this.accept(":") ? this.expect("name") : null;
    const many = this.accept("[") && Boolean(this.expect("]"));
    return { role, medium, many };
  }

  private quant(node: Node): Node | null {
    if (this.accept("*")) return repeat(node, 0, null);
    if (this.accept("+")) return repeat(node, 1, null);
    if (this.accept("?")) return repeat(node, 0, 1);
    if (this.peek().kind === "[") return this.bounds(node, "[", "]");
    return this.peek().kind === "{" ? this.bounds(node, "{", "}") : null;
  }

  private bounds(node: Node, open: string, close: string): Repeat {
    const at = this.peek().at;
    const inParallel = open === "[";
    this.expect(open);
    if (inParallel && this.accept(close)) return repeat(node, 0, null, true);
    const lo = this.count();
    let hi: number | null = lo;
    if (this.accept(",")) hi = this.peek().kind === "number" ? this.count() : null;
    this.expect(close);
    if (hi !== null && hi < lo) throw pointer(this.text, at, `empty bound ${open}${lo},${hi}${close}`);
    return repeat(node, lo, hi, inParallel);
  }

  private count(): number {
    const at = this.peek().at;
    const value = this.expect("number");
    const n = value.length > 9 ? Infinity : Number(value);
    if (n > MAX_STEPS) throw pointer(this.text, at, `count above ${MAX_STEPS}`);
    return n;
  }

  private peek(ahead = 0): Token {
    return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)];
  }

  private accept(kind: string): boolean {
    if (this.peek().kind !== kind) return false;
    this.index += 1;
    return true;
  }

  private expect(kind: string): string {
    const token = this.peek();
    if (token.kind !== kind) {
      throw pointer(this.text, token.at, `expected ${kind}, found ${token.kind === "end" ? "end of input" : `'${token.value}'`}`);
    }
    this.index += 1;
    return token.value;
  }
}
