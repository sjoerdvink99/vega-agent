export const ACTORS = ["model", "tool", "agent", "human", "code"] as const;
export const ANY = "_";

export type Actor = (typeof ACTORS)[number] | typeof ANY;

export type Rep = { role: string; medium: string | null; many: boolean };
export type Sig = { inputs: Rep[]; outputs: Rep[] };

export type Step = {
  t: "step";
  actor: Actor;
  name: string | null;
  sig: Sig | null;
  body: Node | null;
  failed: boolean;
};

export type List = { t: "seq" | "par" | "alt"; items: Node[] };
export type Repeat = { t: "repeat"; node: Node; lo: number; hi: number | null; parallel: boolean };
export type Node = Step | List | Repeat;

export const EMPTY: List = { t: "seq", items: [] };

export const MAX_DEPTH = 64;
export const MAX_STEPS = 100_000;

export function step(actor: Actor, fields: Partial<Omit<Step, "t" | "actor">> = {}): Step {
  return { t: "step", actor, name: null, sig: null, body: null, failed: false, ...fields };
}

const isEmpty = (node: Node) => node.t === "seq" && node.items.length === 0;
const flatten = (t: List["t"], nodes: Node[]) => nodes.flatMap((node) => (node.t === t ? node.items : [node]));

export const seq = (...nodes: Node[]): Node => sequence(nodes);
export const par = (...nodes: Node[]): Node => parallel(nodes);
export const alt = (...nodes: Node[]): Node => choice(nodes);

export function sequence(nodes: Node[]): Node {
  const items = flatten("seq", nodes);
  if (!items.length) return EMPTY;
  return items.length === 1 ? items[0] : { t: "seq", items };
}

export function parallel(nodes: Node[]): Node {
  const items = flatten(
    "par",
    nodes.filter((node) => !isEmpty(node)),
  );
  if (!items.length) return EMPTY;
  return items.length === 1 ? items[0] : { t: "par", items };
}

export function choice(nodes: Node[]): Node {
  const items = flatten("alt", nodes);
  return items.length === 1 ? items[0] : { t: "alt", items };
}

export function repeat(node: Node, lo: number, hi: number | null, inParallel = false): Repeat {
  return { t: "repeat", node, lo, hi, parallel: inParallel };
}

export function children(node: Node): Node[] {
  switch (node.t) {
    case "step":
      return node.body ? [node.body] : [];
    case "repeat":
      return [node.node];
    default:
      return node.items;
  }
}

export function steps(node: Node, depth = 0, found: [Step, number][] = []): [Step, number][] {
  if (node.t === "step") found.push([node, depth]);
  for (const child of children(node)) steps(child, node.t === "step" ? depth + 1 : depth, found);
  return found;
}
