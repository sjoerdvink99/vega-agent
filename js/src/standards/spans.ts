import { EMPTY } from "../grammar/ast";
import { append } from "../collections";
import { OPERATIONS, classify, failed, kind, named, type Kind } from "./conventions";
import { MICROSECONDS, READ_DEPTH, either, first, identifier, isObject, list, mapping, objects, records, seconds, text, truthy, type Record_ } from "./records";
import { run, type TracedRun } from "./runs";
import { timedParallel, timedSequence, timedStep, type Timed } from "./timed";

export type Span = { id: string; parent: string | null; trace: string; title: string; start: number | null; end: number | null; failed: boolean; kind: Kind };

const NAMED = ["tool", "agent", "code"];

export const otel = (source: unknown): TracedRun[] => build([...flatten(records(source))].map(toSpan));

export const openaiAgents = (source: unknown): TracedRun[] =>
  build([...nested(records(source), "spans")].filter((span) => isObject(span.span_data)).map(openai));

export const langsmith = (source: unknown): TracedRun[] => build([...nested(records(source), "child_runs")].map(langsmithRun));

export const langfuse = (source: unknown): TracedRun[] =>
  build([...observations(records(source))].map(([item, trace], index) => langfuseObservation(item, trace, index)));

function* nested(items: unknown[], key: string): Generator<Record_> {
  for (const item of items.filter(isObject)) {
    yield item;
    yield* nested(list(item[key]), key);
  }
}

function* flatten(items: unknown[]): Generator<Record_> {
  for (const item of items.filter(isObject)) {
    const batches = first(item.resourceSpans, item.batches);
    const data = item.data;
    if (Array.isArray(batches)) {
      for (const resource of objects(batches)) {
        for (const scope of objects(first(resource.scopeSpans, resource.instrumentationLibrarySpans))) yield* objects(scope.spans);
      }
    } else if (isObject(data) && "spans" in data) yield* objects(data.spans);
    else if (Array.isArray(data) || ("traceID" in item && "spans" in item)) {
      for (const each of objects(Array.isArray(data) ? data : [item])) yield* objects(each.spans);
    } else yield item;
  }
}

function attributes(raw: unknown): Record_ {
  if (isObject(raw)) return raw;
  return Object.fromEntries(
    objects(raw)
      .filter((item) => "key" in item)
      .map((item) => [String(item.key), attribute(item.value)]),
  );
}

const attribute = (value: unknown): unknown => (isObject(value) ? Object.values(value)[0] : value);

export function parent(value: unknown, id: string): string | null {
  const found = truthy(value) ? text(value) : null;
  return found === id ? null : found;
}

function kindOf(found: Kind, explicit: string | null, title: string): Kind {
  if (!found) return null;
  const words = title.split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  const fallback = NAMED.includes(found.actor) && last && !OPERATIONS.has(last) ? last : null;
  return { actor: found.actor, name: explicit || found.name || fallback };
}

function toSpan(record: Record_, index: number): Span {
  return "spanID" in record ? jaeger(record, index) : otelSpan(record, index);
}

function otelSpan(record: Record_, index: number): Span {
  const context = mapping(record.context);
  const status = mapping(record.status);
  const values = attributes(record.attributes);
  const title = text(record.name) ?? "";
  const found = classify(values);
  const id = text(first(record.spanId, record.span_id, context.span_id)) || `#${index}`;
  return {
    id,
    parent: parent(either(record.parentSpanId, record.parent_span_id, record.parent_id), id),
    trace: text(first(record.traceId, record.trace_id, context.trace_id)) ?? "",
    title,
    start: seconds(first(record.startTimeUnixNano, record.start_time_unix_nano, record.start_time)),
    end: seconds(first(record.endTimeUnixNano, record.end_time_unix_nano, record.end_time)),
    failed: failed(first(status.code, status.status_code, record.status_code), values, record.events),
    kind: kindOf(found, found && named(found.actor, values), title),
  };
}

function jaeger(record: Record_, index: number): Span {
  const tags = attributes(record.tags);
  const title = text(record.operationName) ?? "";
  const found = classify(tags);
  const id = text(record.spanID) || `#${index}`;
  const parents = objects(record.references).filter((reference) => reference.refType === "CHILD_OF");
  const start = seconds(record.startTime, MICROSECONDS);
  const duration = seconds(record.duration, MICROSECONDS);
  const logs = objects(record.logs).map((log) => ({ name: attributes(log.fields).event }));
  const erred = tags.error === true || tags.error === "true" || tags["otel.status_code"] === "ERROR";
  return {
    id,
    parent: parent(parents.length ? parents[0].spanID : null, id),
    trace: text(record.traceID) ?? "",
    title,
    start,
    end: start !== null && duration !== null ? start + duration : null,
    failed: erred || failed(null, tags, logs),
    kind: kindOf(found, found && named(found.actor, tags), title),
  };
}

