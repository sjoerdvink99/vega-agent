import { EMPTY, type Actor } from "../grammar/ast";
import type { Interval } from "../spec";
import { MESSAGES, lookup } from "./conventions";
import { READ_DEPTH, first, identifier, instant, isObject, list, mapping, objects, records, text, truthy, type Record_ } from "./records";
import { run, type TracedRun } from "./runs";
import { timedParallel, timedSequence, timedStep, type Timed } from "./timed";

const ROLES = MESSAGES.roles;
const HOSTED = new Set(MESSAGES.hosted);
const CALLS = new Set(MESSAGES.calls);
const SUBAGENTS = new Set(MESSAGES.subagents);
const INVOKED = new Set(["function_call", "custom_tool_call"]);
const RETURNED = new Set(["function_call_output", "custom_tool_call_output"]);
const ITEMS = new Set(["message", "reasoning", ...INVOKED, ...RETURNED, ...HOSTED]);
export const EXIT = /exit[ _]?code\W{0,3}(-?\d+)/i;

export type Call = { id: string | null; name: unknown; start: number | null; actor: Actor; bodies: Transcript[]; failed: boolean; end: number | null };
type Turn = { actor: Actor; start: number | null; end: number | null; calls: Call[] };
type Moment = number | null;

export const call = (id: string | null, name: unknown, start: Moment, actor: Actor = "tool"): Call => ({
  id,
  name,
  start,
  actor,
  bodies: [],
  failed: false,
  end: null,
});
const earliest = (...values: Moment[]): Moment => values.find((value) => value !== null) ?? null;

export class Transcript {
  turns: Turn[] = [];
  pending = new Map<string, Call>();
  private keyed = new Map<string, Turn>();
  private open = false;
  private clock: Moment = null;

  human(at: Moment) {
    this.turns.push({ actor: "human", start: at, end: at, calls: [] });
    this.open = false;
    this.tick(at);
  }

  model(
    calls: Call[] = [],
    { merge = false, at = null, key = null, actor = "model" }: { merge?: boolean; at?: Moment; key?: string | null; actor?: Actor } = {},
  ) {
    let turn = key !== null ? this.keyed.get(key) : undefined;
    if (!turn && merge && this.open) turn = this.turns[this.turns.length - 1];
    if (!turn) {
      turn = { actor, start: earliest(this.clock, at), end: at, calls: [] };
      this.turns.push(turn);
      this.open = true;
      if (key !== null) this.keyed.set(key, turn);
    }
    turn.end = earliest(at, turn.end);
    for (const each of calls) {
      turn.calls.push(each);
      if (each.id !== null) this.pending.set(each.id, each);
    }
    this.tick(at);
  }

  result(id: string | null, failed: boolean, at: Moment) {
    this.open = false;
    const found = id !== null ? this.pending.get(id) : undefined;
    if (found) {
      found.failed = found.failed || failed;
      found.end = earliest(at, found.end);
    }
    this.tick(at);
  }

  private tick(at: Moment) {
    if (at !== null) this.clock = at;
  }
}

export const messages = (source: unknown): TracedRun[] => runs(conversations(records(source)).map(([id, items]) => [id, transcribe(items)]));

export function codex(source: unknown): TracedRun[] {
  const sessions: [string, Record_[]][] = [];
  for (const item of records(source).filter(isObject)) {
    const payload = mapping(item.payload);
    if (item.type === "session_meta" || !sessions.length) {
      const id = item.type === "session_meta" ? text(payload.id) : null;
      if (sessions.length && !sessions[sessions.length - 1][1].length) sessions.pop();
      sessions.push([id || String(sessions.length), []]);
    }
    if (item.type === "response_item" && truthy(payload)) sessions[sessions.length - 1][1].push({ ...payload, timestamp: item.timestamp });
  }
  return runs(sessions.map(([id, items]) => [id, transcribe(items)]));
}

type Threads = Map<string, Record_[]>;

export function claudeCode(source: unknown): TracedRun[] {
  const lines = records(source)
    .filter(isObject)
    .filter((item) => (item.type === "user" || item.type === "assistant") && isObject(item.message));
  const sessions: Threads = new Map();
  const threads: Threads = new Map();
  for (const line of lines) {
    const [table, key] = line.isSidechain === true ? [threads, line.agentId] : [sessions, line.sessionId];
    const id = text(key) || "";
    table.set(id, [...(table.get(id) ?? []), line]);
  }
  const links = new Map<string, string>();
  for (const line of lines) {
    const agent = text(mapping(line.toolUseResult).agentId);
    if (!agent) continue;
    for (const block of blocks(mapping(line.message))) {
      const id = text(block.tool_use_id);
      if (id) links.set(id, agent);
    }
  }
  return runs([...sessions].map(([id, group], index) => [id || String(index), session(group, threads, links, false, 0)]));
}

