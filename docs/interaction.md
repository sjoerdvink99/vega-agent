# Interaction

`embed` turns a spec into an interactive view. Tooltips, zoom into the icicle and the level switch are always on. Everything else, such as selecting, linking and filtering, is declared in the spec as a selection.

```ts
import { embed } from "vega-agent";

const view = await embed(element, { mark: "icicle", data: { url: "spans.jsonl" }, width: "container" });
```

All of it compiles to Vega: a selection is a data set `<name>_store` of ids, updated by Vega signals, and `highlight` and `filter` are tests on it inside the dataflow. The compiled spec keeps its interaction without vega-agent, for example in the [Vega Editor](https://vega.github.io/editor/).

## Selections

A selection is a named set of ids that the user fills by interacting with a view, following the `params` of [Vega-Lite](https://vega.github.io/vega-lite/docs/selection.html). A view declares the selections it makes:

```json
"params": [{ "name": "picked", "select": "click" }]
```

| Property | |
|---|---|
| `name` | how other views refer to it |
| `select` | `"click"`: click an item to select it, shift-click to add another, click the background to clear. `"hover"`: the item under the pointer, cleared when the pointer leaves |
| `value` | the ids selected now; `embed` keeps it up to date |

A corpus view selects **runs**, by the value of the `run` field: clicking a variant, a cell, a pair or a row selects every run in it. A `diagram` or `timeline` of a trace selects **steps**. Views use a selection in two ways:

| Property | Views | |
|---|---|---|
| `highlight: { "param": name }` | all | emphasise what is selected and dim the rest |
| `filter: { "param": name }` | all but `diagram` | corpus views show only the selected runs, or all of them while nothing is selected; `timeline` and `handoffs` draw the first selected run |

Here clicking a variant highlights it, and the sequences below show only its runs. Both views read the `data` of the composition, so their runs and ids are the same:

```vega-agent
{ "data": { "url": "../assets/coding.jsonl" },
  "trace": { "run": "session", "actor": "type", "name": "tool", "start": "start", "end": "end", "failed": "error" },
  "vconcat": [
    { "mark": "variants", "level": "names", "params": [{ "name": "picked", "select": "click" }], "highlight": { "param": "picked" } },
    { "mark": "sequences", "filter": { "param": "picked" } }
  ] }
```

Declaring the same name in several views shares one selection between them, so hovering either view highlights both. A name selects runs or steps, never both, and `validate` checks that every `{ "param": name }` refers to a declared selection of the right kind. Selections on a `diagram` need a trace, because only a trace has steps to select.

## The view

| Member | |
|---|---|
| `view.spec` | the current spec, with the state the user reached: `level`, `focus` and each selection's `value` |
| `view.selection` | each selection's ids, such as `{ picked: ["run-7"] }` |
| `view.on("select", selection => …)` | a selection changed |
| `view.update(spec)` | draw a new spec in place; returns a promise |
| `view.toSVG()` | a promise of the current figure as a standalone SVG string |
| `view.vega` | the underlying [Vega view](https://vega.github.io/vega/docs/api/view/), for its signals, data and events |
| `view.destroy()` | remove the view and its listeners |

`on` returns a function that removes the listener.

**State is a spec.** Every state the user can reach is a property of the spec, so `view.spec` reproduces exactly what is on screen. Save it, share it, or pass it to `render` for a paper.

**Failures leave the view alone.** `embed` and `update` validate first and reject with a `SpecError` with a path, such as `spec.trace.run`, before touching the page.

## Linking your own components

Selections link views within one spec. To drive the rest of a page, listen to them. Here a variants overview drives a timeline of the run the user clicks:

```ts
import { embed } from "vega-agent";

const source = {
  data: { url: "coding.jsonl" },
  trace: { run: "session", actor: "type", name: "tool", start: "start", end: "end", failed: "error" },
};

const overview = await embed(left, {
  ...source,
  mark: "variants",
  level: "names",
  width: "container",
  params: [{ name: "picked", select: "click" }],
  highlight: { param: "picked" },
});
const detail = await embed(right, { ...source, mark: "timeline" });

overview.on("select", ({ picked }) => {
  if (picked.length === 0) return;
  detail.update({ ...source, mark: "timeline", transform: [{ filter: { field: "session", oneOf: picked } }] });
});
```

The [trace explorer](https://github.com/sjoerdvink99/vega-agent/tree/main/examples/explorer) is a complete tool built this way.

## Without a browser

| Function | Returns | Use it for |
|---|---|---|
| `render(spec)` | a promise of an SVG string | Node, servers, CI reports, papers |
| `compile(spec)` | a self-contained Vega spec | rendering with Vega to canvas or PNG, the Vega Editor, extending a figure by hand |
| `validate(spec)` | a checked copy of the spec | rejecting bad input early |

## In Python

Charts are notebook widgets. Corpus charts select runs on click, as the selection `selected`, and highlight what is selected. `select="hover"` selects on hover, and `select=None` turns it off. The selection syncs back to Python:

```python
chart = runs.chart(mark="variants", level="names")
chart                       # shows the view
runs.select(chart.selected) # the runs the user clicked, as a Corpus
```

`chart.selection` holds every selection by name. `chart.properties(...)` sets any other property of the spec, such as `tooltip`, `params` or `filter`:

```python
va.vconcat(
    runs.chart(mark="variants", select=None).properties(
        params=[{"name": "picked", "select": "click"}], highlight={"param": "picked"}
    ),
    runs.chart(mark="sequences", select=None).properties(filter={"param": "picked"}),
)
```

Export with `chart.save("figure.html")`, `.json`, `.svg` or `.vg.json`, the compiled Vega spec. `chart.to_vega()` returns that spec as a dict. SVG and Vega need Node on the PATH.
