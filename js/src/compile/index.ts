import type { Data, GroupMark, Legend, Mark, Scale, Signal, Spec as VegaSpec } from "vega";
import { configure, SMALL, theme, type Config } from "../config";
import { corpus, hits, matching, type Corpus } from "../data/corpus";
import { ACTORS, ANY, type Actor, type Node } from "../grammar/ast";
import { find } from "../grammar/match";
import { trace } from "../grammar/trace";
import { activities } from "../marks/activities";
import { diagram } from "../marks/diagram";
import { distribution } from "../marks/distribution";
import { durations } from "../marks/durations";
import { graph } from "../marks/graph";
import { handoffs } from "../marks/handoffs";
import { icicle } from "../marks/icicle";
import { projection } from "../marks/projection";
import { sankey } from "../marks/sankey";
import { sequences } from "../marks/sequences";
import { timeline } from "../marks/timeline";
import { transitions } from "../marks/transitions";
import { variants } from "../marks/variants";
import type { ConfigSpec, Data as Source, FacetSpec, InlineData, Param, Sourced, Spec, UnitSpec } from "../spec";
import { filtered } from "../data/transform";
import { LEVEL, shipped } from "./corpus";
import { groupOf, orderOf, partition } from "../standards/mapping";
import { SpecError, validate } from "../validate";
import { literal } from "./expr";
import { stepOf } from "./focus";
import { extent, type Emphasis, type Part, type Unit } from "./unit";

const PADDING = 16;
const GAP = 20;
const DEFAULT_WIDTH = 800;
const MIN_WIDTH = 240;
const COLUMNS = 3;
export const CONTENT = "contentWidth";
const ALL: Actor[] = [...ACTORS, ANY];
const SCHEMA = "https://vega.github.io/schema/vega/v6.json";

type Compiler<M extends UnitSpec["mark"]> = (unit: Unit<Extract<UnitSpec, { mark: M }>>) => Part;

const MARKS: { [M in UnitSpec["mark"]]: Compiler<M> } = {
  diagram,
  timeline,
  handoffs,
  icicle,
  variants,
  transitions,
  graph,
  sankey,
  activities,
  sequences,
  distribution,
  durations,
  projection,
};

export const units = (spec: Spec): UnitSpec[] => ("facet" in spec ? [spec.spec] : "vconcat" in spec ? spec.vconcat : "hconcat" in spec ? spec.hconcat : [spec]);

const direction = (spec: Spec) => ("vconcat" in spec ? "vconcat" : "hconcat");

function inlined(data: Source | undefined, at: string): InlineData | undefined {
  if (data && "url" in data) throw new SpecError(`${at}.url`, "compile needs the records: load(spec) fetches them, and embed and render do so themselves");
  return data;
}

function inherit(spec: Spec, view: UnitSpec, index: number): UnitSpec {
  if (view.mark === "diagram") return view;
  const outer: Sourced = "data" in spec ? spec : {};
  const at = view.data && nests(spec) ? `spec.${direction(spec)}[${index}].data` : "spec.data";
  const data = inlined(view.data ?? outer.data, at);
  const transform = view.data ? (view.transform ?? []) : [...(outer.transform ?? []), ...(view.transform ?? [])];
  const mapping = view.trace ?? outer.trace;
  return { ...view, data, ...(transform.length ? { transform } : {}), ...(mapping ? { trace: mapping } : {}) };
}

function facetted(spec: FacetSpec): UnitSpec[] {
  const data = inlined(spec.data, "spec.data") ?? { values: [] };
  const format = data.format ? { format: data.format } : {};
  const how = spec.trace ?? {};
  const records = filtered(data.values, spec.transform);
  const grouping = groupOf(how);
  const order = grouping === undefined ? [] : [...new Set([...orderOf(how), ...partition(records, how, grouping).map(([value]) => value)])];
  const mapping = spec.trace ? { trace: grouping === undefined ? how : { ...how, group: { field: grouping, order } } } : {};
  const panels = partition(records, how, spec.facet.field);
  if (!panels.length) return [{ ...spec.spec, data: { values: [], ...format }, ...mapping }];
  return panels.map(([value, values]) => ({ ...spec.spec, title: value, data: { values, ...format }, ...mapping }));
}

function arranged(spec: Spec): { views: UnitSpec[]; columns: number } {
  if ("facet" in spec) {
    const views = facetted(spec);
    return { views, columns: Math.min(views.length, spec.facet.columns ?? COLUMNS) };
  }
  const views = units(spec).map((view, index) => inherit(spec, view, index));
  return { views, columns: "hconcat" in spec ? views.length : 1 };
}

export const store = (param: string) => `${param}_store`;

const nests = (spec: Spec) => "vconcat" in spec || "hconcat" in spec || "facet" in spec;

export const scoped = (spec: Spec, index: number, local: string) => ("facet" in spec && local === LEVEL ? local : (nests(spec) ? `v${index}_` : "") + local);

