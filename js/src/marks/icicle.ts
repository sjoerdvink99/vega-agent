import type { Mark } from "vega";
import { base, divergence, joined, levelOf, scopeOf, shares, stats, table, tally, weigh, LEVEL } from "../compile/corpus";
import { each, first, fit, literal, percent, sum } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { dim, part, type Part, type Unit } from "../compile/unit";
import { byVariant, LEVELS, type Tables } from "../data/tables";
import type { Level } from "../grammar/abstract";
import type { Actor } from "../grammar/ast";
import type { IcicleSpec } from "../spec";

const COLUMN = 132;
const LEGIBLE = 13;
const ROOT = 0;

type Branch = {
  level: Level;
  key: number;
  parent: number | null;
  token: string;
  depth: number;
  actors: Actor[];
  failed: boolean;
  end: boolean;
  ends: number | null;
};

function trees({ variants, tokens }: Tables) {
  const branches: Branch[] = [];
  const walks: { variant: number; key: number }[] = [];
  const tokensOf = byVariant(tokens);
  for (const level of LEVELS) {
    const children = new Map<string, number>();
    const byKey: Branch[] = [];
    const add = (parent: Branch | null, token: string, actors: Actor[], isFailed: boolean, end: boolean): Branch => {
      const id = `${parent?.key ?? ""}\t${end ? "\u0000" : token}`;
      const found = children.get(id);
      if (found !== undefined) return byKey[found];
      const branch: Branch = {
        level,
        key: byKey.length,
        parent: parent?.key ?? null,
        token,
        depth: parent ? parent.depth + 1 : 0,
        actors,
        failed: isFailed,
        end,
        ends: null,
      };
      if (parent && end) parent.ends = branch.key;
      children.set(id, branch.key);
      byKey.push(branch);
      branches.push(branch);
      return branch;
    };
    const root = add(null, "all runs", [], false, false);
    for (const { variant } of variants.filter((row) => row.level === level)) {
      let node = root;
      walks.push({ variant, key: root.key });
      for (const { token, actors, failed } of tokensOf.get(variant) ?? []) {
        node = add(node, token, actors, failed, false);
        walks.push({ variant, key: node.key });
      }
      walks.push({ variant, key: add(node, "end", [], false, true).key });
    }
  }
  return { branches, walks };
}

function locate(branches: Branch[], level: Level, path: string[]): number {
  let key = ROOT;
  for (const token of path) {
    const child = branches.find((branch) => branch.level === level && branch.parent === key && !branch.end && branch.token === token);
    if (!child) break;
    key = child.key;
  }
  return key;
}

