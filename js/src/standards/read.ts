import type { Format, Mapping } from "../spec";
import { checkMapping } from "../validate";
import { groupOf, isStepMapping, mapped, partition } from "./mapping";
import { claudeCode, codex, messages } from "./messages";
import { isObject, list, mapping, objects, records, text, type Record_ } from "./records";
import { expressions, type TracedRun } from "./runs";
import { langfuse, langsmith, openaiAgents, otel } from "./spans";
import { atif, openhands, sweAgent } from "./trajectories";

const READERS: Record<Format, (items: unknown[]) => TracedRun[]> = {
  runs: expressions,
  otel,
  openai_agents: openaiAgents,
  langsmith,
  langfuse,
  messages,
  codex,
  claude_code: claudeCode,
  atif,
  swe_agent: sweAgent,
  openhands,
};

export const FORMATS = Object.keys(READERS) as Format[];

const CODEX = new Set(["session_meta", "response_item", "turn_context", "event_msg", "compacted"]);
const SPANS = ["spanId", "span_id", "spanID", "traceId", "trace_id", "attributes"];
const SAMPLE = 64;

export function read(source: unknown, format?: Format | Mapping): TracedRun[] {
  if (typeof format === "object" && format !== null) return traced(records(source), undefined, checkMapping(format, "format"));
  if (format !== undefined && !FORMATS.includes(format)) {
    throw new TypeError(`unknown format ${JSON.stringify(format)}, expected one of ${FORMATS.join(", ")}`);
  }
  return traced(records(source), format);
}

export function traced(items: unknown[], format?: Format, how: Mapping = {}): TracedRun[] {
  const found = isStepMapping(how) ? mapped(items, how) : partitioned(items, READERS[format ?? detect(items)], how);
  return found.map((run, index) => (run.id ? run : { ...run, id: String(index) }));
}

function partitioned(items: unknown[], reader: (items: unknown[]) => TracedRun[], how: Mapping): TracedRun[] {
  const group = groupOf(how);
  if (group === undefined) return reader(items);
  return partition(items, how, group).flatMap(([name, part]) => reader(part).map((run) => ({ ...run, group: name })));
}

export function detect(items: unknown[]): Format {
  for (const item of items.filter((each) => typeof each === "string" || isObject(each)).slice(0, SAMPLE)) {
    if (typeof item === "string" || typeof item.process === "string") return "runs";
    const found = shape(item);
    if (found) return found;
  }
  return "messages";
}

function shape(item: Record_): Exclude<Format, "runs"> | null {
  const data = item.data;
  if ("resourceSpans" in item || "batches" in item) return "otel";
  if (item.object === "trace.span" || isObject(item.span_data)) return "openai_agents";
  if ("run_type" in item || "child_runs" in item) return "langsmith";
  if (Array.isArray(item.observations) || "parentObservationId" in item) return "langfuse";
  if (String(item.schema_version ?? "").startsWith("ATIF") || ("steps" in item && "agent" in item)) return "atif";
  if (CODEX.has(text(item.type) ?? "") && isObject(item.payload)) return "codex";
  if ((item.type === "user" || item.type === "assistant") && "sessionId" in item && isObject(item.message)) return "claude_code";
  if (Array.isArray(item.trajectory) || String(item.trajectory_format ?? "").startsWith("mini-swe-agent")) return "swe_agent";
  if (("action" in item || "observation" in item) && "source" in item) return "openhands";
  if (objects(list(item.history).slice(0, 1)).some((event) => shape(event) === "openhands")) return "openhands";
  const nested = objects(list(item.spans).slice(0, 1)).map(shape)[0];
  if (nested) return nested;
  const spans = isObject(data) && "spans" in data;
  const jaeger = ("traceID" in item && "spans" in item) || objects(data).some((each) => "spans" in each);
  if (spans || jaeger || SPANS.some((key) => key in item) || "span_id" in mapping(item.context)) return "otel";
  return null;
}
