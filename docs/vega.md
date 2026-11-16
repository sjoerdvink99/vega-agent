# Compiling to Vega

Every view spec compiles to one self-contained [Vega](https://vega.github.io/vega/) spec. vega-agent turns your records into the [tables](tables.md) of their traces and ships them in the spec; every view is a Vega dataflow over those tables. The figure recounts when you click or change `level`, without compiling again.

## Who does what

| Step | Done by | In the Vega spec |
|---|---|---|
| Read, filter and map records to one trace per run | vega-agent | |
| Build the tables: variants at each level, their tokens and steps, the runs' times | vega-agent | `runs`, `variants`, `tokens`, `steps`, `times` |
| Lay out what must stay put while you click: the prefix tree, kept activities and their order, Sankey nodes, chip widths, projection positions, hand-off lanes | vega-agent, from the tables | `walks`, `activities`, `layouts`, `points`, … |
| Pick the level | Vega | the `level` signal |
| Keep the selected runs and mark the highlighted ones | Vega | `filter` and `formula` on `active` |
| Join each run to what its variant contains | Vega | `lookup` and `flatten` |
| Count, share, rank and fold into a remainder | Vega | `aggregate`, `window`, `filter` |
| Scales, axes, legends, marks, tooltips and selections | Vega | |

A spec ships each table its views read once, whatever the number of views; with several data sources, as in a `facet`, each source's tables get a prefix, `s0_runs`, `s1_runs`.

## One view, step by step

Take three runs in two groups:

```json
{ "mark": "activities", "level": "names", "trace": { "group": "side" },
  "data": { "values": [
    { "process": "model -> tool.read -> model", "side": "a" },
    { "process": "model -> tool.read -> model", "side": "b" },
    { "process": "model -> tool.edit! -> model -> tool.edit -> model", "side": "b" } ] } }
```

The spec ships `runs` and `steps`. The first two runs share a trace, so `steps` holds two traces, eight rows, however many runs share them. The view then reads (abridged):

```json
{ "name": "active", "source": "runs", "transform": [
  { "type": "project", "fields": ["run", "id", "group", "full", "names", "actors", "loops"] },
  { "type": "formula", "as": "variant", "expr": "datum[level]" } ] }
{ "name": "used", "source": "steps", "transform": [
  { "type": "formula", "as": "activity", "expr": "… actor and name, at the level …" },
  { "type": "aggregate", "groupby": ["variant", "activity"], "fields": ["index", "fail"], "ops": ["count", "max"], "as": ["uses", "failed"] } ] }
{ "name": "uses", "source": "active", "transform": [
  { "type": "lookup", "from": "used_by_variant", "key": "variant", "fields": ["full"], "values": ["items"] },
  { "type": "flatten", "fields": ["items"], "as": ["item"] } ] }
{ "name": "activities", "source": "uses", "transform": [
  { "type": "aggregate", "groupby": ["activity"], "fields": ["n0", "n1", "uses0", "uses1", "id"], "ops": ["sum", "sum", "sum", "sum", "values"] } ] }
```

`active` is the view's own copy of `runs`, at its level and after its selection. `used` counts each activity once per trace, and `uses` joins every active run to the counts of its trace; `aggregate` then counts runs and uses per activity and group. Each counted item keeps the ids of its runs, so a click selects exactly those runs.

The grammar decides what a trace contains, and Vega counts how many runs have it. A corpus of a million runs with one trace ships one trace, plus a short row per run: at 10,000 [SWE-agent runs](gallery.md#real-runs) the icicle compiles to 4 MB and the transition matrix to about 1 MB.

## Per mark

| Mark | Reads | Fixed layout | Vega |
|---|---|---|---|
| `icicle` | `runs`, `tokens` | the prefix tree and each variant's walk through it | `aggregate` per node, `stratify`, `partition` |
| `variants` | `runs`, `variants`, `tokens` | the width of each chip | `aggregate` per variant, `window` to rank, `flatten` the chips of shown rows |
| `transitions`, `graph` | `runs`, `steps` | the kept activities and their order | `window` `lead` for step pairs, `aggregate` per pair and per step |
| `sankey` | `runs`, `tokens` | the nodes of each column | `aggregate` per node and per link, `window` to stack |
| `activities` | `runs`, `steps` | | `aggregate` per trace, then per activity, `window` to rank |
| `durations` | `runs`, `steps`, `times` | | quartiles per activity |
| `distribution` | `runs`, `steps`, `times` | | run length, failures or duration, then `bin` |
| `projection` | `runs`, `variants`, `tokens` | each variant's position | `aggregate` per variant |
| `sequences` | `runs`, `tokens`, `steps`, `times` | the most typical runs | `lookup` of their selection and matches |
| `timeline` | `runs`, `steps`, `times` | | the shown run's steps and times, `window` for lanes |
| `handoffs` | `runs`, `steps`, `times` | each trace's calls, returns and lanes | the shown run's messages and times |
| `diagram` | a design, not data | the laid-out railroad diagram | marks only |

`timeline` and `handoffs` show the first selected run, or the first run; Vega picks it, so a click redraws them without compiling.

## Interaction

- **`level`** is a signal. A run's variant is `datum[level]`, so a new level re-runs the dataflow from `active`.
- **A selection** is a Vega data set of run ids, `<param>_store`. A click puts the clicked item's ids in it. `filter` keeps the runs in it before counting; `highlight` dims what it leaves out.
- **A query** in `highlight` needs the grammar, so vega-agent finds the matching runs, once per distinct trace, and ships their ids as a data set.

The compiled spec uses only Vega's own transforms and expressions. Open it in the [Vega Editor](https://vega.github.io/editor/) with `compile(spec)`, `vega-agent view.json --vega`, or `chart.to_vega()` in Python, and draw your own marks over its tables.
