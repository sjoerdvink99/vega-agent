import type { Axis, Data, Legend, Mark, NumericValueRef, Scale, Signal, SignalRef, Transforms } from "vega";
import type { Config } from "../config";
import type { Actor } from "../grammar/ast";
import type { UnitSpec } from "../spec";
import { literal } from "./expr";

const DIM = 0.3;

export type Emphasis = { store: string; active: string };

export interface Unit<S extends UnitSpec = UnitSpec> {
  spec: S;
  config: Config;
  name: (local: string) => string;
  mark: (role: string) => string;
  width: string;
  actor: string;
  source: string;
  tables: Set<string>;
  highlight: Emphasis | null;
  filter: Emphasis | null;
}

export interface Part {
  data: Data[];
  signals: Signal[];
  scales: Scale[];
  axes: Axis[];
  legends: Legend[];
  marks: Mark[];
  width: number | string;
  height: number | string;
  actors: Actor[];
  subtitle: string;
  selectable: string[];
}

export const part = (fields: Partial<Part> & Pick<Part, "marks" | "width" | "height" | "actors">): Part => ({
  data: [],
  signals: [],
  scales: [],
  axes: [],
  legends: [],
  subtitle: "",
  selectable: [],
  ...fields,
});

export const extent = (value: number | string): NumericValueRef => (typeof value === "number" ? { value } : { signal: value });

export const contains = (emphasis: Emphasis, field: string) => `indata(${literal(emphasis.store)}, 'data', ${field})`;

export const hit = (unit: Unit, field = "datum.id"): Transforms[] =>
  unit.highlight ? [{ type: "formula", as: "hit", expr: `${contains(unit.highlight, field)} ? 1 : 0` }] : [];

export function dim(unit: Unit, base = 1): NumericValueRef {
  if (!unit.highlight) return { value: base };
  return { signal: `${unit.highlight.active} && !datum.matching ? ${Math.min(base, DIM)} : ${base}` };
}

type Member = { key: string; id: string };

export function membership(unit: Unit, items: string, members: Member[]): { data: Data[]; transforms: Transforms[] } {
  const uses = [...(unit.highlight ? [{ emphasis: unit.highlight, as: "matching" }] : []), ...(unit.filter ? [{ emphasis: unit.filter, as: "kept" }] : [])];
  if (!uses.length) return { data: [], transforms: [] };
  const all = unit.name(`${items}_members`);
  const counted = (as: string) => unit.name(`${items}_${as}`);
  return {
    data: [
      { name: all, values: members },
      ...uses.map(({ emphasis, as }): Data => ({
        name: counted(as),
        source: all,
        transform: [
          { type: "filter", expr: contains(emphasis, "datum.id") },
          { type: "aggregate", groupby: ["key"], ops: ["count"], as: [as] },
        ],
      })),
    ],
    transforms: [
      ...uses.map(({ as }): Transforms => ({ type: "lookup", from: counted(as), key: "key", fields: ["key"], values: [as], default: 0 })),
      ...(unit.filter ? [{ type: "filter" as const, expr: `!(${unit.filter.active}) || datum.kept > 0` }] : []),
    ],
  };
}

export function band(unit: Unit, role: string, data: string, y: string, height: number, width: string, tip: { tooltip?: SignalRef }): Mark {
  return {
    type: "rect",
    name: unit.mark(role),
    from: { data },
    encode: {
      update: {
        x: { value: -6 },
        width: { signal: `${width} + 12` },
        y: { signal: y },
        height: { value: height },
        cornerRadius: { value: 4 },
        fill: { value: unit.config.panel },
        fillOpacity: { value: 0 },
        ...tip,
      },
      hover: { fillOpacity: { value: 0.6 } },
    },
  };
}
