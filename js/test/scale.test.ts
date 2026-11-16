import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compile, type Spec } from "../src";

const records: Record<string, unknown>[] = readFileSync(new URL("../../docs/assets/coding.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const trace = { run: "session", actor: "type", name: "tool", start: "start", end: "end", failed: "error", group: "version" };
const RUNS = new Set(records.map((record) => record.session)).size;
const COPIES = 40;

const copies = (times: number) =>
  Array.from({ length: times }, (_, copy) => records.map((record) => ({ ...record, session: `${record.session}-${copy}` }))).flat();
const size = (mark: string, times: number) => JSON.stringify(compile({ mark, data: { values: copies(times) }, trace } as Spec)).length;
const added = (mark: string) => (size(mark, COPIES + 1) - size(mark, 1)) / (COPIES * RUNS);

describe("compiled size follows distinct behaviour, not the number of runs", () => {
  it.each(["icicle", "variants", "transitions", "graph", "sankey", "activities", "projection"])("adds one small row per repeated run to %s", (mark) => {
    expect(added(mark)).toBeLessThan(40);
  });

  it("adds a run's step times, once, to durations", () => {
    const steps = records.length / RUNS;
    expect(added("durations") / steps).toBeLessThan(60);
  });
});
