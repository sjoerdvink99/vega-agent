import { LEVELS } from "./grammar/abstract";
import { ACTORS, MAX_DEPTH, steps } from "./grammar/ast";
import { ParseError, parse } from "./grammar/parse";
import { isGround, trace } from "./grammar/trace";
import { filtered } from "./data/transform";
import type { Field, Mapping, Spec, Transform } from "./spec";
import { attribute, groupOf, orderOf } from "./standards/mapping";
import { detect, FORMATS } from "./standards/read";

export class SpecError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = "SpecError";
  }
}

type Value = Record<string, unknown>;

const BASE = ["$schema", "title", "width", "legend", "config"];
const SOURCED = ["data", "transform", "trace"];
const UNIT = [...BASE, "mark", "params", "highlight", "tooltip"];
const CORPUS = [...UNIT, ...SOURCED, "filter"];
const LEVELED = [...CORPUS, "level"];
const KEYS: Record<string, string[]> = {
  diagram: [...UNIT, "process", "fold", "key"],
  timeline: [...UNIT, ...SOURCED, "filter", "lanes"],
  handoffs: [...UNIT, ...SOURCED, "filter"],
  icicle: [...LEVELED, "focus", "height"],
  variants: [...LEVELED, "limit"],
  transitions: [...LEVELED, "limit"],
  graph: [...LEVELED, "limit"],
  sankey: [...LEVELED, "limit", "height"],
  activities: [...LEVELED, "limit"],
  sequences: [...CORPUS, "limit", "x"],
  distribution: [...CORPUS, "measure"],
  durations: [...LEVELED, "limit"],
  projection: [...LEVELED, "height"],
};
const FOLLOWS: Field[] = ["rate", "count", "runs", "difference", "matching"];
const FIELDS: Record<string, Field[]> = {
  diagram: ["actor", "count"],
  timeline: ["actor", "start", "end", "duration"],
  handoffs: ["actor", "from", "start", "duration"],
  icicle: ["runs", "share", "difference", "ending", "matching"],
  variants: ["runs", "share", "difference", "steps", "matching"],
  transitions: FOLLOWS,
  graph: FOLLOWS,
  sankey: ["runs", "share", "difference", "matching"],
  activities: ["runs", "share", "rate", "failed", "difference", "matching"],
  sequences: ["runs", "steps", "failed", "matching", "run", "step", "start", "duration"],
  distribution: ["runs", "share", "difference", "matching"],
  durations: ["steps", "runs", "median", "spread", "longest", "matching"],
  projection: ["runs", "share", "difference", "steps", "failed", "matching"],
};
const STEP_MARKS = ["diagram", "timeline", "handoffs"];
const CHANNELS = ["group", "run", "step", "parent", "actor", "name", "failed", "start", "end"];
const UNITS = ["s", "ms", "us", "ns"];
const TARGET = new RegExp(`^(${ACTORS.join("|")})(\\.[A-Za-z_][A-Za-z0-9_]*)?$`);
const MAX_GROUPS = 2;
const MAX_PANELS = 64;
const TESTS = ["equal", "oneOf", "range", "valid"];
const LOGIC = ["and", "or", "not"];
const MEASURES = ["steps", "failures", "duration"];
const AXES = ["step", "time"];
const LANES = ["step", "agent"];
const EVENTS = ["click", "hover"];
const MARKS = Object.keys(KEYS);
const COLOR = /^#[0-9a-fA-F]{6}$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_SIZE = 1_000_000;
const COLORS = ["background", "ink", "muted", "faint", "line", "panel", "rail", "fail"];

const isObject = (value: unknown): value is Value => typeof value === "object" && value !== null && !Array.isArray(value);
const describe = (value: unknown) => (value === null ? "null" : Array.isArray(value) ? "an array" : typeof value);

function fail(path: string, reason: string): never {
  throw new SpecError(path, reason);
}

const has = (value: Value, key: string) => value[key] !== undefined;

function known(value: Value, keys: string[], path: string): void {
  for (const key of Object.keys(value))
    if (has(value, key) && !keys.includes(key)) fail(`${path}.${key}`, `unknown property, expected one of ${keys.join(", ")}`);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, `expected a string, found ${describe(value)}`);
  return value;
}

