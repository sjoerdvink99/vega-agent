import type { View as VegaView } from "vega";
import { CONTENT, fill, scoped, store, translate, units } from "./compile";
import { isLeveled, LEVEL } from "./compile/corpus";
import { configure, type Config } from "./config";
import { load } from "./load";
import { instantiate } from "./runtime";
import type { Ids, Spec } from "./spec";
import { validate } from "./validate";

export type Selection = Record<string, Ids>;
export type Listener = (selection: Selection) => void;
export type ViewEvent = "select";

export interface View {
  readonly spec: Spec;
  readonly selection: Selection;
  readonly vega: VegaView;
  update(spec: Spec): Promise<void>;
  on(event: ViewEvent, listener: Listener): () => void;
  toSVG(): Promise<string>;
  destroy(): void;
}

const OFFSET = 12;
const MARGIN = 8;
const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";

const style = ({ background, ink, muted, line, font }: Config) => `
:host{display:block;max-width:100%;color:${ink}}
.view{max-width:100%;overflow-x:auto}
svg{display:block}
form.vega-bindings{display:flex;flex-wrap:wrap;gap:4px 18px;margin:2px 16px 0;font:11px/1.6 ${SANS};color:${muted}}
.vega-bind-name{margin-right:8px}
.vega-bind-radio label{display:inline-flex;align-items:center;gap:4px;margin-right:12px;cursor:pointer}
.vega-bind-radio input{margin:0;accent-color:${ink};cursor:pointer}
.tip{position:fixed;z-index:1000;top:0;left:0;max-width:320px;padding:7px 10px 8px;border:1px solid ${line};border-radius:6px;background:${background};color:${ink};font:11px/1.45 ${SANS};box-shadow:0 4px 14px rgba(15,18,24,.12);pointer-events:none;visibility:hidden}
.tip.shown{visibility:visible}
.tip h2{margin:0;font:600 11px/1.45 ${font};overflow-wrap:anywhere}
.tip dl{display:grid;grid-template-columns:auto auto;gap:1px 16px;margin:5px 0 0;padding:5px 0 0;border-top:1px solid ${line}}
.tip dt{color:${muted}}
.tip dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}`;

type Tip = { show(event: MouseEvent, value: unknown): void; hide(): void };

function tooltip(tip: HTMLElement): Tip {
  const hide = () => tip.classList.remove("shown");
  const place = (event: MouseEvent) => {
    const { offsetWidth: width, offsetHeight: height } = tip;
    const right = event.clientX + OFFSET + width + MARGIN > innerWidth;
    const below = event.clientY + OFFSET + height + MARGIN > innerHeight;
    const x = right ? event.clientX - OFFSET - width : event.clientX + OFFSET;
    const y = below ? event.clientY - OFFSET - height : event.clientY + OFFSET;
    tip.style.transform = `translate(${Math.max(MARGIN, x)}px, ${Math.max(MARGIN, y)}px)`;
  };
  const show = (event: MouseEvent, value: unknown) => {
    if (!value || typeof value !== "object") return hide();
    const { title, ...fields } = value as Record<string, unknown>;
    const entries = Object.entries(fields).filter(([, entry]) => entry !== "" && entry !== null && entry !== undefined);
    const heading = Object.assign(document.createElement("h2"), { textContent: String(title ?? "") });
    const list = document.createElement("dl");
    list.append(
      ...entries.flatMap(([key, entry]) => [
        Object.assign(document.createElement("dt"), { textContent: key }),
        Object.assign(document.createElement("dd"), { textContent: String(entry) }),
      ]),
    );
    tip.replaceChildren(heading, ...(entries.length ? [list] : []));
    tip.classList.add("shown");
    place(event);
  };
  return { show, hide };
}

const params = (spec: Spec) => [...new Set(units(spec).flatMap((unit) => (unit.params ?? []).map((param) => param.name)))];

