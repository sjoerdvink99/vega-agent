import type { Data, Signal, Transforms } from "vega";
import type { Actor } from "../grammar/ast";
import type { Scope } from "./corpus";
import { literal } from "./expr";
import { contains, type Unit } from "./unit";

export type Focus = { run: string; variant: string; data: Data[]; signals: Signal[]; timing: Data };

export const stepOf = (run: number | string, index: number | string) => `${run}:${index}`;

export function focus(scope: Scope): Focus {
  const { unit } = scope;
  const [chosen, run, variant, timing] = ["chosenRuns", "shownRun", "shownVariant", "timing"].map(unit.name);
  const runs = literal(scope.table("runs"));
  const pick = (field: string, fallback: string) =>
    `length(data(${literal(chosen)})) ? data(${literal(chosen)})[0].${field} : length(data(${runs})) ? data(${runs})[0].${field} : ${fallback}`;
  return {
    run,
    variant,
    data: [
      {
        name: chosen,
        source: scope.table("runs"),
        transform: unit.filter ? [{ type: "filter", expr: contains(unit.filter, "datum.id") }] : [{ type: "filter", expr: "false" }],
      },
    ],
    signals: [
      { name: run, update: pick("run", "-1") },
      { name: variant, update: pick("full", "-1") },
    ],
    timing: {
      name: timing,
      source: scope.table("times"),
      transform: [
        { type: "filter", expr: `datum.run === ${run}` },
        { type: "project", fields: ["index", "start", "end"] },
        { type: "joinaggregate", fields: ["start"], ops: ["min"], as: ["origin"] },
        { type: "formula", as: "begin", expr: "datum.start - datum.origin" },
        { type: "formula", as: "finish", expr: "datum.end - datum.origin" },
      ],
    },
  };
}

export const ofVariant = (scope: Scope, focused: Focus, local: string, then: Transforms[]): Data => ({
  name: scope.unit.name(local),
  source: scope.table("steps"),
  transform: [
    { type: "filter", expr: `datum.variant === ${focused.variant}` },
    { type: "project", fields: ["variant", "index", "depth", "parent", "actor", "name", "signature", "failed"] },
    { type: "formula", as: "label", expr: "datum.actor + (datum.name ? '.' + datum.name : '') + (datum.signature || '') + (datum.failed ? '!' : '')" },
    ...then,
  ],
});

export function matched(unit: Unit, focused: Focus): Transforms[] {
  const { highlight } = unit;
  if (!highlight) return [];
  const has = (key: string) => contains(highlight, key);
  return [{ type: "formula", as: "matching", expr: `${has("'' + datum.index")} || ${has(`${focused.run} + ':' + datum.index`)} ? 1 : 0` }];
}

export function actorsShown(scope: Scope): Actor[] {
  const { runs, steps } = scope.corpus.tables;
  const shown = new Set((scope.unit.filter ? runs : runs.slice(0, 1)).map((run) => run.full));
  return [...new Set(steps.filter((step) => shown.has(step.variant)).map((step) => step.actor))];
}
