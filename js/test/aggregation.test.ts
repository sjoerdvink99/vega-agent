import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEVELS, abstract, find, print, read, steps, trace, type Level, type Node, type Spec, type Step } from "../src";
import { sequence } from "../src/data/tables";
import { expression, random } from "./generate";
import { run as instantiate } from "./headless";

type Row = Record<string, unknown> & { ids: string[] };
type Run = { id: string; group: number; node: Node; time: ([number, number] | null)[] };
type Source = { name: string; values: unknown[]; trace: Record<string, unknown>; groups: string[]; timed: boolean };

const lines = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const CODING: Source = {
  name: "coding sessions",
  values: lines("../../docs/assets/coding.jsonl"),
  trace: { run: "session", actor: "type", name: "tool", start: "start", end: "end", failed: "error", group: { field: "version", order: ["before", "after"] } },
  groups: ["before", "after"],
  timed: true,
};

const next = random(7);
const GENERATED: Source = {
  name: "generated corpus",
  values: Array.from({ length: 48 }, (_, index) => ({ process: print(expression(next, 3, true)), side: index % 3 ? "a" : "b" })),
  trace: { group: { field: "side", order: ["a", "b"] } },
  groups: ["a", "b"],
  timed: false,
};

const QUERY = "model -> tool";

function runsOf(source: Source): Run[] {
  return read(source.values, source.trace as never).map((each) => ({
    id: each.id,
    group: source.groups.indexOf(each.group ?? source.groups[0]),
    node: trace(each.process),
    time: each.time,
  }));
}

const named = (step: Step, level: Level) => ((level === "full" || level === "names") && step.name ? `${step.actor}.${step.name}` : step.actor);
const labelled = (step: Step, level: Level) => `${named(step, level)}${step.failed ? "!" : ""}`;
const flat = (node: Node) => steps(node).map(([step]) => step);
const path = (run: Run, level: Level) => sequence(run.node, level).map((token) => print(token));

type Measure = {
  mark: string;
  dataset: string;
  options?: Record<string, unknown>;
  leveled: boolean;
  timed?: boolean;
  key: (row: Row, rows: Row[]) => string;
  owns: (run: Run, level: Level) => Map<string, Record<string, number>>;
};

const counted = (keys: string[]) => new Map(keys.map((key) => [key, {}]));

function summed(keys: string[], field: string): Map<string, Record<string, number>> {
  const found = new Map<string, Record<string, number>>();
  for (const key of keys) found.set(key, { [field]: (found.get(key)?.[field] ?? 0) + 1 });
  return found;
}

const MEASURES: Measure[] = [
  {
    mark: "variants",
    dataset: "ranking",
    options: { limit: 1000 },
    leveled: true,
    key: (row) => String(row.variant),
    owns: () => new Map(),
  },
  {
    mark: "projection",
    dataset: "counted",
    leveled: true,
    key: (row) => String(row.variant),
    owns: () => new Map(),
  },
  {
    mark: "graph",
    dataset: "visited",
    options: { limit: 1000 },
    leveled: true,
    key: (row) => String(row.node),
    owns: (run, level) => {
      const walk = ["start", ...flat(run.node).map((step) => labelled(step, level)), "end"];
      return summed(walk, "times");
    },
  },
  {
    mark: "icicle",
    dataset: "tree",
    leveled: true,
    key: (row, rows) => {
      const byKey = new Map(rows.map((each) => [each.key, each]));
      const parts: string[] = [];
      for (let at: Row | undefined = row; at && at.depth !== 0; at = byKey.get(at.parent)) parts.unshift(at.end ? "\u0000" : String(at.token));
      return parts.join("\t");
    },
    owns: (run, level) => {
      const walk = [...path(run, level), "\u0000"];
      return counted(walk.map((_, index) => walk.slice(0, index + 1).join("\t")));
    },
  },
  {
    mark: "transitions",
    dataset: "follows",
    options: { limit: 1000 },
    leveled: true,
    key: (row) => `${row.from}\t${row.to}`,
    owns: (run, level) => {
      const walk = ["start", ...flat(run.node).map((step) => labelled(step, level)), "end"];
      return summed(
        walk.slice(1).map((to, index) => `${walk[index]}\t${to}`),
        "times",
      );
    },
  },
  {
    mark: "activities",
    dataset: "activities",
    options: { limit: 1000 },
    leveled: true,
    key: (row) => String(row.activity),
    owns: (run, level) => {
      const found = new Map<string, Record<string, number>>();
      for (const step of flat(run.node)) {
        const key = named(step, level);
        const at = found.get(key) ?? { uses: 0, failed: 0 };
        found.set(key, { uses: at.uses + 1, failed: Math.max(at.failed, Number(step.failed)) });
      }
      return found;
    },
  },
  {
    mark: "sankey",
    dataset: "stack",
    options: { limit: 4, height: 4000 },
    leveled: true,
    key: (row) => `${row.column}\t${row.token}`,
    owns: (run, level) => {
      const walk = path(run, level);
      const shown = walk.length < 4 ? [...walk.slice(0, 4), "end"] : walk.slice(0, 4);
      return counted(shown.map((token, column) => `${column}\t${token}`));
    },
  },
  {
    mark: "durations",
    dataset: "summary",
    options: { limit: 1000 },
    leveled: true,
    timed: true,
    key: (row) => String(row.activity),
    owns: (run, level) => {
      const origin = Math.min(...run.time.flatMap((span) => (span ? [span[0]] : [])));
      return summed(
        flat(run.node).flatMap((step, position) => (run.time[position] && origin < Infinity ? [named(step, level)] : [])),
        "steps",
      );
    },
  },
  {
    mark: "distribution",
    dataset: "bins",
    leveled: false,
    key: (row) => `${row.b0}\t${row.b1}`,
    owns: () => new Map(),
  },
];

