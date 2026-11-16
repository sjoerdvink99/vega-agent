import { steps } from "../grammar/ast";
import { print } from "../grammar/print";
import { isGround, trace } from "../grammar/trace";
import type { Interval } from "../spec";
import { isObject, text } from "./records";
import type { Timed } from "./timed";

export type TracedRun = { id: string; process: string; time: Interval[]; agent?: string; group?: string };

export function run(id: string, { node, time }: Timed, agent?: string): TracedRun | null {
  if (!isGround(node)) return null;
  return { id, process: print(node), time, ...(agent ? { agent } : {}) };
}

export const expressions = (items: unknown[]): TracedRun[] => items.flatMap((item) => expression(item) ?? []);

function expression(item: unknown): TracedRun | null {
  const record = typeof item === "string" ? { process: item } : isObject(item) ? item : null;
  if (!record || typeof record.process !== "string") return null;
  try {
    const node = trace(record.process);
    const count = steps(node).length;
    const time = Array.isArray(record.time) && record.time.length === count ? record.time.map(interval) : Array<Interval>(count).fill(null);
    const agent = text(record.agent);
    return { id: text(record.id) ?? "", process: record.process, time, ...(agent ? { agent } : {}) };
  } catch {
    return null;
  }
}

function interval(value: unknown): Interval {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [start, end] = value as unknown[];
  return typeof start === "number" && typeof end === "number" && Number.isFinite(end - start) && end >= start ? [start, end] : null;
}
