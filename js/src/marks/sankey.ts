import type { Mark, Transforms } from "vega";
import { append } from "../collections";
import { base, counted, divergence, joined, perLevel, scopeOf, shares, subtitle, table, tally, weigh, LEVEL } from "../compile/corpus";
import { each, first, fit, literal, percent } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { dim, part, type Part, type Unit } from "../compile/unit";
import { SMALL, TINY } from "../config";
import { byVariant, LEVELS } from "../data/tables";
import type { Level } from "../grammar/abstract";
import type { Actor } from "../grammar/ast";
import type { SankeySpec } from "../spec";

const NODE = 10;
const GAP = 6;
const AXIS = 18;
const LABEL = 140;
const ROOM = 24;
const END = "end";
const OTHER = "other";

type Token = { token: string; actors: Actor[]; failed: boolean };

function largest(paths: { runs: number[]; tokens: Token[] }[], groups: number, room: number): Set<string> {
  const sizes = Array.from({ length: groups }, (_, group) => paths.reduce((total, path) => total + path.runs[group], 0) || 1);
  const weights = new Map<string, number>();
  for (const path of paths) {
    const weight = path.runs.reduce((total, runs, group) => total + runs / sizes[group], 0);
    path.tokens.forEach(({ token }, column) => {
      const key = `${column}\t${token}`;
      weights.set(key, (weights.get(key) ?? 0) + weight);
    });
  }
  const columns = new Map<string, string[]>();
  for (const [key] of [...weights].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) append(columns, key.slice(0, key.indexOf("\t")), key);
  return new Set([...columns.values()].flatMap((keys) => (keys.length > room ? keys.slice(0, room - 1) : keys)));
}

