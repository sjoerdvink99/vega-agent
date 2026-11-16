import { subtitle } from "../compile/corpus";
import { follows, labelColor } from "../compile/follows";
import { tooltip } from "../compile/tooltip";
import { dim, part, type Part, type Unit } from "../compile/unit";
import { measure, mix, SMALL } from "../config";
import type { TransitionsSpec } from "../spec";

const LABEL = 180;

export function transitions(unit: Unit<TransitionsSpec>): Part {
  const { config, name, width } = unit;
  const model = follows(unit, unit.spec.limit ?? 16);
  const [x, y, color, cell] = [name("x"), name("y"), name("color"), name("cell")];
  const columns = model.byLevel((activities) => activities.filter((activity) => activity.kind !== "start").length);
  const rows = model.byLevel((activities) => activities.filter((activity) => activity.kind !== "end").length);
  const left = model.byLevel((activities) => Math.min(LABEL, Math.max(0, ...activities.map((activity) => measure(activity.name, SMALL, config)))) + 12);
  return part({
    data: [
      ...model.data,
      { name: name("columns"), source: name("activities"), transform: [{ type: "filter", expr: "datum.kind !== 'start'" }] },
      { name: name("rows"), source: name("activities"), transform: [{ type: "filter", expr: "datum.kind !== 'end'" }] },
    ],
    signals: [...model.signals, { name: cell, update: `max(12, min(28, floor((${width} - ${left}) / max(1, ${columns}))))` }],
    scales: [
      {
        name: x,
        type: "band",
        domain: { data: name("columns"), field: "name", sort: { field: "order", op: "min" } },
        range: [0, { signal: `${cell} * ${columns}` }],
      },
      {
        name: y,
        type: "band",
        domain: { data: name("rows"), field: "name", sort: { field: "order", op: "min" } },
        range: [0, { signal: `${cell} * ${rows}` }],
      },
      model.color(color, [mix(config.diverging[1], config.diverging[2], 0.12), config.diverging[2]]),
    ],
    axes: [
      {
        scale: x,
        orient: "top",
        gridScale: y,
        bandPosition: 0,
        labelAngle: -90,
        labelAlign: "left",
        labelBaseline: "middle",
        labelLimit: LABEL,
        labelFontSize: SMALL,
        encode: { labels: { update: { fill: { signal: labelColor(unit, "datum.value") } } } },
      },
      {
        scale: y,
        orient: "left",
        gridScale: x,
        bandPosition: 0,
        labelLimit: LABEL,
        labelFontSize: SMALL,
        encode: { labels: { update: { fill: { signal: labelColor(unit, "datum.value") } } } },
      },
    ],
    legends: [model.legend("fill", color)],
    marks: [
      {
        type: "rect",
        name: unit.mark("pair"),
        from: { data: name("follows") },
        encode: {
          update: {
            x: { scale: x, field: "to", offset: 1 },
            width: { scale: x, band: 1, offset: -2 },
            y: { scale: y, field: "from", offset: 1 },
            height: { scale: y, band: 1, offset: -2 },
            cornerRadius: { value: 2 },
            fill: { scale: color, field: "value" },
            stroke: { value: config.line },
            opacity: dim(unit),
            ...tooltip(unit, "datum.from + ' → ' + datum.to", model.fields),
          },
          hover: { stroke: { value: config.ink }, strokeWidth: { value: 1.5 } },
        },
      },
    ],
    width: `${cell} * ${columns}`,
    height: `${cell} * ${rows}`,
    actors: [...new Set(model.activities.flatMap((activity) => (activity.actor ? [activity.actor] : [])))],
    subtitle: subtitle(model.scope),
    selectable: [unit.mark("pair")],
  });
}
