import type { Mark, Transforms } from "vega";
import { append } from "../collections";
import { scopeOf, table } from "../compile/corpus";
import { duration, fit, literal } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { band, dim, part, type Part, type Unit } from "../compile/unit";
import { measure, SMALL, type Config } from "../config";
import { ANY, byVariant, labelOf, type StepRow } from "../data/tables";
import type { Actor } from "../grammar/ast";
import { actorsShown, focus, matched } from "../compile/focus";
import type { HandoffsSpec } from "../spec";

const ROW = 22;
const HEAD = 22;
const TOP = HEAD + 10;
const ROOT = "run";

type Kind = "call" | "step" | "return";
type Event = { kind: Kind; from: string; to: string; step: StepRow };

const party = (step: StepRow) => (step.actor === "agent" || step.actor === "human" ? (step.name ? `${step.actor}.${step.name}` : step.actor) : null);

function events(rows: StepRow[]): Event[] {
  const inside = new Map<number, StepRow[]>();
  for (const row of rows) append(inside, row.parent, row);
  const found: Event[] = [];
  const visit = (parent: number, lane: string) => {
    for (const step of inside.get(parent) ?? []) {
      const other = party(step);
      if (!other) {
        found.push({ kind: "step", from: lane, to: lane, step });
        continue;
      }
      found.push({ kind: "call", from: lane, to: other, step });
      visit(step.index, other);
      found.push({ kind: "return", from: other, to: lane, step });
    }
  };
  visit(-1, ROOT);
  return found;
}

function layout(variant: number, rows: StepRow[], config: Config) {
  const found = events(rows);
  const owners = new Map<string, Actor>([
    [ROOT, ANY],
    ...found.flatMap((event): [string, Actor][] => (event.kind === "call" ? [[event.to, event.step.actor]] : [])),
  ]);
  const lanes = [...owners].map(([lane, actor], position) => ({ variant, lane, position, actor, text: measure(lane, SMALL, config) }));
  const messages = found.map(({ kind, from, to, step }, order) => ({
    variant,
    order,
    kind,
    from,
    to,
    index: kind === "return" ? -1 : step.index,
    label: kind === "return" ? "" : labelOf(step),
    actor: kind === "return" ? (owners.get(from) ?? ANY) : step.actor,
    failed: kind !== "return" && step.failed,
    ids: kind === "return" ? [] : [String(step.index)],
  }));
  return { messages, lanes };
}