function session(lines: Record_[], threads: Threads, links: Map<string, string>, delegated: boolean, depth: number): Transcript {
  const transcript = new Transcript();
  for (const line of lines) {
    if (line.isMeta === true || line.isCompactSummary === true) continue;
    const message = mapping(line.message);
    const at = instant(line.timestamp);
    if (line.type === "user") {
      user(message, transcript, at, !delegated);
      continue;
    }
    const calls = callsIn(message, at);
    const byId = new Map(calls.filter((each) => each.id).map((each) => [each.id, each]));
    for (const block of blocks(message)) {
      const found = byId.get(text(block.id));
      if (block.type !== "tool_use" || !SUBAGENTS.has(text(block.name) ?? "") || !found) continue;
      found.actor = "agent";
      found.name = mapping(block.input).subagent_type;
      const thread = threads.get(links.get(found.id ?? "") ?? "") ?? [];
      if (thread.length && depth < READ_DEPTH) found.bodies.push(session(thread, threads, links, true, depth + 1));
    }
    transcript.model(calls, { at, key: text(message.id) || text(line.uuid) });
  }
  return transcript;
}

export function runs(transcripts: [string, Transcript][]): TracedRun[] {
  return transcripts.map(([id, transcript]) => trace(transcript, id)).filter((each): each is TracedRun => each !== null);
}

export function trace(transcript: Transcript, id: string, agent?: string | null): TracedRun | null {
  const process = build(transcript, 0);
  if (process.node === EMPTY) return null;
  return run(id, process, agent || undefined);
}

function build(transcript: Transcript, depth: number): Timed {
  return timedSequence(
    transcript.turns.flatMap((turn) => [
      timedStep(turn.actor, {}, interval(turn.start, turn.end)),
      timedParallel(turn.calls.map((each) => invoke(each, depth))),
    ]),
  );
}

function invoke(each: Call, depth: number): Timed {
  const bodies = depth < READ_DEPTH ? each.bodies : [];
  const body = timedParallel(bodies.map((nested) => build(nested, depth + 1)));
  return timedStep(each.actor, { name: identifier(each.name), failed: each.failed }, interval(each.start, earliest(each.end, each.start)), body);
}

const interval = (start: Moment, end: Moment): Interval => (start !== null && end !== null && end >= start ? [start, end] : null);

function transcribe(items: unknown[]): Transcript {
  const transcript = new Transcript();
  for (const item of items.filter(isObject)) {
    const message = normal(item);
    read(message, transcript, instant(first(item.timestamp, message.timestamp)));
  }
  return transcript;
}

function conversations(items: unknown[]): [string, unknown[]][] {
  if (items.length && items.every(isMessage)) return [["0", items]];
  return items.flatMap((item, index): [string, unknown[]][] => {
    if (Array.isArray(item)) return [[String(index), item]];
    if (!isObject(item)) return [];
    if (Array.isArray(item.samples)) return objects(item.samples).map((sample, position) => [named(sample, position), conversation(sample)]);
    return [[named(item, index), conversation(item)]];
  });
}

function named(record: Record_, index: number): string {
  const base = text(first(record.id, record.conversation_id)) || String(index);
  const epoch = text(record.epoch);
  return epoch ? `${base}:${epoch}` : base;
}

function conversation(record: Record_): unknown[] {
  const key = ["contents", "conversations", "messages", "events", "input"].find((each) => Array.isArray(record[each]));
  const replies = objects(record.choices).map((choice) => choice.message);
  return [...(key ? list(record[key]) : []), ...list(record.output), ...replies];
}

function isMessage(item: unknown): boolean {
  if (!isObject(item)) return false;
  const message = normal(item);
  return "role" in message || role(message) !== null || ITEMS.has(text(message.type) ?? "") || message.kind === "request" || message.kind === "response";
}

function normal(message: Record_): Record_ {
  const { kwargs, data, content } = message;
  if (message.lc !== undefined && message.lc !== null && isObject(kwargs)) {
    const names = list(message.id);
    const last = (names.length ? text(names[names.length - 1]) : null) || "";
    return { ...kwargs, type: last.replace(/(Message)?(Chunk)?$/, "").toLowerCase() };
  }
  if (isObject(data) && lookup(ROLES, text(message.type)) !== undefined && !("role" in message)) return { ...data, type: message.type };
  if ("from" in message && "value" in message) return shared(message);
  if (!("role" in message) && isObject(content) && ("role" in content || "parts" in content))
    return { role: message.author === "user" ? "user" : "model", ...content };
  return message;
}

function shared(message: Record_): Record_ {
  const from = (text(message.from) ?? "").toLowerCase();
  if (from !== "function_call" && from !== "tool_call") return { role: from, content: text(message.value) ?? "" };
  let parsed: unknown = message.value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  return { role: "assistant", tool_calls: (Array.isArray(parsed) ? parsed : [parsed]).map((each) => ({ name: mapping(each).name })) };
}

function role(message: Record_): string | null {
  const kind = text(message.type);
  const found = text(message.role) || (lookup(ROLES, kind) !== undefined ? kind : null);
  return found ? (lookup(ROLES, found.toLowerCase()) ?? null) : null;
}

