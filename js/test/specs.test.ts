import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import cases from "../../grammar/specs.json";
import { SpecError, render, validate } from "../src";

const parser = new new JSDOM().window.DOMParser();

describe("view spec contract", () => {
  it.each(cases.valid.map((spec, index) => [index, spec] as const))("accepts valid spec %i and renders it as finite, well-formed SVG", async (_, spec) => {
    expect(() => validate(spec)).not.toThrow();
    const svg = await render(spec as never);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(parser.parseFromString(svg, "image/svg+xml").getElementsByTagName("parsererror")).toHaveLength(0);
  });

  it.each(cases.invalid.map((each) => [each.path, each] as const))("rejects at %s", (path, each) => {
    expect(() => validate(each.spec)).toThrow(SpecError);
    try {
      validate(each.spec);
    } catch (error) {
      expect((error as SpecError).path).toBe(path);
    }
  });

  it("treats undefined properties as absent", () => {
    expect(() => validate({ mark: "transitions", data: { values: ["model"] }, highlight: undefined })).not.toThrow();
  });

  it("returns a copy the caller cannot mutate", () => {
    const spec = { mark: "variants" as const, data: { values: ["model"] } };
    const checked = validate(spec);
    spec.data.values.push("tool");
    expect(checked).toEqual({ mark: "variants", data: { values: ["model"] } });
  });
});
