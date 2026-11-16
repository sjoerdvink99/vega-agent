import type { Mark } from "vega";
import { literal } from "../compile/expr";
import { tooltip } from "../compile/tooltip";
import { dim, membership, part, type Part, type Unit } from "../compile/unit";
import { append } from "../collections";
import { measure, tint, type Config } from "../config";
import { fold } from "../grammar/abstract";
import { steps, type Actor, type List, type Node, type Repeat, type Step } from "../grammar/ast";
import { parse } from "../grammar/parse";
import { label as stepLabel, rep } from "../grammar/print";
import { isGround, trace } from "../grammar/trace";
import type { DiagramSpec } from "../spec";

const STEP = 22;
const GAP = 14;
const VGAP = 10;
const R = 8;
const PAD = 10;
const HEAD = 20;
const DECK = 4;
const BAR = 3;
const LEAD = 18;
const NOTE = 9.5;
const TITLE = 10;
const MARGIN = 10;
const GLYPH = 28;

type Card = {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  actor: Actor;
  scope: boolean;
  opaque: boolean;
  failed: boolean;
  text: string;
  note: string;
  label: string;
  ids: string[];
};
type Rail = { d: string; x: number; y: number; dash: boolean; round: boolean };
type Shape = { x: number; y: number; w: number; h: number; r: number; fill: string; stroke: string | null; dash: boolean };
type Deck = { x: number; y: number; w: number; h: number; actor: Actor | null };
type Text = { x: number; y: number; text: string; size: number; fill: string; align: "left" | "center"; weight: number };

type Ink = { cards: Card[]; rails: Rail[]; shapes: Shape[]; decks: Deck[]; texts: Text[] };

type Box = { w: number; h: number; y: number; card?: number; draw: (x: number, top: number) => void };

type Construct = "parallel" | "choice" | "repeat" | "optional" | "copies" | "scope" | "opaque" | "failed";

const NAMES: Record<Construct, string> = {
  parallel: "parallel",
  choice: "choice",
  repeat: "repeat",
  optional: "optional",
  copies: "parallel copies",
  scope: "own context",
  opaque: "opaque agent",
  failed: "failed",
};

function bound({ lo, hi }: Repeat): string {
  if (hi === null) return lo > 1 ? `${lo}+` : "";
  if (lo === hi) return `×${lo}`;
  if (lo === 0) return hi > 1 ? `≤${hi}` : "";
  return `${lo}–${hi}`;
}

function constructs(node: Node | null, found = new Set<Construct>()): Set<Construct> {
  if (!node) return found;
  switch (node.t) {
    case "step":
      if (node.failed) found.add("failed");
      if (node.body) found.add("scope");
      else if (node.actor === "agent") found.add("opaque");
      return constructs(node.body, found);
    case "repeat":
      if (node.parallel) found.add("copies");
      else {
        if (node.lo === 0) found.add("optional");
        if (node.hi === null || node.hi > 1) found.add("repeat");
      }
      return constructs(node.node, found);
    default:
      if (node.t !== "seq") found.add(node.t === "par" ? "parallel" : "choice");
      node.items.forEach((item) => constructs(item, found));
      return found;
  }
}

function covered(node: Node, base: number, found: Map<Step, string[]>): number {
  switch (node.t) {
    case "step":
      append(found, node, String(base));
      return 1 + (node.body ? covered(node.body, base + 1, found) : 0);
    case "repeat": {
      let at = base;
      for (let copy = 0; copy < node.lo; copy += 1) at += covered(node.node, at, found);
      return at - base;
    }
    case "alt":
      return 0;
    default: {
      let at = base;
      for (const item of node.items) at += covered(item, at, found);
      return at - base;
    }
  }
}

