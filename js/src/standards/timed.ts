import { EMPTY, parallel, sequence, step, type Actor, type Node, type Step } from "../grammar/ast";
import { print } from "../grammar/print";
import type { Interval } from "../spec";

export type Timed = { node: Node; time: Interval[]; branches: Timed[] };

const NONE: Timed = { node: EMPTY, time: [], branches: [] };

const byText = (a: Timed, b: Timed) => {
  const [x, y] = [print(a.node), print(b.node)];
  return x < y ? -1 : x > y ? 1 : 0;
};

export function timedStep(actor: Actor, fields: Partial<Omit<Step, "t" | "actor" | "body">>, interval: Interval, body: Timed = NONE): Timed {
  const inner = body.node === EMPTY ? null : body.node;
  return { node: step(actor, { ...fields, body: inner }), time: [interval, ...body.time], branches: [] };
}

export function timedSequence(parts: Timed[]): Timed {
  return { node: sequence(parts.map((part) => part.node)), time: parts.flatMap((part) => part.time), branches: [] };
}

export function timedParallel(parts: Timed[]): Timed {
  const branches = parts
    .flatMap((part) => (part.node.t === "par" ? part.branches : [part]))
    .filter((part) => part.node !== EMPTY && !(part.node.t === "seq" && !part.node.items.length))
    .sort(byText);
  if (!branches.length) return NONE;
  if (branches.length === 1) return branches[0];
  return { node: parallel(branches.map((branch) => branch.node)), time: branches.flatMap((branch) => branch.time), branches };
}
