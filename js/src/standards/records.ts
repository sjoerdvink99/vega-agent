export type Record_ = Record<string, unknown>;

export const READ_DEPTH = 24;
const NANOSECONDS = 1e9;
export const MICROSECONDS = 1e6;
const MILLISECONDS = 1e3;
const SECONDS = 1;
const EARLIEST = -62135596800;
const LATEST = 253402300799;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

export const isObject = (value: unknown): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value);
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const objects = (value: unknown): Record_[] => list(value).filter(isObject);
export const mapping = (value: unknown): Record_ => (isObject(value) ? value : {});
export const first = (...values: unknown[]): unknown => values.find((value) => value !== undefined && value !== null) ?? null;

const owns = (record: Record_, key: string) => Object.prototype.hasOwnProperty.call(record, key);

export function pick(record: unknown, path: string): unknown {
  if (!isObject(record)) return undefined;
  if (owns(record, path)) return record[path];
  const parts = path.split(".");
  for (let split = parts.length - 1; split > 0; split -= 1) {
    const head = parts.slice(0, split).join(".");
    if (owns(record, head)) return pick(record[head], parts.slice(split).join("."));
  }
  return undefined;
}

export const category = (value: unknown): string | null => (typeof value === "boolean" ? String(value) : text(value));

export function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return typeof value === "number" ? value !== 0 : Boolean(value);
}

export const either = (...values: unknown[]): unknown => values.find(truthy) ?? null;

export function records(source: unknown): unknown[] {
  if (typeof source === "string") return parse(source);
  if (Array.isArray(source)) return source;
  if (isObject(source)) return [source];
  throw new TypeError(`expected records, a record, or JSON text, found ${source === null ? "null" : typeof source}`);
}

function parse(content: string): unknown[] {
  try {
    const loaded: unknown = JSON.parse(content);
    return Array.isArray(loaded) ? loaded : [loaded];
  } catch {
    return content.split(/\r?\n/).flatMap((line) => {
      try {
        return line.trim() ? [JSON.parse(line) as unknown] : [];
      } catch {
        return [];
      }
    });
  }
}

export function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number.isInteger(value) ? BigInt(value).toString() : String(value);
}

export function unquoted(value: unknown): string | null {
  const found = text(value);
  if (!found || found.length < 2 || !found.startsWith('"') || !found.endsWith('"')) return found;
  try {
    const decoded: unknown = JSON.parse(found);
    return typeof decoded === "string" ? decoded : found;
  } catch {
    return found;
  }
}

export function identifier(value: unknown): string | null {
  const cleaned = (text(value) ?? "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return null;
  return /^\d/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function seconds(value: unknown, perSecond = NANOSECONDS): number | null {
  if (value === undefined || value === null || value === "" || typeof value === "boolean") return null;
  let parsed = NaN;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) parsed = Number(value) / perSecond;
  else if (typeof value === "string") parsed = moment(value);
  return parsed >= EARLIEST && parsed <= LATEST ? parsed : null;
}

export function instant(value: unknown): number | null {
  if (typeof value !== "number") return seconds(value, SECONDS);
  const magnitude = Math.abs(value);
  const scale = magnitude < 1e11 ? SECONDS : magnitude < 1e14 ? MILLISECONDS : magnitude < 1e17 ? MICROSECONDS : NANOSECONDS;
  return seconds(value, scale);
}

function moment(value: string): number {
  const found = ISO.exec(value.trim());
  if (!found) return NaN;
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((index) => Number(found[index] ?? 0));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  const valid = year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!valid || hour > 23 || minute > 59 || second > 59) return NaN;
  const micros = Number((found[7] ?? "").padEnd(6, "0").slice(0, 6));
  return (date.getTime() * 1000 + micros) / 1e6 - offset(found[8]);
}

function offset(zone: string | undefined): number {
  if (!zone || zone.toUpperCase() === "Z") return 0;
  const digits = zone.slice(1).replace(":", "");
  const [hours, minutes] = [Number(digits.slice(0, 2)), Number(digits.slice(2))];
  if (hours > 23 || minutes > 59) return NaN;
  return (zone.startsWith("-") ? -1 : 1) * (hours * 3600 + minutes * 60);
}
