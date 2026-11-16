import { remember } from "../collections";
import { ANY, sequence, steps, type List, type Node, type Rep, type Repeat, type Sig, type Step } from "./ast";
import { fold } from "./abstract";
import { parse } from "./parse";
import { print } from "./print";
import { trace } from "./trace";

export type Hit = { text: string; steps: number[] };

type Query = string | Node;

type Pool = { node: Node; lo: number; hi: number | null };

const NOTHING: Node[] = [];

const stepCount = (node: Node) => steps(node).length;

function offsets(items: Node[], base: number): number[] {
  let next = base;
  return items.map((item) => {
    const at = next;
    next += stepCount(item);
    return at;
  });
}

const product = (choices: Pool[][][]) =>
  choices.reduce<Pool[][]>((combined, options) => combined.flatMap((pools) => options.map((option) => [...pools, ...option])), [[]]);

const asNode = (query: Query) => (typeof query === "string" ? parse(query) : query);
const asTrace = (run: Query) => (typeof run === "string" ? trace(run) : run);

export function conforms(run: Query, spec: Query): boolean {
  return new Matcher().full(asNode(spec), asTrace(run));
}

export function find(run: Query, query: Query): Hit[] {
  const pattern = asNode(query);
  const matcher = new Matcher();
  const hits: Hit[] = [];
  for (const { items, at } of matcher.sequences(asTrace(run), 0)) {
    let start = 0;
    while (start < items.length) {
      const end = [...matcher.ends(pattern, items, start)].reduce((best, each) => Math.max(best, each), start);
      if (end === start) {
        start += 1;
        continue;
      }
      const matched = sequence(items.slice(start, end));
      hits.push({ text: print(fold(matched)), steps: Array.from({ length: stepCount(matched) }, (_, offset) => at[start] + offset) });
      start = end;
    }
  }
  return hits;
}

class Matcher {
  private ids = new Map<object, number>();
  private lists = new WeakMap<Node, Node[]>();
  private memo = new Map<string, Set<number>>();
  private spreading = new WeakMap<Node, boolean>();

  items(node: Node): Node[] {
    return remember(this.lists, node, () => (node.t === "seq" ? node.items : [node]));
  }

  *sequences(node: Node, base: number): Generator<{ items: Node[]; at: number[] }> {
    const items = this.items(node);
    const at = offsets(items, base);
    yield { items, at };
    for (const [k, item] of items.entries()) {
      if (item.t === "step" && item.body) yield* this.sequences(item.body, at[k] + 1);
      if (item.t !== "par") continue;
      let start = at[k];
      for (const branch of item.items) {
        yield* this.sequences(branch, start);
        start += stepCount(branch);
      }
    }
  }

  full(spec: Node, node: Node): boolean {
    const items = this.items(node);
    return this.ends(spec, items, 0).has(items.length);
  }

  ends(spec: Node, items: Node[], start: number): Set<number> {
    return remember(this.memo, `${this.id(spec)}:${this.id(items)}:${start}`, () => this.compute(spec, items, start));
  }

  private id(value: object): number {
    return remember(this.ids, value, () => this.ids.size);
  }

  private compute(spec: Node, items: Node[], start: number): Set<number> {
    const here = start < items.length ? items[start] : null;
    switch (spec.t) {
      case "step":
        if (spec.actor === ANY && !spec.name && !spec.sig && !spec.body && !spec.failed) return new Set(here ? [start + 1] : []);
        return new Set(here?.t === "step" && this.step(spec, here) ? [start + 1] : []);
      case "seq": {
        let positions = new Set([start]);
        for (const item of spec.items) positions = new Set([...positions].flatMap((position) => [...this.ends(item, items, position)]));
        return positions;
      }
      case "alt":
        return new Set(spec.items.flatMap((option) => [...this.ends(option, items, start)]));
      case "repeat":
        return spec.parallel ? this.copies(spec, items, start) : this.repeat(spec, items, start);
      case "par":
        return this.branches(spec, items, start);
    }
  }

  private repeat(spec: Repeat, items: Node[], start: number): Set<number> {
    const reached = new Set(spec.lo === 0 ? [start] : []);
    let frontier = new Set([start]);
    const limit = spec.hi ?? items.length - start + spec.lo + 1;
    for (let rounds = 1; rounds <= limit; rounds += 1) {
      frontier = new Set([...frontier].flatMap((position) => [...this.ends(spec.node, items, position)]));
      if (!frontier.size || (rounds > spec.lo && [...frontier].every((end) => reached.has(end)))) break;
      if (rounds >= spec.lo) frontier.forEach((end) => reached.add(end));
    }
    return reached;
  }

  private copies(spec: Repeat, items: Node[], start: number): Set<number> {
    const empty = this.nullable(spec.node);
    const ends = new Set<number>(spec.lo === 0 || empty ? [start] : []);
    if (spec.hi !== 0 && (spec.lo <= 1 || empty)) this.ends(spec.node, items, start).forEach((end) => ends.add(end));
    if (this.spread(spec, items[start])) ends.add(start + 1);
    return ends;
  }

  private branches(spec: List, items: Node[], start: number): Set<number> {
    const ends = new Set<number>(spec.items.every((item) => this.nullable(item)) ? [start] : []);
    spec.items.forEach((item, k) => {
      if (this.alone(spec.items, k)) this.ends(item, items, start).forEach((end) => ends.add(end));
    });
    if (this.spread(spec, items[start])) ends.add(start + 1);
    return ends;
  }

