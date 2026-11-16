import { append } from "../collections";
import type { ActorChannel, FailedChannel, Mapping, StepMapping, TimeChannel, TimeUnit } from "../spec";
import { lookup, term, type Kind } from "./conventions";
import { category, identifier, instant, isObject, pick, seconds, text, truthy, type Record_ } from "./records";
import type { TracedRun } from "./runs";
import { build, parent, type Span } from "./spans";

const PER_SECOND: Record<TimeUnit, number> = { s: 1, ms: 1e3, us: 1e6, ns: 1e9 };

const fieldOf = (channel: string | { field: string }) => (typeof channel === "string" ? channel : channel.field);

export const groupOf = (mapping: Mapping): string | undefined => (mapping.group === undefined ? undefined : fieldOf(mapping.group));

export const orderOf = (mapping: Mapping): string[] => (typeof mapping.group === "object" ? mapping.group.order : []);

export const isStepMapping = (mapping: Mapping): mapping is StepMapping => mapping.actor !== undefined;

const runOf = (record: unknown, mapping: Mapping) => (mapping.run === undefined ? "" : (category(pick(record, mapping.run)) ?? ""));

export function attribute(items: unknown[], mapping: Mapping, field: string): (string | null)[] {
  const own = items.map((item) => category(pick(item, field)));
  if (!isStepMapping(mapping)) return own;
  const first = new Map<string, string>();
  items.forEach((item, index) => {
    const [run, value] = [runOf(item, mapping), own[index]];
    if (value !== null && !first.has(run)) first.set(run, value);
  });
  return items.map((item) => first.get(runOf(item, mapping)) ?? null);
}

export function partition(items: unknown[], mapping: Mapping, field: string): [string, unknown[]][] {
  const values = attribute(items, mapping, field);
  const parts = new Map<string, unknown[]>();
  items.forEach((item, index) => {
    const value = values[index];
    if (value !== null) append(parts, value, item);
  });
  return [...parts];
}

export function mapped(items: unknown[], mapping: StepMapping): TracedRun[] {
  const records = items.filter(isObject);
  const runs = build(records.map((record, index) => span(record, index, mapping)));
  const group = groupOf(mapping);
  if (group === undefined) return runs;
  const values = attribute(records, mapping, group);
  const groups = new Map(records.map((record, index) => [runOf(record, mapping), values[index]]));
  return runs.flatMap((run) => {
    const found = groups.get(run.id);
    return found === undefined || found === null ? [] : [{ ...run, group: found }];
  });
}

function span(record: Record_, index: number, mapping: StepMapping): Span {
  const value = (channel: string | undefined) => (channel === undefined ? undefined : pick(record, channel));
  const id = text(value(mapping.step)) || `#${index}`;
  const name = identifier(value(mapping.name));
  const start = moment(record, mapping.start);
  return {
    id,
    parent: mapping.parent === undefined ? null : parent(value(mapping.parent), id),
    trace: runOf(record, mapping),
    title: name ?? "",
    start,
    end: mapping.end === undefined ? start : moment(record, mapping.end),
    failed: mapping.failed !== undefined && failure(record, mapping.failed),
    kind: kind(record, mapping.actor, name),
  };
}

function kind(record: Record_, channel: string | ActorChannel, name: string | null): Kind {
  const value = category(pick(record, fieldOf(channel)));
  if (value === null) return null;
  const target = typeof channel === "object" && channel.map ? lookup(channel.map, value) : undefined;
  const found = target === undefined ? term(value) : target === null ? null : term(target);
  return found && { actor: found.actor, name: name ?? found.name };
}

function failure(record: Record_, channel: string | FailedChannel): boolean {
  const value = pick(record, fieldOf(channel));
  return typeof channel === "string" ? truthy(value) : value === channel.equal;
}

function moment(record: Record_, channel: string | TimeChannel | undefined): number | null {
  if (channel === undefined) return null;
  const value = pick(record, fieldOf(channel));
  return typeof channel === "string" ? instant(value) : seconds(value, PER_SECOND[channel.unit]);
}
