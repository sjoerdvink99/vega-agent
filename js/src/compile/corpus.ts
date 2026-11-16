import type { Data, Legend, Scale, Signal, Transforms } from "vega";
import { corpus, type Corpus } from "../data/corpus";
import type { Tables } from "../data/tables";
import { LEVELS, type Level } from "../grammar/abstract";
import type { DiagramSpec, UnitSpec } from "../spec";
import { each, first, literal, percent, plural, signed } from "./expr";
import { measure, mix, SMALL } from "../config";
import type { Fields } from "./tooltip";
import { contains, hit, type Unit } from "./unit";

type CorpusUnit = Unit<Exclude<UnitSpec, DiagramSpec>>;

const DEFAULT_LEVEL = {
  icicle: "actors",
  variants: "actors",
  sankey: "actors",
  transitions: "names",
  graph: "names",
  activities: "names",
  durations: "names",
  projection: "names",
} as const;

export const LEVEL = "level";

export type Table = keyof Tables;

export type Scope = {
  unit: CorpusUnit;
  corpus: Corpus;
  groups: number;
  count: string;
  active: string;
  leveled: boolean;
  level: string;
  table: (name: Table) => string;
};

type Leveled = Extract<UnitSpec, { mark: keyof typeof DEFAULT_LEVEL }>;

export const isLeveled = (spec: UnitSpec): spec is Leveled => spec.mark in DEFAULT_LEVEL;

export const levelOf = (spec: Leveled): Level => spec.level ?? DEFAULT_LEVEL[spec.mark];

export function scopeOf(unit: CorpusUnit): Scope {
  const data = corpus(unit.spec);
  const leveled = isLeveled(unit.spec);
  return {
    unit,
    corpus: data,
    groups: Math.max(1, data.groups.length),
    count: unit.name("count"),
    active: unit.name("active"),
    leveled,
    level: leveled ? unit.name(LEVEL) : literal("full"),
    table: (name) => {
      unit.tables.add(name);
      return `${unit.source}${name}`;
    },
  };
}

export const named = (scope: Scope) => `indexof(['full', 'names'], ${scope.level}) >= 0 && datum.name ? datum.actor + '.' + datum.name : datum.actor`;

export const perLevel = (scope: Scope, pick: (level: Level) => number): string =>
  scope.leveled ? `${literal(Object.fromEntries(LEVELS.map((level) => [level, pick(level)])))}[${scope.level}]` : String(pick("full"));

export const hues = (scope: Scope): string[] => [scope.unit.config.diverging[0], scope.unit.config.diverging[2]];

export function swatches(scope: Scope): { scales: Scale[]; legends: Legend[] } {
  if (scope.groups < 2) return { scales: [], legends: [] };
  const name = scope.unit.name("group");
  return {
    scales: [{ name, type: "ordinal", domain: scope.corpus.groups, range: hues(scope) }],
    legends: [{ fill: name, orient: "bottom", direction: "horizontal" }],
  };
}

export function table(name: string, rows: readonly object[], transform: Transforms[] = []): Data {
  if (!rows.length) return { name, values: [], transform };
  const fields = [...new Set(rows.flatMap(Object.keys))];
  const columns = Object.fromEntries(fields.map((field) => [field, rows.map((row) => (row as Record<string, unknown>)[field] ?? null)]));
  return { name, values: [columns], transform: [{ type: "flatten", fields }, ...transform] };
}

export const shipped = ({ tables }: Corpus, prefix: string, used: Set<string>): Data[] =>
  (Object.keys(tables) as Table[]).filter((name) => used.has(name)).map((name) => table(`${prefix}${name}`, tables[name]));

export function counted(scope: Scope, level: Level): Map<number, number[]> {
  const found = new Map<number, number[]>();
  for (const row of scope.corpus.tables.runs) {
    const counts = found.get(row[level]) ?? Array<number>(scope.groups).fill(0);
    counts[scope.corpus.groups.indexOf(row.group ?? "runs")] += 1;
    found.set(row[level], counts);
  }
  return found;
}

export const grouping = (groups: readonly string[]) => `indexof(${literal(groups)}, datum.group === null ? 'runs' : datum.group)`;

const STEP = ["variant", "index", "depth", "parent", "actor", "name", "signature", "failed"];

