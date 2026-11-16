import { LEVELS, type Level } from "../grammar/abstract";
import type { Actor } from "../grammar/ast";
import { byVariant, type StepRow } from "./tables";

const START = "start";
const END = "end";
const OTHER = "other";

export type Activity = { level: Level; name: string; order: number; kind: "start" | "end" | "other" | "step"; actor: Actor | null; failed: boolean };

const named = (step: StepRow, level: Level) => ((level === "full" || level === "names") && step.name ? `${step.actor}.${step.name}` : step.actor);

const label = (step: StepRow, level: Level) => `${named(step, level)}${step.failed ? "!" : ""}`;

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function orders(steps: readonly StepRow[], weights: Map<number, number>, limit: number): Activity[] {
  const walks = [...byVariant(steps)];
  return LEVELS.flatMap((level) => {
    const exact = level === "loops" ? "actors" : level;
    const actors = new Map<string, Actor>();
    const frequency = new Map<string, number>();
    const position = new Map<string, { sum: number; runs: number }>();
    for (const [variant, rows] of walks) {
      const weight = weights.get(variant) ?? 0;
      const seen = new Set<string>();
      rows.forEach((row, index) => {
        const item = label(row, exact);
        actors.set(item, row.actor);
        frequency.set(item, (frequency.get(item) ?? 0) + weight);
        if (seen.has(item)) return;
        seen.add(item);
        const at = position.get(item) ?? { sum: 0, runs: 0 };
        position.set(item, { sum: at.sum + weight * index, runs: at.runs + weight });
      });
    }
    const kept = [...frequency]
      .sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))
      .slice(0, limit)
      .map(([item]) => item);
    const mean = (item: string) => {
      const at = position.get(item);
      return at && at.runs ? at.sum / at.runs : 0;
    };
    const order = kept.sort((a, b) => mean(a) - mean(b) || byName(a, b));
    const names = [START, ...order, ...(frequency.size > kept.length ? [OTHER] : []), END];
    return names.map((name, index): Activity => {
      const kind = name === START ? "start" : name === END ? "end" : name === OTHER ? "other" : "step";
      return { level, name, order: index, kind, actor: kind === "step" ? (actors.get(name) ?? null) : null, failed: kind === "step" && name.endsWith("!") };
    });
  });
}
