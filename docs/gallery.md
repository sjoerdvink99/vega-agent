# Gallery

Every figure below is drawn from its spec: click **Spec** under a figure to show it, and copy one to start.

## The data

The views read two small files, each with one `trace` mapping, so every spec is a mark, the data and the mapping.

[`coding.jsonl`](assets/coding.jsonl) is the event log of a coding agent: 16 sessions, 8 before and 8 after a change to the agent, one record per model call or tool call.

```json
{"session":"s09","version":"after","type":"llm","start":0.0,"end":1.0}
{"session":"s09","type":"tool","tool":"read","start":1.1,"end":1.5}
{"session":"s09","type":"llm","start":1.6,"end":2.4}
{"session":"s09","type":"tool","tool":"write","start":2.5,"end":2.8,"error":"patch did not apply"}
```

```json
"trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" }
```

[`crew.jsonl`](assets/crew.jsonl) holds the spans of two multi-agent runs, where each span names its parent:

```json
{"trace":"t1","id":"2","kind":"agent","name":"research","start":1.1,"end":3.4}
{"trace":"t1","id":"4","parent":"2","kind":"tool","name":"search","start":1.9,"end":2.6}
```

```json
"trace": { "run": "trace", "step": "id", "parent": "parent", "actor": "kind", "name": "name", "start": "start", "end": "end", "failed": "error" }
```

## One run

### Steps over time

When each step of session `s13` ran. A `transform` keeps its records.

```vega-agent
{ "mark": "timeline",
  "transform": [{ "filter": { "field": "session", "equal": "s13" } }],
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

### Pick a run

Click a row: the timeline below draws the selected run.

```vega-agent
{ "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" },
  "vconcat": [
    { "mark": "sequences", "params": [{ "name": "picked", "select": "click", "value": ["s12"] }], "highlight": { "param": "picked" } },
    { "mark": "timeline", "filter": { "param": "picked" } }
  ] }
```

### Agents in swimlanes

One lane per agent context over time, as in [AgentLens](https://arxiv.org/abs/2402.08995) and the overview timeline of [AGDebugger](https://arxiv.org/abs/2503.02068). The thin bars in the main lane mark the delegations.

```vega-agent
{ "mark": "timeline", "lanes": "agent",
  "data": { "url": "../assets/crew.jsonl" },
  "trace": { "run": "trace", "step": "id", "parent": "parent", "actor": "kind", "name": "name", "start": "start", "end": "end", "failed": "error" } }
```

### Hand-offs between agents

Who passes control to whom, the question behind the conversation overview of [AGDebugger](https://arxiv.org/abs/2503.02068) and the agent interactions of [AgentLens](https://arxiv.org/abs/2402.08995).

```vega-agent
{ "mark": "handoffs",
  "transform": [{ "filter": { "field": "trace", "equal": "t2" } }],
  "data": { "url": "../assets/crew.jsonl" },
  "trace": { "run": "trace", "step": "id", "parent": "parent", "actor": "kind", "name": "name", "start": "start", "end": "end", "failed": "error" } }