function layout(root: Node, config: Config, positions: Map<Step, string[]>): { ink: Ink; width: number; height: number } {
  const ink: Ink = { cards: [], rails: [], shapes: [], decks: [], texts: [] };
  const width = (text: string, size = config.size) => measure(text, size, config);
  const rail = (x1: number, y: number, x2: number) => ink.rails.push({ d: `M${x1},${y}H${x2}`, x: 0, y: 0, dash: false, round: false });
  const curve = (d: string, dash = false, round = false) => ink.rails.push({ d, x: 0, y: 0, dash, round });
  const text = (x: number, y: number, value: string, fill: string, size: number, align: Text["align"] = "left", weight = 400) =>
    ink.texts.push({ x, y, text: value, size, fill, align, weight });
  const card = (node: Step, x: number, y: number, w: number, h: number, scope: boolean, note = "") =>
    ink.cards.push({
      key: String(ink.cards.length),
      x,
      y,
      w,
      h,
      actor: node.actor,
      scope,
      opaque: node.actor === "agent" && !scope,
      failed: node.failed,
      text: scope ? (node.name ? `${node.actor} · ${node.name}` : node.actor) : (node.name ?? (node.actor === "_" ? "any" : node.actor)),
      note,
      label: stepLabel(node),
      ids: positions.get(node) ?? [],
    });

  const place = (node: Node): Box => {
    switch (node.t) {
      case "step":
        return node.body ? scope(node, node.body) : step(node);
      case "seq":
        return sequence(node);
      case "par":
        return parallel(node);
      case "alt":
        return choice(node);
      case "repeat":
        return node.parallel ? copies(node) : repeat(node);
    }
  };

  const step = (node: Step): Box => {
    const name = node.name ?? (node.actor === "_" ? "any" : node.actor);
    const note = node.sig?.outputs.length ? `→ ${node.sig.outputs.map(rep).join(", ")}` : "";
    const w = Math.max(width(name) + 20, note ? width(note, NOTE) + 10 : 0, 30);
    return { w, h: note ? STEP + 14 : STEP, y: STEP / 2, card: STEP, draw: (x, top) => card(node, x, top, w, STEP, false, note) };
  };

  const scope = (node: Step, body: Node): Box => {
    const inner = place(body);
    const title = node.name ? `${node.actor} · ${node.name}` : node.actor;
    const w = Math.max(inner.w + 2 * PAD, width(title, TITLE) + 2 * PAD);
    const h = HEAD + inner.h + PAD;
    const y = HEAD + inner.y;
    return {
      w,
      h,
      y,
      card: h,
      draw: (x, top) => {
        const left = x + (w - inner.w) / 2;
        card(node, x, top, w, h, true);
        rail(x, top + y, left);
        inner.draw(left, top + HEAD);
        rail(left + inner.w, top + y, x + w);
      },
    };
  };

  const sequence = (node: List): Box => {
    const parts = node.items.map(place);
    const y = parts.reduce((most, each) => Math.max(most, each.y), 0);
    const h = y + parts.reduce((most, each) => Math.max(most, each.h - each.y), 0);
    const w = parts.reduce((total, each) => total + each.w, 0) + GAP * Math.max(0, parts.length - 1);
    return {
      w,
      h,
      y,
      draw: (x, top) => {
        let cursor = x;
        parts.forEach((each, index) => {
          if (index) rail(cursor - GAP, top + y, cursor);
          each.draw(cursor, top + y - each.y);
          cursor += each.w + GAP;
        });
      },
    };
  };

  const stack = (items: Node[]) => {
    const parts = items.map(place);
    const tops: number[] = [];
    let h = 0;
    for (const each of parts) {
      tops.push(h);
      h += each.h + VGAP;
    }
    return { parts, tops, h: h - VGAP, widest: parts.reduce((most, each) => Math.max(most, each.w), 0) };
  };

  const parallel = (node: List): Box => {
    const { parts, tops, h, widest } = stack(node.items);
    const first = tops[0] + parts[0].y;
    const last = tops[tops.length - 1] + parts[parts.length - 1].y;
    const side = BAR + GAP;
    const w = widest + 2 * side;
    return {
      w,
      h,
      y: (first + last) / 2,
      draw: (x, top) => {
        for (const left of [x, x + w - BAR])
          ink.shapes.push({ x: left, y: top + first - 6, w: BAR, h: last - first + 12, r: 1.5, fill: config.ink, stroke: null, dash: false });
        parts.forEach((each, index) => {
          const level = top + tops[index] + each.y;
          rail(x + BAR, level, x + side);
          each.draw(x + side, top + tops[index]);
          rail(x + side + each.w, level, x + w - BAR);
        });
      },
    };
  };

  const choice = (node: List): Box => {
    const { parts, tops, h, widest } = stack(node.items);
    const side = 2 * R + 6;
    const w = widest + 2 * side;
    const y = parts[0].y;
    return {
      w,
      h,
      y,
      draw: (x, top) => {
        const right = x + w;
        const main = top + y;
        parts.forEach((each, index) => {
          const level = top + tops[index] + each.y;
          const start = x + side;
          const end = start + each.w;
          if (index === 0) {
            rail(x, main, start);
            rail(end, main, right);
          } else {
            curve(`M${x},${main} Q${x + R},${main} ${x + R},${main + R} V${level - R} Q${x + R},${level} ${x + 2 * R},${level} H${start}`);
            curve(`M${end},${level} H${right - 2 * R} Q${right - R},${level} ${right - R},${level - R} V${main + R} Q${right - R},${main} ${right},${main}`);
          }
          each.draw(start, top + tops[index]);
        });
      },
    };
  };

  const repeat = (node: Repeat): Box => {
    const inner = place(node.node);
    const optional = node.lo === 0;
    const loops = node.hi === null || node.hi > 1;
    const tag = bound(node);
    const above = optional ? 12 : 0;
    const below = loops ? (tag ? 20 : 14) : 0;
    const side = R + 6;
    const w = inner.w + 2 * side;
    return {
      w,
      h: above + inner.h + below,
      y: above + inner.y,
      draw: (x, top) => {
        const right = x + w;
        const middle = x + w / 2;
        const level = top + above + inner.y;
        const low = top + above + inner.h + 8;
        const high = top + 3;
        rail(x, level, x + side);
        inner.draw(x + side, top + above);
        rail(x + side + inner.w, level, right);
        if (loops) {
          curve(
            `M${right - side},${level} C${right},${level} ${right},${low} ${right - side},${low} H${x + side} C${x},${low} ${x},${level} ${x + side},${level}`,
          );
          curve(`M${middle + 3},${low - 3} L${middle - 2},${low} L${middle + 3},${low + 3}`, false, true);
        }
        if (loops && tag) {
          const plate = width(tag, NOTE) + 8;
          ink.shapes.push({ x: middle - plate / 2, y: low + 3, w: plate, h: 12, r: 6, fill: config.background, stroke: null, dash: false });
          text(middle, low + 9, tag, config.muted, NOTE, "center");
        }
        if (optional) {
          curve(
            `M${x},${level} C${x + side},${level} ${x},${high} ${x + side},${high} H${right - side} C${right},${high} ${right - side},${level} ${right},${level}`,
            true,
          );
        }
      },
    };
  };

  const copies = (node: Repeat): Box => {
    const inner = place(node.node);
    const tag = node.hi === null && node.lo <= 1 ? "per item" : bound(node) || `≤${node.hi}`;
    const w = inner.w + 2 * DECK + width(tag, NOTE) + 8;
    return {
      w,
      h: inner.h + 2 * DECK,
      y: 2 * DECK + inner.y,
      draw: (x, top) => {
        for (const k of [2, 1])
          ink.decks.push({
            x: x + k * DECK,
            y: top + (2 - k) * DECK,
            w: inner.w,
            h: inner.card ?? inner.h,
            actor: node.node.t === "step" ? node.node.actor : null,
          });
        inner.draw(x, top + 2 * DECK);
        rail(x + inner.w + 2 * DECK, top + 2 * DECK + inner.y, x + w);
        text(x + inner.w + 2 * DECK + 4, top + DECK, tag, config.muted, NOTE);
      },
    };
  };

  const figure = place(root);
  const level = MARGIN + figure.y;
  const right = figure.w + 2 * LEAD - 4;
  rail(4, level, LEAD);
  figure.draw(LEAD, MARGIN);
  rail(LEAD + figure.w, level, right);
  for (const cx of [4, right]) ink.shapes.push({ x: cx - 3.5, y: level - 3.5, w: 7, h: 7, r: 3.5, fill: config.background, stroke: config.rail, dash: false });
  return { ink, width: figure.w + 2 * LEAD, height: figure.h + 2 * MARGIN };
}

