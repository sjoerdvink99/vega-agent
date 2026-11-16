import type { Mark } from "vega";
import { base, hues, joined, ranked, scopeOf, shares, stepsAt, subtitle, swatches, tally, weigh } from "../compile/corpus";
import { each, fit, fixed, literal, percent, plural } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { band, dim, part, type Part, type Unit } from "../compile/unit";
import { measure } from "../config";
import type { ActivitiesSpec } from "../spec";

const BAR = 8;
const LABEL = 200;
const SPACING = 6;

export function activities(unit: Unit<ActivitiesSpec>): Part {
  const { spec, config, name, width } = unit;
  const corpus = scopeOf(unit);
  const { groups: count } = corpus;
  const compare = count > 1;
  const limit = spec.limit ?? 16;
  const runs = base(corpus);
  const [uses, all, shown, rest, height] = [name("uses"), name("activities"), name("shown"), name("rest"), name("chartHeight")];
  const { steps } = corpus.corpus.tables;
  const failures = steps.some((step) => step.failed);
  const caption = (group: number) =>
    `${percent(`datum.s${group}`)} + ' of runs · ' + ${fixed(`datum.uses_rate${group}`, 1)} + ' per run' + (datum.failed${group} ? ' · ' + ${percent(`datum.failed_rate${group}`)} + ' failed' : '')`;
  const text = measure(`100% of runs · 99.9 per run${failures ? " · 100% failed" : ""}`, 10, config) + 10;
  const left = `min(${LABEL}, ${width} * 0.3)`;
  const bar = `max(60, ${width} - ${left} - ${text})`;
  const h = compare ? 2 * BAR + 10 : BAR + 12;
  const top = (offset: number | string) => ({ signal: `(datum.rank - 1) * ${h + SPACING} + ${offset}` });
  const tip = tooltip(unit, "datum.activity", {
    ...shares(corpus),
    rate: each(count, (group) => fixed(`datum.uses_rate${group}`, 1)),
    ...(failures ? { failed: each(count, (group) => percent(`datum.failed_rate${group}`)) } : {}),
  });

  const groupMarks = Array.from({ length: count }, (_, group): Mark[] => {
    const y = compare ? 4 + group * (BAR + 2) : (h - BAR) / 2;
    const rect = (span: string, fill: Record<string, unknown>): Mark => ({
      type: "rect",
      from: { data: shown },
      interactive: false,
      encode: {
        update: { x: { signal: left }, width: { signal: span }, y: top(y), height: { value: BAR }, cornerRadius: { value: 1.5 }, ...fill, opacity: dim(unit) },
      },
    });
    return [
      rect(bar, { fill: { value: config.panel } }),
      rect(
        `datum.s${group} > 0 ? max(1, datum.s${group} * ${bar}) : 0`,
        compare ? { fill: { value: hues(corpus)[group] } } : { fill: { scale: unit.actor, field: "actor" }, fillOpacity: { value: 0.7 } },
      ),
      rect(`datum.failed${group} ? max(1, datum.failed_rate${group} * ${bar}) : 0`, { fill: { value: config.fail } }),
      {
        type: "text",
        from: { data: shown },
        interactive: false,
        style: "muted",
        encode: {
          update: {
            x: { signal: `${left} + ${bar} + 10` },
            y: top(y + BAR / 2),
            text: { signal: caption(group) },
            fontSize: { value: 10 },
            opacity: dim(unit),
          },
        },
      },
    ];
  }).flat();

  const marks: Mark[] = [
    band(unit, "activity", shown, top(0).signal, h, width, tip),
    {
      type: "rect",
      from: { data: shown },
      interactive: false,
      encode: {
        update: {
          x: { value: 0 },
          width: { value: 3 },
          y: top((h - 16) / 2),
          height: { value: 16 },
          cornerRadius: { value: 1 },
          fill: { scale: unit.actor, field: "actor" },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: shown },
      interactive: false,
      encode: {
        update: { x: { value: 10 }, y: top(h / 2), text: { signal: fit("datum.activity", `${left} - 16`, config.size, config.advance) }, opacity: dim(unit) },
      },
    },
    ...groupMarks,
    band(
      unit,
      "rest",
      rest,
      `length(data(${literal(shown)})) * ${h + SPACING}`,
      h,
      width,
      tooltip(unit, plural(`length(data(${literal(all)})) - ${limit}`, "more step"), { runs: "'' + length(datum.ids)" }),
    ),
    {
      type: "text",
      from: { data: rest },
      interactive: false,
      style: "faint",
      encode: {
        update: {
          x: { signal: left },
          y: { signal: `length(data(${literal(shown)})) * ${h + SPACING} + ${h / 2}` },
          text: { signal: `'+' + (length(data(${literal(all)})) - ${limit}) + ' more'` },
        },
      },
    },
    ...(compare
      ? []
      : [
          {
            type: "text" as const,
            interactive: false,
            style: "faint",
            encode: {
              update: {
                x: { value: 0 },
                y: { signal: `${height} + 14` },
                text: { value: "share of runs that use the step; red: share where it failed" },
                fontSize: { value: 10 },
              },
            },
          },
        ]),
  ];

  return part({
    data: [
      ...runs.data,
      stepsAt(corpus, "used", [
        { type: "aggregate", groupby: ["variant", "activity", "actor"], fields: ["index", "fail"], ops: ["count", "max"], as: ["uses", "failed"] },
      ]),
      ...joined(corpus, "uses", name("used"), ["activity", "actor", "uses", "failed"], { by: "full", then: weigh(corpus, ["uses", "failed"]) }),
      {
        name: all,
        source: uses,
        transform: [
          ...tally(corpus, ["activity", "actor"], ["uses", "failed"]),
          { type: "window", sort: { field: ["size", "activity"], order: ["descending", "ascending"] }, ops: ["row_number"], as: ["rank"] },
        ],
      },
      ...ranked(corpus, uses, all, "activity", limit),
    ],
    signals: [
      ...runs.signals,
      { name: height, update: `max(${h}, (length(data(${literal(shown)})) + length(data(${literal(rest)}))) * ${h + SPACING} - ${SPACING})` },
    ],
    ...swatches(corpus),
    marks,
    width,
    height,
    actors: [...new Set(steps.map((step) => step.actor))],
    subtitle: subtitle(corpus),
    selectable: [unit.mark("activity"), unit.mark("rest")],
  });
}