export const fill = (available: number) => Math.max(MIN_WIDTH, available - 2 * PADDING);

const emphasis = (param: string): Emphasis => ({ store: store(param), active: `length(data(${literal(store(param))})) > 0` });

export const compile = (input: Spec): VegaSpec => translate(validate(input));

export function translate(spec: Spec): VegaSpec {
  const { views, columns } = arranged(spec);
  const nested = nests(spec);
  const config = configure(spec.config);

  const sources = sourcesOf(views);
  const compiled = views.map((view, index) => {
    const own = nested ? configure(merge(spec.config, view.config)) : config;
    const name = (local: string) => scoped(spec, index, local);
    const query = queried(view, name("query"));
    const unit: Unit = {
      spec: view,
      config: own,
      name,
      mark: (role: string) => name(`${role}_mark`),
      width: name("chartWidth"),
      actor: nested && view.config?.actors ? name("actor") : "actor",
      source: view.mark === "diagram" ? "" : (sources.get(corpus(view)) ?? ""),
      tables: new Set<string>(),
      highlight: query ? query.emphasis : typeof view.highlight === "object" ? emphasis(view.highlight.param) : null,
      filter: "filter" in view && view.filter ? emphasis(view.filter.param) : null,
    };
    return { unit, query, part: (MARKS[view.mark] as Compiler<UnitSpec["mark"]>)(unit) };
  });

  const parts = compiled.map(({ part }) => part);
  const natural = parts.map((each) => (typeof each.width === "number" ? each.width : null));
  const fixed = views.map((view, index) => natural[index] ?? (nested && typeof view.width === "number" ? view.width : null));
  const row = fixed.slice(0, columns);
  const flexible = row.filter((each) => each === null).length;
  const sizes = views.map((_, index) => String(natural[index] ?? compiled[index].unit.width));
  const across = (index: number) => sizes.slice(index, index + columns);
  const rows = Array.from({ length: Math.ceil(views.length / columns) }, (_, index) => across(index * columns));
  const width = (each: string[]) => (each.length === 1 ? each[0] : `${each.join(" + ")} + ${GAP * (each.length - 1)}`);
  const total = rows.length === 1 ? width(rows[0]) : `max(${rows.map(width).join(", ")})`;
  const share =
    columns > 1
      ? `max(${MIN_WIDTH}, (${CONTENT} - ${row.reduce<number>((sum, each) => sum + (each ?? 0), 0) + GAP * (columns - 1)}) / ${Math.max(1, flexible)})`
      : `max(${CONTENT}, ${Math.max(0, ...natural.map((each) => each ?? 0))})`;
  const widths: Signal[] = compiled.flatMap(({ unit }, index) =>
    natural[index] === null ? [{ name: unit.width, update: fixed[index] === null ? share : String(fixed[index]) }] : [],
  );

  const order = (actors: Iterable<Actor>) => ALL.filter((actor) => new Set(actors).has(actor));
  const domain = order(parts.flatMap((each) => each.actors));
  const listed = order(parts.flatMap((each, index) => (views[index].legend === false ? [] : each.actors))).filter((actor) => actor !== ANY);
  const selection = selections(views, parts);

  return {
    $schema: SCHEMA,
    ...(spec.title ? { description: spec.title, title: { text: spec.title, frame: "bounds" as const, offset: 12 } } : {}),
    background: config.background,
    width: Number.isFinite(Number(total)) ? Number(total) : { signal: total },
    padding: PADDING,
    autosize: { type: "pad" },
    config: theme(config),
    signals: distinct([contentWidth(spec.width), ...widths, ...selection.signals, ...parts.flatMap((each) => each.signals)]),
    data: [
      ...selection.data,
      ...[...sources].flatMap(([source, prefix]) => shipped(source, prefix, used(compiled, prefix))),
      ...compiled.flatMap(({ query }) => (query ? [query.data] : [])),
      ...parts.flatMap((each) => each.data),
    ],
    scales: domain.length ? [actorScale("actor", domain, config)] : [],
    legends: spec.legend === false || !listed.length ? [] : [actorLegend(listed)],
    layout: { columns, padding: GAP, bounds: "full", align: "none" },
    marks: compiled.map(({ unit, part }) => group(unit, part, nested, domain)),
  };
}

const used = (compiled: { unit: Unit }[], prefix: string) => new Set(compiled.flatMap(({ unit }) => (unit.source === prefix ? [...unit.tables] : [])));

function sourcesOf(views: UnitSpec[]): Map<Corpus, string> {
  const found = [...new Set(views.flatMap((view) => (view.mark === "diagram" ? [] : [corpus(view)])))];
  return new Map(found.map((each, index) => [each, found.length === 1 ? "" : `s${index}_`]));
}

function distinct(signals: Signal[]): Signal[] {
  const named = new Map<string, Signal>();
  for (const signal of signals) if (!named.has(signal.name)) named.set(signal.name, signal);
  return [...named.values()];
}