const entry = (construct: Construct, config: Config) => GLYPH + 5 + measure(NAMES[construct], TITLE, config) + 16;

const keyWidth = (present: Construct[], config: Config) => (present.length ? present.reduce((sum, construct) => sum + entry(construct, config), -16) : 0);

function key(present: Construct[], ink: Ink, left: number, top: number, config: Config): void {
  let x = left;
  const at = (dx: number, dy: number) => ({ x: x + dx, y: top + dy });
  const swatch = (dx: number, dy: number, ghost = false) =>
    ink.shapes.push({ ...at(dx, dy), w: 12, h: 6, r: 2, fill: ghost ? config.background : tint(config, config.faint, 0.2), stroke: config.rail, dash: false });
  const rail = (x1: number, y: number, x2: number) => ink.rails.push({ d: `M${x1},${y}H${x2}`, ...at(0, 0), dash: false, round: false });
  const curve = (d: string, dash = false, round = false) => ink.rails.push({ d, ...at(0, 0), dash, round });
  const box = (dx: number, dy: number, w: number, h: number, r: number, dash: boolean) =>
    ink.shapes.push({ ...at(dx, dy), w, h, r, fill: config.background, stroke: config.rail, dash });
  const glyphs: Record<Construct, () => void> = {
    parallel: () => {
      for (const dx of [2, 24]) ink.shapes.push({ ...at(dx, 1.5), w: 2, h: 13, r: 1, fill: config.ink, stroke: null, dash: false });
      for (const dy of [4.5, 11.5]) {
        rail(4, dy, 24);
        swatch(8, dy - 3);
      }
    },
    choice: () => {
      rail(0, 4.5, 28);
      curve("M2,4.5 Q5,4.5 5,8 Q5,11.5 8,11.5 H20 Q23,11.5 23,8 Q23,4.5 26,4.5");
      swatch(8, 1.5);
      swatch(8, 8.5);
    },
    repeat: () => {
      rail(0, 5, 28);
      curve("M21,5 C25,5 25,13 21,13 H7 C3,13 3,5 7,5");
      curve("M15,11 L12.5,13 L15,15", false, true);
      swatch(8, 2);
    },
    optional: () => {
      rail(0, 11, 28);
      curve("M2,11 C6,11 3,3 8,3 H20 C25,3 22,11 26,11", true);
      swatch(8, 8);
    },
    copies: () => {
      swatch(13, 0, true);
      swatch(10.5, 2, true);
      swatch(8, 6);
    },
    scope: () => box(2, 2, 24, 12, 4, false),
    opaque: () => box(2, 3, 24, 10, 3, true),
    failed: () => {
      ink.shapes.push({ ...at(8.5, 2.5), w: 11, h: 11, r: 5.5, fill: config.fail, stroke: null, dash: false });
      ink.texts.push({ ...at(14, 8.5), text: "!", size: 8.5, fill: "#ffffff", align: "center", weight: 700 });
    },
  };
  for (const construct of present) {
    glyphs[construct]();
    ink.texts.push({ x: x + GLYPH + 5, y: top + 8, text: NAMES[construct], size: TITLE, fill: config.muted, align: "left", weight: 400 });
    x += entry(construct, config);
  }
}

