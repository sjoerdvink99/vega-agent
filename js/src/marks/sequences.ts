import type { Mark } from "vega";
import { base, scopeOf, subtitle } from "../compile/corpus";
import { duration, fit, literal } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { band, dim, membership, part, type Part, type Unit } from "../compile/unit";
import { SMALL } from "../config";
import { hits } from "../data/corpus";
import { byVariant, clockOf, labelOf, type RunRow } from "../data/tables";
import type { SequencesSpec } from "../spec";

const ROW = 16;
const CELL = 10;
const LABEL = 96;

type Placed = { run: RunRow; members: string[] };

function modal(members: { run: RunRow; key: string }[]): RunRow {
  const counts = new Map<string, number>();
  for (const { key } of members) counts.set(key, (counts.get(key) ?? 0) + 1);
  return members.reduce((best, each) => ((counts.get(each.key) ?? 0) > (counts.get(best.key) ?? 0) ? each : best)).run;
}

function representatives(runs: RunRow[], labels: Map<number, string>, rows: number): Placed[] {
  if (runs.length <= rows) return runs.map((run) => ({ run, members: [run.id] }));
  const sorted = runs.map((run) => ({ run, key: labels.get(run.full) ?? "" })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return Array.from({ length: rows }, (_, index) => {
    const members = sorted.slice(Math.floor((index * sorted.length) / rows), Math.floor(((index + 1) * sorted.length) / rows));
    return { run: modal(members), members: members.map((member) => member.run.id) };
  });
}

export function sequences(unit: Unit<SequencesSpec>): Part {
  const { spec, config, name, width } = unit;
  const corpus = scopeOf(unit);
  const { groups: count } = corpus;
  const compare = count > 1;
  const timed = spec.x === "time";
  const query = typeof spec.highlight === "string" ? spec.highlight : null;
  const per = Math.max(1, Math.floor((spec.limit ?? 50) / count));
  const runs = base(corpus);
  const [rows, cells, headers, height, x, y] = ["rows", "cells", "headers", "chartHeight", "x", "y"].map(name);

  const { runs: table, tokens, steps, times } = corpus.corpus.tables;
  const labels = new Map([...byVariant(tokens)].map(([variant, items]) => [variant, items.map((item) => item.token).join(" -> ")]));
  const stepsOf = byVariant(steps);
  const clocks = clockOf(times);
  const hitsOf = query ? hits(corpus.corpus, query) : null;
  const groupOf = (run: RunRow) => corpus.corpus.groups.indexOf(run.group ?? "runs");
  const placed = Array.from({ length: count }, (_, group) =>
    representatives(
      table.filter((run) => groupOf(run) === group),
      labels,
      per,
    ),
  ).flat();
  const rowValues = placed.map(({ run, members: ids }, order) => {
    const found = stepsOf.get(run.full) ?? [];
    return { key: String(order), order, group: groupOf(run), run: run.id, ids, steps: found.length, failed: found.filter((step) => step.failed).length };
  });
  const cellValues = placed.flatMap(({ run }, order) => {
    const matched = new Set(hitsOf?.get(run.full) ?? []);
    const clock = clocks.get(run.run);
    return (stepsOf.get(run.full) ?? []).flatMap((step) => {
      const span = timed ? clock?.get(step.index) : { start: step.index, end: step.index + 1 };
      if (!span) return [];
      const { start, end } = span;
      return [
        { key: String(order), run: run.id, start, end, actor: step.actor, failed: step.failed, hit: !hitsOf || matched.has(step.index), label: labelOf(step) },
      ];
    });
  });
  const span = cellValues.reduce((most, cell) => Math.max(most, cell.end), 0) || 1;
  const grouped = rowValues.filter((row) => row.ids.length > 1);
  const linked = membership(
    unit,
    "rows",
    rowValues.flatMap((row) => row.ids.map((id) => ({ key: row.key, id }))),
  );
  const room = `max(40, ${width} - ${LABEL})`;
  const gap = timed ? "0" : `min(2, ${room} / ${span} * 0.2)`;
  const slot = compare ? " + datum.group + 1" : "";
  const top = (offset: number) => ({ signal: `(datum.index - 1${slot}) * ${ROW} + ${offset}` });
  const format = (value: string) => (timed ? duration(value) : `'' + ${value}`);

  const marks: Mark[] = [
    ...(compare
      ? [
          {
            type: "text",
            from: { data: headers },
            interactive: false,
            encode: {
              update: {
                x: { value: 0 },
                y: { signal: `(datum.first - 1 + datum.group) * ${ROW} + ${ROW / 2 + 2}` },
                text: { signal: `${literal(corpus.corpus.groups)}[datum.group]` },
                fontSize: { value: SMALL },
                fontWeight: { value: 600 },
              },
            },
          } satisfies Mark,
        ]
      : []),
    band(
      unit,
      "run",
      rows,
      top(0).signal,
      ROW,
      `${LABEL} + ${room}`,
      tooltip(unit, "datum.run", {
        runs: "length(datum.ids) > 1 ? '' + length(datum.ids) : ''",
        steps: "'' + datum.steps",
        failed: "'' + datum.failed",
      }),
    ),
    {
      type: "text",
      from: { data: rows },
      interactive: false,
      style: "muted",
      encode: { update: { x: { value: 0 }, y: top(ROW / 2), text: { signal: fit("datum.run", `${LABEL - 10}`, SMALL, config.advance) }, opacity: dim(unit) } },
    },
    {
      type: "rect",
      name: unit.mark("cell"),
      from: { data: cells },
      encode: {
        update: {
          x: { scale: x, field: "start" },
          width: { signal: `max(0.5, scale(${literal(x)}, datum.end) - scale(${literal(x)}, datum.start) - ${gap})` },
          y: top((ROW - CELL) / 2),
          height: { value: CELL },
          cornerRadius: { value: 2 },
          fill: { signal: `datum.failed ? ${literal(config.fail)} : scale(${literal(unit.actor)}, datum.actor)` },
          opacity: unit.highlight ? { signal: `(${unit.highlight.active} && !datum.matching) || !datum.hit ? 0.18 : 0.9` } : { value: 0.9 },
          ...tooltip(unit, "datum.label", {
            run: "datum.run",
            ...(timed ? { start: format("datum.start"), duration: format("datum.end - datum.start") } : { step: format("datum.start") }),
          }),
        },
      },
    },
    ...(grouped.length
      ? [
          {
            type: "text" as const,
            interactive: false,
            style: "faint",
            encode: {
              update: {
                x: { value: 0 },
                y: { signal: `${height} + 10` },
                text: {
                  value: `each row stands for about ${Math.round(grouped.reduce((sum, row) => sum + row.ids.length, 0) / grouped.length)} similar runs and shows the most common of them`,
                },
                fontSize: { value: 10 },
              },
            },
          },
        ]
      : []),
  ];

  return part({
    data: [
      ...runs.data,
      ...linked.data,
      {
        name: rows,
        values: rowValues,
        transform: [...linked.transforms, { type: "window", sort: { field: "order" }, ops: ["row_number"], as: ["index"] }],
      },
      {
        name: cells,
        values: cellValues,
        transform: [
          { type: "lookup", from: rows, key: "key", fields: ["key"], values: ["index", "group", "ids", ...(unit.highlight ? ["matching"] : [])] },
          { type: "filter", expr: "datum.index != null" },
        ],
      },
      ...(compare
        ? [
            {
              name: headers,
              source: rows,
              transform: [{ type: "aggregate" as const, groupby: ["group"], fields: ["index"], ops: ["min" as const], as: ["first"] }],
            },
          ]
        : []),
    ],
    signals: [
      ...runs.signals,
      { name: height, update: `max(${ROW}, (length(data(${literal(rows)}))${compare ? ` + length(data(${literal(headers)}))` : ""}) * ${ROW} + 4)` },
    ],
    scales: [
      { name: x, type: "linear", domain: [0, span], range: [LABEL, { signal: `${LABEL} + ${room}` }], zero: true, nice: false },
      { name: y, type: "linear", domain: [0, 1], range: [0, { signal: height }] },
    ],
    axes: [
      {
        scale: x,
        orient: "top",
        gridScale: y,
        tickCount: { signal: `max(2, floor(${room} / 90))` },
        ...(timed ? {} : { tickMinStep: 1 }),
        encode: { labels: { update: { text: { signal: format("datum.value") } } } },
      },
    ],
    marks,
    width: `${LABEL} + ${room}`,
    height,
    actors: [...new Set(cellValues.map((cell) => cell.actor))],
    subtitle: subtitle(corpus),
    selectable: [unit.mark("run"), unit.mark("cell")],
  });
}