const prefixed = (nested: boolean, name: string) => (nested ? `v1_${name}` : name);

async function aggregated(source: Source, measure: Measure, level: Level, selected: Set<string> | null, highlight: boolean) {
  const view = { mark: measure.mark, ...(measure.leveled ? { level } : {}), ...measure.options, ...(highlight ? { highlight: QUERY } : {}) };
  const spec = (
    selected
      ? {
          data: { values: source.values },
          trace: source.trace,
          vconcat: [
            { mark: "distribution", params: [{ name: "picked", select: "click", value: [...selected] }] },
            { ...view, filter: { param: "picked" } },
          ],
        }
      : { ...view, data: { values: source.values }, trace: source.trace }
  ) as Spec;
  const vega = await instantiate(spec);
  return vega.data(prefixed(Boolean(selected), measure.dataset)) as Row[];
}

function expectations(measure: Measure, runs: Run[], level: Level): Map<string, { ids: string[]; totals: Record<string, number>[] }> {
  const found = new Map<string, { ids: string[]; totals: Record<string, number>[] }>();
  for (const each of runs) {
    for (const [key, values] of measure.owns(each, level)) {
      const at = found.get(key) ?? { ids: [], totals: [{}, {}] };
      at.ids.push(each.id);
      for (const [field, value] of Object.entries(values)) at.totals[each.group][field] = (at.totals[each.group][field] ?? 0) + value;
      found.set(key, at);
    }
  }
  return found;
}

const sorted = (ids: string[]) => [...ids].sort();

function checkCounts(rows: Row[], runs: Run[]) {
  for (const row of rows) {
    const members = runs.filter((each) => row.ids.includes(each.id));
    expect(members).toHaveLength(row.ids.length);
    [0, 1].forEach((group) => expect(row[`n${group}`]).toBe(members.filter((each) => each.group === group).length));
  }
}

const SOURCES = [CODING, GENERATED];
const cases = SOURCES.flatMap((source) =>
  MEASURES.filter((measure) => !measure.timed || source.timed).flatMap((measure) =>
    (measure.leveled ? LEVELS : (["full"] as const)).map((level) => [source.name, measure.mark, level, source, measure] as const),
  ),
);

describe("aggregation agrees with the grammar", () => {
  describe.each([
    ["every run", false],
    ["a selection of runs", true],
  ])("over %s", (_label, selecting) => {
    it.each(cases)("%s: %s at %s", async (_name, _mark, level, source, measure) => {
      const all = runsOf(source);
      const selected = selecting ? new Set(all.filter((_, index) => index % 3 !== 1).map((each) => each.id)) : null;
      const runs = selected ? all.filter((each) => selected.has(each.id)) : all;
      const rows = (await aggregated(source, measure, level, selected, false)).filter((row) => !(measure.dataset === "tree" && row.depth === 0));
      checkCounts(rows, runs);

      if (measure.mark === "variants" || measure.mark === "projection") {
        const key = (each: Run) => print(abstract(each.node, level));
        expect(sorted(rows.flatMap((row) => row.ids))).toEqual(sorted(runs.map((each) => each.id)));
        for (const row of rows) {
          const members = runs.filter((each) => row.ids.includes(each.id));
          const classes = new Set(members.map(key));
          expect(classes.size).toBe(1);
          expect(sorted(runs.filter((each) => classes.has(key(each))).map((each) => each.id))).toEqual(sorted(row.ids));
        }
        return;
      }

      if (measure.mark === "distribution") {
        expect(sorted(rows.flatMap((row) => row.ids))).toEqual(sorted(runs.map((each) => each.id)));
        for (const row of rows) {
          for (const id of row.ids) {
            const length = flat(runs.find((each) => each.id === id)?.node as Node).length;
            expect(length).toBeGreaterThanOrEqual(row.b0 as number);
            expect(length).toBeLessThan(row.b1 as number);
          }
        }
        return;
      }

      const expected = expectations(measure, runs, level);
      const keyed = new Map(rows.map((row) => [measure.key(row, rows), row]));
      expect(sorted([...keyed.keys()])).toEqual(sorted([...expected.keys()]));
      for (const [key, { ids, totals }] of expected) {
        const row = keyed.get(key) as Row;
        expect(sorted(row.ids)).toEqual(sorted(ids));
        totals.forEach((fields, group) => {
          for (const [field, value] of Object.entries(fields)) expect(row[`${field}${group}`] ?? 0).toBe(value);
        });
      }
    });
  });

  it.each(cases.filter(([, mark]) => mark !== "distribution"))("%s: %s at %s counts the runs a query matches", async (_name, _mark, level, source, measure) => {
    const runs = runsOf(source);
    const matches = new Set(runs.filter((each) => find(each.node, QUERY).length).map((each) => each.id));
    const rows = await aggregated(source, measure, level, null, true);
    for (const row of rows) expect(row.matching ?? 0).toBe(row.ids.filter((id) => matches.has(id)).length);
  });
});
