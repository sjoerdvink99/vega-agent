# vega-agent

A grammar for agent processes, and the visualizations it produces.

```bash
pip install vega-agent
```

```python
import vega_agent as va

va.diagram("(model -> tool[])* -> model")  # the agent loop, as a diagram

runs = va.Corpus(va.read("spans.jsonl"))  # OpenTelemetry, LangSmith, Claude Code, Codex, …
runs = va.Corpus(va.read(events, {"run": "session", "actor": "type", "name": "tool"}))  # your own records
runs.chart(mark="variants", level="names")  # every distinct run, by frequency
runs.conformance("(model -> tool[])* -> model")  # share of runs that follow the spec
runs.find("(model -> tool!){3,}")  # three failing tool calls in a row
runs.tables.steps  # the corpus as tables: runs, variants, tokens, steps, times
va.to_xes(runs)  # or to_ocel, to_bpmn, to_otel
runs.chart(mark="icicle").to_vega()  # the compiled Vega spec
```

Documentation: <https://sjoerdvink99.github.io/vega-agent/> · Source: <https://github.com/sjoerdvink99/vega-agent>
