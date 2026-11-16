import { fileURLToPath } from "node:url";
import { changeset, parse, type GroupMark } from "vega";
import { describe, expect, it } from "vitest";
import { compile, load, read, render, SpecError, type Spec } from "../src";
import { units } from "../src/compile";
import { items, run } from "./headless";

const LOOP = "(model -> tool[])* -> model";
const RUNS = ["model -> tool.read -> model", "model -> tool.read -> model -> tool.write! -> model", "model -> tool.read || tool.list -> model"];
const VALUES = { values: RUNS };
const GROUPS = { values: [...RUNS.map((process) => ({ process, version: "old" })), ...RUNS.slice(1).map((process) => ({ process, version: "new" }))] };
const VERSIONS = { group: "version" };

const specs: Record<string, Spec> = {
  diagram: { mark: "diagram", process: LOOP },
  trace: { mark: "diagram", process: "model -> tool -> model -> tool -> model" },
  icicle: { mark: "icicle", data: VALUES, level: "names", highlight: "tool!" },
  difference: { mark: "icicle", data: GROUPS, trace: VERSIONS },
  variants: { mark: "variants", data: VALUES, level: "names", highlight: "tool!" },
  variantsDifference: { mark: "variants", data: GROUPS, trace: VERSIONS },
  transitions: { mark: "transitions", data: VALUES },
  transitionsDifference: { mark: "transitions", data: GROUPS, trace: VERSIONS, level: "actors" },
  graph: { mark: "graph", data: VALUES },
  sankey: { mark: "sankey", data: GROUPS, trace: VERSIONS, level: "names" },
  activities: { mark: "activities", data: GROUPS, trace: VERSIONS },
  sequences: { mark: "sequences", data: VALUES, highlight: "tool" },
  stacked: {
    vconcat: [
      { mark: "diagram", process: RUNS[1] },
      {
        mark: "timeline",
        data: {
          values: [
            {
              process: RUNS[1],
              time: [
                [0, 1],
                [1, 1.2],
                [1.2, 2],
                [2, 2.5],
                [2.5, 3],
              ],
            },
          ],
        },
      },
    ],
  },
};

describe("compile", () => {
  it.each(Object.entries(specs))("compiles %s to a self-contained Vega spec", (_, spec) => {
    const compiled = compile(spec);
    expect(compiled.$schema).toMatch(/vega\/v6/);
    expect(JSON.parse(JSON.stringify(compiled))).toEqual(compiled);
    expect(() => parse(compiled)).not.toThrow();
  });

  it("is a pure function of the spec", () => {
    expect(compile(specs.icicle)).toEqual(compile(specs.icicle));
  });

  it("validates before compiling", () => {
    expect(() => compile({ mark: "diagram", process: "model ->" })).toThrow(/spec.process/);
  });
});

