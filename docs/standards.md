# Standards

The grammar sits between the telemetry agents already emit and the formats process and visualization tools read. No new instrumentation is needed.

## In

A view reads these formats from its `data` directly: `{ "data": { "url": "spans.jsonl" } }`. It detects the format from the records, so you never name it, but you can: `{ "url": "session.jsonl", "format": "claude_code" }`. For records in no standard, map their fields with [`trace`](data.md#trace).

Outside a view, one function reads everything: `va.read(source)` in Python, `read(source)` in TypeScript, with the format, or a [`trace` mapping](data.md#trace), as its second argument.

=== "Python"

    ```python
    va.read("spans.jsonl")                    # a JSON or JSON Lines file
    va.read("~/.claude/projects/my-app/")     # a folder: every .json, .jsonl, .eval and .traj in it
    va.read("logs/2026-01-01_task.eval")      # an Inspect AI log
    va.read(records)                          # records already in memory
    va.read(events, {"run": "session", "actor": "type", "name": "tool"})
    ```

=== "TypeScript"

    ```ts
    read(await file.text());   // JSON or JSON Lines text
    read(records);             // records already in memory
    read(events, { run: "session", actor: "type", name: "tool" });
    ```

| Source | What it reads | `format` |
|---|---|---|
| OpenTelemetry GenAI, MCP | `gen_ai.operation.name`, `mcp.method.name` on spans, OTLP/JSON, Jaeger or Grafana Tempo exports | `otel` |
| OpenInference (Phoenix, Arize), OpenLLMetry (Traceloop), Vercel AI SDK, Langfuse via OTel | `openinference.span.kind`, `traceloop.span.kind`, `ai.operationId`, `langfuse.observation.type` | `otel` |
| MLflow | traces and spans, MLflow 2 and 3 (`mlflow.spanType`) | `otel` |
| Langfuse | API and UI exports: a trace with `observations`, or the observations | `langfuse` |
| LangSmith | runs with `run_type` and `child_runs` | `langsmith` |
| OpenAI Agents SDK | spans with `span_data` | `openai_agents` |
| Chat transcripts | OpenAI Chat and Responses, Anthropic, Gemini, Amazon Bedrock Converse, LangChain, Pydantic AI, Google ADK sessions, ShareGPT datasets, Inspect AI logs | `messages` |
| Claude Code | session files in `~/.claude/projects`, with their subagents | `claude_code` |
| Codex CLI | rollout files in `~/.codex/sessions` | `codex` |
| ATIF (Harbor) | trajectories with `steps`, and their subagent trajectories | `atif` |
| SWE-agent, mini-SWE-agent | `.traj` trajectories | `swe_agent` |
| OpenHands | event streams, and evaluation output with a `history` | `openhands` |
| vega-agent runs | expressions, or `{ id, process, time, agent }`, as `read` returns them | `runs` |

Frameworks that emit OpenTelemetry GenAI or OpenInference (Google ADK, Strands, CrewAI, AutoGen, Semantic Kernel, Pydantic AI with Logfire, smolagents and others) read through `otel`.

- Spans that overlap in time become `||`; children become a body `{…}`. Tool calls made in one model turn are parallel.
- A step fails (`!`) on an `ERROR` status, `error.type`, an `exception` event, a tool result marked as an error, or a non-zero exit code.
- A single root agent becomes the run's context, in `agent`. Subagents (a Claude Code `Task`, an OpenHands `delegate`, an ATIF subagent trajectory) become `agent.name{…}`.
- Timestamps give each step its interval; without them, steps keep their order.
- Records that are not agent steps are skipped, never fatal: broken lines, unknown fields, values of the wrong type. Names are reduced to the grammar's alphabet: `web-search/v2` becomes `web_search_v2`.

## Out

| Format | Python |
|---|---|
| OpenTelemetry GenAI, OTLP/JSON | `to_otel(runs)`, which reads back to the same process |
| IEEE 1849 XES | `to_xes(runs)` |
| OCEL 2.0 | `to_ocel(runs)` |
| BPMN 2.0 | `to_bpmn(spec)` |
| pm4py process tree | `to_process_tree(spec)` |

pm4py reads the XES, OCEL and BPMN exports, and runs sampled from a spec align perfectly with its exported process tree. Both are checked in the tests.

## Adding a dialect

Every mapping from a telemetry convention, role or event to an actor is data, in [`grammar/conventions.json`](https://github.com/sjoerdvink99/vega-agent/blob/main/grammar/conventions.json):

```json
{ "standard": "OpenInference", "key": "openinference.span.kind", "values": { "LLM": "model", "TOOL": "tool", "AGENT": "agent" } }
```

Python and TypeScript both read this table, and the `actor` channel of a [`trace` mapping](data.md#trace) understands every term in it. To support a new dialect, add a rule and a real-shaped case to [`grammar/standards.json`](https://github.com/sjoerdvink99/vega-agent/blob/main/grammar/standards.json).
