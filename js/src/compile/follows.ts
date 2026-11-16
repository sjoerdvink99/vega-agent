import type { Data, Legend, Scale, Signal } from "vega";
import { mix } from "../config";
import { orders, type Activity } from "../data/pairs";
import type { GraphSpec, TransitionsSpec } from "../spec";
import { base, counted, gradient, joined, perLevel, scopeOf, stepsAt, table, tally, weigh, type Scope } from "./corpus";
import { each, first, fixed, literal, signed } from "./expr";
import type { Fields } from "./tooltip";
import type { Unit } from "./unit";

type Follows = {
  scope: Scope;
  data: Data[];
  signals: Signal[];
  activities: Activity[];
  fields: Fields;
  measures: string[];
  byLevel: (pick: (activities: Activity[]) => number) => string;
  color: (name: string, single: [string, string]) => Scale;
  legend: (channel: "fill" | "stroke", scale: string, note?: string) => Legend;
};

export function follows(unit: Unit<TransitionsSpec | GraphSpec>, limit: number): Follows {
  const corpus = scopeOf(unit);
  const { name, config } = unit;
  const { groups: count } = corpus;
  const compare = count > 1;
  const weights = new Map([...counted(corpus, "full")].map(([variant, runs]) => [variant, runs.reduce((sum, size) => sum + size, 0)]));
  const activities = orders(corpus.corpus.tables.steps, weights, limit);
  const [labelled, continuing, starting, paired] = ["labelled", "continuing", "starting", "paired"].map(name);
  const runs = base(corpus);
  const peak = name("peak");
  const value = compare ? "datum.times_rate1 - datum.times_rate0" : "datum.times_rate0";
  const [d0, d1, d2] = config.diverging;
  return {
    scope: corpus,
    activities,
    data: [
      ...runs.data,
      table(name("activities"), activities, [{ type: "filter", expr: `datum.level === ${corpus.level}` }]),
      stepsAt(corpus, "labelled", [
        { type: "formula", as: "label", expr: "datum.activity + (datum.failed ? '!' : '')" },
        { type: "lookup", from: name("activities"), key: "name", fields: ["label"], values: ["kind"] },
        { type: "formula", as: "mapped", expr: "isValid(datum.kind) ? datum.label : 'other'" },
        { type: "window", groupby: ["variant"], sort: { field: "index" }, ops: ["lead"], fields: ["mapped"], as: ["next"] },
      ]),
      {
        name: continuing,
        source: labelled,
        transform: [
          { type: "formula", as: "from", expr: "datum.mapped" },
          { type: "formula", as: "to", expr: "isValid(datum.next) ? datum.next : 'end'" },
        ],
      },
      {
        name: starting,
        source: labelled,
        transform: [
          { type: "filter", expr: "datum.index === 0" },
          { type: "formula", as: "from", expr: "'start'" },
          { type: "formula", as: "to", expr: "datum.mapped" },
        ],
      },
      { name: paired, source: [continuing, starting], transform: [{ type: "aggregate", groupby: ["variant", "from", "to"], ops: ["count"], as: ["times"] }] },
      ...joined(corpus, "pairs", paired, ["from", "to", "times"], { by: "full", then: weigh(corpus, ["times"]) }),
      { name: name("follows"), source: name("pairs"), transform: [...tally(corpus, ["from", "to"], ["times"]), { type: "formula", as: "value", expr: value }] },
      {
        name: peak,
        source: name("follows"),
        transform: [
          { type: "formula", as: "magnitude", expr: "abs(datum.value)" },
          { type: "aggregate", fields: ["magnitude"], ops: ["max"], as: ["peak"] },
        ],
      },
    ],
    signals: [...runs.signals, { name: peak, update: `max(1e-9, ${first(peak, { peak: 0 })}.peak)` }],
    measures: Array.from({ length: count }, (_, group) => [`n${group}`, `times${group}`, `times_rate${group}`]).flat(),
    byLevel: (pick) => perLevel(corpus, (level) => pick(activities.filter((activity) => activity.level === level))),
    fields: {
      rate: each(count, (group) => fixed(`datum.times_rate${group}`, 2)),
      count: each(count, (group) => `datum.times${group}`),
      runs: each(count, (group) => `datum.n${group}`),
      ...(compare ? { difference: signed("datum.times_rate1 - datum.times_rate0", 2, "per run") } : {}),
    },
    color: (scale, single) =>
      compare
        ? {
            name: scale,
            type: "pow",
            exponent: 0.6,
            domain: { signal: `[-${peak}, 0, ${peak}]` },
            range: [mix(d1, d0, 0.85), d1, mix(d1, d2, 0.85)],
            clamp: true,
          }
        : { name: scale, type: "pow", exponent: 0.6, domain: { signal: `[0, ${peak}]` }, range: single, clamp: true },
    legend: (channel, scale, note) => gradient(corpus, channel, scale, peak, compare ? note : note ? `per run · ${note}` : "per run"),
  };
}

export const labelColor = (unit: Unit, field: string) =>
  `test(/!$/, ${field}) ? ${literal(unit.config.fail)} : indexof(['start', 'end', 'other'], ${field}) >= 0 ? ${literal(unit.config.faint)} : ${literal(unit.config.ink)}`;
