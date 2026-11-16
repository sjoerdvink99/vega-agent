import { describe, expect, it } from "vitest";
import fixtures from "../../grammar/fixtures.json";
import { ParseError, TraceError, abstract, conforms, find, fold, parse, print, steps, trace, type Level } from "../src";

describe("grammar fixtures", () => {
  it.each(fixtures.roundtrip)("prints %s canonically", (text) => {
    expect(print(parse(text))).toBe(text);
  });

  it.each(fixtures.canonical)("canonicalizes %s", (text, expected) => {
    expect(print(parse(text))).toBe(expected);
  });

  it.each(fixtures.errors)("rejects %s", (text) => {
    expect(() => parse(text)).toThrow(ParseError);
  });

  it.each(fixtures.traces as [string, number | null][])("grounds %s", (text, count) => {
    if (count === null) expect(() => trace(text)).toThrow(TraceError);
    else expect(steps(trace(text))).toHaveLength(count);
  });

  it.each(fixtures.conforms)("%s ⊨ %s is %s", (run, spec, expected) => {
    expect(conforms(run as string, spec as string)).toBe(expected);
  });

  it.each(fixtures.find)("finds %s in %s", (run, query, expected) => {
    expect(find(run as string, query as string).map((hit) => hit.text)).toEqual(expected);
  });

  it.each(fixtures.positions)("finds %s at the positions of %s", (run, query, expected) => {
    expect(find(run as string, query as string).map((hit) => hit.steps)).toEqual(expected);
  });

  it.each(fixtures.fold)("folds %s", (run, expected) => {
    expect(print(fold(trace(run)))).toBe(expected);
  });

  it.each(fixtures.abstract)("abstracts %s at %s", (run, level, expected) => {
    expect(print(abstract(trace(run), level as Level))).toBe(expected);
  });

  it.each(fixtures.designs)("abstracts the design %s at %s", (spec, level, expected) => {
    expect(print(abstract(parse(spec), level as Level))).toBe(expected);
  });

  it("prints each node of a list on its own, whatever its position", () => {
    const nodes = Array.from({ length: 8 }, () => trace("tool.read"));
    expect(nodes.map(print)).toEqual(Array(8).fill("tool.read"));
  });
});