export function icicle(unit: Unit<IcicleSpec>): Part {
  const { spec, config, name, width } = unit;
  const corpus = scopeOf(unit);
  const { groups: count } = corpus;
  const compare = count > 1;
  const height = spec.height ?? 380;
  const runs = base(corpus);
  const { branches, walks } = trees(corpus.corpus.tables);
  const [paths, counts, tree, visible, named, captioned, cut, focused, deepest, stripes] = [
    "paths",
    "counts",
    "tree",
    "visible",
    "named",
    "captioned",
    "cut",
    "focused",
    "deepest",
    "stripes",
  ].map(name);
  const [x, y, color] = [name("x"), name("y"), name("color")];
  const [focus, zoom, columns, level] = [name("focus"), name("zoom"), name("columns"), name(LEVEL)];
  const quiet = "(datum.depth === 0 || datum.end)";
  const active = unit.highlight ? unit.highlight.active : "false";
  const box = {
    x: { scale: x, field: "depth", offset: 1 },
    x2: { scale: x, signal: "datum.depth + 1", offset: -1 },
    y: { scale: y, field: "x0", offset: 0.5 },
    y2: { scale: y, field: "x1", offset: -0.5 },
    cornerRadius: { value: 2 },
  };
  const caption = compare ? each(count, (group) => percent(`datum.s${group}`)) : `datum.n0 + ' · ' + ${percent("datum.s0")}`;
  const ending = `datum.ended ? ${each(count, (group) => `datum.ended.n${group}`)} : ''`;
  const tip = tooltip(unit, "datum.end ? 'runs end here' : datum.token", { ...shares(corpus), ending });
  const contrast = divergence(corpus, 0.6);

  const cells: Mark[] = [
    {
      type: "rect",
      name: unit.mark("cell"),
      from: { data: visible },
      encode: {
        update: {
          ...box,
          fill: {
            signal: `${quiet} ? ${literal(config.panel)} : ${compare ? `scale(${literal(color)}, datum.difference)` : `scale(${literal(unit.actor)}, datum.actor)`}`,
          },
          fillOpacity: { signal: compare ? "1" : `${quiet} ? 1 : ${active} ? 0.06 : 0.16` },
          stroke: { signal: `datum.failed && datum.span >= ${LEGIBLE} ? ${literal(config.fail)} : null` },
          strokeWidth: { value: 1.2 },
          opacity: dim(unit),
          ...tip,
        },
        hover: { fillOpacity: { signal: compare ? "0.8" : `${quiet} ? 0.7 : 0.3` } },
      },
    },
    ...(unit.highlight
      ? [
          {
            type: "rect",
            from: { data: visible },
            interactive: false,
            encode: {
              update: {
                ...box,
                y2: {
                  signal: `scale(${literal(y)}, datum.x0) + 0.5 + max(0, datum.span - 1) * (${active} && !${quiet} ? (datum.matching || 0) / max(1, ${sum(count, (group) => `datum.n${group}`)}) : 0)`,
                },
                fill: { scale: unit.actor, field: "actor" },
                fillOpacity: { value: 0.42 },
              },
            },
          } satisfies Mark,
        ]
      : []),
    {
      type: "rect",
      from: { data: stripes },
      interactive: false,
      encode: {
        update: {
          x: { scale: x, field: "depth", offset: 1 },
          width: { value: 3 },
          y: { signal: `scale(${literal(y)}, datum.x0) + 0.5 + datum.band * max(0.5, datum.span - 1) / length(datum.actors)` },
          height: { signal: `max(0.5, datum.span - 1) / length(datum.actors)` },
          fill: { scale: unit.actor, field: "actor" },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: named },
      interactive: false,
      encode: {
        update: {
          x: { scale: x, field: "depth", offset: 9 },
          y: { signal: `scale(${literal(y)}, datum.x0) + min(datum.span / 2, 10)` },
          text: { signal: fit("datum.token", `scale(${literal(x)}, datum.depth + 1) - scale(${literal(x)}, datum.depth) - 20`, config.size, config.advance) },
          fill: { signal: `datum.end ? ${literal(config.faint)} : ${literal(config.ink)}` },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: captioned },
      interactive: false,
      style: "muted",
      encode: {
        update: {
          x: { scale: x, field: "depth", offset: 9 },
          y: { signal: `scale(${literal(y)}, datum.x0) + 23` },
          text: { signal: caption },
          fontSize: { value: 10 },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: cut },
      interactive: false,
      style: "faint",
      encode: {
        update: {
          x: { scale: x, signal: "datum.depth + 1", offset: -8 },
          y: { signal: `scale(${literal(y)}, datum.x0) + datum.span / 2` },
          text: { value: "›" },
          align: { value: "center" },
        },
      },
    },
  ];

  const lines = stats(corpus);
  const crumbs = `join(reverse(pluck(treeAncestors(${literal(tree)}, ${focus}), 'token')), ' › ')`;
  return part({
    data: [
      ...runs.data,
      table(name("walks"), walks),
      ...joined(corpus, "paths", name("walks"), ["key"], { then: weigh(corpus) }),
      { name: counts, source: paths, transform: tally(corpus, ["key"]) },
      table(
        tree,
        branches.map((branch) => ({ ...branch, actor: branch.actors[0] ?? null })),
        [
          { type: "filter", expr: `datum.level === ${level}` },
          { type: "lookup", from: counts, key: "key", fields: ["key"], as: ["counted"] },
          { type: "lookup", from: counts, key: "key", fields: ["ends"], as: ["ended"] },
          { type: "filter", expr: "datum.counted || datum.depth === 0" },
          ...["size", "matching", "ids", "difference", ...Array.from({ length: count }, (_, group) => [`n${group}`, `s${group}`]).flat()].map((field) => ({
            type: "formula" as const,
            as: field,
            expr: `datum.counted ? datum.counted.${field} : ${field === "ids" ? "[]" : "0"}`,
          })),
          { type: "formula", as: "value", expr: "datum.end ? datum.size : 0" },
          { type: "stratify", key: "key", parentKey: "parent" },
          { type: "partition", field: "value", sort: { field: ["data.end", "value"], order: ["ascending", "descending"] }, size: [1, 1] },
        ],
      ),
      {
        name: visible,
        source: tree,
        transform: [
          {
            type: "filter",
            expr: `datum.depth >= ${zoom}.depth && datum.depth < ${zoom}.depth + ${columns} && datum.x1 > ${zoom}.x0 && datum.x0 < ${zoom}.x1`,
          },
          { type: "formula", as: "span", expr: `(datum.x1 - datum.x0) / max(1e-9, ${zoom}.x1 - ${zoom}.x0) * ${height}` },
          { type: "filter", expr: "datum.span >= 0.75" },
        ],
      },
      { name: named, source: visible, transform: [{ type: "filter", expr: `datum.span >= ${LEGIBLE}` }] },
      { name: captioned, source: visible, transform: [{ type: "filter", expr: "datum.span >= 30 && !datum.end" }] },
      {
        name: cut,
        source: visible,
        transform: [{ type: "filter", expr: `datum.span >= 9 && datum.children && datum.depth === ${zoom}.depth + ${columns} - 1` }],
      },
      { name: focused, source: tree, transform: [{ type: "filter", expr: `datum.key === ${focus}` }] },
      { name: deepest, source: tree, transform: [{ type: "aggregate", fields: ["depth"], ops: ["max"], as: ["depth"] }] },
      {
        name: stripes,
        source: visible,
        transform: [
          { type: "filter", expr: "datum.depth > 0 && !datum.end" },
          { type: "flatten", fields: ["actors"], as: ["actor"], index: "band" },
        ],
      },
    ],
    signals: [
      ...runs.signals,
      {
        name: focus,
        value: locate(branches, levelOf(spec), spec.focus ?? []),
        on: [
          {
            events: `@${unit.mark("cell")}:click`,
            update: `datum.end ? ${focus} : datum.key === ${focus} ? (datum.parent === null ? ${focus} : datum.parent) : datum.key`,
          },
          { events: { signal: level }, update: String(ROOT) },
        ],
      },
      { name: zoom, update: first(focused, { x0: 0, x1: 1, depth: 0 }) },
      { name: columns, update: `max(1, min(${first(deepest, { depth: 0 })}.depth - ${zoom}.depth + 1, floor(${width} / ${COLUMN})))` },
    ],
    scales: [
      { name: x, type: "linear", domain: { signal: `[${zoom}.depth, ${zoom}.depth + ${columns}]` }, range: [0, { signal: width }], zero: false, nice: false },
      { name: y, type: "linear", domain: { signal: `[${zoom}.x0, ${zoom}.x1]` }, range: [0, height], zero: false, nice: false },
      ...contrast.scales,
    ],
    legends: contrast.legends,
    marks: [{ type: "group", encode: { update: { width: { signal: width }, height: { value: height }, clip: { value: true } } }, marks: cells }],
    width,
    height,
    actors: [...new Set(branches.flatMap((branch) => branch.actors))],
    subtitle: `${zoom}.depth > 0 ? [${[...lines, crumbs].join(", ")}] : [${lines.join(", ")}]`,
    selectable: [unit.mark("cell")],
  });
}
