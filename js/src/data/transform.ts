import type { Predicate, Transform } from "../spec";
import { pick } from "../standards/records";

export function filtered(records: unknown[], transform: Transform[] = []): unknown[] {
  return transform.reduce((kept, { filter }) => kept.filter((record) => holds(filter, record)), records);
}

function holds(predicate: Predicate, record: unknown): boolean {
  if ("and" in predicate) return predicate.and.every((each) => holds(each, record));
  if ("or" in predicate) return predicate.or.some((each) => holds(each, record));
  if ("not" in predicate) return !holds(predicate.not, record);
  const value = pick(record, predicate.field);
  if ("equal" in predicate) return value === predicate.equal;
  if ("oneOf" in predicate) return predicate.oneOf.some((each) => each === value);
  if ("valid" in predicate) return valid(value) === predicate.valid;
  const [low, high] = predicate.range;
  return typeof value === "number" && Number.isFinite(value) && (low === null || value >= low) && (high === null || value <= high);
}

const valid = (value: unknown) => value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value));
