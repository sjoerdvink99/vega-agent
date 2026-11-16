# Data

A view takes your records as they are. You put them in `data`, as in Vega-Lite, and say in `trace` which field is the run, the actor, the name and the time. vega-agent maps every run to a trace in its [grammar](grammar.md); the trace is never written by hand. The view then compiles to Vega, which does the counting.

| Stage | Property | Turns | Into | Done by |
|---|---|---|---|---|
| Read | `data` | a file, a URL or inline values | records | vega-agent |
| Filter | `transform` | records | the records to keep | vega-agent |
| Map | `trace` | records | one trace in the grammar per run, in groups | vega-agent |
| Split | `facet` | runs | one panel per value | vega-agent |
| Tabulate | | traces | the [tables](tables.md): runs, variants at each `level`, tokens, steps, times | vega-agent |
| Aggregate | `mark`, `level` | tables | counts per prefix, pair, step, bin or row | Vega |
| Rank and fold | `limit` | aggregates | what is drawn, and one remainder | Vega |

Here each record is one event of a coding agent's log. The spec is the records, the mapping and a mark, and nothing more:

```vega-agent
{ "mark": "variants", "level": "names",
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "at", "failed": "error" },
  "data": { "values": [
    { "session": "s1", "type": "llm", "at": "2026-03-02T09:00:00Z" },
    { "session": "s1", "type": "tool", "tool": "read", "at": "2026-03-02T09:00:04Z" },
    { "session": "s1", "type": "llm", "at": "2026-03-02T09:00:05Z" },
    { "session": "s2", "type": "llm", "at": "2026-03-02T09:01:00Z" },
    { "session": "s2", "type": "tool", "tool": "edit", "at": "2026-03-02T09:01:03Z", "error": "patch failed" },
    { "session": "s2", "type": "llm", "at": "2026-03-02T09:01:04Z" },
    { "session": "s2", "type": "tool", "tool": "edit", "at": "2026-03-02T09:01:09Z" },
    { "session": "s2", "type": "llm", "at": "2026-03-02T09:01:12Z" },
    { "session": "s3", "type": "llm", "at": "2026-03-02T09:02:00Z" },
    { "session": "s3", "type": "tool", "tool": "read", "at": "2026-03-02T09:02:02Z" },
    { "session": "s3", "type": "llm", "at": "2026-03-02T09:02:03Z" }
  ] } }
```

The mapping turns sessions `s1` and `s3` into the trace `model -> tool.read -> model` and `s2` into `model -> tool.edit! -> model -> tool.edit -> model`. Vega counts two variants and draws them.

## data

| Property | |
|---|---|
| `values` | the records, inline |
| `url` | a JSON or JSON Lines file to fetch, relative to the page, or for `render` and the CLI to the spec file |
| `format` | the [standard](standards.md) the records follow, or `"runs"`; detected when left out |

`compile` is synchronous, so it needs `values`. `load(spec)` fetches every `url` and returns the spec with `values`; `embed` and `render` load by themselves.

A view reads two kinds of records:

