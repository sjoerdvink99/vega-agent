import { OPENHANDS, lookup } from "./conventions";
import { EXIT, Transcript, call, runs, trace, type Call } from "./messages";
import { READ_DEPTH, first, instant, isObject, list, mapping, objects, records, text, truthy, type Record_ } from "./records";
import type { TracedRun } from "./runs";

const FENCED = /```(?:bash|sh|shell)\b/;
const RETURNCODE = /<returncode>\s*(-?\d+)\s*<\/returncode>/;

export function atif(source: unknown): TracedRun[] {
  return records(source)
    .filter(isObject)
    .map((document, index) => {
      const id = text(document.trajectory_id) || text(document.session_id) || String(index);
      return trace(trajectory(document, 0), id, text(mapping(document.agent).name));
    })
    .filter((each): each is TracedRun => each !== null);
}

function trajectory(document: Record_, depth: number): Transcript {
  const subagents = new Map(objects(document.subagent_trajectories).map((sub) => [text(sub.trajectory_id), sub]));
  const transcript = new Transcript();
  for (const step of objects(document.steps)) {
    const at = instant(step.timestamp);
    if (step.source === "user") transcript.human(at);
    if (step.source !== "agent") continue;
    const results = new Map(objects(mapping(step.observation).results).map((result) => [text(result.source_call_id), result]));
    const calls = objects(step.tool_calls).map((each) => invoked(each, mapping(results.get(text(each.tool_call_id))), subagents, at, depth));
    transcript.model(calls, { at, actor: step.llm_call_count === 0 ? "code" : "model" });
  }
  return transcript;
}

function invoked(each: Record_, result: Record_, subagents: Map<string | null, Record_>, at: number | null, depth: number): Call {
  const found = call(text(each.tool_call_id), each.function_name, at);
  found.failed = truthy(mapping(result.extra).is_error);
  const refs = result.subagent_trajectory_ref;
  if (!truthy(refs)) return found;
  found.actor = "agent";
  if (depth >= READ_DEPTH) return found;
  for (const ref of objects(isObject(refs) ? [refs] : refs)) {
    const sub = subagents.get(text(ref.trajectory_id));
    if (sub) found.bodies.push(trajectory(sub, depth + 1));
  }
  return found;
}

export const sweAgent = (source: unknown): TracedRun[] =>
  runs(
    records(source)
      .filter(isObject)
      .map((document, index) => [named(document, index), swe(document)]),
  );

function swe(document: Record_): Transcript {
  const transcript = new Transcript();
  if (Array.isArray(document.trajectory)) {
    for (const step of objects(document.trajectory)) {
      const words = (text(step.action) ?? "").split(/\s+/).filter(Boolean);
      transcript.model(words.length ? [call(null, words[0], null)] : []);
    }
    return transcript;
  }
  let last: Call | null = null;
  for (const message of objects(document.messages)) {
    const content = text(message.content) ?? "";
    if (message.role === "assistant") {
      last = FENCED.test(content) ? call(null, "bash", null) : null;
      transcript.model(last ? [last] : []);
    } else if (message.role === "user" && last) {
      const code = RETURNCODE.exec(content);
      last.failed = Boolean(code && Number(code[1]) !== 0);
      last = null;
    }
  }
  return transcript;
}

export const openhands = (source: unknown): TracedRun[] => runs(histories(records(source).filter(isObject)).map(([id, events]) => [id, eventsOf(events)]));

function histories(items: Record_[]): [string, unknown[]][] {
  if (items.length && items.every((item) => "action" in item || "observation" in item)) return [["0", items]];
  return items.map((item, index) => [named(item, index), list(first(item.history, item.events))]);
}

function eventsOf(events: unknown[]): Transcript {
  const transcript = new Transcript();
  for (const event of events.filter(isObject)) {
    const at = instant(event.timestamp);
    if ("observation" in event) {
      transcript.result(text(event.cause), erred(event), at);
      continue;
    }
    const action = text(event.action);
    if (event.source === "user" && action === "message") transcript.human(at);
    const actor = lookup(OPENHANDS, action ?? "");
    if (event.source !== "agent" || actor === undefined) continue;
    const response = mapping(mapping(event.tool_call_metadata).model_response).id;
    const args = mapping(event.args);
    const name = action === "mcp" ? args.name : action === "delegate" ? args.agent : action;
    const calls = actor === "model" ? [] : [call(text(event.id), name, at, actor === "agent" ? "agent" : "tool")];
    transcript.model(calls, { at, key: text(response) });
  }
  return transcript;
}

function erred(event: Record_): boolean {
  const extras = mapping(event.extras);
  const code = first(mapping(extras.metadata).exit_code, extras.exit_code);
  if (event.observation === "error" || event.success === false) return true;
  if (typeof code === "number" && Number.isInteger(code)) return code !== 0 && code !== -1;
  const found = event.observation === "run" ? EXIT.exec((text(event.content) ?? "").slice(-400)) : null;
  return Boolean(found && Number(found[1]) !== 0);
}

function named(document: Record_, index: number): string {
  const info = mapping(document.info);
  return text(first(document.instance_id, info.instance_id, document.id)) || String(index);
}