function oneOf(value: unknown, options: readonly string[], path: string): void {
  if (typeof value !== "string" || !options.includes(value)) fail(path, `expected one of ${options.join(", ")}, found ${JSON.stringify(value) ?? "nothing"}`);
}

function strings(value: unknown, path: string): void {
  if (!Array.isArray(value)) fail(path, `expected an array of strings, found ${describe(value)}`);
  value.forEach((each, index) => string(each, `${path}[${index}]`));
}

function positive(value: unknown, path: string, integer = false): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    fail(path, `expected a positive ${integer ? "integer" : "number"}, found ${JSON.stringify(value) ?? describe(value)}`);
  }
  if (!integer && value > MAX_SIZE) fail(path, `expected at most ${MAX_SIZE}, found ${value}`);
}

function boolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") fail(path, `expected true or false, found ${describe(value)}`);
}

function expression(value: unknown, path: string, ground = false): void {
  const text = string(value, path);
  try {
    if (ground) trace(text);
    else parse(text);
  } catch (error) {
    fail(path, error instanceof ParseError ? `not a valid expression: ${error.message}` : `not a trace: ${(error as Error).message}`);
  }
}

function color(value: unknown, path: string): void {
  if (typeof value !== "string" || !COLOR.test(value)) fail(path, `expected a colour like #7b61ff, found ${JSON.stringify(value)}`);
}

function config(value: unknown, path: string): void {
  if (!isObject(value)) fail(path, `expected an object, found ${describe(value)}`);
  known(value, [...COLORS, "actors", "diverging", "font", "size", "advance"], path);
  for (const key of COLORS) if (has(value, key)) color(value[key], `${path}.${key}`);
  if (has(value, "actors")) {
    const actors = value.actors;
    if (!isObject(actors)) fail(`${path}.actors`, `expected an object, found ${describe(actors)}`);
    known(actors, [...ACTORS, "_"], `${path}.actors`);
    for (const [actor, each] of Object.entries(actors)) color(each, `${path}.actors.${actor}`);
  }
  if (has(value, "diverging")) {
    const diverging = value.diverging;
    if (!Array.isArray(diverging) || diverging.length !== 3) fail(`${path}.diverging`, "expected three colours");
    diverging.forEach((each, index) => color(each, `${path}.diverging[${index}]`));
  }
  if (has(value, "font")) string(value.font, `${path}.font`);
  for (const key of ["size", "advance"]) if (has(value, key)) positive(value[key], `${path}.${key}`);
}

function base(value: Value, path: string): void {
  if (has(value, "$schema")) string(value.$schema, `${path}.$schema`);
  if (has(value, "title")) string(value.title, `${path}.title`);
  if (has(value, "width") && value.width !== "container") positive(value.width, `${path}.width`);
  if (has(value, "legend")) boolean(value.legend, `${path}.legend`);
  if (has(value, "config")) config(value.config, `${path}.config`);
}

type Scope = { data?: Value; dataAt: string; transform: Transform[]; trace?: Value; traceAt: string };

function run(value: unknown, path: string): void {
  if (typeof value === "string") return expression(value, path, true);
  if (!isObject(value)) fail(path, `expected an expression or a run { process }, found ${describe(value)}`);
  if (has(value, "id")) string(value.id, `${path}.id`);
  if (has(value, "agent")) string(value.agent, `${path}.agent`);
  expression(value.process, `${path}.process`, true);
  if (has(value, "time")) intervals(value.time, `${path}.time`, value.process as string);
}

function data(value: unknown, path: string): Value {
  if (!isObject(value)) fail(path, `expected { "values": [...] } or { "url": "..." }, found ${describe(value)}`);
  known(value, ["values", "url", "format"], path);
  if (has(value, "values") === has(value, "url")) fail(path, `expected either 'values' or 'url'`);
  if (has(value, "url")) string(value.url, `${path}.url`);
  if (has(value, "values") && !Array.isArray(value.values)) fail(`${path}.values`, `expected an array of records, found ${describe(value.values)}`);
  if (has(value, "format")) oneOf(value.format, FORMATS, `${path}.format`);
  return value;
}

