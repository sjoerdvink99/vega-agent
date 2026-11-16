---
hide:
  - navigation
  - toc
---

<div class="hero" markdown>

![vega-agent](assets/logo.svg){ .hero-logo }

# vega-agent

**A visualization grammar for agent traces.** You give it your records and a view spec. vega-agent maps the records to a grammar of agent processes and compiles the view to Vega, so the figure renders the same in a browser, a notebook, a paper or CI.

[Get started](quickstart.md){ .md-button .md-button--primary } [Gallery](gallery.md){ .md-button } [GitHub](https://github.com/sjoerdvink99/vega-agent){ .md-button }

</div>

## How it works

**1. Your data.** Records as your agent logs them, one per step. Here each line is one event of a coding agent, from [`coding.jsonl`](assets/coding.jsonl):

```json
{"session":"s09","version":"after","type":"llm","start":0.0,"end":1.0}
{"session":"s09","type":"tool","tool":"read","start":1.1,"end":1.5}
{"session":"s09","type":"llm","start":1.6,"end":2.4}
{"session":"s09","type":"tool","tool":"write","start":2.5,"end":2.8,"error":"patch did not apply"}
```

**2. Your spec.** A JSON view spec, as in Vega-Lite: a `mark`, the `data`, and a `trace` mapping that says which field is the run, the actor, the name, the time and the failure.

```vega-agent
{ "mark": "variants", "level": "names",
  "data": { "url": "assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

**3. The grammar.** vega-agent maps every run to a trace in a grammar of agent processes. Session `s09` becomes `model -> tool.read -> model -> tool.write! -> model -> tool.write -> model`: five actors, sequence `->`, parallel `||` and failure `!`. You never write these traces; the [grammar](grammar.md) is what views count, compare and query.

**4. Vega.** The view compiles to a self-contained [Vega](https://vega.github.io/vega/) spec. vega-agent ships each distinct variant once; Vega counts, ranks and folds the runs, lays out the figure and handles every click. [Compiling to Vega →](vega.md)

<div class="grid cards va-features" markdown>

-   **Your data, as it is**

    Your own records, mapped field by field with `trace`, or telemetry in a standard, read with no mapping at all. [Data →](data.md)

-   **Declarative views**

    One JSON spec, one figure: timelines, hand-offs, icicles, variants, process graphs, Sankeys, transition matrices, activity statistics, sequences, distributions, durations and projections. [Views →](views.md)

-   **A grammar underneath**

    Every run becomes an expression such as `(model -> tool){2} -> model`, and a corpus becomes five tables that views and analyses read. The same syntax draws an architecture as a diagram and finds a pattern. [Grammar →](grammar.md) · [Tables →](tables.md)

-   **Speaks the standards**

    Reads OpenTelemetry GenAI, OpenInference, LangSmith, provider transcripts and ATIF. Writes OTLP, XES, OCEL 2.0 and BPMN. [Standards →](standards.md)

</div>

## Gallery

Every view below reads the same file with the same `trace`. Click **Spec** under a figure to see it.

<div class="gallery" markdown>

```vega-agent
{ "mark": "transitions", "level": "names", "legend": false,
  "data": { "url": "assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

```vega-agent
{ "mark": "activities", "legend": false,
  "data": { "url": "assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

</div>

```vega-agent
{ "mark": "icicle", "level": "names", "height": 240,
  "data": { "url": "assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error", "group": "version" } }
```

```vega-agent
{ "mark": "sequences", "highlight": "tool! -> model -> tool",
  "data": { "url": "assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

With `group`, the icicle compares the runs before and after a change: orange is more common before, blue after. The `highlight` keeps the steps where a failed tool call is retried in colour. [More in the gallery →](gallery.md)
