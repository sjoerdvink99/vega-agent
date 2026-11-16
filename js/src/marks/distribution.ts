import type { Data, Mark, Transforms } from "vega";
import { base, hues, scopeOf, shares, subtitle, swatches, tally, weigh, type Scope } from "../compile/corpus";
import { duration, literal } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { dim, part, type Part, type Unit } from "../compile/unit";
import { tint } from "../config";
import type { DistributionSpec, Measure } from "../spec";

const HEIGHT = 160;
const GAP = 2;

const MEASURES: Record<Measure, { title: string; noun: string }> = {
  steps: { title: "steps per run", noun: "steps" },
  failures: { title: "failed steps per run", noun: "failed" },
  duration: { title: "run duration", noun: "" },
};

function measured(scope: Scope, measure: Measure): { data: Data[]; lookup: Transforms } {
  const name = scope.unit.name("measured");
  if (measure === "duration")
    return {
      data: [
        {
          name,
          source: scope.table("times"),
          transform: [
            { type: "aggregate", groupby: ["run"], fields: ["start", "end"], ops: ["min", "max"], as: ["first", "last"] },
            { type: "formula", as: "value", expr: "datum.last - datum.first" },
          ],
        },
      ],
      lookup: { type: "lookup", from: name, key: "run", fields: ["run"], values: ["value"], default: 0 },
    };
  const [field, op] = measure === "steps" ? (["index", "count"] as const) : (["failed", "sum"] as const);
  return {
    data: [{ name, source: scope.table("steps"), transform: [{ type: "aggregate", groupby: ["variant"], fields: [field], ops: [op], as: ["value"] }] }],
    lookup: { type: "lookup", from: name, key: "variant", fields: ["full"], values: ["value"], default: 0 },
  };
}

export function distribution(unit: Unit<DistributionSpec>): Part {
  const { spec, config, name, width } = unit;
  const corpus = scopeOf(unit);
  const { groups: count } = corpus;
  const measure = spec.measure ?? "steps";
  const { title, noun } = MEASURES[measure];
  const timed = measure === "duration";
  const key = swatches(corpus);
  const runs = base(corpus);
  const values = measured(corpus, measure);
  const [binned, x, y, extent, bins] = [name("bins"), name("x"), name("y"), name("extent"), name("binning")];
  const [low, high] = [`(${extent}[0] || 0)`, `(${extent}[1] || 0)`];
  const value = (field: string) => (timed ? duration(field) : `'' + ${field}`);
  const range = timed
    ? `${value("datum.b0")} + '–' + ${value("datum.b1")}`
    : `(ceil(datum.b0) === floor(datum.b1) ? '' + ceil(datum.b0) : ceil(datum.b0) + '–' + floor(datum.b1)) + ' ${noun}'`;
  const tip = tooltip(unit, range, shares(corpus));
  const left = (group: number) =>
    `scale(${literal(x)}, datum.b0) + ${GAP / 2} + ${group} * (scale(${literal(x)}, datum.b1) - scale(${literal(x)}, datum.b0) - ${GAP}) / ${count}`;
  const span = `(scale(${literal(x)}, datum.b1) - scale(${literal(x)}, datum.b0) - ${GAP}) / ${count}`;

  const bars: Mark[] = Array.from({ length: count }, (_, group) => ({
    type: "rect",
    from: { data: binned },
    interactive: false,
    encode: {
      update: {
        x: { signal: left(group) },
        width: { signal: `max(1, ${span})` },
        y: { scale: y, field: `s${group}` },
        y2: { scale: y, value: 0 },
        cornerRadius: { value: 1.5 },
        fill: { value: count > 1 ? hues(corpus)[group] : tint(config, config.rail, 0.8) },
        opacity: dim(unit),
      },
    },
  }));

  return part({
    data: [
      ...runs.data,
      ...values.data,
      {
        name: binned,
        source: corpus.active,
        transform: [
          values.lookup,
          { type: "extent", field: "value", signal: extent },
          {
            type: "bin",
            field: "value",
            extent: { signal: timed ? `[${low}, max(${high}, ${low} + 1)]` : `[${low} - 0.5, max(${high}, ${low}) + 0.5]` },
            maxbins: 24,
            ...(timed ? { nice: true } : { minstep: 1, nice: false }),
            as: ["b0", "b1"],
            signal: bins,
          },
          ...weigh(corpus),
          ...tally(corpus, ["b0", "b1"]),
        ],
      },
    ],
    signals: runs.signals,
    scales: [
      ...key.scales,
      { name: x, type: "linear", domain: { signal: `[${bins}.start, ${bins}.stop]` }, range: [0, { signal: width }], zero: false, nice: false },
      {
        name: y,
        type: "linear",
        domain: { data: binned, fields: Array.from({ length: count }, (_, group) => `s${group}`) },
        range: [HEIGHT, 0],
        zero: true,
        nice: true,
      },
    ],
    axes: [
      {
        scale: x,
        orient: "bottom",
        grid: false,
        title,
        tickCount: { signal: `max(2, floor(${width} / 80))` },
        ...(timed ? { encode: { labels: { update: { text: { signal: duration("datum.value") } } } } } : { tickMinStep: 1 }),
      },
      { scale: y, orient: "left", format: ".0%", tickCount: 4, title: "share of runs" },
    ],
    legends: key.legends,
    marks: [
      ...bars,
      {
        type: "rect",
        name: unit.mark("bin"),
        from: { data: binned },
        encode: {
          update: {
            x: { scale: x, field: "b0" },
            x2: { scale: x, field: "b1" },
            y: { value: 0 },
            height: { value: HEIGHT },
            fill: { value: config.ink },
            fillOpacity: { value: 0 },
            ...tip,
          },
          hover: { fillOpacity: { value: 0.04 } },
        },
      },
    ],
    width,
    height: HEIGHT,
    actors: [],
    subtitle: subtitle(corpus),
    selectable: [unit.mark("bin")],
  });
}