function channel(value: unknown, path: string, options: string[], check: (value: Value, path: string) => void = () => {}): void {
  if (typeof value === "string") return field(value, path);
  if (!isObject(value)) fail(path, `expected a field name or { "field": name, ${options.map((key) => `"${key}": ...`).join(", ")} }, found ${describe(value)}`);
  known(value, ["field", ...options], path);
  field(value.field, `${path}.field`);
  check(value, path);
}

function field(value: unknown, path: string): void {
  if (string(value, path) === "") fail(path, "expected a field name, found an empty string");
}

function actorMap(value: Value, path: string): void {
  if (!has(value, "map")) return;
  if (!isObject(value.map)) fail(`${path}.map`, `expected an object of values to actors, found ${describe(value.map)}`);
  for (const [key, target] of Object.entries(value.map))
    if (target !== null && (typeof target !== "string" || !TARGET.test(target)))
      fail(`${path}.map.${key}`, `expected an actor such as "model" or "tool.search", or null, found ${JSON.stringify(target)}`);
}

function failure(value: Value, path: string): void {
  if (!["string", "number", "boolean"].includes(typeof value.equal))
    fail(`${path}.equal`, `expected a string, number or boolean, found ${describe(value.equal)}`);
}

const unitOf = (value: Value, path: string) => oneOf(value.unit, UNITS, `${path}.unit`);

function groupOrder(value: Value, path: string): void {
  strings(value.order, `${path}.order`);
  const order = value.order as string[];
  if (!order.length || order.length > MAX_GROUPS || new Set(order).size !== order.length)
    fail(`${path}.order`, `expected one or ${MAX_GROUPS} distinct group names, found ${JSON.stringify(order)}`);
}

const scalar = (value: unknown) => typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

function predicate(value: unknown, path: string, depth = 0): void {
  if (!isObject(value)) fail(path, `expected a predicate, found ${describe(value)}`);
  if (depth > MAX_DEPTH) fail(path, `expected predicates nested at most ${MAX_DEPTH} deep`);
  const logic = LOGIC.filter((key) => has(value, key));
  if (logic.length) {
    const [key] = logic;
    known(value, [key], path);
    if (key === "not") return predicate(value.not, `${path}.not`, depth + 1);
    const items = value[key];
    if (!Array.isArray(items) || !items.length) fail(`${path}.${key}`, `expected a non-empty array of predicates, found ${describe(items)}`);
    return items.forEach((each, index) => predicate(each, `${path}.${key}[${index}]`, depth + 1));
  }
  known(value, ["field", ...TESTS], path);
  field(value.field, `${path}.field`);
  const tests = TESTS.filter((key) => has(value, key));
  if (tests.length !== 1) fail(path, `expected exactly one of ${TESTS.join(", ")}, or a predicate of ${LOGIC.join(", ")}`);
  const [test] = tests;
  const found = value[test];
  if (test === "equal" && !scalar(found)) fail(`${path}.equal`, `expected a string, number or boolean, found ${JSON.stringify(found) ?? describe(found)}`);
  if (test === "valid") boolean(found, `${path}.valid`);
  if (test === "oneOf") {
    if (!Array.isArray(found)) fail(`${path}.oneOf`, `expected an array of values, found ${describe(found)}`);
    found.forEach((each, index) => {
      if (!scalar(each)) fail(`${path}.oneOf[${index}]`, `expected a string, number or boolean, found ${JSON.stringify(each) ?? describe(each)}`);
    });
  }
  if (test === "range") {
    const bound = (each: unknown) => each === null || (typeof each === "number" && Number.isFinite(each));
    if (!Array.isArray(found) || found.length !== 2 || !found.every(bound))
      fail(`${path}.range`, `expected [low, high] with numbers or null, found ${JSON.stringify(found)}`);
    if (found[0] !== null && found[1] !== null && found[0] > found[1]) fail(`${path}.range`, `expected low ≤ high, found ${JSON.stringify(found)}`);
  }
}

