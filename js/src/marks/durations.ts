import type { Mark } from "vega";
import { base, hues, perRun, scopeOf, stepsAt, subtitle, swatches, tally, weigh } from "../compile/corpus";
import { duration, each, fit, literal } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { band, dim, part, type Part, type Unit } from "../compile/unit";
import type { DurationsSpec } from "../spec";

const BOX = 10;
const LABEL = 200;
const SPACING = 6;

export function durations(unit: Unit<DurationsSpec>): Part {
  const { spec, config, name, width } = unit;
  const corpus = scopeOf(unit);
  const { groups: count } = corpus;
  const limit = spec.limit ?? 16;
  const key = swatches(corpus);
  const runs = base(corpus);
  const { runs: rows, steps, times } = corpus.corpus.tables;
  const actorOf = new Map(steps.map((step) => [`${step.variant}:${step.index}`, step.actor]));
  const actors = [...new Set(times.flatMap((time) => actorOf.get(`${rows[time.run].full}:${time.index}`) ?? []))];
  const [timed, reached, summary, ranked, x, height] = ["timed", "reached", "summary", "ranked", "x", "chartHeight"].map(name);
  const h = count * (BOX + 4) + 8;
  const left = `min(${LABEL}, ${width} * 0.3)`;
  const top = (offset: number | string) => ({ signal: `(datum.rank - 1) * ${h + SPACING} + ${offset}` });
  const across = (field: string) => each(count, (group) => duration(`datum.${field}${group}`));
  const tip = tooltip(unit, "datum.activity", {
    steps: "'' + datum.steps",
    runs: "'' + length(datum.ids)",
    median: across("median"),
    spread: each(count, (group) => `${duration(`datum.q1${group}`)} + '–' + ${duration(`datum.q3${group}`)}`),
    longest: across("max"),
  });

  const plots: Mark[] = Array.from({ length: count }, (_, group): Mark[] => {
    const y = 4 + group * (BOX + 4);
    const shown = { data: ranked };
    const color = count > 1 ? { value: hues(corpus)[group] } : { scale: unit.actor, field: "actor" };
    const present = `datum.steps${group} > 0`;
    const position = (stat: string) => ({ signal: `${present} ? scale(${literal(x)}, datum.${stat}${group}) : 0` });
    return [
      {
        type: "rule",
        from: shown,
        interactive: false,
        encode: {
          update: {
            x: position("min"),
            x2: position("max"),
            y: top(y + BOX / 2),
            stroke: { value: config.rail },
            strokeOpacity: { signal: `${present} ? 1 : 0` },
            opacity: dim(unit),
          },
        },
      },
      {
        type: "rect",
        from: shown,
        interactive: false,
        encode: {
          update: {
            x: position("q1"),
            x2: position("q3"),
            y: top(y),
            height: { value: BOX },
            cornerRadius: { value: 1.5 },
            fill: color,
            fillOpacity: { signal: `${present} ? 0.35 : 0` },
            stroke: color,
            strokeOpacity: { signal: `${present} ? 1 : 0` },
            opacity: dim(unit),
          },
        },
      },
      {
        type: "rect",
        from: shown,
        interactive: false,
        encode: {
          update: {
            xc: position("median"),
            width: { value: 2 },
            y: top(y - 1),
            height: { value: BOX + 2 },
            fill: { value: config.ink },
            fillOpacity: { signal: `${present} ? 1 : 0` },
            opacity: dim(unit),
          },
        },
      },
    ];
  }).flat();

  const groupOf = (group: number, field: string) => `datum.group === ${group} ? datum.${field} : null`;
  const perGroup = Array.from({ length: count }, (_, group) => group);
  const stats = ["q1", "median", "q3", "min", "max"] as const;

  return part({
    data: [
      ...runs.data,
      stepsAt(corpus, "named", [{ type: "formula", as: "step", expr: "datum.variant + ':' + datum.index" }]),
      {
        name: timed,
        source: corpus.table("times"),
        transform: [
          { type: "project", fields: ["run", "index", "start", "end"] },
          { type: "lookup", from: corpus.active, key: "run", fields: ["run"], values: ["id", "group", "full", ...(unit.highlight ? ["hit"] : [])] },
          { type: "filter", expr: "isValid(datum.id)" },
          { type: "formula", as: "step", expr: "datum.full + ':' + datum.index" },
          { type: "lookup", from: name("named"), key: "step", fields: ["step"], values: ["activity", "actor"] },
          { type: "formula", as: "duration", expr: "datum.end - datum.start" },
          ...perGroup.flatMap((group) => [
            { type: "formula" as const, as: `d${group}`, expr: groupOf(group, "duration") },
            { type: "formula" as const, as: `n${group}`, expr: `datum.group === ${group} ? 1 : 0` },
          ]),
        ],
      },
      {
        name: reached,
        source: timed,
        transform: [perRun("activity"), ...weigh(corpus), ...tally(corpus, ["activity"])],
      },
      {
        name: summary,
        source: timed,
        transform: [
          {
            type: "aggregate",
            groupby: ["activity", "actor"],
            fields: [...perGroup.flatMap((group) => [...stats.map(() => `d${group}`), `n${group}`]), "duration"],
            ops: [...perGroup.flatMap(() => [...stats, "sum" as const]), "median"],
            as: [...perGroup.flatMap((group) => [...stats.map((stat) => `${stat}${group}`), `steps${group}`]), "typical"],
          },
          {
            type: "lookup",
            from: reached,
            key: "activity",
            fields: ["activity"],
            values: ["ids", ...perGroup.map((group) => `n${group}`), ...(unit.highlight ? ["matching"] : [])],
          },
          { type: "formula", as: "steps", expr: perGroup.map((group) => `datum.steps${group}`).join(" + ") },
          { type: "window", sort: { field: ["typical", "activity"], order: ["descending", "ascending"] }, ops: ["row_number"], as: ["rank"] },
        ],
      },
      { name: ranked, source: summary, transform: [{ type: "filter", expr: `datum.rank <= ${limit}` }] },
    ],
    signals: [...runs.signals, { name: height, update: `max(${h}, length(data(${literal(ranked)})) * ${h + SPACING} - ${SPACING})` }],
    scales: [
      ...key.scales,
      {
        name: x,
        type: "linear",
        domain: { data: ranked, fields: perGroup.map((group) => `max${group}`) },
        range: [{ signal: `${left} + 8` }, { signal: `${width} - 6` }],
        domainMin: 0,
        zero: true,
        nice: true,
      },
    ],
    axes: [
      {
        scale: x,
        orient: "top",
        tickCount: { signal: `max(2, floor((${width} - ${left}) / 90))` },
        encode: { labels: { update: { text: { signal: duration("datum.value") } } } },
      },
    ],
    legends: key.legends,
    marks: [
      band(unit, "activity", ranked, top(0).signal, h, width, tip),
      {
        type: "rect",
        from: { data: ranked },
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
        from: { data: ranked },
        interactive: false,
        encode: {
          update: { x: { value: 10 }, y: top(h / 2), text: { signal: fit("datum.activity", `${left} - 16`, config.size, config.advance) }, opacity: dim(unit) },
        },
      },
      ...plots,
      {
        type: "text",
        interactive: false,
        style: "faint",
        encode: {
          update: {
            x: { value: 0 },
            y: { signal: `${height} + 14` },
            text: { value: "step duration: box from the first to the third quartile, line at the median, whiskers to the extremes" },
            fontSize: { value: 10 },
          },
        },
      },
    ],
    width,
    height,
    actors,
    subtitle: subtitle(corpus),
    selectable: [unit.mark("activity")],
  });
}