export function sankey(unit: Unit<SankeySpec>): Part {
  const { spec, config, name, width } = unit;
  const corpus = scopeOf(unit);
  const { groups: count } = corpus;
  const compare = count > 1;
  const limit = spec.limit ?? 8;
  const height = spec.height ?? 300;
  const room = Math.max(2, Math.floor((height - AXIS) / ROOM));
  const runs = base(corpus);
  const [visits, stack, columns, nodes, flows, links, axis, info, color] = [
    "visits",
    "stack",
    "columns",
    "nodes",
    "flows",
    "links",
    "axis",
    "info",
    "color",
  ].map(name);
  const [scale, spacing, level] = [name("scale"), name("spacing"), name(LEVEL)];

  const walks: { variant: number; node: number }[] = [];
  const moves: { variant: number; source: number; target: number; column: number }[] = [];
  const kinds: { level: Level; node: number; column: number; token: string; actor: Actor | null; failed: boolean; last: number }[] = [];
  const tokensOf = byVariant(corpus.corpus.tables.tokens);
  for (const abstraction of LEVELS) {
    const sizes = counted(corpus, abstraction);
    const shapes = corpus.corpus.tables.variants.filter((row) => row.level === abstraction);
    const paths = shapes.map(({ variant }) => {
      const all = tokensOf.get(variant) ?? [];
      const path = all.slice(0, limit).map(({ token, actors, failed }) => ({ token, actors, failed }));
      return { runs: sizes.get(variant) ?? [], tokens: all.length < limit ? [...path, { token: END, actors: [], failed: false }] : path };
    });
    const kept = largest(paths, count, room);
    const bucket = (column: number, token: Token): Token => (kept.has(`${column}\t${token.token}`) ? token : { token: OTHER, actors: [], failed: false });
    const ids = new Map<string, number>();
    const identify = (token: Token, column: number): number => {
      const key = `${column}\t${token.token}`;
      const known = ids.get(key);
      if (known !== undefined) return known;
      const node = kinds.length;
      ids.set(key, node);
      const last = token.token === END ? 1 : token.token === OTHER ? 2 : 0;
      kinds.push({ level: abstraction, node, column, token: token.token, actor: token.actors[0] ?? null, failed: token.failed, last });
      return node;
    };
    paths.forEach((path, index) => {
      const { variant } = shapes[index];
      const visited = path.tokens.map((token, column) => identify(bucket(column, token), column));
      visited.forEach((node, column) => {
        walks.push({ variant, node });
        if (column) moves.push({ variant, source: visited[column - 1], target: node, column: column - 1 });
      });
    });
  }
  const span = perLevel(corpus, (abstraction) => Math.max(1, ...kinds.filter((kind) => kind.level === abstraction).map((kind) => kind.column + 1)));
  const x = (column: string) => `${column} * ${spacing}`;
  const before = (groupby: string, by: string, as: string): Transforms => ({
    type: "window",
    groupby: [groupby],
    sort: { field: by },
    ops: ["sum"],
    fields: ["size"],
    as: [as],
    frame: [null, -1],
    ignorePeers: true,
  });
  const hue = (node: string) => `${node}.last ? ${literal(config.faint)} : scale(${literal(unit.actor)}, ${node}.actor)`;
  const tipFields = shares(corpus);

  const marks: Mark[] = [
    {
      type: "text",
      from: { data: axis },
      interactive: false,
      style: "tick",
      encode: {
        update: {
          x: { signal: `${x("datum.column")} + ${NODE / 2}` },
          y: { value: 6 },
          text: { signal: "'' + (datum.column + 1)" },
          fontSize: { value: TINY },
          fill: { value: config.faint },
        },
      },
    },
    {
      type: "path",
      name: unit.mark("link"),
      from: { data: links },
      encode: {
        update: {
          path: { field: "path" },
          fill: compare ? { scale: color, field: "difference" } : { signal: hue("datum.from") },
          fillOpacity: { value: compare ? 0.75 : 0.28 },
          opacity: dim(unit),
          ...tooltip(unit, "datum.from.token + ' → ' + datum.to.token", tipFields),
        },
        hover: { fillOpacity: { value: compare ? 0.95 : 0.5 } },
      },
    },
    {
      type: "rect",
      name: unit.mark("node"),
      from: { data: nodes },
      encode: {
        update: {
          x: { signal: x("datum.column") },
          width: { value: NODE },
          y: { field: "y" },
          height: { field: "h" },
          cornerRadius: { value: 2 },
          fill: { signal: hue("datum") },
          stroke: { signal: `datum.failed ? ${literal(config.fail)} : null` },
          strokeWidth: { value: 1.4 },
          opacity: dim(unit),
          ...tooltip(unit, "datum.token", tipFields),
        },
      },
    },
    {
      type: "text",
      from: { data: nodes },
      interactive: false,
      encode: {
        update: {
          x: { signal: `${x("datum.column")} + ${NODE + 4}` },
          y: { signal: "datum.y + min(datum.h / 2, 8)" },
          text: { signal: `datum.h >= 11 ? ${fit("datum.token", `${spacing} - ${NODE + 10}`, SMALL, config.advance)} : ''` },
          fontSize: { value: SMALL },
          fill: { signal: `datum.failed ? ${literal(config.fail)} : ${literal(config.ink)}` },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: nodes },
      interactive: false,
      style: "muted",
      encode: {
        update: {
          x: { signal: `${x("datum.column")} + ${NODE + 4}` },
          y: { signal: "datum.y + 21" },
          text: { signal: `datum.h >= 26 ? ${compare ? each(count, (group) => percent(`datum.s${group}`)) : percent("datum.size")} : ''` },
          fontSize: { value: 10 },
          opacity: dim(unit),
        },
      },
    },
  ];

  return part({
    data: [
      ...runs.data,
      table(info, kinds, [{ type: "filter", expr: `datum.level === ${level}` }]),
      { name: axis, source: info, transform: [{ type: "aggregate", groupby: ["column"] }] },
      table(name("visited"), walks),
      ...joined(corpus, "visits", name("visited"), ["node"], { then: weigh(corpus) }),
      {
        name: stack,
        source: visits,
        transform: [
          ...tally(corpus, ["node"]),
          { type: "lookup", from: info, key: "node", fields: ["node"], values: ["column", "token", "actor", "failed", "last"] },
          {
            type: "window",
            groupby: ["column"],
            sort: { field: ["last", "size", "token"], order: ["ascending", "descending", "ascending"] },
            ops: ["row_number"],
            as: ["index"],
          },
          before("column", "index", "before"),
        ],
      },
      {
        name: columns,
        source: stack,
        transform: [
          { type: "aggregate", groupby: ["column"], fields: ["size", "size"], ops: ["sum", "count"], as: ["total", "count"] },
          { type: "formula", as: "fit", expr: `datum.total > 0 ? max(0, ${height - AXIS} - ${GAP} * (datum.count - 1)) / datum.total : ${height - AXIS}` },
          { type: "aggregate", fields: ["fit"], ops: ["min"], as: ["fit"] },
        ],
      },
      {
        name: nodes,
        source: stack,
        transform: [
          { type: "formula", as: "y", expr: `${AXIS} + (datum.before || 0) * ${scale} + (datum.index - 1) * ${GAP}` },
          { type: "formula", as: "h", expr: `max(1, datum.size * ${scale})` },
        ],
      },
      table(name("flowing"), moves),
      ...joined(corpus, "flows", name("flowing"), ["source", "target", "column"], { then: weigh(corpus) }),
      {
        name: links,
        source: flows,
        transform: [
          ...tally(corpus, ["source", "target", "column"]),
          { type: "lookup", from: nodes, key: "node", fields: ["source", "target"], as: ["from", "to"] },
          { type: "filter", expr: "datum.from && datum.to" },
          { type: "formula", as: "fromY", expr: "datum.from.y" },
          { type: "formula", as: "toY", expr: "datum.to.y" },
          before("source", "toY", "out"),
          before("target", "fromY", "in"),
          { type: "formula", as: "sx", expr: `${x("datum.column")} + ${NODE}` },
          { type: "formula", as: "tx", expr: x("(datum.column + 1)") },
          { type: "formula", as: "sy", expr: `datum.from.y + (datum.out || 0) * ${scale}` },
          { type: "formula", as: "ty", expr: `datum.to.y + (datum.in || 0) * ${scale}` },
          { type: "formula", as: "t", expr: `datum.size * ${scale}` },
          { type: "formula", as: "mx", expr: "(datum.sx + datum.tx) / 2" },
          {
            type: "formula",
            as: "path",
            expr: [
              "'M' + datum.sx + ',' + datum.sy",
              "' C' + datum.mx + ',' + datum.sy + ' ' + datum.mx + ',' + datum.ty + ' ' + datum.tx + ',' + datum.ty",
              "' L' + datum.tx + ',' + (datum.ty + datum.t)",
              "' C' + datum.mx + ',' + (datum.ty + datum.t) + ' ' + datum.mx + ',' + (datum.sy + datum.t) + ' ' + datum.sx + ',' + (datum.sy + datum.t) + ' Z'",
            ].join(" + "),
          },
        ],
      },
    ],
    signals: [
      ...runs.signals,
      { name: spacing, update: `max(${NODE + 40}, (${width} - ${LABEL + NODE}) / max(1, ${span} - 1))` },
      { name: scale, update: `${first(columns, { fit: height - AXIS })}.fit` },
    ],
    ...divergence(corpus),
    marks,
    width: `${x(`(${span} - 1)`)} + ${NODE + LABEL}`,
    height,
    actors: [...new Set(kinds.flatMap((kind) => (kind.actor ? [kind.actor] : [])))],
    subtitle: subtitle(corpus),
    selectable: [unit.mark("link"), unit.mark("node")],
  });
}
