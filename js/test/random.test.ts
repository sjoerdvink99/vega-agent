import { describe, expect, it } from "vitest";
import { LEVELS, conforms, parse, print, render, steps, trace } from "../src";
import { expression, random } from "./generate";

const SEEDS = Array.from({ length: 60 }, (_, index) => index + 1);
const finite = (svg: string) => !/NaN|undefined|Infinity/.test(svg);

describe("randomized", () => {
  it.each(SEEDS)("prints and parses expression %i to a fixed point", (seed) => {
    const text = print(expression(random(seed), 4, false));
    expect(print(parse(text))).toBe(text);
  });

  it.each(SEEDS)("accepts the trace of ground expression %i", (seed) => {
    const text = print(expression(random(seed), 4, true));
    expect(conforms(trace(text), text)).toBe(true);
  });

  it.each(SEEDS)("renders a diagram of expression %i", async (seed) => {
    expect(finite(await render({ mark: "diagram", process: print(expression(random(seed), 4, false)) }))).toBe(true);
  });

  it.each(SEEDS.slice(0, 20))("renders every corpus mark for corpus %i", async (seed) => {
    const next = random(seed);
    const runs = Array.from({ length: 25 }, () => print(expression(next, 3, true)));
    const plain = { data: { values: runs } };
    const grouped = { data: { values: runs.map((process, index) => ({ process, side: index < 12 ? "a" : "b" })) }, trace: { group: "side" } };
    for (const level of LEVELS) {
      for (const source of [plain, grouped]) {
        expect(finite(await render({ mark: "icicle", ...source, level, highlight: "tool" }))).toBe(true);
        expect(finite(await render({ mark: "variants", ...source, level, highlight: "model -> tool", limit: 5 }))).toBe(true);
        expect(finite(await render({ mark: "transitions", ...source, level, limit: 6 }))).toBe(true);
        expect(finite(await render({ mark: "graph", ...source, level, limit: 6 }))).toBe(true);
        expect(finite(await render({ mark: "sankey", ...source, level, limit: 5, height: 160 }))).toBe(true);
        expect(finite(await render({ mark: "activities", ...source, level, limit: 6 }))).toBe(true);
        expect(finite(await render({ mark: "sequences", ...source, highlight: "tool", limit: 8 }))).toBe(true);
        expect(finite(await render({ mark: "projection", ...source, level, highlight: "tool" }))).toBe(true);
      }
      expect(finite(await render({ mark: "distribution", ...grouped, highlight: "tool" }))).toBe(true);
      expect(finite(await render({ mark: "distribution", ...plain, measure: "failures" }))).toBe(true);
    }
  });

  it.each(SEEDS.slice(0, 20))("renders a timeline for trace %i", async (seed) => {
    const next = random(seed);
    const process = print(expression(next, 3, true));
    let clock = 0;
    const time = steps(trace(process)).map(() => {
      const start = clock;
      clock += next();
      return next() < 0.1 ? null : ([start, clock] as [number, number]);
    });
    const data = { values: [{ process, time }] };
    expect(finite(await render({ mark: "timeline", data }))).toBe(true);
    expect(finite(await render({ mark: "timeline", data, lanes: "agent" }))).toBe(true);
    expect(finite(await render({ mark: "handoffs", data }))).toBe(true);
    expect(finite(await render({ mark: "durations", data: { values: [...data.values, ...data.values] }, level: "actors" }))).toBe(true);
    expect(finite(await render({ mark: "distribution", data, measure: "duration" }))).toBe(true);
  });
});