  private spread(spec: Node, here: Node | undefined): boolean {
    if (here?.t !== "par") return false;
    return this.layouts(spec, here.items.length).some((pools) => this.assign(pools, here.items));
  }

  private nullable(spec: Node): boolean {
    return this.ends(spec, NOTHING, 0).has(0);
  }

  private alone(items: Node[], k: number): boolean {
    return items.every((other, j) => j === k || this.nullable(other));
  }

  private spreads(spec: Node): boolean {
    return remember(this.spreading, spec, () => {
      switch (spec.t) {
        case "step":
          return false;
        case "par":
          return true;
        case "alt":
          return spec.items.some((option) => this.spreads(option));
        case "seq":
          return spec.items.some((item, k) => this.spreads(item) && this.alone(spec.items, k));
        case "repeat":
          if (spec.hi === 0) return false;
          if (spec.parallel) return spec.hi === null || spec.hi > 1 || this.spreads(spec.node);
          return this.spreads(spec.node) && (spec.lo <= 1 || this.nullable(spec.node));
      }
    });
  }

  private layouts(spec: Node, n: number): Pool[][] {
    const single = [[{ node: spec, lo: 1, hi: 1 }]];
    if (!this.spreads(spec)) return single;
    switch (spec.t) {
      case "par":
        return product(spec.items.map((item) => this.layouts(item, n)));
      case "alt":
        return spec.items.flatMap((option) => this.layouts(option, n));
      case "seq":
        return [...single, ...spec.items.flatMap((item, k) => (this.alone(spec.items, k) ? this.layouts(item, n) : []))];
      case "repeat":
        return spec.parallel ? this.scaled(spec, n) : [...single, ...this.layouts(spec.node, n)];
      default:
        return single;
    }
  }

  private scaled(spec: Repeat, n: number): Pool[][] {
    if (!this.spreads(spec.node)) return [[{ node: spec.node, lo: spec.lo, hi: spec.hi }]];
    const options = this.layouts(spec.node, n);
    const least = this.nullable(spec.node) ? 0 : spec.lo;
    const most = Math.min(spec.hi ?? n, n);
    const found = new Map<string, Pool[]>();
    let reached = new Map<string, Pool[]>([["", []]]);
    for (let copies = 0; copies <= most && reached.size; copies += 1) {
      if (copies >= least) reached.forEach((pools, key) => found.set(key, pools));
      const next = new Map<string, Pool[]>();
      for (const pools of reached.values()) {
        for (const option of options) {
          const merged = this.merge([...pools, ...option], n);
          if (merged) next.set(this.key(merged), merged);
        }
      }
      reached = next;
    }
    return [...found.values()];
  }

  private merge(pools: Pool[], n: number): Pool[] | null {
    const merged = new Map<Node, Pool>();
    for (const { node, lo, hi } of pools) {
      const held = merged.get(node) ?? { node, lo: 0, hi: 0 };
      merged.set(node, { node, lo: held.lo + lo, hi: Math.min((held.hi ?? 0) + (hi ?? n), n) });
    }
    const least = [...merged.values()].reduce((total, pool) => total + (this.nullable(pool.node) ? 0 : pool.lo), 0);
    return least > n ? null : [...merged.values()];
  }

  private key(pools: Pool[]): string {
    return pools
      .map(({ node, lo, hi }) => `${this.id(node)}:${lo}:${hi}`)
      .sort()
      .join(" ");
  }

  private assign(pools: Pool[], branches: Node[]): boolean {
    const lows = pools.map((pool) => (this.nullable(pool.node) ? 0 : pool.lo));
    const highs = pools.map((pool) => Math.min(pool.hi ?? branches.length, branches.length));
    const fits = branches.map((branch) => pools.flatMap((pool, k) => (this.full(pool.node, branch) ? [k] : [])));
    const owner: (number | null)[] = branches.map(() => null);
    const taken = pools.map(() => 0);
    const seat = (branch: number, caps: number[], seen: Set<number>): boolean => {
      for (const pool of fits[branch]) {
        if (seen.has(pool)) continue;
        seen.add(pool);
        if (taken[pool] < caps[pool] || owner.some((held, other) => held === pool && seat(other, caps, seen))) {
          const previous = owner[branch];
          if (previous !== null) taken[previous] -= 1;
          owner[branch] = pool;
          taken[pool] += 1;
          return true;
        }
      }
      return false;
    };
    branches.forEach((_, branch) => seat(branch, lows, new Set()));
    if (taken.some((count, k) => count < lows[k])) return false;
    return branches.every((_, branch) => owner[branch] !== null || seat(branch, highs, new Set()));
  }

  private step(spec: Step, node: Step): boolean {
    return (
      (spec.actor === ANY || spec.actor === node.actor) &&
      (spec.name === null || spec.name === node.name) &&
      (node.failed || !spec.failed) &&
      (spec.sig === null || covers(spec.sig, node.sig)) &&
      (spec.body === null || (node.body !== null && this.full(spec.body, node.body)))
    );
  }
}

const fits = (rep: Rep, other: Rep) => rep.role === other.role && (rep.medium === null || rep.medium === other.medium) && (other.many || !rep.many);
const subset = (wanted: Rep[], given: Rep[]) => wanted.every((rep) => given.some((other) => fits(rep, other)));
const covers = (spec: Sig, sig: Sig | null) => sig !== null && subset(spec.inputs, sig.inputs) && subset(spec.outputs, sig.outputs);
