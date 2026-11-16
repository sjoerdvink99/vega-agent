import type { Data, Mark, Transforms } from "vega";
import { subtitle, tally, weigh } from "../compile/corpus";
import { first, fit, literal } from "../compile/expr";
import { follows, labelColor } from "../compile/follows";
import { tooltip } from "../compile/tooltip";
import { dim, part, type Part, type Unit } from "../compile/unit";
import { measure, mix, SMALL } from "../config";
import type { GraphSpec } from "../spec";

const NODE = 22;
const GAP = 28;
const ARC = 150;
const CHIP = 180;

export function graph(unit: Unit<GraphSpec>): Part {
  const { config, name, width } = unit;
  const model = follows(unit, unit.spec.limit ?? 16);
  const corpus = model.scope;
  const [nodes, arcs, reach, edges, incoming, outgoing, visited, color] = ["nodes", "arcs", "reach", "edges", "incoming", "outgoing", "visited", "color"].map(
    name,
  );
  const [step, above, below, peak] = [name("step"), name("above"), name("below"), name("peak")];
  const chip = (text: string) => Math.min(CHIP, measure(text, SMALL, config) + 16);
  const count = model.byLevel((activities) => activities.length);
  const widest = model.byLevel((activities) => Math.max(0, ...activities.map((activity) => chip(activity.name))));
  const strength = `min(1, abs(datum.value) / ${peak})`;
  const d2 = config.diverging[2];
  const center = (order: string) => `(${order} + 0.5) * ${step}`;
  const position = (field: string, as: string): Transforms => ({
    type: "lookup",
    from: nodes,
    key: "name",
    fields: [field],
    values: ["order", "w"],
    as: [as, `${as}w`],
  });
  const paths: Transforms[] = [
    { type: "formula", as: "x1", expr: center("datum.a") },
    { type: "formula", as: "x2", expr: center("datum.b") },
    { type: "formula", as: "top", expr: above },
    { type: "formula", as: "bottom", expr: `${above} + ${NODE}` },
    { type: "formula", as: "middle", expr: `${above} + ${NODE / 2}` },
    { type: "formula", as: "start", expr: `datum.x1 + min(datum.aw, ${step} - 8) / 2` },
    { type: "formula", as: "end", expr: `datum.x2 - min(datum.bw, ${step} - 8) / 2` },
    {
      type: "formula",
      as: "path",
      expr: [
        "datum.kind === 'next' ? 'M' + datum.start + ',' + datum.middle + ' H' + datum.end",
        "datum.kind === 'self' ? 'M' + (datum.x1 - 6) + ',' + datum.bottom + ' C' + (datum.x1 - 16) + ',' + (datum.bottom + 24) + ' ' + (datum.x1 + 16) + ',' + (datum.bottom + 24) + ' ' + (datum.x1 + 6) + ',' + datum.bottom",
        "datum.kind === 'forward' ? 'M' + datum.x1 + ',' + datum.top + ' C' + datum.x1 + ',' + (datum.top - datum.lift) + ' ' + datum.x2 + ',' + (datum.top - datum.lift) + ' ' + datum.x2 + ',' + datum.top",
        "'M' + datum.x1 + ',' + datum.bottom + ' C' + datum.x1 + ',' + (datum.bottom + datum.lift) + ' ' + datum.x2 + ',' + (datum.bottom + datum.lift) + ' ' + datum.x2 + ',' + datum.bottom",
      ].join(" : "),
    },
    {
      type: "formula",
      as: "head",
      expr: [
        "datum.kind === 'next' ? 'M' + (datum.end - 6) + ',' + (datum.middle - 3) + ' L' + datum.end + ',' + datum.middle + ' L' + (datum.end - 6) + ',' + (datum.middle + 3)",
        "datum.kind === 'self' ? 'M' + (datum.x1 + 3) + ',' + (datum.bottom + 6) + ' L' + (datum.x1 + 6) + ',' + datum.bottom + ' L' + (datum.x1 + 10) + ',' + (datum.bottom + 5)",
        "datum.kind === 'forward' ? 'M' + (datum.x2 - 3) + ',' + (datum.top - 6) + ' L' + datum.x2 + ',' + datum.top + ' L' + (datum.x2 + 3) + ',' + (datum.top - 6)",
        "'M' + (datum.x2 - 3) + ',' + (datum.bottom + 6) + ' L' + datum.x2 + ',' + datum.bottom + ' L' + (datum.x2 + 3) + ',' + (datum.bottom + 6)",
      ].join(" : "),
    },
  ];
  const visits = (key: "to" | "from", only: string | null): Transforms[] => [
    ...(only ? [{ type: "filter" as const, expr: `datum.${key} === ${literal(only)}` }] : []),
    { type: "aggregate", groupby: [key, "run", "id", "group"], fields: ["times"], ops: ["sum"], as: ["times"] },
    { type: "formula", as: "node", expr: `datum.${key}` },
    ...weigh(corpus, ["times"]),
    ...tally(corpus, ["node"], ["times"]),
  ];
  const stats: Data[] = [
    { name: incoming, source: name("pairs"), transform: visits("to", null) },
    { name: outgoing, source: name("pairs"), transform: visits("from", "start") },
    { name: visited, source: [incoming, outgoing] },
  ];
  const quiet = "datum.kind !== 'step'";
  const nodeTip = tooltip(unit, "datum.name", model.fields);

  const marks: Mark[] = [
    {
      type: "path",
      name: unit.mark("pair"),
      from: { data: edges },
      sort: { field: "datum.magnitude", order: "descending" },
      encode: {
        update: {
          path: { field: "path" },
          stroke: { value: config.ink },
          strokeOpacity: { value: 0 },
          strokeWidth: { signal: `9 + 6 * ${strength}` },
          ...tooltip(unit, "datum.from + ' → ' + datum.to", model.fields),
        },
      },
    },
    {
      type: "path",
      from: { data: edges },
      interactive: false,
      sort: { field: "datum.magnitude", order: "descending" },
      encode: {
        update: {
          path: { field: "path" },
          stroke: { scale: color, field: "value" },
          strokeWidth: { signal: `1 + 6 * ${strength}` },
          strokeCap: { value: "round" },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "path",
      from: { data: edges },
      interactive: false,
      encode: {
        update: {
          path: { field: "head" },
          stroke: { scale: color, field: "value" },
          strokeWidth: { value: 1.4 },
          strokeCap: { value: "round" },
          strokeJoin: { value: "round" },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "rect",
      name: unit.mark("node"),
      from: { data: nodes },
      encode: {
        update: {
          x: { signal: `${center("datum.order")} - min(datum.w, ${step} - 8) / 2` },
          width: { signal: `min(datum.w, ${step} - 8)` },
          y: { signal: above },
          height: { value: NODE },
          cornerRadius: { value: 5 },
          fill: { signal: `${quiet} ? ${literal(config.background)} : scale(${literal(unit.actor)}, datum.actor)` },
          fillOpacity: { signal: `${quiet} ? 1 : 0.14` },
          stroke: { signal: `datum.failed ? ${literal(config.fail)} : ${quiet} ? ${literal(config.faint)} : scale(${literal(unit.actor)}, datum.actor)` },
          strokeWidth: { signal: "datum.failed ? 1.6 : 1.2" },
          opacity: dim(unit),
          ...nodeTip,
        },
        hover: { fillOpacity: { signal: `${quiet} ? 1 : 0.3` } },
      },
    },
    {
      type: "text",
      from: { data: nodes },
      interactive: false,
      encode: {
        update: {
          x: { signal: center("datum.order") },
          y: { signal: `${above} + ${NODE / 2}` },
          text: { signal: fit("datum.name", `min(datum.w, ${step} - 8) - 10`, SMALL, config.advance) },
          fontSize: { value: SMALL },
          align: { value: "center" },
          fill: { signal: labelColor(unit, "datum.name") },
          opacity: dim(unit),
        },
      },
    },
  ];

  return part({
    data: [
      ...model.data,
      ...stats,
      {
        name: nodes,
        source: name("activities"),
        transform: [
          { type: "formula", as: "w", expr: `min(${CHIP}, length(datum.name) * ${SMALL * config.advance} + 16)` },
          { type: "lookup", from: visited, key: "node", fields: ["name"], values: [...model.measures, "ids", ...(unit.highlight ? ["matching"] : [])] },
          { type: "filter", expr: "isValid(datum.ids)" },
        ],
      },
      {
        name: arcs,
        source: name("follows"),
        transform: [
          position("from", "a"),
          position("to", "b"),
          { type: "formula", as: "kind", expr: "datum.from === datum.to ? 'self' : datum.b === datum.a + 1 ? 'next' : datum.b > datum.a ? 'forward' : 'back'" },
          { type: "formula", as: "lift", expr: `min(${ARC}, 16 + 0.3 * abs(datum.b - datum.a) * ${step})` },
          { type: "formula", as: "magnitude", expr: "abs(datum.value)" },
        ],
      },
      {
        name: reach,
        source: arcs,
        transform: [
          { type: "formula", as: "up", expr: "datum.kind === 'forward' ? 0.75 * datum.lift : 0" },
          { type: "formula", as: "down", expr: "datum.kind === 'self' ? 22 : datum.kind === 'back' ? 0.75 * datum.lift : 0" },
          { type: "aggregate", fields: ["up", "down"], ops: ["max", "max"], as: ["up", "down"] },
        ],
      },
      { name: edges, source: arcs, transform: paths },
    ],
    signals: [
      ...model.signals,
      { name: step, update: `max(${width} / max(1, ${count}), ${widest} + ${GAP})` },
      { name: above, update: `${first(reach, { up: 0, down: 0 })}.up + 8` },
      { name: below, update: `${first(reach, { up: 0, down: 0 })}.down + 8` },
    ],
    scales: [model.color(color, [mix(config.faint, d2, 0.25), d2])],
    legends: [model.legend("stroke", color, "forward above, back below")],
    marks,
    width: `${step} * ${count}`,
    height: `${above} + ${NODE} + ${below}`,
    actors: [...new Set(model.activities.flatMap((activity) => (activity.actor ? [activity.actor] : [])))],
    subtitle: subtitle(corpus),
    selectable: [unit.mark("pair"), unit.mark("node")],
  });
}
