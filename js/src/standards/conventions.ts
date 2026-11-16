import conventions from "../../../grammar/conventions.json";
import { ACTORS, type Actor } from "../grammar/ast";
import { mapping, objects, text, unquoted, type Record_ } from "./records";

export type Kind = { actor: Actor; name: string | null } | null;

type Rule = { key: string; values: Record<string, string | null> };

const CONVENTIONS = conventions as unknown as {
  rules: Rule[];
  names: Record<string, string[]>;
  failure: { status: (string | number)[]; attributes: string[]; events: string[] };
  spans: Record<string, Record<string, string | null>>;
  messages: { roles: Record<string, string>; hosted: string[]; calls: string[]; injected: string[]; subagents: string[] };
  trajectories: { openhands: Record<string, string> };
};

export const MESSAGES = CONVENTIONS.messages;
export const OPENHANDS = CONVENTIONS.trajectories.openhands;
export const OPERATIONS = new Set(CONVENTIONS.rules.flatMap((rule) => Object.keys(rule.values)));
const VOCABULARY = new Map(
  [...CONVENTIONS.rules.map((rule) => rule.values), ...Object.values(CONVENTIONS.spans)].flatMap((table) =>
    Object.entries(table).map(([key, value]): [string, string | null] => [key.toLowerCase(), value]),
  ),
);

const owns = (table: object, key: string) => Object.prototype.hasOwnProperty.call(table, key);

export function lookup<V>(table: Record<string, V>, key: string | null): V | undefined {
  return key !== null && owns(table, key) ? table[key] : undefined;
}

function target(value: string | null | undefined): Kind {
  if (!value) return null;
  const [actor, ...name] = value.split(".");
  return { actor: actor as Actor, name: name.join(".") || null };
}

export function term(value: string): Kind {
  const known = VOCABULARY.get(value.toLowerCase());
  if (known !== undefined) return target(known);
  const found = target(value);
  return found && (ACTORS as readonly string[]).includes(found.actor) ? found : null;
}

export function classify(attributes: Record_): Kind {
  for (const rule of CONVENTIONS.rules) {
    const value = unquoted(attributes[rule.key]);
    if (value !== null && owns(rule.values, value)) return target(rule.values[value]);
  }
  return null;
}

export function named(actor: Actor, attributes: Record_): string | null {
  for (const key of lookup(CONVENTIONS.names, actor) ?? []) {
    const value = unquoted(attributes[key]);
    if (value) return value;
  }
  return null;
}

export function failed(status: unknown, attributes: Record_, events?: unknown): boolean {
  const rules = CONVENTIONS.failure;
  return (
    rules.status.some((value) => value === status) ||
    rules.attributes.some((key) => owns(attributes, key)) ||
    objects(events).some((event) => rules.events.includes(text(event.name) ?? ""))
  );
}

export function kind(table: string, value: unknown): Kind {
  return target(lookup(mapping(lookup(CONVENTIONS.spans, table)) as Record<string, string | null>, text(value)));
}
