import { describe, expect, it } from "vitest";
import cases from "../../grammar/tables.json";
import { tables, type TracedRun } from "../src";

describe("tables", () => {
  it.each(cases)("$name", ({ runs, tables: expected }) => {
    expect(tables(runs as TracedRun[])).toEqual(expected);
  });
});