function transforms(value: unknown, path: string): Transform[] {
  if (!Array.isArray(value)) fail(path, `expected an array of transforms, found ${describe(value)}`);
  value.forEach((each, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(each)) fail(at, `expected a transform { "filter": predicate }, found ${describe(each)}`);
    known(each, ["filter"], at);
    if (!has(each, "filter")) fail(at, `missing 'filter'`);
    predicate(each.filter, `${at}.filter`);
  });
  return value as Transform[];
}

function facet(value: unknown, path: string): void {
  if (!isObject(value)) fail(path, `expected { "field": name, "columns": count }, found ${describe(value)}`);
  known(value, ["field", "columns"], path);
  field(value.field, `${path}.field`);
  if (has(value, "columns")) positive(value.columns, `${path}.columns`, true);
}

function distinct(scope: Scope, key: string, listed: string[]): string[] {
  const records = filtered(scope.data?.values as unknown[], scope.transform);
  return [...new Set([...listed, ...attribute(records, (scope.trace ?? {}) as Mapping, key).filter((each) => each !== null)])];
}

function bounded(scope: Scope, key: string, most: number, path: string, what: string, listed: string[] = []): void {
  if (!Array.isArray(scope.data?.values)) return;
  const found = distinct(scope, key, listed);
  if (found.length > most) fail(path, `expected at most ${most} ${what}, found ${found.length}: ${found.slice(0, 5).join(", ")}`);
}

export function checkMapping(value: unknown, path: string): Mapping {
  if (!isObject(value)) fail(path, `expected an object of channels, found ${describe(value)}`);
  known(value, CHANNELS, path);
  for (const key of ["run", "step", "parent", "name"]) if (has(value, key)) field(value[key], `${path}.${key}`);
  if (has(value, "group")) channel(value.group, `${path}.group`, ["order"], groupOrder);
  if (has(value, "actor")) channel(value.actor, `${path}.actor`, ["map"], actorMap);
  if (has(value, "failed")) channel(value.failed, `${path}.failed`, ["equal"], failure);
  for (const key of ["start", "end"]) if (has(value, key)) channel(value[key], `${path}.${key}`, ["unit"], unitOf);
  const stepwise = CHANNELS.find((key) => key !== "group" && key !== "actor" && has(value, key));
  if (stepwise && !has(value, "actor")) fail(`${path}.${stepwise}`, `reading records as steps needs 'actor': map it to the field that names each step's actor`);
  return value as Mapping;
}

function source(scope: Scope & { data: Value }, timed: string | null, checked: Set<Value>): void {
  const { data: value, dataAt, trace: how, traceAt } = scope;
  if (how && has(how, "actor") && has(value, "format"))
    fail(`${traceAt}.actor`, `'${String(value.format)}' data is read by its standard, so it takes no step channels`);
  if (!Array.isArray(value.values)) return;
  const records = value.values as unknown[];
  const grouping = how && has(how, "group") ? (how as Mapping) : null;
  const group = grouping && groupOf(grouping);
  if (grouping && group) bounded(scope, group, MAX_GROUPS, `${traceAt}.group`, "groups to compare; facet by this field to show more", orderOf(grouping));
  if (how && has(how, "actor")) {
    if (timed && !has(how, "start")) fail(traceAt, `expected a 'start' channel, because ${timed}`);
    return;
  }
  if ((value.format ?? detect(records)) !== "runs") return;
  if (!checked.has(value)) records.forEach((each, index) => run(each, `${dataAt}.values[${index}]`));
  checked.add(value);
  if (!timed) return;
  const untimed = records.findIndex((each) => !(isObject(each) && has(each, "time")));
  if (untimed >= 0) fail(`${dataAt}.values[${untimed}]`, `expected a run with 'time', because ${timed}`);
}

