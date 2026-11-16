import { append } from "../collections";
import { abstract, fold, LEVELS, project, type Level } from "../grammar/abstract";
import { children, type Actor, type Node } from "../grammar/ast";

export { ANY } from "../grammar/ast";
export { LEVELS } from "../grammar/abstract";
import { print, signature } from "../grammar/print";
import { trace } from "../grammar/trace";
import type { TracedRun } from "../standards/runs";

export type RunRow = { run: number; id: string; group: string | null } & Record<Level, number>;
export type VariantRow = { variant: number; level: Level; label: string; length: number };
export type TokenRow = { variant: number; index: number; token: string; actors: Actor[]; failed: boolean };
export type StepRow = {
  variant: number;
  index: number;
  depth: number;
  parent: number;
  actor: Actor;
  name: string | null;
  signature: string | null;
  failed: boolean;
};
export type TimeRow = { run: number; index: number; start: number; end: number };

export type Tables = { runs: RunRow[]; variants: VariantRow[]; tokens: TokenRow[]; steps: StepRow[]; times: TimeRow[] };

export function sequence(node: Node, level: Level): Node[] {
  const projected = level === "loops" ? abstract(node, level) : project(node, level);
  const items = projected.t === "seq" ? projected.items : [projected];
  return level === "loops" ? items : items.map(fold);
}

export const actorsOf = (node: Node): Actor[] => (node.t === "step" ? [node.actor] : [...new Set(children(node).flatMap(actorsOf))]);

export const failed = (node: Node): boolean => (node.t === "step" && node.failed) || children(node).some(failed);

function walked(node: Node, variant: number): Omit<StepRow, "index">[] {
  const found: Omit<StepRow, "index">[] = [];
  const visit = (current: Node, depth: number, parent: number) => {
    if (current.t === "step") {
      found.push({
        variant,
        depth,
        parent,
        actor: current.actor,
        name: current.name,
        signature: current.sig && signature(current.sig),
        failed: current.failed,
      });
      if (current.body) visit(current.body, depth + 1, found.length - 1);
    } else children(current).forEach((child) => visit(child, depth, parent));
  };
  visit(node, 0, -1);
  return found;
}

export function tables(traced: readonly TracedRun[]): Tables {
  const nodes = traced.map((run) => trace(run.process));
  const known = new Map<string, number>();
  const result: Tables = { runs: [], variants: [], tokens: [], steps: [], times: [] };
  const assigned = LEVELS.map((level) =>
    nodes.map((node) => {
      const items = sequence(node, level);
      const key = `${level}\u0000${items.map((item) => print(item)).join("\u0001")}`;
      const found = known.get(key);
      if (found !== undefined) return found;
      const variant = result.variants.length;
      known.set(key, variant);
      result.variants.push({ variant, level, label: print(abstract(node, level)), length: items.length });
      items.forEach((item, index) => result.tokens.push({ variant, index, token: print(item), actors: actorsOf(item), failed: failed(item) }));
      if (level === "full") walked(node, variant).forEach((row, index) => result.steps.push({ ...row, index }));
      return variant;
    }),
  );
  traced.forEach((run, index) => {
    const levels = Object.fromEntries(LEVELS.map((level, at) => [level, assigned[at][index]])) as Record<Level, number>;
    result.runs.push({ run: index, id: run.id, group: run.group ?? null, ...levels });
    run.time.forEach((interval, position) => {
      if (interval) result.times.push({ run: index, index: position, start: interval[0], end: interval[1] });
    });
  });
  return result;
}

export function byVariant<T extends { variant: number }>(rows: readonly T[]): Map<number, T[]> {
  const found = new Map<number, T[]>();
  for (const row of rows) append(found, row.variant, row);
  return found;
}

export const labelOf = (step: StepRow) => `${step.actor}${step.name ? `.${step.name}` : ""}${step.signature ?? ""}${step.failed ? "!" : ""}`;

export function clockOf(times: readonly TimeRow[]): Map<number, Map<number, { start: number; end: number }>> {
  const found = new Map<number, Map<number, { start: number; end: number }>>();
  const origin = new Map<number, number>();
  for (const { run, start } of times) origin.set(run, Math.min(origin.get(run) ?? Infinity, start));
  for (const { run, index, start, end } of times) {
    const at = found.get(run) ?? new Map();
    const zero = origin.get(run) ?? 0;
    at.set(index, { start: start - zero, end: end - zero });
    found.set(run, at);
  }
  return found;
}
