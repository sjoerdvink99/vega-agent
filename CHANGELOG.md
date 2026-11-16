# Changelog

## Unreleased

- **Data in the spec.** `data` holds records, as in Vega-Lite: `{ "values": [...] }` inline or `{ "url": "spans.jsonl" }`, with an optional `format`. A view reads any standard, runs written as expressions, or records of your own shape. `load(spec)` fetches urls; `embed`, `render` and the CLI do so themselves.
- **Mapping to the grammar.** `trace` maps fields of the records to a trace: `run`, `actor`, `name`, `step`, `parent`, `start`, `end`, `failed` and `group`. Actor values follow the vocabulary of every standard in `conventions.json`, or a `map` of your own. `read(source, mapping)` does the same outside a view, in TypeScript and Python, held to `grammar/mappings.json`.
- **Groups from a field.** Two groups to compare come from the `group` channel instead of nested `{ name, runs }` lists, ordered by first appearance or by `{ "field", "order" }`.
- **Filters.** `transform: [{ "filter": predicate }]` keeps the records that matter before they are mapped, with Vega-Lite's `equal`, `oneOf`, `range` and `valid` predicates combined by `and`, `or` and `not`. Filters travel with the data a view inherits.
- **Facets.** `{ "facet": { "field", "columns" }, "spec": view }` draws one panel per value of a field, for any number of groups. Panels share their legend, level switch, selections and group colours. Python charts of more than two corpora become facets.
- **Shared data.** `data` and `trace` on a `vconcat` or `hconcat` hold for every view in it.
- **One run of many.** `timeline` and `handoffs` take `filter`, a selection of runs, and draw the first selected run; rows, lanes, height and time axis follow the selection in the Vega dataflow.
- **Real runs.** The gallery shows 400 SWE-agent trajectories on real GitHub issues, extracted by `examples/data/swe_agent.py`.
- **One repeat.** The grammar has six forms: a step, `->`, `||`, `|`, and a repeat of each composition, `{m,n}` in sequence and `[m,n]` in parallel. Parallel copies take bounds, as in `tool[1,]`; `* + ?`, `{n}`, `[]` and `[n]` are shorthands. `repeat(node, lo, hi, parallel)` builds one in TypeScript.
- **Exact parallel matching.** `conforms` and `find` match parallel branches by a bounded assignment, so `model[0] || tool` accepts `tool`, `(tool.a || tool.b)[2]` accepts its own trace, and `_[] || model[1]` accepts `model || tool`.
- **Tables.** A corpus has one relational form: `runs`, `variants`, `tokens`, `steps` and `times`, built by `tables(runs)` in TypeScript and `va.tables(runs)` in Python and held to `grammar/tables.json`. Every view is a Vega dataflow over them, the compiled spec ships each table once per data source, and Python's `Corpus` analyses them (`corpus.tables`).
- **Scale.** Each distinct trace ships once, plus a short row per run. At 10,000 runs the icicle compiles to 4 MB instead of 101 MB and `durations` to 13 MB instead of 205 MB.
- **Steps by position.** Steps carry no ids: a step is its position in the trace, a step before its body. `find` returns positions, a run's times follow the same order, and Python's `Trace` has a `time` field. Readers build each trace and its times together.
- **Fixes.** Variant labels no longer wrap every step after the fifth in parentheses, and read as the grammar names the variant, `abstract(trace, level)`; `loops` no longer breaks on equal-shaped bodies with and without a loop, which also made Python fold them wrongly; `durations` counts runs, not steps, in its tooltip and highlight; `vega-agent --help` exits with 0.
- **Compiling to Vega.** A new page shows what vega-agent computes, what Vega computes, and the tables in between.
- **Breaking.** `Many` is gone from both packages: parallel copies are a `Repeat` with `parallel` set. `Step` has no `ids`, and Python's `Trace` keeps times in `time` instead of `meta["time"]`. `data` is no longer a list of runs or groups, and `timeline` and `handoffs` draw a run of their `data` instead of taking `process` and `time`.

## 0.1.0

The first release, as `vega-agent` on npm and PyPI.

- **Grammar.** Five actors, sequence, parallel, choice, repetition, parallel copies, nested contexts, signatures and failure. Parsing, printing, conformance, queries, abstraction, folding and sampling, in TypeScript and Python, held to one shared set of cases.
- **Views.** The marks `diagram`, `timeline` (per step or in agent swimlanes), `handoffs`, `icicle`, `variants`, `transitions`, `graph`, `sankey`, `activities`, `sequences`, `distribution`, `durations` and `projection`, composed with `vconcat` and `hconcat`, covering the views of the agent and event-sequence visualization literature. Two groups of runs show their difference. A JSON Schema for every spec.
- **Built on Vega.** `compile` turns a view into a self-contained Vega spec, as Vega-Lite does: aggregation, ranking, layout, scales, guides, tooltips and selections are Vega dataflow and signals. `render` and `embed` run it with Vega; the CLI's `--vega` and Python's `Chart.to_vega()` export it.
- **Aggregation.** Corpus views scale to thousands of runs: they abstract each run to a `level`, group runs into items, and draw the largest while folding the rest into a remainder that still counts and selects its runs. Beyond `limit` runs, `sequences` becomes a relative frequency sequence plot.
- **Tooltips.** Every item carries a structured tooltip of named fields, one value per group when two are compared; `tooltip` chooses and renames the fields.
- **Interaction.** Selections in the spec, after Vega-Lite's `params`: a view selects runs or steps on `click` or `hover`, and views `highlight` or `filter` by them, re-aggregating in the dataflow. `embed` adds zoom, a level switch and a `select` event, and every interactive state is a spec.
- **Reading.** One `read(source, format?)` replaces the per-format readers and detects OTel/OTLP, Jaeger, Tempo, MLflow, Langfuse, LangSmith, OpenAI Agents, chat transcripts (OpenAI, Anthropic, Gemini, Bedrock, LangChain, Pydantic AI, Inspect AI, ShareGPT, ADK), Codex CLI, Claude Code, ATIF, SWE-agent and OpenHands.
- **Standards.** Readers for OpenTelemetry GenAI and MCP, OpenInference, OpenLLMetry, Langfuse, the Vercel AI SDK, provider transcripts, the OpenAI Agents SDK, LangSmith and ATIF. Exports to OTLP/JSON, XES, OCEL 2.0, BPMN 2.0 and pm4py process trees.
- **Bounded.** Expressions nest at most 64 levels, traces have at most 100,000 steps, and sizes are at most 1,000,000. Invalid input raises `ParseError`, `TraceError`, `SpecError` or `TypeError` with a location; readers skip what they cannot read.