export function stepsAt(scope: Scope, local: string, then: Transforms[]): Data {
  return {
    name: scope.unit.name(local),
    source: scope.table("steps"),
    transform: [
      { type: "project", fields: STEP },
      { type: "formula", as: "activity", expr: named(scope) },
      { type: "formula", as: "fail", expr: "datum.failed ? 1 : 0" },
      ...then,
    ],
  };
}

export function joined(scope: Scope, local: string, rows: string, fields: string[], options: { by?: string; then?: Transforms[] } = {}): Data[] {
  const { unit } = scope;
  const [grouped, items] = [unit.name(`${local}_by_variant`), `${local}_items`];
  return [
    { name: grouped, source: rows, transform: [{ type: "aggregate", groupby: ["variant"], fields: ["variant"], ops: ["values"], as: ["items"] }] },
    {
      name: unit.name(local),
      source: scope.active,
      transform: [
        { type: "lookup", from: grouped, key: "variant", fields: [options.by ?? "variant"], values: ["items"], as: [items] },
        { type: "filter", expr: `isValid(datum.${items})` },
        { type: "flatten", fields: [items], as: ["item"] },
        ...fields.map((field): Transforms => ({ type: "formula", as: field, expr: `datum.item.${field}` })),
        ...(options.then ?? []),
      ],
    },
  ];
}

const groups = (scope: Scope) => Array.from({ length: scope.groups }, (_, group) => group);

export function weigh(scope: Scope, metrics: string[] = []): Transforms[] {
  const own = (group: number, value: string) => `datum.group === ${group} ? ${value} : 0`;
  return [
    ...groups(scope).flatMap((group): Transforms[] => [
      { type: "formula", as: `n${group}`, expr: own(group, "1") },
      { type: "formula", as: `s${group}`, expr: own(group, `1 / ${scope.count}.t${group}`) },
      ...metrics.map((metric): Transforms => ({ type: "formula", as: `${metric}${group}`, expr: own(group, `datum.${metric}`) })),
    ]),
    ...hit(scope.unit),
  ];
}

export function tally(scope: Scope, groupby: string[], metrics: string[] = []): Transforms[] {
  const names = groups(scope).flatMap((group) => [`n${group}`, `s${group}`, ...metrics.map((metric) => `${metric}${group}`)]);
  const summed = [...names, ...(scope.unit.highlight ? ["hit"] : [])];
  const as = [...names, ...(scope.unit.highlight ? ["matching"] : []), "members"];
  const size = groups(scope)
    .map((group) => `datum.s${group}`)
    .join(" + ");
  return [
    { type: "aggregate", groupby, fields: [...summed, "id"], ops: [...summed.map(() => "sum" as const), "values"], as },
    { type: "formula", as: "ids", expr: "pluck(datum.members, 'id')" },
    { type: "formula", as: "size", expr: `(${size}) / ${scope.groups}` },
    ...(scope.groups > 1 ? [{ type: "formula" as const, as: "difference", expr: "datum.s1 - datum.s0" }] : []),
    ...metrics.flatMap((metric) =>
      groups(scope).map((group): Transforms => ({
        type: "formula",
        as: `${metric}_rate${group}`,
        expr: `datum.${metric}${group} / max(1, ${scope.count}.t${group})`,
      })),
    ),
  ];
}

export const perRun = (...keys: string[]): Transforms => ({ type: "aggregate", groupby: [...keys, "run", "id", "group"] });

export function ranked(scope: Scope, source: string, items: string, key: string, limit: number): Data[] {
  const { name } = scope.unit;
  return [
    { name: name("shown"), source: items, transform: [{ type: "filter", expr: `datum.rank <= ${limit}` }] },
    {
      name: name("tail"),
      source,
      transform: [
        { type: "lookup", from: items, key, fields: [key], values: ["rank"] },
        { type: "filter", expr: `datum.rank > ${limit}` },
        perRun(),
        ...weigh(scope),
      ],
    },
    { name: name("rest"), source: name("tail"), transform: [...tally(scope, []), { type: "filter", expr: "isValid(datum.ids) && length(datum.ids) > 0" }] },
  ];
}

