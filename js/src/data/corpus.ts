import { remember } from "../collections";
import { find } from "../grammar/match";
import { trace } from "../grammar/trace";
import type { InlineData, Mapping, Sourced, Transform } from "../spec";
import { orderOf } from "../standards/mapping";
import { traced } from "../standards/read";
import type { TracedRun } from "../standards/runs";
import { tables, type Tables } from "./tables";
import { filtered } from "./transform";

export type Corpus = { groups: string[]; runs: TracedRun[]; tables: Tables };

const read = new WeakMap<InlineData, Map<string, Corpus>>();

const NONE: InlineData = { values: [] };

export function corpus({ data, transform = [], trace: how = {} }: Sourced): Corpus {
  const inline = data && "values" in data ? data : NONE;
  return remember(
    remember(read, inline, () => new Map()),
    JSON.stringify([transform, how]),
    () => load(inline, transform, how),
  );
}

function load({ values, format }: InlineData, transform: Transform[], how: Mapping): Corpus {
  const runs = traced(filtered(values, transform), format, how);
  const groups = how.group === undefined ? ["runs"] : [...new Set([...orderOf(how), ...runs.map((run) => run.group ?? "runs")])];
  return { groups, runs, tables: tables(runs) };
}

export function hits({ runs, tables: { runs: rows } }: Corpus, query: string): Map<number, number[]> {
  const found = new Map<number, number[]>();
  rows.forEach(({ full }, index) => {
    if (!found.has(full)) found.set(full, [...new Set(find(trace(runs[index].process), query).flatMap((hit) => hit.steps))]);
  });
  return found;
}

export function matching(data: Corpus, query: string): string[] {
  const found = hits(data, query);
  return data.tables.runs.filter((row) => found.get(row.full)?.length).map((row) => row.id);
}
