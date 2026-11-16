import type { SignalRef } from "vega";
import type { Field } from "../spec";
import { literal } from "./expr";
import type { Unit } from "./unit";

export type Fields = Partial<Record<Field, string>>;

export function tooltip(unit: Unit, title: string, fields: Fields): { tooltip?: SignalRef } {
  const setting = unit.spec.tooltip ?? true;
  if (setting === false) return {};
  const available: Fields = unit.highlight && "data" in unit.spec ? { ...fields, matching: "datum.matching" } : fields;
  const chosen =
    setting === true
      ? Object.entries(available).map(([field, value]) => [field, value])
      : setting.flatMap((entry) => {
          const { field, title: name = field } = typeof entry === "string" ? { field: entry } : entry;
          const value = available[field];
          return value === undefined ? [] : [[name, value]];
        });
  const entries = [["title", title], ...chosen].map(([key, value]) => `${literal(key)}: ${value}`);
  return { tooltip: { signal: `{${entries.join(", ")}}` } };
}
