# Quickstart

## Install

=== "Python"

    ```bash
    pip install vega-agent
    ```

    Import it as `import vega_agent as va`. Charts work in Jupyter, JupyterLab, VS Code, Colab and marimo.

=== "TypeScript"

    ```bash
    npm install vega-agent
    ```

    One dependency, [Vega](https://vega.github.io/vega/), with type declarations.

=== "Plain HTML"

    ```html
    <script src="https://cdn.jsdelivr.net/npm/vega-agent/dist/vega-agent.min.js"></script>
    ```

    Bundles Vega and exposes the same API as the global `vega-agent`.

=== "From source"

    ```bash
    git clone https://github.com/sjoerdvink99/vega-agent
    cd vega-agent && make install
    ```

    Needs Node 22+ and Python 3.10+.

## Your first view

You need two things: your records and a view spec.

Your records are whatever your agent logs. Here, [`coding.jsonl`](assets/coding.jsonl) holds one event per step of a coding agent:

```json
{"session":"s01","version":"before","type":"llm","start":0.0,"end":1.0}
{"session":"s01","type":"tool","tool":"read","start":1.1,"end":1.4}
{"session":"s01","type":"llm","start":1.5,"end":2.8}
```

The spec names a `mark`, points `data` at the records, and maps their fields with `trace`: `session` is the run, `type` the actor, `tool` the step's name, `start` and `end` the time, and `error` marks a failure.

```vega-agent
{ "mark": "variants", "level": "names",
  "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" } }
```

That is all. vega-agent maps each session to a trace in its [grammar](grammar.md), `model -> tool.read -> model`, and compiles the view to Vega, which counts the distinct runs and draws them. Change `mark` to `transitions`, `activities` or `sequences` for another view of the same records.

=== "Python"

    ```python
    import json
    import vega_agent as va

    records = [json.loads(line) for line in open("coding.jsonl")]
    va.Chart({
        "mark": "variants",
        "level": "names",
        "data": {"values": records},
        "trace": {"run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error"},
    })
    ```

=== "TypeScript"

    ```ts
    import { embed } from "vega-agent";

    await embed(document.getElementById("view")!, {
      mark: "variants",
      level: "names",
      data: { url: "coding.jsonl" },
      trace: { run: "session", actor: "type", name: "tool", start: "start", end: "end", failed: "error" },
    });
    ```

=== "Plain HTML"

    ```html
    <div id="view"></div>
    <script>
      vegaAgent.embed(document.getElementById("view"), {
        mark: "variants",
        level: "names",
        data: { url: "coding.jsonl" },
        trace: { run: "session", actor: "type", name: "tool", start: "start", end: "end", failed: "error" },
      });
    </script>
    ```

=== "CLI"

    ```bash
    npx vega-agent view.json -o variants.svg    # view.json holds the spec above
    npx vega-agent view.json --vega             # the compiled Vega spec
    ```

## Telemetry in a standard

OpenTelemetry spans, LangSmith runs, provider transcripts and the other [standards](standards.md) need no `trace` at all:

```json
{ "mark": "variants", "level": "names", "data": { "url": "spans.jsonl" } }
```

## Linked views

Views in one spec share their data and link through selections. Click a variant to see its runs:

```vega-agent
{ "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" },
  "vconcat": [
    { "mark": "variants", "level": "names", "params": [{ "name": "picked", "select": "click" }], "highlight": { "param": "picked" } },
    { "mark": "sequences", "filter": { "param": "picked" } }
  ] }
```

In Python, a corpus gives the same charts and analyses over the grammar:

```python
runs = va.Corpus(va.read(records, {"run": "session", "actor": "type", "name": "tool", "failed": "error"}))
runs.chart(mark="variants", level="names")          # every distinct run, by frequency
runs.conformance("(model -> tool[])* -> model")     # share of runs that follow a design
runs.find("(model -> tool!){2,}")                   # two failing tool calls in a row
```

## Next

- [Data](data.md): map your records to runs, and how views aggregate them.
- [Grammar](grammar.md): what your runs become, and how to query them.
- [Views](views.md): every mark and its properties.
- [Interaction](interaction.md): build an analytics tool on top.