function intervals(value: unknown, path: string, process: string): void {
  if (!Array.isArray(value)) fail(path, `expected an array of [start, end] or null, found ${describe(value)}`);
  const count = steps(trace(process)).length;
  if (value.length !== count) fail(path, `expected one interval per step (${count}), found ${value.length}`);
  let [first, last] = [Infinity, -Infinity];
  value.forEach((each, index) => {
    if (each === null) return;
    const ok = Array.isArray(each) && each.length === 2 && each.every(Number.isFinite) && each[1] >= each[0];
    if (!ok) fail(`${path}[${index}]`, `expected [start, end] with start ≤ end, or null, found ${JSON.stringify(each)}`);
    [first, last] = [Math.min(first, each[0]), Math.max(last, each[1])];
  });
  if (!Number.isFinite(last - first) && first <= last) fail(path, "the intervals span more than a finite range");
}

function tooltip(value: unknown, path: string, fields: Field[]): void {
  if (typeof value === "boolean") return;
  if (!Array.isArray(value)) fail(path, `expected true, false or an array of fields, found ${describe(value)}`);
  value.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(entry)) return oneOf(entry, fields, at);
    known(entry, ["field", "title"], at);
    oneOf(entry.field, fields, `${at}.field`);
    if (has(entry, "title")) string(entry.title, `${at}.title`);
  });
}

function params(value: unknown, path: string): void {
  if (!Array.isArray(value)) fail(path, `expected an array of params, found ${describe(value)}`);
  value.forEach((param, index) => {
    const at = `${path}[${index}]`;
    if (!isObject(param)) fail(at, `expected a param { name, select }, found ${describe(param)}`);
    known(param, ["name", "select", "value"], at);
    if (!IDENTIFIER.test(string(param.name, `${at}.name`)))
      fail(`${at}.name`, `expected a name of letters, digits and underscores, such as picked, found ${JSON.stringify(param.name)}`);
    oneOf(param.select, EVENTS, `${at}.select`);
    if (has(param, "value")) strings(param.value, `${at}.value`);
  });
}

function reference(value: unknown, path: string): void {
  if (!isObject(value)) fail(path, `expected { "param": name }, found ${describe(value)}`);
  known(value, ["param"], path);
  string(value.param, `${path}.param`);
}

function unit(value: unknown, path: string, outer: Scope, checked: Set<Value>): void {
  if (!isObject(value)) fail(path, `expected a view spec object, found ${describe(value)}`);
  if (!has(value, "mark")) fail(path, `missing 'mark', expected one of ${MARKS.join(", ")}`);
  const mark = value.mark;
  oneOf(mark, MARKS, `${path}.mark`);
  known(value, KEYS[mark as string], path);
  base(value, path);
  if (mark === "diagram") {
    if (!has(value, "process")) fail(path, `missing 'process'`);
    expression(value.process, `${path}.process`);
    for (const key of ["fold", "key"]) if (has(value, key)) boolean(value[key], `${path}.${key}`);
    const selectable = ["params", "highlight"].find((key) => has(value, key));
    if (selectable && !isGround(parse(value.process as string)))
      fail(`${path}.${selectable}`, "expected a diagram of a trace: only a trace has steps to select");
  }
  if (has(value, "lanes")) oneOf(value.lanes, LANES, `${path}.lanes`);
  if (has(value, "params")) params(value.params, `${path}.params`);
  if (has(value, "tooltip")) tooltip(value.tooltip, `${path}.tooltip`, FIELDS[mark as string]);
  if (typeof value.highlight === "string") expression(value.highlight, `${path}.highlight`);
  else if (has(value, "highlight")) reference(value.highlight, `${path}.highlight`);
  if (has(value, "x")) oneOf(value.x, AXES, `${path}.x`);
  if (has(value, "measure")) oneOf(value.measure, MEASURES, `${path}.measure`);
  if (has(value, "filter")) reference(value.filter, `${path}.filter`);
  if (has(value, "level")) oneOf(value.level, LEVELS, `${path}.level`);
  if (has(value, "focus")) strings(value.focus, `${path}.focus`);
  if (has(value, "limit")) positive(value.limit, `${path}.limit`, true);
  if (has(value, "height")) positive(value.height, `${path}.height`);
  if (mark === "diagram") return;
  const scope = { ...outer, ...sourced(value, path, outer) };
  if (!scope.data) fail(path, `missing 'data'`);
  source({ ...scope, data: scope.data }, timing(value), checked);
}