function read(message: Record_, transcript: Transcript, at: Moment) {
  const kind = text(message.type) ?? "";
  const speaker = role(message);
  if (HOSTED.has(kind)) {
    const id = text(first(message.id, message.call_id)) || kind;
    const found = call(id, kind === "mcp_call" ? message.name : kind.replace(/_call$/, ""), at);
    found.failed = message.status === "failed";
    transcript.model([found], { merge: true, at });
  } else if (INVOKED.has(kind)) transcript.model([call(text(first(message.call_id, message.id)), message.name, at)], { merge: true, at });
  else if (RETURNED.has(kind)) transcript.result(text(message.call_id), exited(message.output), at);
  else if (kind === "reasoning") transcript.model([], { merge: true, at });
  else if (message.kind === "response") transcript.model(partsIn(message, at), { at });
  else if (message.kind === "request") request(message, transcript, at);
  else if (speaker === "assistant") transcript.model(callsIn(message, at), { merge: kind === "message", at });
  else if (speaker === "tool") tool(message, transcript, at);
  else if (speaker === "user") user(message, transcript, at);
}

function exited(output: unknown): boolean {
  let parsed: unknown = output;
  if (typeof output === "string") {
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = null;
    }
  }
  let code: unknown = mapping(mapping(parsed).metadata).exit_code;
  const found = typeof output === "string" ? EXIT.exec(output.slice(0, 400)) : null;
  if ((code === undefined || code === null) && found) code = Number(found[1]);
  return typeof code === "number" && Number.isInteger(code) && code !== 0;
}

function callsIn(message: Record_, at: Moment): Call[] {
  const calls = objects(message.tool_calls).map((each) => {
    const fn = each.function;
    return call(text(each.id), first(mapping(fn).name, typeof fn === "string" ? fn : null, each.name), at);
  });
  if (isObject(message.function_call)) calls.push(call(text(message.function_call.name), message.function_call.name, at));
  for (const block of blocks(message)) {
    const gemini = block.functionCall;
    const bedrock = block.toolUse;
    if (CALLS.has(text(block.type) ?? "")) calls.push(call(text(block.id), block.name, at));
    else if (isObject(gemini)) calls.push(call(text(first(gemini.id, gemini.name)), gemini.name, at));
    else if (isObject(bedrock)) calls.push(call(text(bedrock.toolUseId), bedrock.name, at));
  }
  return calls;
}

function partsIn(message: Record_, at: Moment): Call[] {
  return objects(message.parts)
    .filter((part) => part.part_kind === "tool-call" || part.part_kind === "builtin-tool-call")
    .map((part) => call(text(part.tool_call_id), part.tool_name, at));
}

function request(message: Record_, transcript: Transcript, at: Moment) {
  for (const part of objects(message.parts)) {
    const moment = earliest(instant(part.timestamp), at);
    if (part.part_kind === "user-prompt") transcript.human(moment);
    else if (part.part_kind === "tool-return" || part.part_kind === "builtin-tool-return") transcript.result(text(part.tool_call_id), false, moment);
    else if (part.part_kind === "retry-prompt") transcript.result(truthy(part.tool_name) ? text(part.tool_call_id) : null, true, moment);
  }
}

function outcome(block: Record_): [string | null, boolean] | null {
  const gemini = block.functionResponse;
  const bedrock = block.toolResult;
  if (block.type === "tool_result") return [text(block.tool_use_id), truthy(block.is_error)];
  if (isObject(gemini)) return [text(first(gemini.id, gemini.name)), "error" in mapping(gemini.response)];
  if (isObject(bedrock)) return [text(bedrock.toolUseId), bedrock.status === "error"];
  return null;
}

function tool(message: Record_, transcript: Transcript, at: Moment) {
  const erred = truthy(message.error) || message.status === "error" || message.is_error === true;
  transcript.result(text(first(message.tool_call_id, message.tool_use_id)), erred, at);
  for (const block of blocks(message)) {
    const found = outcome(block);
    if (found) transcript.result(found[0], found[1], at);
  }
}

function user(message: Record_, transcript: Transcript, at: Moment, spoken = true) {
  const all = blocks(message);
  const outcomes = all.map(outcome).filter((each): each is [string | null, boolean] => each !== null);
  for (const [id, erred] of outcomes) transcript.result(id, erred, at);
  const content = message.content;
  const said = typeof content === "string" || outcomes.length < all.length;
  if (spoken && said && !injected(content, all)) transcript.human(at);
}

function injected(content: unknown, all: Record_[]): boolean {
  const texts = typeof content === "string" ? [content] : all.map((block) => text(block.text) ?? "");
  return texts.length > 0 && texts.every((each) => MESSAGES.injected.some((prefix) => each.trimStart().startsWith(prefix)));
}

const blocks = (message: Record_): Record_[] => [...objects(message.content), ...objects(message.parts)];