function merge(outer: ConfigSpec = {}, inner: ConfigSpec = {}): ConfigSpec {
  return { ...outer, ...inner, actors: { ...outer.actors, ...inner.actors } };
}

function contentWidth(width: Spec["width"]): Signal {
  if (width !== "container") return { name: CONTENT, value: width ?? DEFAULT_WIDTH };
  const update = `max(${MIN_WIDTH}, (containerSize()[0] || ${DEFAULT_WIDTH + 2 * PADDING}) - ${2 * PADDING})`;
  return { name: CONTENT, init: update, on: [{ events: "window:resize", update }] };
}

function stepsMatching(data: Corpus, query: string): string[] {
  const found = hits(data, query);
  return data.tables.runs.flatMap((row) => (found.get(row.full) ?? []).map((step) => stepOf(row.run, step)));
}

function queried(view: UnitSpec, name: string): { emphasis: Emphasis; data: Data } | null {
  const query = view.highlight;
  if (typeof query !== "string") return null;
  const steps = (node: Node) => find(node, query).flatMap((hit) => hit.steps.map(String));
  const ids =
    view.mark === "diagram"
      ? steps(trace(view.process))
      : view.mark === "timeline" || view.mark === "handoffs"
        ? stepsMatching(corpus(view), query)
        : matching(corpus(view), query);
  return { emphasis: { store: name, active: "true" }, data: { name, values: ids } };
}

function actorScale(name: string, domain: Actor[], config: Config): Scale {
  return { name, type: "ordinal", domain, range: domain.map((actor) => config.actors[actor]) };
}

function actorLegend(values: Actor[]): Legend {
  return { fill: "actor", orient: "top", direction: "horizontal", values };
}

function heading(unit: Unit, part: Part, nested: boolean): Pick<GroupMark, "title"> {
  const lines = part.subtitle ? { signal: part.subtitle } : null;
  const text = nested ? unit.spec.title : undefined;
  if (text) return { title: { text, ...(lines ? { subtitle: lines } : {}) } };
  return lines ? { title: { text: lines, color: unit.config.muted, fontSize: SMALL, fontWeight: 400 } } : {};
}

function group(unit: Unit, part: Part, nested: boolean, domain: Actor[]): GroupMark {
  const own = unit.actor === "actor" ? [] : [actorScale(unit.actor, domain, unit.config)];
  return {
    type: "group",
    name: unit.mark("view"),
    ...heading(unit, part, nested),
    encode: { update: { width: extent(part.width), height: extent(part.height) } },
    scales: [...own, ...part.scales],
    axes: part.axes,
    legends: part.legends,
    marks: pointed(part.marks, new Set(part.selectable)),
  };
}

function pointed(marks: Mark[], selectable: Set<string>): Mark[] {
  return marks.map((mark) => {
    if (mark.type === "group" && mark.marks) return { ...mark, marks: pointed(mark.marks, selectable) };
    if (!mark.name || !selectable.has(mark.name)) return mark;
    return { ...mark, encode: { ...mark.encode, update: { ...mark.encode?.update, cursor: { value: "pointer" } } } } as Mark;
  });
}

function selections(views: UnitSpec[], parts: Part[]): { data: Data[]; signals: Signal[] } {
  const declared = new Map<string, { view: number; param: Param }[]>();
  views.forEach((view, index) => view.params?.forEach((param) => declared.set(param.name, [...(declared.get(param.name) ?? []), { view: index, param }])));
  const everything = parts.flatMap((each) => each.selectable);
  const on = (names: string[]) => `item() && item().mark && indexof(${literal(names)}, item().mark.name) >= 0`;
  const data: Data[] = [];
  const signals: Signal[] = [];
  for (const [name, uses] of declared) {
    const by = (select: Param["select"]) => uses.filter((use) => use.param.select === select).flatMap((use) => parts[use.view].selectable);
    const [click, hover] = [by("click"), by("hover")];
    const others = everything.filter((each) => !click.includes(each));
    const [tuple, clear] = [`${name}_tuple`, "{ids: [], add: false}"];
    data.push({ name: store(name), values: [...new Set(uses.flatMap((use) => use.param.value ?? []))] });
    signals.push(
      {
        name: tuple,
        value: null,
        on: [
          ...(click.length
            ? [{ events: "click", update: `${on(click)} ? {ids: datum.ids, add: event.shiftKey} : ${on(others)} ? null : ${clear}`, force: true }]
            : []),
          ...(hover.length
            ? [
                { events: "pointerover", update: `${on(hover)} ? {ids: datum.ids, add: false} : ${clear}`, force: true },
                { events: "pointerout", update: `${on(hover)} ? ${clear} : null`, force: true },
              ]
            : []),
        ],
      },
      { name: `${name}_modify`, on: [{ events: { signal: tuple }, update: `${tuple} ? modify(${literal(store(name))}, ${tuple}.ids, !${tuple}.add) : null` }] },
    );
  }
  return { data, signals };
}
