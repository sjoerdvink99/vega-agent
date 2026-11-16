import { describe, expect, it } from "vitest";
import mappings from "../../grammar/mappings.json";
import cases from "../../grammar/standards.json";
import { fold, print, read, SpecError, trace, type Format, type Mapping, type TracedRun } from "../src";

const folded = (runs: TracedRun[]) => runs.map((run) => print(fold(trace(run.process))));

describe("standards fixtures", () => {
  it.each(cases.map((each) => [each.standard, each] as const))("reads %s", (_, each) => {
    const runs = read(each.input, each.reader as Format);
    expect(folded(runs)).toEqual([each.expected]);
    if ("agent" in each) expect(runs[0].agent).toBe(each.agent);
  });

  it.each(cases.map((each) => [each.standard, each] as const))("detects %s", (_, each) => {
    expect(folded(read(each.input))).toEqual([each.expected]);
  });

  it("aligns timing with the canonical step order", () => {
    const [run] = read(cases[0].input);
    expect(run.time).toEqual([
      [0, 1],
      [1.1, 1.5],
      [1, 2],
      [2, 3],
    ]);
  });
});

describe("mapping fixtures", () => {
  it.each(mappings.valid.map((each) => [each.name, each] as const))("reads %s", (_, each) => {
    const runs = read(each.input, each.trace as Mapping);
    expect(runs.map((run) => ({ id: run.id, process: print(fold(trace(run.process))), group: run.group, agent: run.agent }))).toEqual(
      each.expected.map((run) => ({
        id: run.id,
        process: run.process,
        group: "group" in run ? run.group : undefined,
        agent: "agent" in run ? run.agent : undefined,
      })),
    );
    each.expected.forEach((run, index) => {
      if ("time" in run) expect(runs[index].time).toEqual(run.time);
    });
  });

  it.each(mappings.invalid.map((each) => [each.reason, each] as const))("rejects %s", (_, each) => {
    expect(() => read([], each.trace as Mapping)).toThrow(each.trace !== null && typeof each.trace === "object" ? SpecError : TypeError);
  });
});
