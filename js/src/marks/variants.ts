import type { Compare, Mark, Transforms } from "vega";
import { base, hues, ranked, scopeOf, shares, subtitle, swatches, table, tally, weigh } from "../compile/corpus";
import { each, literal, percent, plural, sum } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { band, dim, part, type Part, type Unit } from "../compile/unit";
import { clip, measure, tint } from "../config";
import { byVariant } from "../data/tables";
import type { VariantsSpec } from "../spec";

const ROW = 26;
const CHIP = 18;
const BAR = 80;
const GAP = 10;
const WIDEST = 240;

export function variants(unit: Unit<VariantsSpec>): Part {
  const { spec, config, name, width } = unit;
  const corpus = scopeOf(unit);
  const { groups: count } = corpus;
  const compare = count > 1;
  const limit = spec.limit ?? 12;
  const query = typeof spec.highlight === "string";
  const runs = base(corpus);
  const [all, shown, rest, chips, visible, more, spans, stripes] = ["ranking", "shown", "rest", "chips", "visible", "more", "spans", "stripes"].map(name);
  const [scale, height] = [name("bar"), name("chartHeight")];
  const strip = BAR + GAP + measure(compare ? "100% → 100%" : "999 · 100%", 10, config) + 16;
  const room = `${width} - ${strip}`;
  const row = (offset: number) => ({ signal: `(datum.rank - 1) * ${ROW} + ${offset}` });

  const layouts = [...byVariant(corpus.corpus.tables.tokens)].map(([variant, items]) => {
    const widths = items.map(({ token }) => Math.min(measure(token, config.size, config), WIDEST) + 18);
    return {
      variant,
      count: items.length,
      text: items.map(({ token }, index) => clip(token, widths[index] - 16, config.size, config)),
      actors: items.map((item) => item.actors),
      failed: items.map((item) => item.failed),
      w: widths,
    };
  });
  const longest = Math.max(0, ...layouts.map((layout) => layout.count));
  const reserves = Array.from({ length: longest }, (_, left) => ({ left, reserve: left ? measure(`+${left + 1}`, config.size, config) + 12 : 0 }));

  const order: Compare = query
    ? { field: ["matching", "size", "variant"], order: ["descending", "descending", "ascending"] }
    : { field: ["size", "variant"], order: ["descending", "ascending"] };
  const caption = compare ? each(count, (group) => percent(`datum.s${group}`)) : `datum.n0 + ' · ' + ${percent("datum.s0")}`;
  const tip = tooltip(unit, "datum.label || 'empty'", { ...shares(corpus), steps: "'' + datum.steps" });
  const restTip = tooltip(unit, plural(`length(data(${literal(all)})) - ${limit}`, "more variant"), shares(corpus));

  const bars: Mark[] = Array.from({ length: count }, (_, group): Mark[] => {
    const h = compare ? 5 : 8;
    const y = ROW / 2 - (count * h + (count - 1) * 2) / 2 + group * (h + 2);
    const fill = compare ? hues(corpus)[group] : tint(config, config.rail, 0.75);
    return [
      {
        type: "rect",
        from: { data: shown },
        interactive: false,
        encode: {
          update: {
            x: { value: 0 },
            width: { value: BAR },
            y: row(y),
            height: { value: h },
            cornerRadius: { value: 1.5 },
            fill: { value: config.panel },
            opacity: dim(unit),
          },
        },
      },
      {
        type: "rect",
        from: { data: shown },
        interactive: false,
        encode: {
          update: {
            x: { value: 0 },
            width: { signal: `max(1, scale(${literal(scale)}, datum.s${group}))` },
            y: row(y),
            height: { value: h },
            cornerRadius: { value: 1.5 },
            fill: { value: fill },
            opacity: dim(unit),
          },
        },
      },
    ];
  }).flat();

  const marks: Mark[] = [
    band(unit, "variant", shown, row(1).signal, ROW - 2, width, tip),
    ...bars,
    {
      type: "text",
      from: { data: shown },
      interactive: false,
      style: "muted",
      encode: { update: { x: { value: BAR + GAP }, y: row(ROW / 2), text: { signal: caption }, fontSize: { value: 10 }, opacity: dim(unit) } },
    },
    {
      type: "rule",
      from: { data: spans },
      interactive: false,
      encode: { update: { x: { value: strip }, x2: { signal: `${strip} + datum.end` }, y: row(ROW / 2), stroke: { value: config.line }, opacity: dim(unit) } },
    },
    {
      type: "rect",
      from: { data: visible },
      interactive: false,
      encode: {
        update: {
          x: { signal: `${strip} + datum.x` },
          width: { field: "w" },
          y: row((ROW - CHIP) / 2),
          height: { value: CHIP },
          cornerRadius: { value: 3 },
          fill: { value: config.background },
          stroke: { signal: `datum.failed ? ${literal(config.fail)} : null` },
          strokeWidth: { value: 1.2 },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "rect",
      from: { data: visible },
      interactive: false,
      encode: {
        update: {
          x: { signal: `${strip} + datum.x` },
          width: { field: "w" },
          y: row((ROW - CHIP) / 2),
          height: { value: CHIP },
          cornerRadius: { value: 3 },
          fill: { scale: unit.actor, field: "actors[0]" },
          fillOpacity: { value: 0.16 },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "rect",
      from: { data: stripes },
      interactive: false,
      encode: {
        update: {
          x: { signal: `${strip} + datum.x` },
          width: { value: 3 },
          y: { signal: `(datum.rank - 1) * ${ROW} + ${(ROW - CHIP) / 2} + datum.band * ${CHIP} / length(datum.actors)` },
          height: { signal: `${CHIP} / length(datum.actors)` },
          fill: { scale: unit.actor, field: "actor" },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: visible },
      interactive: false,
      encode: { update: { x: { signal: `${strip} + datum.x + 10` }, y: row(ROW / 2), text: { field: "text" }, opacity: dim(unit) } },
    },
    {
      type: "text",
      from: { data: more },
      interactive: false,
      style: "faint",
      encode: {
        update: {
          x: { signal: `${strip} + datum.x + 2` },
          y: row(ROW / 2),
          text: { signal: "'+' + (datum.count - datum.index)" },
          fontSize: { value: config.size },
        },
      },
    },
    band(unit, "rest", rest, `length(data(${literal(shown)})) * ${ROW} + 1`, ROW - 2, width, restTip),
    {
      type: "text",
      from: { data: rest },
      interactive: false,
      style: "faint",
      encode: {
        update: {
          x: { value: strip },
          y: { signal: `length(data(${literal(shown)})) * ${ROW} + ${ROW / 2}` },
          text: {
            signal: `'+' + ${plural(`(length(data(${literal(all)})) - ${limit})`, "more variant")} + ' · ' + ${plural(`(${sum(count, (group) => `datum.n${group}`)})`, "run")}`,
          },
        },
      },
    },
  ];

  const chipFields = ["text", "actors", "failed", "w"];
  const prefix = (frame: [null, number]): Transforms => ({
    type: "window",
    groupby: ["variant"],
    sort: { field: "index" },
    ops: ["min"],
    fields: ["ok"],
    as: [frame[1] ? "before" : "shown"],
    frame,
    ignorePeers: true,
  });

  return part({
    data: [
      ...runs.data,
      { name: name("layouts"), values: layouts },
      table(name("reserves"), reserves),
      {
        name: all,
        source: corpus.active,
        transform: [
          ...weigh(corpus),
          ...tally(corpus, ["variant"]),
          { type: "lookup", from: corpus.table("variants"), key: "variant", fields: ["variant"], values: ["label", "length"], as: ["label", "steps"] },
          { type: "window", sort: order, ops: ["row_number"], as: ["rank"] },
        ],
      },
      ...ranked(corpus, corpus.active, all, "variant", limit),
      {
        name: chips,
        source: shown,
        transform: [
          { type: "lookup", from: name("layouts"), key: "variant", fields: ["variant"], values: ["count", ...chipFields] },
          { type: "flatten", fields: chipFields, index: "index" },
          { type: "formula", as: "span", expr: "datum.w + 8" },
          { type: "window", groupby: ["variant"], sort: { field: "index" }, ops: ["sum"], fields: ["span"], as: ["reach"] },
          { type: "formula", as: "x", expr: "datum.reach - datum.span" },
          { type: "formula", as: "end", expr: "datum.x + datum.w" },
          { type: "formula", as: "left", expr: "datum.count - datum.index - 1" },
          { type: "lookup", from: name("reserves"), key: "left", fields: ["left"], values: ["reserve"], default: 0 },
          { type: "formula", as: "ok", expr: `datum.end + datum.reserve <= ${room} ? 1 : 0` },
          prefix([null, 0]),
          prefix([null, -1]),
        ],
      },
      { name: visible, source: chips, transform: [{ type: "filter", expr: "datum.shown" }] },
      { name: more, source: chips, transform: [{ type: "filter", expr: "!datum.shown && datum.before !== 0" }] },
      {
        name: spans,
        source: visible,
        transform: [
          {
            type: "aggregate",
            groupby: ["variant", "rank"],
            fields: ["end", ...(unit.highlight ? ["matching"] : [])],
            ops: ["max", ...(unit.highlight ? ["max" as const] : [])],
            as: ["end", ...(unit.highlight ? ["matching"] : [])],
          },
        ],
      },
      { name: stripes, source: visible, transform: [{ type: "flatten", fields: ["actors"], as: ["actor"], index: "band" }] },
    ],
    signals: [...runs.signals, { name: height, update: `max(${ROW}, (length(data(${literal(shown)})) + length(data(${literal(rest)}))) * ${ROW})` }],
    scales: [
      {
        name: scale,
        type: "linear",
        domain: { data: shown, fields: Array.from({ length: count }, (_, group) => `s${group}`) },
        range: [0, BAR],
        zero: true,
        nice: false,
      },
      ...swatches(corpus).scales,
    ],
    legends: swatches(corpus).legends,
    marks,
    width,
    height,
    actors: [...new Set(layouts.flatMap((layout) => layout.actors.flat()))],
    subtitle: subtitle(corpus),
    selectable: [unit.mark("variant"), unit.mark("rest")],
  });
}