export function gradient(scope: Scope, channel: "fill" | "stroke", scale: string, extent: string, title?: string): Legend {
  const placed = { [channel]: scale, type: "gradient", orient: "bottom", direction: "horizontal", ...(title ? { title } : {}) } as const;
  if (scope.groups < 2) return { ...placed, values: [0, { signal: extent }], format: ".2~f" };
  const labels = scope.corpus.groups.map((group) => `more in ${group}`);
  const [a, b] = labels.map(literal);
  const text = `datum.value < 0 ? ${a} : datum.value > 0 ? ${b} : ''`;
  return {
    ...placed,
    gradientLength: Math.max(
      240,
      labels.reduce((sum, label) => sum + measure(label, SMALL, scope.unit.config), 24),
    ),
    values: [{ signal: `-(${extent})` }, 0, { signal: extent }],
    encode: { labels: { update: { text: { signal: text } } } },
  };
}

const CONTRAST = 0.3;

export function divergence(scope: Scope, strength = 1): { scales: Scale[]; legends: Legend[] } {
  if (scope.groups < 2) return { scales: [], legends: [] };
  const [d0, d1, d2] = scope.unit.config.diverging;
  const name = scope.unit.name("color");
  return {
    scales: [{ name, type: "pow", exponent: 0.75, domain: [-CONTRAST, 0, CONTRAST], range: [mix(d1, d0, strength), d1, mix(d1, d2, strength)], clamp: true }],
    legends: [gradient(scope, "fill", name, String(CONTRAST))],
  };
}

export function shares(scope: Scope): Fields {
  return {
    runs: each(scope.groups, (group) => `datum.n${group}`),
    share: each(scope.groups, (group) => percent(`datum.s${group}`)),
    ...(scope.groups > 1 ? { difference: signed("datum.difference * 100", 1, "pts") } : {}),
  };
}

export function base(scope: Scope): { data: Data[]; signals: Signal[] } {
  const { unit } = scope;
  const query = typeof unit.spec.highlight === "string" ? unit.spec.highlight : null;
  const totals = groups(scope).map((group) => `t${group}`);
  const level = isLeveled(unit.spec) ? levelOf(unit.spec) : null;
  return {
    data: [
      {
        name: scope.active,
        source: scope.table("runs"),
        transform: [
          { type: "project", fields: ["run", "id", "group", ...LEVELS] },
          { type: "formula", as: "group", expr: grouping(scope.corpus.groups) },
          { type: "formula", as: "variant", expr: `datum[${scope.level}]` },
          ...(unit.filter ? [{ type: "filter" as const, expr: `!(${unit.filter.active}) || ${contains(unit.filter, "datum.id")}` }] : []),
          ...hit(unit),
        ],
      },
      {
        name: scope.count,
        source: scope.active,
        transform: [
          ...groups(scope).map((group): Transforms => ({ type: "formula", as: `t${group}`, expr: `datum.group === ${group} ? 1 : 0` })),
          {
            type: "aggregate",
            fields: [...totals, "variant", ...(query ? ["hit"] : [])],
            ops: [...totals.map(() => "sum" as const), "distinct", ...(query ? ["sum" as const] : [])],
            as: [...totals, "variants", ...(query ? ["matched"] : [])],
          },
        ],
      },
    ],
    signals: [
      ...(level ? [{ name: unit.name(LEVEL), value: level, bind: { input: "radio" as const, options: [...LEVELS], name: "level" } }] : []),
      { name: scope.count, update: first(scope.count, { ...Object.fromEntries(totals.map((total) => [total, 0])), variants: 0, matched: 0 }) },
    ],
  };
}

export function stats(scope: Scope): string[] {
  const { count, corpus: data, groups: n } = scope;
  const runs = groups(scope)
    .map((group) => `${n > 1 ? `${literal(`${data.groups[group]} `)} + ` : ""}${plural(`${count}.t${group}`, "run")}`)
    .join(" + ' · ' + ");
  const lines = [`${runs} + ' · ' + ${plural(`${count}.variants`, "variant")}`];
  const query = scope.unit.spec.highlight;
  if (typeof query === "string") {
    const total = groups(scope)
      .map((group) => `${count}.t${group}`)
      .join(" + ");
    lines.push(`'runs matching ' + ${literal(query)} + ' · ' + ${count}.matched + ' of ' + (${total})`);
  }
  return lines;
}

export const subtitle = (scope: Scope): string => `[${stats(scope).join(", ")}]`;