describe("render", () => {
  it.each(Object.entries(specs))("renders %s as a finite SVG", async (_, spec) => {
    const svg = await render(spec);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it("is deterministic", async () => {
    expect(await render(specs.icicle)).toBe(await render(specs.icicle));
  });

  it("folds ground expressions in diagrams", async () => {
    expect(await render(specs.trace)).toContain("×2");
  });

  it("draws the title, width and config of each stacked view", async () => {
    const svg = await render({
      vconcat: [
        { mark: "diagram", process: "model", title: "first", config: { actors: { model: "#000001" } } },
        { mark: "variants", data: VALUES, title: "second", width: 300 },
      ],
    });
    expect(svg).toContain(">first<");
    expect(svg).toContain(">second<");
    expect(svg).toContain("#000001");
  });

  it("leaves stacked views out of the legend when asked", () => {
    const compiled = compile({
      vconcat: [
        { mark: "diagram", process: "model" },
        { mark: "diagram", process: "tool", legend: false },
      ],
    });
    expect(compiled.legends).toEqual([expect.objectContaining({ values: ["model"] })]);
    expect(compile({ mark: "diagram", process: "model", legend: false }).legends).toEqual([]);
  });

  it("fills the container, or 800 pixels without one", async () => {
    const view = await run({ ...specs.icicle, width: "container" } as Spec);
    expect(view.signal("contentWidth")).toBe(800);
  });
});

describe("dataflow", () => {
  it("counts directly-follows pairs per run", async () => {
    const view = await run({ mark: "transitions", data: { values: ["model -> tool -> model -> tool -> model"] }, level: "actors" });
    const pair = view.data("follows").find((each) => each.from === "model" && each.to === "tool");
    expect(pair).toMatchObject({ times0: 2, n0: 1, times_rate0: 2 });
  });

  it("keeps the tooltip fields the spec asks for, in its order and with its titles", async () => {
    const view = await run({ mark: "variants", data: VALUES, level: "names", tooltip: [{ field: "steps", title: "length" }, "runs"] });
    expect(Object.keys(items(view, "variant_mark")[0].tooltip ?? {})).toEqual(["title", "length", "runs"]);
    expect(items(await run({ mark: "variants", data: VALUES, tooltip: false }), "variant_mark")[0].tooltip).toBeUndefined();
  });

  it("gives each group its own value when two groups are compared", async () => {
    const view = await run(specs.difference);
    const model = view.data("tree").find((node) => node.token === "model");
    expect(model).toMatchObject({ n0: 3, n1: 2 });
    expect(model?.difference).toBeCloseTo(0);
    expect(items(view, "cell_mark").find((item) => item.datum.token === "model")?.tooltip?.runs).toBe("3 → 2");
  });

  it("numbers runs without ids across groups", async () => {
    const values = [
      { process: "model", arm: "a" },
      { process: "tool", arm: "a" },
      { process: "model", arm: "b" },
    ];
    const view = await run({ mark: "sequences", data: { values }, trace: { group: "arm" } });
    expect(view.data("rows").map((row) => row.run)).toEqual(["0", "1", "2"]);
  });

  it("dims what a selection leaves out and counts what it matches", async () => {
    const params = [{ name: "picked", select: "click" as const, value: ["2"] }];
    const view = await run({ mark: "variants", data: VALUES, level: "names", params, highlight: { param: "picked" } });
    const rows = items(view, "variant_mark");
    expect(rows.map((item) => item.datum.matching)).toEqual(rows.map((item) => ((item.datum.ids as string[]).includes("2") ? 1 : 0)));
    expect(rows.map((item) => item.tooltip?.matching)).toContain(1);
  });

  it("filters a view to the selected runs, reactively", async () => {
    const view = await run({
      vconcat: [
        { mark: "variants", data: VALUES, params: [{ name: "picked", select: "click", value: ["0", "2"] }] },
        { mark: "sequences", data: VALUES, filter: { param: "picked" } },
      ],
    });
    expect(view.data("v1_rows").map((row) => row.run)).toEqual(["0", "2"]);
    await view
      .change(
        "picked_store",
        changeset()
          .remove(() => true)
          .insert(["1"]),
      )
      .runAsync();
    expect(view.data("v1_rows").map((row) => row.run)).toEqual(["1"]);
    await view
      .change(
        "picked_store",
        changeset().remove(() => true),
      )
      .runAsync();
    expect(view.data("v1_rows")).toHaveLength(3);
  });

  it("recounts corpus views over the selected runs", async () => {
    const view = await run({
      vconcat: [
        { mark: "variants", data: VALUES, params: [{ name: "picked", select: "click", value: ["1"] }] },
        { mark: "activities", data: VALUES, level: "names", filter: { param: "picked" } },
      ],
    });
    expect(view.signal("v1_count")).toMatchObject({ t0: 1 });
    expect(view.data("v1_activities").find((row) => row.activity === "tool.write")).toMatchObject({ n0: 1, s0: 1 });
  });

  it("highlights the steps a hover selection holds", async () => {
    const view = await run({
      mark: "diagram",
      process: "model -> tool -> model",
      params: [{ name: "step", select: "hover", value: ["1"] }],
      highlight: { param: "step" },
    });
    expect(items(view, "step_mark").map((item) => item.opacity)).toEqual([0.3, 1, 0.3]);
  });

  it("switches level without recompiling", async () => {
    const view = await run({ mark: "variants", data: { values: ["model -> tool.read -> model", "model -> tool.write -> model"] }, level: "names" });
    expect(view.data("ranking")).toHaveLength(2);
    await view.signal("level", "actors").runAsync();
    expect(view.data("ranking")).toHaveLength(1);
  });

  it("zooms the icicle by its focus", async () => {
    const view = await run({ mark: "icicle", data: VALUES, level: "names", focus: ["model", "tool.read"] });
    expect(view.signal("zoom")).toMatchObject({ depth: 2, token: "tool.read" });
    expect(await render({ mark: "icicle", data: VALUES, level: "names", focus: ["model", "tool.read"] })).toContain("all runs › model › tool.read");
  });

  it("stands each row of a large corpus for a group of similar runs", async () => {
    const data = Array.from({ length: 30 }, (_, index) => ["model -> tool -> model", "model", "model -> tool! -> model"][index % 3]);
    const view = await run({ mark: "sequences", data: { values: data }, limit: 6 });
    const rows = view.data("rows");
    expect(rows).toHaveLength(6);
    expect(rows.flatMap((row) => row.ids).sort()).toEqual(data.map((_, index) => String(index)).sort());
    expect(await render({ mark: "sequences", data: { values: data }, limit: 6 })).toContain("each row stands for about 5 similar runs");
  });

  it("folds what does not fit into a remainder that still counts its runs", async () => {
    const data = ["tool.a", "tool.b", "tool.c", "tool.d", "tool.e", "tool.a"];
    const sankey = await run({ mark: "sankey", data: { values: data }, level: "names", height: 66 });
    expect(sankey.data("nodes").map((node) => node.token)).toContain("other");
    const variants = await run({ mark: "variants", data: { values: data }, level: "names", limit: 2 });
    expect(variants.data("rest")[0].ids).toHaveLength(3);
  });

  it("formats the duration of a computed span", async () => {
    const data = [
      {
        id: "a",
        process: "model -> tool",
        time: [
          [0, 0.5],
          [0.5, 0.75],
        ] as [number, number][],
      },
    ];
    const view = await run({ mark: "sequences", data: { values: data }, x: "time" });
    expect(items(view, "cell_mark").map((item) => item.tooltip?.duration)).toEqual(["500 ms", "250 ms"]);
  });

  it("labels a long variant step by step, without stray parentheses", async () => {
    const process = "model -> tool.a -> model -> tool.b -> model -> tool.c -> model -> tool.d -> model";
    const view = await run({ mark: "variants", data: { values: [process] }, level: "full" });
    expect(view.data("ranking").map((row: { label: string }) => row.label)).toEqual([process]);
  });

  it("keeps runs that share an id apart", async () => {
    const data = {
      values: [
        { id: "x", process: "model", side: "a" },
        { id: "x", process: "tool", side: "b" },
      ],
    };
    const sankey = await run({ mark: "sankey", data, trace: { group: "side" }, level: "actors" });
    expect(
      sankey
        .data("nodes")
        .map((node) => node.token)
        .sort(),
    ).toEqual(["end", "model", "tool"]);
    const icicle = await run({ mark: "icicle", data, trace: { group: "side" }, level: "actors" });
    expect(icicle.data("tree").map((node) => node.token)).toEqual(expect.arrayContaining(["model", "tool"]));
  });

  it("gives each node of the graph the runs that reach it", async () => {
    const view = await run({ mark: "graph", data: { values: ["model -> tool -> model", "model"] }, level: "actors" });
    const nodes = Object.fromEntries(items(view, "node_mark").map((item) => [item.datum.name, item.tooltip]));
    expect(nodes.start).toMatchObject({ runs: "2", count: "2" });
    expect(nodes.tool).toMatchObject({ runs: "1", count: "1" });
    expect(nodes.model).toMatchObject({ runs: "2", count: "3" });
  });

  it("keeps an empty corpus finite", async () => {
    for (const mark of ["icicle", "variants", "transitions", "graph", "sankey", "activities", "sequences"] as const) {
      expect(await render({ mark, data: { values: [] } })).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe("one run of many", () => {
  const values = [
    {
      id: "a",
      process: "model -> tool -> model",
      time: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    },
    {
      id: "b",
      process: "model -> agent.coder{ model -> tool.edit! } -> model",
      time: [
        [0, 1],
        [1, 4],
        [1, 2],
        [2, 4],
        [4, 6],
      ],
    },
  ];
  const linked = (mark: "timeline" | "handoffs", value?: string[], highlight?: string): Spec => ({
    data: { values },
    vconcat: [
      { mark: "sequences", params: [{ name: "picked", select: "click", ...(value ? { value } : {}) }] },
      { mark, filter: { param: "picked" }, ...(highlight ? { highlight } : {}) },
    ],
  });
  const pick = async (view: Awaited<ReturnType<typeof run>>, ids: string[]) =>
    view
      .change(
        "picked_store",
        changeset()
          .remove(() => true)
          .insert(ids),
      )
      .runAsync();

  it("draws the first run until a run is selected, then the first selected run", async () => {
    const view = await run(linked("timeline"));
    expect(view.data("v1_bars").map((row) => row.label)).toEqual(["model", "tool", "model"]);
    expect(view.signal("v1_span")).toBe(3);
    await pick(view, ["b"]);
    expect(view.data("v1_bars").map((row) => row.label)).toEqual(["model", "agent.coder", "model", "tool.edit!", "model"]);
    expect(view.signal("v1_laneCount")).toBe(5);
    expect(view.signal("v1_span")).toBe(6);
    await pick(view, []);
    expect(view.signal("v1_laneCount")).toBe(3);
  });

  it("starts from the selection in the spec, and follows it in handoffs", async () => {
    const view = await run(linked("handoffs", ["b"]));
    expect(view.data("v1_lanes").map((lane) => lane.lane)).toEqual(["run", "agent.coder"]);
    await pick(view, ["a"]);
    expect(view.data("v1_lanes").map((lane) => lane.lane)).toEqual(["run"]);
    expect(view.signal("v1_messageCount")).toBe(3);
  });

  it("highlights query matches of the shown run only", async () => {
    const view = await run(linked("timeline", ["b"], "tool!"));
    expect(view.data("v1_bars").map((row) => row.matching)).toEqual([0, 0, 0, 1, 0]);
  });

  it("needs a selection of runs to filter by", () => {
    expect(() =>
      compile({
        data: { values },
        vconcat: [
          { mark: "timeline", params: [{ name: "step", select: "hover" }] },
          { mark: "timeline", filter: { param: "step" } },
        ],
      }),
    ).toThrow(/needs a selection of runs/);
  });
});

describe("data", () => {
  const examples = fileURLToPath(new URL("../../examples/data/", import.meta.url));
  const url = { mark: "variants", data: { url: "copilot-model-a.jsonl" }, level: "names" } as const;

  it("asks for the records before compiling a url", () => {
    expect(() => compile(url)).toThrow(SpecError);
    expect(() => compile({ vconcat: [{ mark: "variants" }], data: { url: "x.json" } })).toThrow(/spec\.data\.url/);
  });

  it("loads urls against a base and keeps the rest of the spec", async () => {
    const loaded = await load({ vconcat: [url, { ...url, mark: "activities" }], title: "two" }, examples);
    expect(loaded).toMatchObject({ title: "two", vconcat: [{ mark: "variants" }, { mark: "activities" }] });
    const values = units(loaded).map((view) => ("data" in view && view.data && "values" in view.data ? view.data.values.length : 0));
    expect(values[0]).toBeGreaterThan(0);
    expect(values[1]).toBe(values[0]);
    expect(await render(url, examples)).toContain("<svg");
  });

  it("resolves a url against a base that need not exist", async () => {
    expect(await render(url, `${examples}pages/gallery/../../`)).toContain("<svg");
    expect(await render({ ...url, data: { url: "./data/copilot-model-a.jsonl" } }, `${examples}../`)).toContain("<svg");
  });

  it("reads records once for every view that inherits them", async () => {
    const view = await run({
      data: {
        values: [
          { session: "a", kind: "llm" },
          { session: "a", kind: "tool" },
          { session: "b", kind: "llm" },
        ],
      },
      trace: { run: "session", actor: "kind" },
      hconcat: [{ mark: "variants" }, { mark: "sequences", trace: { run: "kind", actor: "kind" } }],
    });
    expect(view.data("v1_rows").map((row: { run: string }) => row.run)).toEqual(["llm", "tool"]);
    expect(view.data("s0_runs").map((row: { id: string }) => row.id)).toEqual(["a", "b"]);
  });

  it("reads the same runs as read", () => {
    const records = [
      { session: "a", kind: "llm", tool: null },
      { session: "a", kind: "tool_call", tool: "grep" },
    ];
    const trace = { run: "session", actor: { field: "kind", map: { tool_call: "tool" } }, name: "tool" };
    expect(read(records, trace).map((each) => each.process)).toEqual(["model -> tool.grep"]);
    const view = compile({ mark: "sequences", data: { values: records }, trace });
    expect(JSON.stringify(view)).toContain("tool.grep");
  });

  it("checks a mapping given to read", () => {
    expect(() => read([], { run: "session" })).toThrow(SpecError);
    expect(() => read([], { actor: { field: "kind", map: { llm: "robot" } } })).toThrow(/format\.actor\.map\.llm/);
  });
});

describe("filters and facets", () => {
  const events = [
    { session: "a", kind: "llm", model: "m1", cost: 1 },
    { session: "a", kind: "tool", tool: "read", cost: 2 },
    { session: "a", kind: "llm" },
    { session: "b", kind: "llm", model: "m2", cost: 5 },
    { session: "b", kind: "tool", tool: "ls" },
    { session: "c", kind: "llm", model: "m3" },
    { session: "c", kind: "tool", tool: "edit", failed: true },
    { session: "d", kind: "llm", model: "m1" },
  ];
  const trace = { run: "session", actor: "kind", name: "tool", failed: "failed" };
  const variants = (view: Awaited<ReturnType<typeof run>>, name = "ranking") => view.data(name).map((each) => each.label);

  it("filters records before they become steps", async () => {
    const view = await run({
      mark: "variants",
      level: "names",
      data: { values: events },
      trace,
      transform: [{ filter: { not: { field: "tool", oneOf: ["ls"] } } }],
    });
    expect(variants(view)).toContain("model");
    expect(variants(view).join()).not.toContain("tool.ls");
  });

  it("tests equal, oneOf, range, valid, and, or and not", async () => {
    const count = async (filter: object) =>
      (await run({ mark: "sequences", data: { values: events }, trace, transform: [{ filter }] } as Spec)).data("rows").length;
    expect(await count({ field: "session", equal: "a" })).toBe(1);
    expect(await count({ field: "session", oneOf: ["a", "c"] })).toBe(2);
    expect(
      await count({
        or: [
          { field: "cost", range: [4, null] },
          { field: "session", equal: "c" },
        ],
      }),
    ).toBe(2);
    expect(
      await count({
        and: [
          { field: "kind", equal: "llm" },
          { field: "model", valid: true },
        ],
      }),
    ).toBe(4);
  });

  it("applies the composition's filters, then a view's own", async () => {
    const view = await run({
      data: { values: events },
      trace,
      transform: [{ filter: { field: "session", oneOf: ["a", "b", "c"] } }],
      hconcat: [{ mark: "sequences" }, { mark: "sequences", transform: [{ filter: { not: { field: "session", equal: "a" } } }] }],
    });
    expect(view.data("v0_rows")).toHaveLength(3);
    expect(view.data("v1_rows")).toHaveLength(2);
  });

  it("draws one panel per value, taking each run's value from its first record", async () => {
    const compiled = compile({ data: { values: events }, trace, facet: { field: "model" }, spec: { mark: "variants", level: "names" } });
    const titles = (compiled.marks ?? []).map((mark) => ((mark as GroupMark).title as { text: string }).text);
    expect(titles).toEqual(["m1", "m2", "m3"]);
    expect(compiled.layout).toMatchObject({ columns: 3 });
    expect(compiled.signals?.filter((signal) => signal.name === "level")).toHaveLength(1);
    const view = await run({ data: { values: events }, trace, facet: { field: "model" }, spec: { mark: "variants", level: "names" } });
    expect(view.signal("v0_count")).toMatchObject({ t0: 2 });
    expect(variants(view, "v2_ranking")).toEqual(["model -> tool.edit!"]);
    await view.signal("level", "actors").runAsync();
    expect(variants(view, "v2_ranking")).toEqual(["model -> tool!"]);
  });

  it("wraps panels into columns and shares one selection across them", async () => {
    const view = await run({
      data: { values: events },
      trace,
      facet: { field: "model", columns: 2 },
      spec: { mark: "sequences", params: [{ name: "picked", select: "click", value: ["d"] }], highlight: { param: "picked" } },
    });
    expect(view.data("v0_rows").map((row) => row.matching)).toEqual([0, 1]);
    expect(compile({ data: { values: events }, trace, facet: { field: "model", columns: 2 }, spec: { mark: "sequences" } }).layout).toMatchObject({
      columns: 2,
    });
  });

  it("compares two groups inside each panel, and keeps an empty facet drawable", async () => {
    const values = [
      { process: "model -> tool", model: "m1", arm: "x" },
      { process: "model", model: "m1", arm: "y" },
      { process: "tool", model: "m2", arm: "x" },
    ];
    const view = await run({ data: { values }, trace: { group: "arm" }, facet: { field: "model" }, spec: { mark: "activities" } });
    expect(view.signal("v0_count")).toMatchObject({ t0: 1, t1: 1 });
    expect(await render({ data: { values: [] }, facet: { field: "model" }, spec: { mark: "icicle" } })).toContain("<svg");
  });

  it("orders groups as asked, and keeps one order and colour across panels", async () => {
    const values = [
      { process: "model", model: "m1", arm: "x" },
      { process: "model -> tool", model: "m2", arm: "y" },
      { process: "tool", model: "m2", arm: "x" },
    ];
    const ordered = await run({ mark: "variants", data: { values }, trace: { group: { field: "arm", order: ["y", "x"] } } });
    expect(ordered.signal("count")).toMatchObject({ t0: 1, t1: 2 });
    const view = await run({ data: { values }, trace: { group: "arm" }, facet: { field: "model" }, spec: { mark: "variants" } });
    expect(view.signal("v0_count")).toMatchObject({ t0: 1, t1: 0 });
    expect(view.signal("v1_count")).toMatchObject({ t0: 1, t1: 1 });
    const scales = compile({ data: { values }, trace: { group: "arm" }, facet: { field: "model" }, spec: { mark: "variants" } }).marks?.map((mark) =>
      (mark as GroupMark).scales?.find((scale) => scale.name.endsWith("group")),
    );
    expect(scales?.map((scale) => scale?.domain)).toEqual([
      ["x", "y"],
      ["x", "y"],
    ]);
  });

  it("asks for a facet to split many values and not to own the panels' data", () => {
    const many = { values: Array.from({ length: 70 }, (_, index) => ({ process: "model", model: `m${index}` })) };
    expect(() => compile({ data: many, facet: { field: "model" }, spec: { mark: "variants" } })).toThrow(/at most 64 panels/);
    expect(() => compile({ data: many, trace: { group: "model" }, mark: "variants" })).toThrow(/facet by this field/);
    expect(() => compile({ data: many, facet: { field: "model" }, spec: { mark: "variants", data: many } } as never)).toThrow(/spec\.spec\.data/);
  });
});
