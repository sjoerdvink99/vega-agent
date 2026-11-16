import { append } from "../collections";
import { children, choice, parallel, repeat, sequence, type Node, type Step } from "./ast";
import { print } from "./print";

export const LEVELS = ["full", "names", "actors", "loops"] as const;
export type Level = (typeof LEVELS)[number];

export function abstract(node: Node, level: Level = "actors"): Node {
  return foldWith(project(node, level), level === "loops");
}

export function fold(node: Node): Node {
  return foldWith(node, false);
}

export function project(node: Node, level: Level): Node {
  switch (node.t) {
    case "step": {
      const body = node.body ? project(node.body, level) : null;
      if (level === "full") return { ...node, body };
      return { ...node, name: level === "names" ? node.name : null, sig: null, body };
    }
    case "seq":
      return sequence(node.items.map((item) => project(item, level)));
    case "par":
      return parallel(node.items.map((item) => project(item, level)));
    case "alt":
      return choice(node.items.map((item) => project(item, level)));
    default:
      return { ...node, node: project(node.node, level) };
  }
}

function foldWith(node: Node, loose: boolean): Node {
  switch (node.t) {
    case "step":
      return node.body ? { ...node, body: foldWith(node.body, loose) } : node;
    case "seq": {
      let items = node.items.map((item) => foldWith(item, loose));
      for (let folded = tandem(items, loose); folded.length < items.length; folded = tandem(items, loose)) items = folded;
      return sequence(items);
    }
    case "par":
      return collapse(
        node.items.map((item) => foldWith(item, loose)),
        loose,
      );
    case "alt":
      return choice(node.items.map((item) => foldWith(item, loose)));
    default:
      return { ...node, node: foldWith(node.node, loose) };
  }
}

const key = (node: Node, loose: boolean) => print(loose ? shape(node) : node);

function shape(node: Node): Node {
  switch (node.t) {
    case "repeat":
      return shape(node.node);
    case "step":
      return { ...node, failed: false, body: node.body ? shape(node.body) : null };
    case "seq":
      return sequence(node.items.map(shape));
    case "par":
      return parallel(node.items.map(shape));
    default:
      return node;
  }
}

function tandem(items: Node[], loose: boolean): Node[] {
  const keys = items.map((item) => key(item, loose));
  const folded: Node[] = [];
  let start = 0;
  while (start < items.length) {
    const [period, times] = longestRun(keys, start);
    if (times === 1) {
      folded.push(items[start]);
      start += 1;
      continue;
    }
    const chunks = Array.from({ length: times }, (_, k) => sequence(items.slice(start + k * period, start + (k + 1) * period)));
    const body = foldWith(chunks.reduce(join), loose);
    folded.push(loose ? repeat(body, 1, null) : repeat(body, times, times));
    start += period * times;
  }
  return folded;
}

function longestRun(keys: string[], start: number): [number, number] {
  let best: [number, number] = [1, 1];
  const rest = keys.length - start;
  for (let period = 1; period <= rest / 2 && best[0] * best[1] < rest; period += 1) {
    let times = 1;
    while ((times + 1) * period <= rest && repeats(keys, start, start + times * period, period)) times += 1;
    if (times > 1 && period * times > best[0] * best[1]) best = [period, times];
  }
  return best;
}

function repeats(keys: string[], from: number, to: number, length: number): boolean {
  for (let k = 0; k < length; k += 1) if (keys[from + k] !== keys[to + k]) return false;
  return true;
}

function collapse(branches: Node[], loose: boolean): Node {
  const groups = new Map<string, Node[]>();
  for (const branch of branches) append(groups, key(branch, loose), branch);
  const decks = [...groups.values()].map((group) =>
    group.length === 1 ? group[0] : repeat(group.reduce(join), loose ? 0 : group.length, loose ? null : group.length, true),
  );
  return parallel(decks);
}

const inner = (node: Node) => (node.t === "repeat" ? node.node : node);

function bounds(node: Node, inParallel: boolean): [number, number | null] {
  if (node.t !== "repeat") return [1, 1];
  return node.parallel === inParallel ? [node.lo, node.hi] : [0, null];
}

function join(a: Node, b: Node): Node {
  if (a.t === "repeat" || b.t === "repeat") {
    const inParallel = (a.t === "repeat" && a.parallel) || (b.t === "repeat" && b.parallel);
    const [[alo, ahi], [blo, bhi]] = [bounds(a, inParallel), bounds(b, inParallel)];
    const hi = ahi === null || bhi === null ? null : Math.max(ahi, bhi);
    return repeat(join(inner(a), inner(b)), Math.min(alo, blo), hi, inParallel);
  }
  if (a.t === "step" && b.t === "step") return joinSteps(a, b);
  if ((a.t === "seq" || a.t === "par") && b.t === a.t && a.items.length === b.items.length) {
    return { ...a, items: a.items.map((item, index) => join(item, b.items[index])) };
  }
  return loops(b) > loops(a) ? b : a;
}

const loops = (node: Node): number => (node.t === "repeat" ? 1 : 0) + children(node).reduce((total, child) => total + loops(child), 0);

function joinSteps(a: Step, b: Step): Step {
  const body = a.body && b.body ? join(a.body, b.body) : a.body;
  return { ...a, body, failed: a.failed || b.failed };
}
