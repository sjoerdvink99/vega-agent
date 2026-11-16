import { ANY, MAX_STEPS, parallel, sequence, type Node } from "./ast";
import { parse } from "./parse";
import { print } from "./print";

export class TraceError extends Error {
  name = "TraceError";
}

const byText = (a: Node, b: Node) => {
  const [x, y] = [print(a), print(b)];
  return x < y ? -1 : x > y ? 1 : 0;
};

const ordered = (node: Node): Node => (node.t === "par" ? { ...node, items: [...node.items].sort(byText) } : node);

export function size(node: Node): number {
  switch (node.t) {
    case "step":
      if (node.actor === ANY) throw new TraceError("a trace cannot contain the wildcard '_'");
      return 1 + (node.body ? size(node.body) : 0);
    case "seq":
    case "par":
      return node.items.reduce((total, item) => total + size(item), 0);
    case "repeat":
      if (node.lo !== node.hi) break;
      return node.lo && node.lo * size(node.node);
  }
  throw new TraceError(`a trace has no choice or open repetition: ${print(node)}`);
}

export function ground(node: Node): Node {
  if (size(node) > MAX_STEPS) throw new TraceError(`a trace has at most ${MAX_STEPS} steps`);
  return expand(node);
}

function expand(node: Node): Node {
  switch (node.t) {
    case "step":
      return node.body ? { ...node, body: expand(node.body) } : node;
    case "seq":
      return sequence(node.items.map(expand));
    case "par":
      return ordered(parallel(node.items.map(expand)));
    case "repeat": {
      const copies = Array.from({ length: node.lo }, () => expand(node.node));
      return node.parallel ? ordered(parallel(copies)) : sequence(copies);
    }
    case "alt":
      throw new TraceError(`a trace has no choice: ${print(node)}`);
  }
}

export function trace(process: string | Node): Node {
  return ground(typeof process === "string" ? parse(process) : process);
}

export function isGround(node: Node): boolean {
  try {
    return size(node) <= MAX_STEPS;
  } catch {
    return false;
  }
}
