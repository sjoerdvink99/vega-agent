import { base, divergence, scopeOf, shares, subtitle, table, tally, weigh } from "../compile/corpus";
import { literal } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { dim, part, type Part, type Unit } from "../compile/unit";
import { tint } from "../config";
import { project } from "../data/projection";
import { byVariant, LEVELS } from "../data/tables";
import type { ProjectionSpec } from "../spec";

const HEIGHT = 300;
const MARGIN = 1.12;

export function projection(unit: Unit<ProjectionSpec>): Part {
  const { spec, config, name, width } = unit;
  const corpus = scopeOf(unit);
  const compare = corpus.groups > 1;
  const height = spec.height ?? HEIGHT;
  const runs = base(corpus);
  const [points, counted, x, y, size] = [name("points"), name("counted"), name("x"), name("y"), name("size")];
  const { variants: rows, tokens } = corpus.corpus.tables;
  const tokensOf = byVariant(tokens);
  const values = LEVELS.flatMap((level) => {
    const items = rows.filter((row) => row.level === level);
    const placed = project(items.map(({ variant }) => ({ variant, words: (tokensOf.get(variant) ?? []).map((row) => row.token) })));
    return items.map(({ variant, label, length }) => {
      const [px, py] = placed.get(variant) ?? [0, 0];
      return { variant, x: px, y: py, label, steps: length, failed: (tokensOf.get(variant) ?? []).some((row) => row.failed) };
    });
  });
  const contrast = divergence(corpus);
  const tip = tooltip(unit, "datum.label || 'empty'", {
    ...shares(corpus),
    steps: "'' + datum.steps",
    failed: "datum.failed ? 'yes' : ''",
  });
  const fill = compare ? { scale: name("color"), field: "difference" } : { value: tint(config, config.rail, 0.55) };

  return part({
    data: [
      ...runs.data,
      table(points, values),
      {
        name: counted,
        source: corpus.active,
        transform: [
          ...weigh(corpus),
          ...tally(corpus, ["variant"]),
          { type: "lookup", from: points, key: "variant", fields: ["variant"], values: ["x", "y", "label", "steps", "failed"] },
          { type: "window", sort: { field: ["size", "variant"], order: ["descending", "ascending"] }, ops: ["row_number"], as: ["rank"] },
        ],
      },
    ],
    signals: runs.signals,
    scales: [
      ...contrast.scales,
      { name: x, type: "linear", domain: [-MARGIN, MARGIN], range: [0, { signal: width }], zero: false, nice: false },
      { name: y, type: "linear", domain: [-MARGIN, MARGIN], range: [height, 0], zero: false, nice: false },
      { name: size, type: "sqrt", domain: { data: counted, field: "size" }, range: [24, 1200], zero: true },
    ],
    legends: contrast.legends,
    marks: [
      {
        type: "rect",
        interactive: false,
        encode: {
          update: {
            x: { value: 0 },
            width: { signal: width },
            y: { value: 0 },
            height: { value: height },
            cornerRadius: { value: 4 },
            fill: { value: config.panel },
            fillOpacity: { value: 0.5 },
          },
        },
      },
      {
        type: "symbol",
        name: unit.mark("point"),
        from: { data: counted },
        encode: {
          update: {
            x: { scale: x, field: "x" },
            y: { scale: y, field: "y" },
            size: { scale: size, field: "size" },
            shape: { value: "circle" },
            fill,
            fillOpacity: { value: 0.75 },
            stroke: { signal: `datum.failed ? ${literal(config.fail)} : ${literal(config.background)}` },
            strokeWidth: { value: 1.2 },
            opacity: dim(unit),
            zindex: { signal: "-datum.rank" },
            ...tip,
          },
          hover: { stroke: { value: config.ink } },
        },
      },
      {
        type: "text",
        interactive: false,
        style: "faint",
        encode: {
          update: {
            x: { value: 0 },
            y: { value: height + 14 },
            text: { value: "each point is a variant, placed by the steps and step pairs it shares with others; area: share of runs; hover to name it" },
            fontSize: { value: 10 },
          },
        },
      },
    ],
    width,
    height: height + 20,
    actors: [],
    subtitle: subtitle(corpus),
    selectable: [unit.mark("point")],
  });
}
