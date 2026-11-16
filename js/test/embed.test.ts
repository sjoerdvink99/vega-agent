import { describe, expect, it, vi } from "vitest";
import { SpecError, embed, type Spec, type View } from "../src";
import widget from "../src/widget";

const RUNS = ["model -> tool.read -> model", "model -> tool.read -> model", "model -> tool.write! -> model"];
const DATA = { values: RUNS };
const PICKED: Spec = { mark: "variants", data: DATA, level: "names", params: [{ name: "picked", select: "click" }], highlight: { param: "picked" } };

function mount(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

const inside = (element: HTMLElement): ShadowRoot => (element.querySelector(".vega-agent") as HTMLElement).shadowRoot as ShadowRoot;

const items = (element: HTMLElement, mark: string): Element[] => [...inside(element).querySelectorAll(`.${mark} > path`)];

async function fire(view: View, target: Element, type: string, init: MouseEventInit = {}): Promise<void> {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
  await view.vega.runAsync();
}

describe("embed", () => {
  it("renders a Vega view into the element", async () => {
    const element = mount();
    const view = await embed(element, { mark: "diagram", process: "model -> tool" });
    expect(inside(element).querySelector("svg")).not.toBeNull();
    expect(view.vega.getState({ data: () => false, signals: () => true }).signals).toHaveProperty("contentWidth");
  });

  it("throws before touching the element when the spec is invalid", async () => {
    const element = mount();
    element.textContent = "kept";
    await expect(embed(element, { mark: "diagram" } as never)).rejects.toThrow(SpecError);
    expect(element.textContent).toBe("kept");
  });

  it("selects the runs of a clicked item and records them in its spec", async () => {
    const element = mount();
    const view = await embed(element, PICKED);
    const listener = vi.fn();
    view.on("select", listener);
    await fire(view, items(element, "variant_mark")[0], "click");
    expect(listener).toHaveBeenLastCalledWith({ picked: ["0", "1"] });
    expect(view.selection).toEqual({ picked: ["0", "1"] });
    expect(view.spec).toMatchObject({ params: [{ name: "picked", value: ["0", "1"] }] });
  });

  it("adds to a selection with shift and clears it on the background", async () => {
    const element = mount();
    const view = await embed(element, PICKED);
    const [first, second] = items(element, "variant_mark");
    await fire(view, first, "click");
    await fire(view, second, "click", { shiftKey: true });
    expect(view.selection.picked.sort()).toEqual(["0", "1", "2"]);
    await fire(view, second, "click");
    expect(view.selection).toEqual({ picked: ["2"] });
    await fire(view, inside(element).querySelector("svg") as Element, "click");
    expect(view.selection).toEqual({ picked: [] });
    expect(view.spec).not.toHaveProperty("params.0.value");
  });

  it("leaves clicks alone in views without a click selection", async () => {
    const element = mount();
    const view = await embed(element, { mark: "variants", data: DATA });
    const listener = vi.fn();
    view.on("select", listener);
    await fire(view, items(element, "variant_mark")[0], "click");
    expect(listener).not.toHaveBeenCalled();
    expect(view.spec).toMatchObject({ mark: "variants", data: DATA });
  });

  it("filters another view to the selection", async () => {
    const element = mount();
    const view = await embed(element, { vconcat: [PICKED as never, { mark: "sequences", data: DATA, filter: { param: "picked" } }] });
    expect(items(element, "v1_run_mark")).toHaveLength(3);
    const write = view.vega.data("v0_shown").findIndex((row) => String(row.label).includes("write"));
    await fire(view, items(element, "v0_variant_mark")[write], "click");
    expect(items(element, "v1_run_mark")).toHaveLength(1);
  });

  it("zooms the icicle on click and switches level from its control", async () => {
    const element = mount();
    const view = await embed(element, { mark: "icicle", data: DATA, level: "names" });
    const model = view.vega.data("tree").findIndex((node) => node.token === "model");
    await fire(view, items(element, "cell_mark")[model], "click");
    expect(view.spec).toMatchObject({ focus: ["model"] });
    const actors = inside(element).querySelector<HTMLInputElement>('input[type="radio"][value="actors"]');
    actors?.click();
    await view.vega.runAsync();
    expect(view.spec).toMatchObject({ level: "actors" });
    expect(view.spec).not.toHaveProperty("focus");
  });

  it("keeps the current view when an update is invalid", async () => {
    const element = mount();
    const view = await embed(element, { mark: "diagram", process: "model" });
    const before = inside(element).innerHTML;
    await expect(view.update({ mark: "diagram", process: "model ->" })).rejects.toThrow(SpecError);
    expect(inside(element).innerHTML).toBe(before);
    expect(view.spec).toEqual({ mark: "diagram", process: "model" });
  });

  it("draws a new spec in place", async () => {
    const element = mount();
    const view = await embed(element, { mark: "diagram", process: "model" });
    await view.update({ mark: "diagram", process: "model -> tool" });
    expect(items(element, "step_mark")).toHaveLength(2);
    expect(inside(element).querySelectorAll("svg")).toHaveLength(1);
  });

  it("shares a hover selection between the views that declare it", async () => {
    const element = mount();
    const step = { params: [{ name: "step", select: "hover" as const }], highlight: { param: "step" } };
    const view = await embed(element, {
      vconcat: [
        { mark: "diagram", process: "model -> tool", ...step },
        {
          mark: "timeline",
          data: {
            values: [
              {
                process: "model -> tool",
                time: [
                  [0, 1],
                  [1, 2],
                ],
              },
            ],
          },
          ...step,
        },
      ],
    });
    const listener = vi.fn();
    view.on("select", listener);
    await fire(view, items(element, "v0_step_mark")[1], "pointerover");
    expect(view.selection).toEqual({ step: ["1"] });
    expect(view.vega.data("v1_bars").map((row) => row.matching)).toEqual([0, 1]);
    await fire(view, items(element, "v0_step_mark")[1], "pointerout");
    expect(view.selection).toEqual({ step: [] });
    expect(listener).toHaveBeenCalledWith({ step: ["1"] });
  });

  it("shows the tooltip of the item under the pointer", async () => {
    const element = mount();
    const view = await embed(element, {
      mark: "variants",
      data: { values: [...RUNS.map((process) => ({ process, side: "old" })), ...RUNS.slice(1).map((process) => ({ process, side: "new" }))] },
      trace: { group: "side" },
      level: "names",
    });
    await fire(view, items(element, "variant_mark")[0], "pointermove");
    const tip = inside(element).querySelector<HTMLElement>(".tip");
    expect(tip?.classList.contains("shown")).toBe(true);
    expect([...(tip?.querySelectorAll("dt") ?? [])].map((cell) => cell.textContent)).toContain("runs");
    await fire(view, items(element, "variant_mark")[0], "pointerleave");
    expect(tip?.classList.contains("shown")).toBe(false);
  });

  it("keeps the state of a facet in its spec, with one level switch for every panel", async () => {
    const element = mount();
    const values = RUNS.map((process, index) => ({ process, arm: `a${index}` }));
    const view = await embed(element, { data: { values }, facet: { field: "arm" }, spec: { mark: "variants", level: "names" } });
    expect(inside(element).querySelectorAll(".vega-bind-radio")).toHaveLength(1);
    await view.vega.signal("level", "actors").runAsync();
    expect(view.spec).toMatchObject({ facet: { field: "arm" }, spec: { mark: "variants", level: "actors" } });
  });

  it("rejects unknown events and listeners", async () => {
    const view = await embed(mount(), { mark: "diagram", process: "model" });
    expect(() => view.on("click" as never, () => {})).toThrow(TypeError);
    expect(() => view.on("select", null as never)).toThrow(TypeError);
  });

  it("keeps the page's styles out of the view", async () => {
    const element = mount();
    await embed(element, { mark: "diagram", process: "model", config: { ink: "#123456" } });
    expect(element.children).toHaveLength(1);
    expect(inside(element).querySelector("style")?.textContent).toContain("#123456");
  });

  it("exports the figure as SVG and stops after destroy", async () => {
    const element = mount();
    const view = await embed(element, { mark: "icicle", data: DATA });
    expect(await view.toSVG()).toMatch(/^<svg/);
    view.destroy();
    expect(element.children).toHaveLength(0);
  });
});

type Listener = () => void;

function fakeModel(spec: Spec) {
  const state: Record<string, unknown> = { spec, selection: {} };
  const listeners = new Map<string, Listener[]>();
  return {
    state,
    saved: vi.fn(),
    get: (key: string) => state[key],
    set: (key: string, value: unknown) => void (state[key] = value),
    save_changes() {
      this.saved();
    },
    on: (event: string, listener: Listener) => listeners.set(event, [...(listeners.get(event) ?? []), listener]),
    off: (event: string, listener: Listener) =>
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((each) => each !== listener),
      ),
    emit: (event: string) => listeners.get(event)?.forEach((listener) => listener()),
    listening: (event: string) => (listeners.get(event) ?? []).length,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("widget", () => {
  it("draws the model's spec, redraws on change and stops listening when removed", async () => {
    const element = mount();
    const state = fakeModel({ mark: "diagram", process: "model -> tool" });
    const remove = await widget.render({ model: state, el: element } as never);
    expect(inside(element).querySelector("svg")).not.toBeNull();
    state.set("spec", { mark: "diagram", process: "model -> tool -> human" });
    state.emit("change:spec");
    await settle();
    expect(inside(element).querySelector("svg")).not.toBeNull();
    (remove as () => void)();
    expect(state.listening("change:spec")).toBe(0);
  });

  it("writes a selection back to the model", async () => {
    const element = mount();
    const state = fakeModel(PICKED);
    await widget.render({ model: state, el: element } as never);
    items(element, "variant_mark")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.waitFor(() => expect(state.saved).toHaveBeenCalled());
    expect(state.state.selection).toEqual({ picked: ["0", "1"] });
  });

  it("shows an invalid spec as a message instead of a figure", async () => {
    const element = mount();
    const state = fakeModel({ mark: "diagram" } as never);
    await widget.render({ model: state, el: element } as never);
    expect(element.querySelector("pre")?.textContent).toMatch(/process/);
    state.set("spec", { mark: "diagram", process: "model" });
    state.emit("change:spec");
    await settle();
    expect(inside(element).querySelector("svg")).not.toBeNull();
  });
});
