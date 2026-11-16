import { describe, expect, it } from "vitest";
import cases from "../../grammar/standards.json";
import { read, render, type Format } from "../src";

const chat = { "gen_ai.operation.name": "chat" };
const tool = { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "search" };

const fromOTel = (input: unknown) => read(input, "otel");
const fromMessages = (input: unknown) => read(input, "messages");
const FORMATS: (Format | undefined)[] = [
  undefined,
  "runs",
  "otel",
  "openai_agents",
  "langsmith",
  "langfuse",
  "messages",
  "codex",
  "claude_code",
  "atif",
  "swe_agent",
  "openhands",
];
const renders = (runs: ReturnType<typeof read>) => expect(render({ mark: "variants", data: { values: runs } })).resolves.toContain("<svg");

describe("readers are total", () => {
  it.each([null, undefined, 3, true])("reject %s with a TypeError", (input) => {
    for (const format of FORMATS) expect(() => read(input, format)).toThrow(TypeError);
  });

  it("names unknown formats", () => {
    expect(() => read([], "jaeger" as Format)).toThrow(/unknown format "jaeger"/);
  });

  it.each([[[]], [{}], [[1, "x", null, []]], [[{ foo: 1 }]], [[{ traceId: "t", spanId: "1", name: "GET" }]], ["not json"]])(
    "every format drops records without agent steps: %j",
    (input) => {
      for (const format of FORMATS) expect(read(input, format)).toEqual([]);
    },
  );

  it("reads JSON Lines text and skips broken lines", () => {
    const lines = [JSON.stringify({ role: "user", content: "hi" }), "{broken", JSON.stringify({ role: "assistant", content: "hello" })].join("\n");
    expect(read(lines).map((run) => run.process)).toEqual(["human -> model"]);
  });

  it.each([[[]], [{}], [[1, "x", null, []]], [[{ traceId: "t", spanId: "1", name: "GET /" }]]])("drop records without agent steps: %j", (input) => {
    expect(fromOTel(input)).toEqual([]);
  });

  it("breaks parent cycles", () => {
    const runs = fromOTel([
      { traceId: "t", spanId: "1", parentSpanId: "2", attributes: chat },
      { traceId: "t", spanId: "2", parentSpanId: "1", attributes: tool },
    ]);
    expect(runs.map((run) => run.process)).toEqual(["model{ tool.search }"]);
    renders(runs);
  });

  it("keeps spans without ids apart", () => {
    const runs = fromOTel([
      { traceId: "t", attributes: chat, startTimeUnixNano: "1" },
      { traceId: "t", attributes: chat, startTimeUnixNano: "2000000000" },
    ]);
    expect(runs[0].process).toBe("model -> model");
  });

  it("does not mistake an operation name for a tool name", () => {
    const runs = fromOTel([{ traceId: "t", spanId: "1", name: "execute_tool", attributes: { "gen_ai.operation.name": "execute_tool" } }]);
    expect(runs[0].process).toBe("tool");
  });

  it("turns unreadable times into unknown intervals", () => {
    const [run] = fromOTel([{ traceId: "t", spanId: "1", startTimeUnixNano: "soon", attributes: chat }]);
    expect(run.time).toEqual([null]);
    renders([run]);
  });

  it.each([[[]], [{}], [["hi", 3]], [[[{ foo: 1 }]]], [[[{ role: "system", content: "x" }]]]])("drop conversations without turns: %j", (input) => {
    expect(fromMessages(input)).toEqual([]);
  });

  it("reads a conversation with malformed blocks", () => {
    const runs = fromMessages([
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: [null, 3, { type: "tool_use", id: "a", name: "x" }], tool_calls: "no" },
      ],
    ]);
    expect(runs.map((run) => run.process)).toEqual(["human -> model -> tool.x"]);
    renders(runs);
  });

  it("reads timestamps strictly and in UTC", () => {
    const at = (value: unknown) => read([{ role: "user", content: "hi", timestamp: value }])[0].time[0]?.[0] ?? null;
    expect(at("2026-01-01T00:00:00Z")).toBe(1767225600);
    expect(at("2026-01-01 01:00:00+01:00")).toBe(1767225600);
    expect(at("2026-01-01T00:00:00")).toBe(1767225600);
    expect(at(1767225600000)).toBe(1767225600);
    expect(["2026-02-30", "2026-01-01T24:00:00Z", "Jan 1 2026", "1e400"].map(at)).toEqual([null, null, null, null]);
  });

  it("survives mutated records of every standard", () => {
    const junk: unknown[] = [
      null,
      0,
      -1,
      3.5,
      true,
      "",
      "x",
      "ERROR",
      "2026-13-45T99:00:00Z",
      "1e400",
      [],
      {},
      [null],
      1e30,
      "Task",
      "__proto__",
      "constructor",
    ];
    let state = 5;
    const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T>(items: T[]): T => items[Math.floor(next() * items.length)];
    for (let round = 0; round < 600; round++) {
      const each = pick(cases);
      const document = structuredClone(each.input) as unknown;
      for (let edit = 0; edit < 1 + Math.floor(next() * 4); edit++) {
        const slots: [Record<string, unknown> | unknown[], string | number][] = [];
        const visit = (node: unknown) => {
          if (Array.isArray(node)) node.forEach((child, index) => (slots.push([node, index]), visit(child)));
          else if (node && typeof node === "object")
            Object.entries(node).forEach(([key, child]) => (slots.push([node as Record<string, unknown>, key]), visit(child)));
        };
        visit(document);
        if (slots.length) {
          const [owner, key] = pick(slots);
          (owner as Record<string | number, unknown>)[key] = structuredClone(pick(junk));
        }
      }
      for (const format of [each.reader as Format, undefined]) renders(read(document, format));
    }
  }, 30_000);
});