export function handoffs(unit: Unit<HandoffsSpec>): Part {
  const { config, name, width } = unit;
  const scope = scopeOf(unit);
  const shown = focus(scope);
  const { runs, steps, times } = scope.corpus.tables;
  const stepsOf = byVariant(steps);
  const shownVariants = runs.length ? [...new Set((unit.filter ? runs : runs.slice(0, 1)).map((run) => run.full))] : [-1];
  const laid = shownVariants.map((variant) => layout(variant, stepsOf.get(variant) ?? [], config));
  const timed = times.length > 0;
  const [data, x, heads, count, lifelines] = [name("messages"), name("x"), name("lanes"), name("messageCount"), name("lifelines")];
  const showing: Transforms = { type: "filter", expr: `datum.variant === ${shown.variant}` };
  const column = (field: string) => `scale(${literal(x)}, ${field})`;
  const [from, to] = [column("datum.from"), column("datum.to")];
  const y = (offset = 0) => ({ signal: `${TOP} + datum.order * ${ROW} + ${ROW / 2 + offset}` });
  const step = "datum.kind === 'step'";
  const color = `scale(${literal(unit.actor)}, datum.actor)`;
  const ink = { signal: `datum.failed ? ${literal(config.fail)} : ${color}` };
  const room = `${width} / max(1, ${lifelines})`;
  const tip = tooltip(unit, `datum.kind === 'return' ? 'back to ' + datum.to : datum.label`, {
    actor: "datum.kind === 'return' ? '' : datum.actor",
    from: "datum.from",
    ...(timed ? { start: duration("datum.start"), duration: duration("datum.end - datum.start") } : {}),
  });

  const marks: Mark[] = [
    band(unit, "message", data, `${TOP} + datum.order * ${ROW}`, ROW, width, tip),
    {
      type: "rule",
      from: { data: heads },
      interactive: false,
      encode: {
        update: {
          x: { scale: x, field: "lane" },
          y: { value: HEAD },
          y2: { signal: `${TOP} + ${count} * ${ROW} + 6` },
          stroke: { value: config.line },
          strokeDash: { value: [3, 3] },
        },
      },
    },
    {
      type: "rect",
      from: { data: heads },
      interactive: false,
      encode: {
        update: {
          xc: { scale: x, field: "lane" },
          width: { signal: `min(${room} - 8, datum.text + 16)` },
          y: { value: 0 },
          height: { value: HEAD - 2 },
          cornerRadius: { value: 4 },
          fill: { signal: color },
          fillOpacity: { value: 0.12 },
          stroke: { signal: color },
          strokeWidth: { value: 1.2 },
        },
      },
    },
    {
      type: "text",
      from: { data: heads },
      interactive: false,
      encode: {
        update: {
          x: { scale: x, field: "lane" },
          y: { value: (HEAD - 2) / 2 },
          align: { value: "center" },
          text: { signal: fit("datum.lane", `${room} - 16`, SMALL, config.advance) },
          fontSize: { value: SMALL },
        },
      },
    },
    {
      type: "rect",
      from: { data },
      interactive: false,
      encode: {
        update: {
          xc: { signal: to },
          width: { value: 6 },
          y: y(-ROW / 2 + 3),
          height: { signal: `datum.kind === 'return' ? 0 : ${ROW - 6}` },
          cornerRadius: { value: 1.5 },
          fill: { signal: color },
          stroke: { signal: `datum.failed ? ${literal(config.fail)} : null` },
          strokeWidth: { value: 1.4 },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "rule",
      from: { data },
      interactive: false,
      encode: {
        update: {
          x: { signal: from },
          x2: { signal: `${step} ? ${from} : ${to} + (${to} > ${from} ? -6 : 6)` },
          y: y(),
          stroke: ink,
          strokeWidth: { value: 1.2 },
          strokeDash: { signal: `datum.kind === 'return' ? [4, 3] : []` },
          strokeOpacity: { signal: `${step} ? 0 : 1` },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "symbol",
      from: { data },
      interactive: false,
      encode: {
        update: {
          x: { signal: `${to} + (${to} > ${from} ? -6 : 6)` },
          y: y(),
          shape: { signal: `${to} > ${from} ? 'triangle-right' : 'triangle-left'` },
          size: { value: 26 },
          fill: ink,
          fillOpacity: { signal: `${step} ? 0 : 1` },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data },
      interactive: false,
      encode: {
        update: {
          x: { signal: `${step} ? ${to} + 9 : (${from} + ${to}) / 2` },
          y: y(),
          align: { signal: `${step} ? 'left' : 'center'` },
          baseline: { signal: `${step} ? 'middle' : 'bottom'` },
          dy: { signal: `${step} ? 0 : -5` },
          text: { signal: fit("datum.label", `${step} ? ${room} - 20 : abs(${to} - ${from}) - 16`, SMALL, config.advance) },
          fontSize: { value: SMALL },
          fill: { signal: `datum.failed ? ${literal(config.fail)} : ${literal(config.ink)}` },
          opacity: dim(unit),
        },
      },
    },
  ];

  return part({
    data: [
      ...shown.data,
      shown.timing,
      table(
        heads,
        laid.flatMap((each) => each.lanes),
        [showing],
      ),
      table(
        data,
        laid.flatMap((each) => each.messages),
        [
          showing,
          { type: "lookup", from: shown.timing.name, key: "index", fields: ["index"], values: ["begin", "finish"], as: ["start", "end"] },
          ...matched(unit, shown),
        ],
      ),
    ],
    signals: [...shown.signals, { name: count, update: `length(data(${literal(data)}))` }, { name: lifelines, update: `length(data(${literal(heads)}))` }],
    scales: [
      {
        name: x,
        type: "point",
        domain: { data: heads, field: "lane", sort: { field: "position", op: "min" } },
        range: [0, { signal: width }],
        padding: 0.5,
      },
    ],
    marks,
    width,
    height: `${TOP} + ${count} * ${ROW} + 8`,
    actors: [...new Set<Actor>([...actorsShown(scope), ANY])],
    selectable: [unit.mark("message")],
  });
}