export function diagram(unit: Unit<DiagramSpec>): Part {
  const { spec, config, name, actor } = unit;
  const parsed = parse(spec.process);
  const ground = isGround(parsed);
  const traced = ground ? trace(parsed) : parsed;
  const node = spec.fold !== false && ground ? fold(traced) : traced;
  const positions = new Map<Step, string[]>();
  if (ground) covered(node, 0, positions);
  const figure = layout(node, config, positions);
  const present = spec.key === false ? [] : (Object.keys(NAMES) as Construct[]).filter((construct) => constructs(node).has(construct));
  const legend = keyWidth(present, config);
  const width = Math.max(figure.width, legend);
  const height = figure.height + (present.length ? 24 : 0);
  key(present, figure.ink, width - legend, figure.height + 8, config);
  const { cards, rails, shapes, decks, texts } = figure.ink;
  const linked = membership(
    unit,
    "cards",
    cards.flatMap((each) => each.ids.map((id) => ({ key: each.key, id }))),
  );
  const [all, frames, boxes, badges] = [name("cards"), name("frames"), name("steps"), name("badges")];
  const color = (field: string) => ({ scale: actor, field });
  const tip = tooltip(unit, "datum.label", { actor: "datum.actor", count: "length(datum.ids) ? '' + length(datum.ids) : ''" });
  const box = { x: { field: "x" }, y: { field: "y" }, width: { field: "w" }, height: { field: "h" } };
  const marks: Mark[] = [
    {
      type: "rect",
      from: { data: name("decks") },
      interactive: false,
      encode: {
        update: {
          ...box,
          cornerRadius: { value: 6 },
          fill: { value: config.background },
          stroke: { signal: `datum.actor ? scale(${literal(actor)}, datum.actor) : ${literal(config.faint)}` },
          strokeOpacity: { value: 0.55 },
          strokeWidth: { value: 1.1 },
        },
      },
    },
    {
      type: "rect",
      name: unit.mark("frame"),
      from: { data: frames },
      encode: {
        update: {
          ...box,
          cornerRadius: { value: 9 },
          fill: color("actor"),
          fillOpacity: { value: 0.04 },
          stroke: { signal: `datum.failed ? ${literal(config.fail)} : scale(${literal(actor)}, datum.actor)` },
          strokeOpacity: { signal: "datum.failed ? 1 : 0.65" },
          strokeWidth: { signal: "datum.failed ? 1.6 : 1.3" },
          opacity: dim(unit),
          ...tip,
        },
      },
    },
    {
      type: "text",
      from: { data: frames },
      interactive: false,
      encode: {
        update: {
          x: { signal: `datum.x + ${PAD}` },
          y: { signal: `datum.y + ${HEAD / 2 + 1}` },
          text: { field: "text" },
          fontSize: { value: TITLE },
          fontWeight: { value: 600 },
          fill: color("actor"),
          opacity: dim(unit),
        },
      },
    },
    {
      type: "path",
      from: { data: name("rails") },
      interactive: false,
      encode: {
        update: {
          x: { field: "x" },
          y: { field: "y" },
          path: { field: "d" },
          stroke: { value: config.rail },
          strokeWidth: { value: 1.4 },
          strokeDash: { signal: "datum.dash ? [3, 3] : []" },
          strokeCap: { signal: "datum.round ? 'round' : 'butt'" },
          strokeJoin: { signal: "datum.round ? 'round' : 'miter'" },
        },
      },
    },
    {
      type: "rect",
      from: { data: name("shapes") },
      interactive: false,
      encode: {
        update: {
          ...box,
          cornerRadius: { field: "r" },
          fill: { field: "fill" },
          stroke: { field: "stroke" },
          strokeWidth: { signal: "datum.r > 3 ? 1.4 : 1" },
          strokeDash: { signal: "datum.dash ? [3, 2] : []" },
        },
      },
    },
    {
      type: "rect",
      name: unit.mark("step"),
      from: { data: boxes },
      encode: {
        update: {
          ...box,
          cornerRadius: { value: 5 },
          fill: { signal: `scale(${literal(actor)}, datum.actor)` },
          fillOpacity: { value: 0.13 },
          stroke: { signal: `datum.failed ? ${literal(config.fail)} : scale(${literal(actor)}, datum.actor)` },
          strokeWidth: { signal: "datum.failed ? 1.6 : 1.3" },
          strokeDash: { signal: "datum.opaque ? [4, 2.5] : []" },
          opacity: dim(unit),
          ...tip,
        },
      },
    },
    {
      type: "text",
      from: { data: boxes },
      interactive: false,
      encode: {
        update: {
          x: { signal: "datum.x + datum.w / 2" },
          y: { signal: `datum.y + ${STEP / 2}` },
          text: { field: "text" },
          align: { value: "center" },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: boxes },
      interactive: false,
      encode: {
        update: {
          x: { signal: "datum.x + datum.w / 2" },
          y: { signal: `datum.y + ${STEP + 8}` },
          text: { field: "note" },
          fontSize: { value: NOTE },
          fill: { value: config.muted },
          align: { value: "center" },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: name("texts") },
      interactive: false,
      encode: {
        update: {
          x: { field: "x" },
          y: { field: "y" },
          text: { field: "text" },
          fontSize: { field: "size" },
          fill: { field: "fill" },
          align: { field: "align" },
          fontWeight: { field: "weight" },
        },
      },
    },
    {
      type: "symbol",
      from: { data: badges },
      interactive: false,
      encode: {
        update: {
          x: { signal: "datum.x + datum.w - 1" },
          y: { signal: "datum.y + 1" },
          shape: { value: "circle" },
          size: { value: 121 },
          fill: { value: config.fail },
          opacity: dim(unit),
        },
      },
    },
    {
      type: "text",
      from: { data: badges },
      interactive: false,
      encode: {
        update: {
          x: { signal: "datum.x + datum.w - 1" },
          y: { signal: "datum.y + 1.5" },
          text: { value: "!" },
          fontSize: { value: 8.5 },
          fontWeight: { value: 700 },
          fill: { value: "#ffffff" },
          align: { value: "center" },
          opacity: dim(unit),
        },
      },
    },
  ];
  return part({
    data: [
      ...linked.data,
      { name: all, values: cards, transform: linked.transforms },
      { name: frames, source: all, transform: [{ type: "filter", expr: "datum.scope" }] },
      { name: boxes, source: all, transform: [{ type: "filter", expr: "!datum.scope" }] },
      { name: badges, source: all, transform: [{ type: "filter", expr: "datum.failed" }] },
      { name: name("decks"), values: decks },
      { name: name("rails"), values: rails },
      { name: name("shapes"), values: shapes },
      { name: name("texts"), values: texts },
    ],
    marks,
    width,
    height,
    actors: [...new Set(steps(node).map(([found]) => found.actor))],
    selectable: ground ? [unit.mark("frame"), unit.mark("step")] : [],
  });
}