```

### Action graph of one run

Repeated actions merge into one node, so loops and backtracking show as returning arcs, as in [Graphectory](https://arxiv.org/abs/2512.02393).

```vega-agent
{ "mark": "graph",
  "transform": [{ "filter": { "field": "session", "equal": "s13" } }],
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

## Many runs

### Shared prefixes

Runs merged by how they start. Runs that contain the query are emphasised.

```vega-agent
{ "mark": "icicle", "level": "names", "height": 240, "highlight": "tool! -> model",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

### Variants

Each distinct run, ranked by how often it occurs.

```vega-agent
{ "mark": "variants", "level": "names",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

### Transitions

How often each step directly follows another, per run.

```vega-agent
{ "mark": "transitions",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

### Every run, step by step

One row per run. Steps that are part of a match for the query keep their colour.

```vega-agent
{ "mark": "sequences", "highlight": "tool! -> model -> tool",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

### Every run, over time

The same view positioned by time.

```vega-agent
{ "mark": "sequences", "x": "time",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

## Real runs

400 trajectories of [SWE-agent](https://swe-agent.com) fixing 57 real GitHub issues, sampled from [nebius/SWE-agent-trajectories](https://huggingface.co/datasets/nebius/SWE-agent-trajectories) (CC BY 4.0). [`examples/data/swe_agent.py`](https://github.com/sjoerdvink99/vega-agent/blob/main/examples/data/swe_agent.py) turns each model turn and each command into one record, 21,936 in all:

```json
{"run":"r0","actor":"model","issue":"AnalogJ__lexicon-336","model":"llama-70b","outcome":"unresolved"}
{"run":"r0","actor":"tool","tool":"bash","failed":true}
```

Every view below reads that file and maps it with the same `trace`; `group` splits the runs by outcome.

### What resolved runs do differently

Unresolved runs call the model twice as often, fail half their edits, and submit less often.

```vega-agent
{ "mark": "activities", "limit": 12,
  "data": { "url": "../assets/swe-agent.jsonl" },
  "trace": { "run": "run", "actor": "actor", "name": "tool", "failed": "failed", "group": "outcome" } }
```

### Long runs, and what fills them

Click a bin of run lengths: the rows below show the runs in it, with every loop of three or more failing edits kept in colour.

```vega-agent
{ "data": { "url": "../assets/swe-agent.jsonl" },
  "trace": { "run": "run", "actor": "actor", "name": "tool", "failed": "failed", "group": "outcome" },
  "vconcat": [
    { "mark": "distribution", "params": [{ "name": "picked", "select": "click" }], "highlight": { "param": "picked" } },
    { "mark": "sequences", "limit": 24, "filter": { "param": "picked" }, "highlight": "(tool.edit! -> model){3,}" }
  ] }
```

### Every model, the same question

One panel per model, with the navigation commands filtered out. In all three, unresolved runs call the model more often and fail more of their edits.

```vega-agent
{ "facet": { "field": "model", "columns": 1 },
  "spec": { "mark": "activities", "limit": 5 },
  "data": { "url": "../assets/swe-agent.jsonl" },
  "transform": [{ "filter": { "not": { "field": "tool", "oneOf": ["goto", "scroll_up", "scroll_down"] } } }],
  "trace": { "run": "run", "actor": "actor", "name": "tool", "failed": "failed", "group": { "field": "outcome", "order": ["resolved", "unresolved"] } } }
```

## From the research literature

Views that visual analytics systems for agents have proposed, each as one spec. The categories and the mark for each:

| Category | Examples | Mark |
|---|---|---|
| Architecture and control flow | LangGraph Studio, agent design patterns | `diagram` |
| Timeline of one run | trace waterfalls in Langfuse, LangSmith and Phoenix; AgentLens | `timeline` |
| Communication between agents | AGDebugger, AgentLens outline view | `handoffs` |
| Prefix tree of many runs | LifeFlow, EventFlow, AIDE solution trees | `icicle` |
| Variants | process mining variant explorers, InconLens | `variants` |
| Flow | Outflow, Graphectory phase Sankey | `sankey` |
| Transition graph and matrix | directly-follows graphs, AgentDiagnose, TraceView, MatrixWave | `graph`, `transitions` |
| Sequence overview | dotted charts, AGDebugger overview | `sequences` |
| Activity statistics | SeaView, AgentTrails, AIDE package view | `activities` |
| Run statistics | step-count distributions by outcome (TraceProbe) | `distribution` |
| Performance | performance spectrum, span latency | `durations` |
| Embedding | AgentDiagnose t-SNE view, AIDE projection view | `projection` |

### Phases across a corpus

Runs flowing through their first steps, with repetitions collapsed, as in the Phase Sankey of the [Graphectory Viewer](https://arxiv.org/abs/2608.17195).

```vega-agent
{ "mark": "sankey", "level": "loops", "limit": 5, "height": 220,
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

### Tool usage and failure

Which tools runs use and how often they fail, the overview that [AgentTrails](https://arxiv.org/abs/2607.18816) and [SeaView](https://arxiv.org/abs/2504.08696) open with.

```vega-agent
{ "mark": "activities",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error", "group": "version" } }
```

### Dotted chart

Every run as a row of events, the classic overview of event sequence analysis ([Guo et al.](https://doi.org/10.1109/TVCG.2021.3100413)), here with the steps of failing loops kept in colour.

```vega-agent
{ "mark": "sequences", "highlight": "(tool! -> model){2,}",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

### Steps per run by group

How long runs are, split by group, as in the step-count distributions of trajectory diagnostics for coding agents ([TraceProbe](https://arxiv.org/abs/2607.06184)).

```vega-agent
{ "mark": "distribution",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error", "group": "version" } }
```

### Where the time goes

The spread of each step's duration, the per-activity view of performance analysis in process mining and of span latency in LLM observability.

```vega-agent
{ "mark": "durations",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

### Similar runs close together

Variants embedded by what they do, like the action embeddings of [AgentDiagnose](https://aclanthology.org/2025.emnlp-demos.15) and the projection view for coding agents of [Wang et al.](https://arxiv.org/abs/2508.12555).

```vega-agent
{ "mark": "projection", "level": "names",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error", "group": "version" } }
```

## Comparisons

With `group` in the mapping, the corpus views compare two groups of runs on one diverging scale: orange is more common in the first group, here `before`, and blue in the second.

### Did the change alter the paths?

```vega-agent
{ "mark": "icicle", "level": "names", "height": 240,
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error", "group": "version" } }
```

### Which variants appeared or vanished?

```vega-agent
{ "mark": "variants", "level": "names",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error", "group": "version" } }
```

### Which hand-offs changed?

```vega-agent
{ "mark": "transitions", "level": "names",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error", "group": "version" } }
```

## Designs

A `diagram` draws a design rather than data: an expression in the [grammar](grammar.md), with choice `|` and repetition `*`, the patterns that runs follow. It is the one view where you write the grammar yourself.

### A design beside its runs

```vega-agent
{ "hconcat": [
  { "mark": "diagram", "process": "(model -> tool[])* -> model", "title": "design" },
  { "mark": "sequences", "title": "runs",
    "data": { "url": "../assets/coding.jsonl" },
    "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
] }
```

### Prompt chain

Fixed steps, with a check in code between them.

```vega-agent
{ "mark": "diagram", "process": "model.outline -> code.check -> model.write" }
```

### Routing

One model picks the specialist that handles the request.

```vega-agent
{ "mark": "diagram", "process": "model.route -> (agent.billing | agent.tech | model.answer)" }
```

### Sectioning

Independent parts in parallel, merged by code.

```vega-agent
{ "mark": "diagram", "process": "(model.intro || model.method || model.results) -> code.merge" }
```

### Voting

The same question five times in parallel, then a vote.

```vega-agent
{ "mark": "diagram", "process": "model.answer[5] -> code.vote" }
```

### Agent loop

The model calls tools, in parallel, until it answers.

```vega-agent
{ "mark": "diagram", "process": "(model -> tool[])* -> model" }
```

### Orchestrator and workers

A plan fans out to one worker per task, each with its own context.

```vega-agent
{ "mark": "diagram", "process": "model.plan(=> task:text[]) -> agent.worker{ (model -> tool[])* -> model }[] -> model.synthesize" }
```

### Evaluator and optimizer

Draft, then critique and revise until the critique passes.

```vega-agent
{ "mark": "diagram", "process": "model.draft -> (model.critique -> model.revise)* -> model.critique" }
```

### Human in the loop

A person may approve each round of tool calls.

```vega-agent
{ "mark": "diagram", "process": "(model -> human.approve? -> tool[])* -> model" }
```

### Retrieval

Typed inputs and outputs, shown under each step.

```vega-agent
{ "mark": "diagram", "process": "model.plan(=> query:text) -> tool.retrieve(query:text => passage:text[]) -> model.answer(passage:text[] => answer:text)" }
```

### MCP sampling

A tool that asks the client's model for a completion.

```vega-agent
{ "mark": "diagram", "process": "model -> tool.summarize{ model } -> model" }
```

### Two designs side by side

```vega-agent
{ "hconcat": [
  { "mark": "diagram", "process": "(model -> tool[])* -> model", "title": "single agent" },
  { "mark": "diagram", "process": "model.plan -> agent.worker{ (model -> tool[])* -> model }[] -> model.synthesize", "title": "orchestrator" }
] }
```