1. **Your own records**, one per step, in any shape: a field that tells the actor is enough. Map them with [`trace`](#trace).
2. **Telemetry in a standard**: OpenTelemetry spans, LangSmith runs, Langfuse observations, provider transcripts, trajectories. Every format of [Standards](standards.md) is read with no mapping at all.

Records a view cannot read are skipped, never fatal. A view also takes the runs that `read` returns in TypeScript and Python, `{ "id", "process", "time" }` (`"format": "runs"`), so a program can pass runs it has already read.

## transform

`transform` is a list of filters, applied in order to the records before they are mapped, as in Vega-Lite:

```json
"transform": [
  { "filter": { "field": "kind", "oneOf": ["llm", "tool"] } },
  { "filter": { "not": { "field": "tool", "oneOf": ["scroll_up", "scroll_down"] } } },
  { "filter": { "and": [{ "field": "cost", "range": [0, 0.5] }, { "field": "error", "valid": false }] } }
]
```

| Predicate | Keeps a record when |
|---|---|
| `{ "field", "equal": value }` | the field equals the value |
| `{ "field", "oneOf": [values] }` | the field equals one of them |
| `{ "field", "range": [low, high] }` | the field is a number from `low` to `high`; `null` leaves a side open |
| `{ "field", "valid": true }` | the field is present and not `null`; `false` keeps the records without it |
| `{ "and": [...] }`, `{ "or": [...] }`, `{ "not": predicate }` | all, any, or not |

A filter sees the records as they are in `data`: each item of `values`, each line of a JSON Lines file. Dropping a step's record drops the step, so a filter can remove noise before any view counts it. Here the navigation commands of the agent are left out, and the runs that remain are compared:

```vega-agent
{ "mark": "variants", "level": "names",
  "transform": [{ "filter": { "not": { "field": "tool", "oneOf": ["scroll", "goto"] } } }],
  "trace": { "run": "session", "actor": "type", "name": "tool" },
  "data": { "values": [
    { "session": "s1", "type": "llm" }, { "session": "s1", "type": "tool", "tool": "open" }, { "session": "s1", "type": "tool", "tool": "scroll" },
    { "session": "s1", "type": "llm" }, { "session": "s1", "type": "tool", "tool": "edit" }, { "session": "s1", "type": "llm" },
    { "session": "s2", "type": "llm" }, { "session": "s2", "type": "tool", "tool": "open" }, { "session": "s2", "type": "tool", "tool": "goto" },
    { "session": "s2", "type": "llm" }, { "session": "s2", "type": "tool", "tool": "edit" }, { "session": "s2", "type": "llm" }
  ] } }
```

Both runs become `model -> tool.open -> model -> tool.edit -> model`: one variant instead of two.

## trace

`trace` maps fields of the records to the parts of a trace. With `actor`, each record is a step:

| Channel | | Without it |
|---|---|---|
| `actor` | the step's actor | records are runs or telemetry, not steps |
| `name` | the step's name, as in `tool.search` | the name `actor` gives, if any |
| `run` | the run the step belongs to | all records are one run |
| `step`, `parent` | the step's id and its parent's: a step's children become its context `{…}` | steps do not nest |
| `start`, `end` | when the step started and ended | record order, and `end` is `start` |
| `failed` | whether it failed (`!`) | no step fails |
| `group` | the group of the run, to compare two groups | one group |

A channel is a field name. A dot reaches into nested objects, `"attributes.gen_ai.tool.name"`, unless the record has a key with that dot in it. Some channels take an object:

| Channel | Object | |
|---|---|---|
| `actor` | `{ "field": "kind", "map": { "llm_call": "model", "tool_call": "tool", "log": null } }` | values to actors, as `model` or `tool.search`; `null` drops the step but keeps its children |
| `failed` | `{ "field": "status", "equal": "error" }` | fails when the field equals the value; a plain field fails when it is set and not `false`, `0` or empty |
| `start`, `end` | `{ "field": "start_ms", "unit": "ms" }` | numbers in `s`, `ms`, `us` or `ns` since any origin; a plain field reads seconds, epoch milliseconds to nanoseconds by their size, or ISO 8601 text |

An actor value is an actor (`model`, `tool`, `agent`, `human`, `code`), an actor with a name (`tool.search`), or any term of the standards in [`conventions.json`](https://github.com/sjoerdvink99/vega-agent/blob/main/grammar/conventions.json), in any case: `LLM`, `chat`, `generation` and `completion` are `model`; `execute_tool` and `function` are `tool`; `retriever` is `tool.retrieve`; `chain` and `workflow` are `code`. Steps whose actor is unknown are dropped, and their children kept.

Within a run, steps are ordered by `start`. Steps that overlap in time run in parallel (`||`), a step's children form its context, and a run that is a single agent step becomes that agent's context. These are the rules the [standard readers](standards.md) follow, so mapped records and telemetry give the same traces.

Spans with ids, parents and timing in milliseconds give the hand-off from a coder agent to its tools, with two tools in parallel:

```vega-agent
{ "mark": "timeline",
  "trace": { "run": "trace", "step": "id", "parent": "parent", "actor": "kind", "name": "name",
             "start": { "field": "start_ms", "unit": "ms" }, "end": { "field": "end_ms", "unit": "ms" },
             "failed": { "field": "status", "equal": "error" } },
  "data": { "values": [
    { "trace": "a", "id": "1", "kind": "chat", "start_ms": 0, "end_ms": 900 },
    { "trace": "a", "id": "2", "kind": "agent", "name": "coder", "start_ms": 900, "end_ms": 4100 },
    { "trace": "a", "id": "3", "parent": "2", "kind": "chat", "start_ms": 950, "end_ms": 1600 },
    { "trace": "a", "id": "4", "parent": "2", "kind": "execute_tool", "name": "edit", "status": "error", "start_ms": 1600, "end_ms": 2100 },
    { "trace": "a", "id": "5", "parent": "2", "kind": "execute_tool", "name": "lint", "start_ms": 1650, "end_ms": 2600 },
    { "trace": "a", "id": "6", "parent": "2", "kind": "chat", "start_ms": 2600, "end_ms": 3300 },
    { "trace": "a", "id": "7", "parent": "2", "kind": "execute_tool", "name": "edit", "status": "ok", "start_ms": 3300, "end_ms": 4100 },
    { "trace": "a", "id": "8", "kind": "chat", "start_ms": 4100, "end_ms": 4800 }
  ] } }
```

A `timeline` and `handoffs` draw one run: the first selected one under a [`filter`](views.md#timeline), and otherwise the first.

Without `actor`, `trace` takes only `group`, and the records are runs or telemetry in a standard.

## Groups

`group` names the field that splits runs into two groups. The corpus views then show the difference between them, orange for more common in the first group and blue for the second. A run belongs to the group of its first record that has one, and runs without a value are left out. With telemetry, `group` reads the top-level records: each line of a JSON Lines export, each trace of a LangSmith export.

Groups are ordered by first appearance. `{ "field": "outcome", "order": ["resolved", "unresolved"] }` sets the order instead, and keeps both groups in the view even when one has no runs.

```vega-agent
{ "mark": "transitions", "level": "names",
  "trace": { "run": "session", "actor": "type", "name": "tool", "group": "model" },
  "data": { "values": [
    { "session": "a1", "model": "model-a", "type": "llm" }, { "session": "a1", "type": "tool", "tool": "read" }, { "session": "a1", "type": "llm" },
    { "session": "a2", "model": "model-a", "type": "llm" }, { "session": "a2", "type": "tool", "tool": "read" }, { "session": "a2", "type": "llm" }, { "session": "a2", "type": "tool", "tool": "edit" }, { "session": "a2", "type": "llm" },
    { "session": "b1", "model": "model-b", "type": "llm" }, { "session": "b1", "type": "tool", "tool": "search" }, { "session": "b1", "type": "llm" }, { "session": "b1", "type": "tool", "tool": "edit" }, { "session": "b1", "type": "llm" },
    { "session": "b2", "model": "model-b", "type": "llm" }, { "session": "b2", "type": "tool", "tool": "edit" }, { "session": "b2", "type": "llm" }
  ] } }
```

## Facets

`group` compares two. To show any number, `facet` draws one panel per value of a field, as small multiples:

```vega-agent
{ "facet": { "field": "model" },
  "spec": { "mark": "variants", "level": "names" },
  "trace": { "run": "session", "actor": "type", "name": "tool" },
  "data": { "values": [
    { "session": "a1", "model": "model-a", "type": "llm" }, { "session": "a1", "type": "tool", "tool": "read" }, { "session": "a1", "type": "llm" },
    { "session": "a2", "model": "model-a", "type": "llm" }, { "session": "a2", "type": "tool", "tool": "read" }, { "session": "a2", "type": "llm" },
    { "session": "b1", "model": "model-b", "type": "llm" }, { "session": "b1", "type": "tool", "tool": "edit" }, { "session": "b1", "type": "llm" },
    { "session": "c1", "model": "model-c", "type": "llm" }, { "session": "c1", "type": "tool", "tool": "search" }, { "session": "c1", "type": "llm" },
    { "session": "c2", "model": "model-c", "type": "llm" }, { "session": "c2", "type": "tool", "tool": "edit" }, { "session": "c2", "type": "llm" }
  ] } }
```

| Property | Default | |
|---|---|---|
| `facet.field` | required | the field to split by; a run takes the value of its first record that has one, as for `group` |
| `facet.columns` | up to `3` | how many panels side by side before the next row |
| `spec` | required | the view drawn in each panel: any mark but `diagram`, without `data`, `transform` or `trace` |

`data`, `transform` and `trace` sit next to `facet` and hold for every panel. Each panel is titled with its value and counts only its own runs. The panels share one legend, one level switch and the selections their spec declares, so clicking a variant in one panel highlights its runs everywhere. With a `group`, every panel compares the same two groups in the same order and colours. A facet draws at most 64 panels; filter the data to show fewer.

## Composition

`data`, `transform` and `trace` at the top of a `vconcat` or `hconcat` hold for every view that does not set its own. A view that inherits the data also inherits its filters, and its own `transform` adds to them; a view with its own `data` uses only its own filters. The views then read the same runs, so their selections refer to the same run ids:

```json
{ "data": { "url": "spans.jsonl" },
  "vconcat": [
    { "mark": "variants", "params": [{ "name": "picked", "select": "click" }] },
    { "mark": "sequences", "filter": { "param": "picked" } }
  ] }
```

## Aggregation

A corpus view never draws runs one by one, so it scales to thousands of them. vega-agent writes the runs as [tables](tables.md), where each distinct trace and variant appears once; Vega joins every run to its variant, counts the runs per item, ranks the items and folds the rest into one remainder, `+3 more variants`, `other` or `+5`, that still counts its runs, has a tooltip and can be selected.

No run is dropped: every count, share and selection covers the whole corpus, and switching `level` or changing a `filter` selection recounts the view without compiling it again. [Compiling to Vega](vega.md) shows the tables and transforms this produces.