function openai(span: Record_, index: number): Span {
  const data = mapping(span.span_data);
  const title = text(data.name) || text(data.type) || "";
  const id = text(span.id) || `#${index}`;
  return {
    id,
    parent: parent(span.parent_id, id),
    trace: text(span.trace_id) ?? "",
    title,
    start: seconds(span.started_at),
    end: seconds(span.ended_at),
    failed: truthy(span.error),
    kind: kindOf(kind("openai-agents", data.type), text(data.name), title),
  };
}

function* observations(items: unknown[]): Generator<[Record_, string]> {
  for (const item of items.filter(isObject)) {
    if (Array.isArray(item.observations)) {
      for (const observation of objects(item.observations)) yield [observation, text(first(observation.traceId, item.id)) ?? ""];
    } else yield [item, text(item.traceId) ?? ""];
  }
}

function langfuseObservation(observation: Record_, trace: string, index: number): Span {
  const title = text(observation.name) ?? "";
  const found = classify({ "langfuse.observation.type": (text(observation.type) ?? "").toLowerCase() });
  const id = text(observation.id) || `#${index}`;
  return {
    id,
    parent: parent(observation.parentObservationId, id),
    trace,
    title,
    start: seconds(observation.startTime),
    end: seconds(observation.endTime),
    failed: observation.level === "ERROR",
    kind: kindOf(found, found && NAMED.includes(found.actor) ? title : null, title),
  };
}

function langsmithRun(record: Record_, index: number): Span {
  const found = kind("langsmith", record.run_type);
  const id = text(record.id) || `#${index}`;
  const title = text(record.name) ?? "";
  const start = seconds(record.start_time);
  return {
    id,
    parent: parent(record.parent_run_id, id),
    trace: text(record.trace_id) || id,
    title,
    start,
    end: seconds(record.end_time) || start,
    failed: truthy(record.error),
    kind: kindOf(found, found && NAMED.includes(found.actor) ? title : null, title),
  };
}

const begins = (span: Span) => span.start ?? span.end ?? 0;
const ends = (span: Span) => Math.max(begins(span), span.end ?? begins(span));

function arrange(items: { span: Span; built: Timed }[]): Timed {
  const sorted = [...items].sort((a, b) => begins(a.span) - begins(b.span) || ends(a.span) - ends(b.span));
  const blocks: (typeof sorted)[] = [];
  let reach = -Infinity;
  for (const item of sorted) {
    if (!blocks.length || begins(item.span) >= reach) {
      blocks.push([]);
      reach = begins(item.span);
    }
    blocks[blocks.length - 1].push(item);
    reach = Math.max(reach, ends(item.span));
  }
  return timedSequence(
    blocks.map((block) => {
      const lanes: (typeof block)[] = [];
      for (const item of block) {
        const lane = lanes.find((each) => ends(each[each.length - 1].span) <= begins(item.span));
        if (lane) lane.push(item);
        else lanes.push([item]);
      }
      return timedParallel(lanes.map((lane) => timedSequence(lane.map((each) => each.built))));
    }),
  );
}

export function build(spans: Span[]): TracedRun[] {
  const traces = new Map<string, Span[]>();
  for (const each of spans) append(traces, each.trace, each);
  return [...traces].map(([id, group]) => tree(id, group)).filter((each): each is TracedRun => each !== null);
}

function tree(id: string, spans: Span[]): TracedRun | null {
  const known = new Set(spans.map((each) => each.id));
  const children = new Map<string | null, Span[]>();
  for (const each of spans) append(children, each.parent && known.has(each.parent) ? each.parent : null, each);
  const visited = new Set<Span>();
  const arranged = (group: Span[], depth: number): Timed =>
    arrange(
      group
        .filter((each) => !visited.has(each))
        .map((each) => ({ span: each, built: built(each, depth) }))
        .filter((item) => item.built.node !== EMPTY),
    );
  const built = (each: Span, depth: number): Timed => {
    visited.add(each);
    const kids = depth < READ_DEPTH ? (children.get(each.id) ?? []) : [];
    if (!each.kind || (each.kind.actor === "code" && kids.length)) return arranged(kids, depth);
    const interval = each.start !== null && each.end !== null && each.end >= each.start ? ([each.start, each.end] as [number, number]) : null;
    const body = kids.length ? arranged(kids, depth + 1) : undefined;
    return timedStep(each.kind.actor, { name: identifier(each.kind.name), failed: each.failed }, interval, body);
  };
  let process = arranged(children.get(null) ?? [], 0);
  for (let rest = spans.filter((each) => !visited.has(each)); rest.length; rest = spans.filter((each) => !visited.has(each))) {
    const root = rest.reduce((earliest, each) => (begins(each) < begins(earliest) ? each : earliest));
    process = timedSequence([process, arranged([root], 0)]);
  }
  if (!process.time.length) return null;
  const { node } = process;
  if (node.t === "step" && node.actor === "agent" && node.body)
    return run(id, { node: node.body, time: process.time.slice(1), branches: [] }, node.name ?? undefined);
  return run(id, process);
}