function selected(view: VegaView, spec: Spec): Selection {
  return Object.fromEntries(params(spec).map((name) => [name, [...new Set((view.data(store(name)) ?? []).map((tuple: { data: string }) => tuple.data))]]));
}

type Branch = { key: number; parent: number | null; token: string; depth: number };

function focus(view: VegaView, spec: Spec, index: number): string[] {
  const [focused]: Branch[] = view.data(scoped(spec, index, "focused")) ?? [];
  const branches = new Map<number | null, Branch>((view.data(scoped(spec, index, "tree")) as Branch[]).map((branch) => [branch.key, branch]));
  const path: string[] = [];
  for (let branch = focused; branch && branch.depth > 0; branch = branches.get(branch.parent) as Branch) path.unshift(branch.token);
  return path;
}

function state(view: VegaView, spec: Spec): Spec {
  const current = structuredClone(spec);
  const chosen = selected(view, spec);
  units(current).forEach((unit, index) => {
    for (const param of unit.params ?? []) {
      if (chosen[param.name].length) param.value = chosen[param.name];
      else delete param.value;
    }
    if (isLeveled(unit)) Object.assign(unit, { level: view.signal(scoped(spec, index, LEVEL)) });
    if (unit.mark === "icicle") {
      const path = focus(view, spec, index);
      if (path.length) unit.focus = path;
      else delete unit.focus;
    }
  });
  return current;
}

export async function embed(element: HTMLElement, spec: Spec): Promise<View> {
  if (!(element instanceof HTMLElement)) throw new TypeError("embed expects an HTML element to render into");
  let current = validate(spec);
  let compiled = translate(await load(current));
  const root = Object.assign(document.createElement("div"), { className: "vega-agent" });
  const shadow = root.attachShadow({ mode: "open" });
  const sheet = document.createElement("style");
  const host = Object.assign(document.createElement("div"), { className: "view" });
  const tipElement = Object.assign(document.createElement("div"), { className: "tip", role: "tooltip" });
  const tip = tooltip(tipElement);
  shadow.append(sheet, host, tipElement);
  element.replaceChildren(root);
  const listeners = new Set<Listener>();
  const notify = () => {
    const selection = selected(view, current);
    listeners.forEach((listener) => listener(selection));
  };

  const mount = async (): Promise<VegaView> => {
    tip.hide();
    sheet.textContent = style(configure(current.config));
    host.replaceChildren();
    const {
      view: created,
      check,
      release,
    } = instantiate(compiled, {
      renderer: "svg",
      hover: true,
      tooltip: (_handler, event, _item, value) => tip.show(event as MouseEvent, value),
    });
    if (current.width === "container" && host.clientWidth) created.signal(CONTENT, fill(host.clientWidth));
    await created.runAsync();
    check();
    created.initialize(host);
    await created.runAsync();
    check();
    release();
    for (const name of params(current)) created.addDataListener(store(name), notify);
    return created;
  };

  let view = await mount();
  const resize =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (current.width === "container" && host.clientWidth) void view.signal(CONTENT, fill(host.clientWidth)).runAsync();
        });
  resize?.observe(root);
  host.addEventListener("pointerleave", tip.hide);
  addEventListener("scroll", tip.hide, { capture: true, passive: true });

  return {
    get spec() {
      return state(view, current);
    },
    get selection() {
      return selected(view, current);
    },
    get vega() {
      return view;
    },
    async update(next) {
      const checked = validate(next);
      const nextCompiled = translate(await load(checked));
      view.finalize();
      [current, compiled] = [checked, nextCompiled];
      view = await mount();
    },
    on(event, listener) {
      if (event !== "select") throw new TypeError(`unknown event '${String(event)}', expected select`);
      if (typeof listener !== "function") throw new TypeError("on expects a listener function");
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    toSVG: () => view.toSVG(),
    destroy() {
      resize?.disconnect();
      removeEventListener("scroll", tip.hide, { capture: true });
      listeners.clear();
      view.finalize();
      element.replaceChildren();
    },
  };
}