function sourced(value: Value, path: string, outer: Scope): Partial<Scope> {
  const own = has(value, "transform") ? transforms(value.transform, `${path}.transform`) : [];
  return {
    ...(has(value, "data") ? { data: data(value.data, `${path}.data`), dataAt: `${path}.data`, transform: own } : { transform: [...outer.transform, ...own] }),
    ...(has(value, "trace") ? { trace: checkMapping(value.trace, `${path}.trace`) as Value, traceAt: `${path}.trace` } : {}),
  };
}

function timing(value: Value): string | null {
  if (value.x === "time") return `x is "time"`;
  if (value.measure === "duration") return `measure is "duration"`;
  if (value.mark === "timeline") return "a timeline needs step times";
  return value.mark === "durations" ? "durations needs step times" : null;
}

const selects = (mark: unknown) => (STEP_MARKS.includes(mark as string) ? "steps" : "runs");

function selections(units: Value[], paths: string[]): void {
  const declared = new Map<string, string>();
  units.forEach((each, index) =>
    ((each.params ?? []) as Value[]).forEach((param, position) => {
      const [name, kind] = [param.name as string, selects(each.mark)];
      const found = declared.get(name) ?? kind;
      if (found !== kind) fail(`${paths[index]}.params[${position}].name`, `'${name}' selects ${found} in another view, so it cannot select ${kind} here`);
      declared.set(name, kind);
    }),
  );
  units.forEach((each, index) => {
    for (const key of ["highlight", "filter"]) {
      const ref = each[key];
      if (!isObject(ref)) continue;
      const [name, at] = [ref.param as string, `${paths[index]}.${key}.param`];
      if (!declared.has(name)) fail(at, `no param named '${name}', declare it in the params of a view`);
      const needs = key === "filter" ? "runs" : selects(each.mark);
      if (declared.get(name) !== needs) fail(at, `'${name}' selects ${declared.get(name)}, but this view needs a selection of ${needs}`);
    }
  });
}

export function validate(spec: unknown): Spec {
  const path = "spec";
  const direction = isObject(spec) ? ["vconcat", "hconcat"].find((key) => has(spec, key)) : undefined;
  const checked = new Set<Value>();
  const top: Scope = { dataAt: `${path}.data`, transform: [], traceAt: `${path}.trace` };
  if (isObject(spec) && has(spec, "facet")) {
    known(spec, [...BASE, ...SOURCED, "facet", "spec"], path);
    base(spec, path);
    facet(spec.facet, `${path}.facet`);
    const outer = { ...top, ...sourced(spec, path, top) };
    if (!outer.data) fail(path, `missing 'data': a facet splits its own data into panels`);
    const [inner, at] = [spec.spec, `${path}.spec`];
    if (!isObject(inner)) fail(at, `expected a view spec object, found ${describe(inner)}`);
    for (const key of SOURCED) if (has(inner, key)) fail(`${at}.${key}`, `the panels of a facet read its ${key}: set '${key}' next to 'facet'`);
    if (inner.mark === "diagram") fail(`${at}.mark`, "expected a mark that reads data: a diagram has no runs to facet");
    unit(inner, at, outer, checked);
    bounded(outer, (spec.facet as Value).field as string, MAX_PANELS, `${path}.facet.field`, "panels");
    selections([inner], [at]);
  } else if (isObject(spec) && direction) {
    known(spec, [...BASE, ...SOURCED, direction], path);
    base(spec, path);
    const outer = { ...top, ...sourced(spec, path, top) };
    const views = spec[direction];
    if (!Array.isArray(views) || !views.length) fail(`${path}.${direction}`, "expected a non-empty array of view specs");
    const paths = views.map((_, index) => `${path}.${direction}[${index}]`);
    views.forEach((each, index) => unit(each, paths[index], outer, checked));
    selections(views as Value[], paths);
  } else {
    unit(spec, path, top, checked);
    selections([spec as Value], [path]);
  }
  return JSON.parse(JSON.stringify(spec)) as Spec;
}
