import type { Data, Mark, Transforms } from "vega";
import { scopeOf } from "../compile/corpus";
import { duration, fit, literal } from "../compile/expr";
import { actorsShown, focus, matched, ofVariant } from "../compile/focus";
import { tooltip } from "../compile/tooltip";
import { dim, part, type Part, type Unit } from "../compile/unit";
import { SMALL } from "../config";
import type { TimelineSpec } from "../spec";

const ROW = 17;

export function timeline(unit: Unit<TimelineSpec>): Part {
  const { spec, config, name, width } = unit;
  const agent = spec.lanes === "agent";
  const scope = scopeOf(unit);
  const [data, structure, owners, lanesData, extentData, x, y] = ["bars", "structure", "owners", "lanes", "extent", "x", "y"].map(name);
  const shown = focus(scope);
  const [count, span] = [name("laneCount"), name("span")];
  const labels = `min(200, ${width} * 0.28)`;
  const lanes: Transforms[] = agent
    ? [
        { type: "lookup", from: owners, key: "parent", fields: ["index"], values: ["parent"], as: ["opens"] },
        { type: "formula", as: "delegated", expr: "isValid(datum.opens)" },
        { type: "joinaggregate", groupby: ["parent"], fields: ["index"], ops: ["min"], as: ["first"] },
        { type: "window", sort: { field: "first" }, ops: ["dense_rank"], as: ["rank"] },
        { type: "formula", as: "lane", expr: "datum.rank - 1" },
      ]
    : [
        { type: "window", sort: { field: "index" }, ops: ["row_number"], as: ["row"] },
        { type: "formula", as: "lane", expr: "datum.row - 1" },
      ];
  const tip = tooltip(unit, "datum.label", {
    actor: "datum.actor",
    start: duration("datum.start"),
    end: duration("datum.end"),
    duration: duration("datum.end - datum.start"),
  });
  const bar = (thin: string) => ({
    x: { scale: x, field: "start" },
    width: { signal: `max(2, scale(${literal(x)}, datum.end) - scale(${literal(x)}, datum.start))` },
    y: { signal: `scale(${literal(y)}, datum.lane) + (${thin} ? ${ROW - 7} : 4)` },
    height: { signal: `${thin} ? 3 : ${ROW - 8}` },
    cornerRadius: { value: 2 },
    fill: { scale: unit.actor, field: "actor" },
    opacity: dim(unit, 0.88),
    stroke: { signal: `datum.failed ? ${literal(config.fail)} : null` },
    strokeWidth: { value: 1.6 },
  });
  const byStep: Mark[] = [
    {
      type: "rect",
      name: unit.mark("row"),
      from: { data },
      encode: {
        update: {
          x: { value: 0 },
          width: { signal: width },
          y: { scale: y, field: "lane" },
          height: { scale: y, band: 1 },
          fill: { value: config.ink },
          fillOpacity: { value: 0 },
          ...tip,
        },
      },
    },
    {
      type: "text",
      from: { data },
      interactive: false,
      encode: {
        update: {
          x: { signal: "6 + datum.depth * 12" },
          y: { scale: y, field: "lane", band: 0.5 },
          text: { signal: fit("datum.label", `${labels} - 14 - datum.depth * 12`, SMALL, config.advance) },
          fontSize: { value: SMALL },
          fill: { signal: `datum.failed ? ${literal(config.fail)} : ${literal(config.muted)}` },
          opacity: dim(unit),
        },
      },
    },
    { type: "rect", from: { data }, interactive: false, encode: { update: bar("false") } },
  ];
  const byAgent: Mark[] = [
    {
      type: "rule",
      from: { data: lanesData },
      interactive: false,
      encode: { update: { x: { value: 0 }, x2: { signal: width }, y: { scale: y, field: "lane", band: 1 }, stroke: { value: config.line } } },
    },
    {
      type: "text",
      from: { data: lanesData },
      interactive: false,
      style: "muted",
      encode: {
        update: { x: { value: 6 }, y: { scale: y, field: "lane", band: 0.5 }, text: { signal: fit("datum.label", `${labels} - 14`, SMALL, config.advance) } },
      },
    },
    { type: "rect", name: unit.mark("bar"), from: { data }, encode: { update: { ...bar("datum.delegated"), ...tip } } },
  ];
  const height = `${count} * ${ROW}`;
  return part({
    data: [
      ...shown.data,
      shown.timing,
      ofVariant(scope, shown, "structure", []),
      { name: owners, source: structure, transform: [{ type: "aggregate", groupby: ["parent"] }] },
      {
        name: data,
        source: structure,
        transform: [
          { type: "lookup", from: shown.timing.name, key: "index", fields: ["index"], values: ["begin", "finish"], as: ["start", "end"] },
          { type: "filter", expr: "isValid(datum.start)" },
          { type: "formula", as: "ids", expr: "['' + datum.index]" },
          ...lanes,
          ...matched(unit, shown),
        ],
      },
      { name: extentData, source: data, transform: [{ type: "aggregate", fields: ["end"], ops: ["max"], as: ["end"] }] },
      ...(agent
        ? [
            {
              name: lanesData,
              source: data,
              transform: [
                { type: "aggregate", groupby: ["lane", "parent"] },
                { type: "lookup", from: structure, key: "index", fields: ["parent"], values: ["label"], as: ["owner"] },
                { type: "formula", as: "label", expr: "isValid(datum.owner) ? datum.owner : 'main'" },
              ],
            } satisfies Data,
          ]
        : []),
    ],
    signals: [
      ...shown.signals,
      { name: count, update: `length(data(${literal(agent ? lanesData : data)}))` },
      { name: span, update: `(length(data(${literal(extentData)})) && data(${literal(extentData)})[0].end) || 1` },
    ],
    scales: [
      { name: x, type: "linear", domain: { signal: `[0, ${span}]` }, range: [{ signal: labels }, { signal: `${width} - 6` }], zero: true, nice: false },
      { name: y, type: "band", domain: { data: agent ? lanesData : data, field: "lane", sort: true }, range: [0, { signal: height }] },
    ],
    axes: [
      {
        scale: x,
        orient: "top",
        gridScale: y,
        tickCount: { signal: `max(2, floor((${width} - ${labels}) / 90))` },
        encode: { labels: { update: { text: { signal: duration("datum.value") } } } },
      },
    ],
    marks: agent ? byAgent : byStep,
    width,
    height: `${height} + 4`,
    actors: actorsShown(scope),
    selectable: [unit.mark(agent ? "bar" : "row")],
  });
}
