# Python

```python
import vega_agent as va
```

## Grammar

| Function | Returns |
|---|---|
| `parse(text)` | a `Node`; raises `ParseError` with `position` and `reason` |
| `trace(text, id="", **meta)` | a `Trace`; raises `TraceError` |
| `conforms(run, spec)` | `True` when the run is in the spec's language |
| `find(run, query)` | `list[Hit]`: the `text` of each match and the positions of its `steps` |
| `abstract(node, level)`, `fold(node)` | a coarser node |
| `sample(spec, n=1, seed=None)` | `n` random traces the spec accepts |
| `is_ground(node)`, `size(node)` | whether a node is a trace, and its number of steps |
| `tables(runs)` | the [`Tables`](../tables.md) of the runs: `runs`, `variants`, `tokens`, `steps` and `times` as DataFrames |

`str(node)` prints the canonical text. Nodes are frozen dataclasses: `Step`, `Seq`, `Par`, `Alt`, `Repeat` (with `parallel` for `[m,n]`). A `Trace` holds its `process`, `id`, `time`, one `(start, end)` or `None` per step in order (empty when untimed), and `meta`.

## Corpora

`Corpus(runs, name="")` holds traces. Index it, iterate it, or:

| Method | Returns |
|---|---|
| `chart(mark="icicle", **options)` | a `Chart`; `options` are those of the mark's function below |
| `tables` | the corpus's [`Tables`](../tables.md) |
| `variants(level)` | a DataFrame of distinct runs and their share |
| `find(query)` | a DataFrame of every match |
| `where(query)` | the runs that contain a match |
| `conformance(spec)` | the share of runs the spec accepts |
| `select(ids)` | the runs with these ids |

`Diff(a, b, spec=None, queries=(), labels=("A", "B"))` compares two corpora: `metrics()`, `variants(level)` and `chart(mark, **options)`.

## Charts

| Function | Mark |
|---|---|
| `diagram(process, title=None, key=True)` | `diagram` |
| `timeline(run, title=None, lanes="step")` | `timeline` |
| `handoffs(process, title=None)` | `handoffs` |
| `icicle(data, level="actors", highlight=None, title=None, height=380)` | `icicle` |
| `variants(data, level="actors", highlight=None, title=None, limit=12)` | `variants` |
| `transitions(data, level="names", title=None, limit=16)` | `transitions` |
| `graph(data, level="names", title=None, limit=16)` | `graph` |
| `sankey(data, level="actors", title=None, limit=8, height=300)` | `sankey` |
| `activities(data, level="names", title=None, limit=16)` | `activities` |
| `sequences(data, highlight=None, title=None, limit=50, x="step")` | `sequences` |
| `distribution(data, measure="steps", highlight=None, title=None)` | `distribution` |
| `durations(data, level="names", title=None, limit=16)` | `durations` |
| `projection(data, level="names", highlight=None, title=None, height=300)` | `projection` |
| `vconcat(*charts, title=None)`, `hconcat(*charts, title=None)` | `vconcat`, `hconcat` |

`data` is a corpus, a list of runs, a `Diff`, or a dict of named corpora; runs that `read` gave a group keep it. The spec carries the runs as `data.values`: two groups are compared in one view with a `trace` group, and more than two become a [`facet`](../data.md#facets) with one panel each. A `Chart` has `selected`, `to_dict()`, `to_json()`, `to_html()`, `to_svg()`, `to_vega()` and `save(path)`. `to_svg()`, `to_vega()` and saving `.svg` or `.vg.json` need Node on the PATH.

## Readers and exports

| Function | |
|---|---|
| `read(source, format=None)` | a file, a folder, a record or records to `list[Trace]`; `format` is a standard, detected unless given, or a [`trace` mapping](../data.md#trace) dict |
| `to_otel(runs)`, `to_xes(runs)`, `to_ocel(runs)` | runs to OTLP/JSON, XES or OCEL 2.0 |
| `to_bpmn(spec)`, `to_process_tree(spec)` | a spec to BPMN 2.0 or a pm4py process tree |
