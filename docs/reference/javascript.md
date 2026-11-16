# TypeScript

`vega-agent` is an ES module with type declarations. `vega-agent.min.js` exposes the same API as the global `vega-agent`.

## Views

| Function | Returns |
|---|---|
| `compile(spec)` | a self-contained [Vega](https://vega.github.io/vega/) spec; `data` must hold `values` |
| `load(spec, base?)` | a promise of the spec with every `data.url` fetched into `values`, relative to `base` |
| `render(spec, base?)` | a promise of an SVG string, rendered by Vega |
| `embed(element, spec)` | a promise of a [`View`](../interaction.md#the-view) |
| `validate(spec)` | a checked copy; throws `SpecError` with `path` and `reason` |

`compile` validates first. The compiled spec holds the [tables](../tables.md) its views read, `runs`, `variants`, `tokens`, `steps` and `times`, prefixed `s0_`, `s1_` when several data sources are drawn. A selection `name` is the data set `name_store`, and with `vconcat` or `hconcat` each view's own names start with `v0_`, `v1_` and so on.

## Readers

| Function | Returns |
|---|---|
| `read(source, format?)` | `TracedRun[]` from records, a record, or JSON or JSON Lines text; `format` is a `Format`, detected unless given, or a [`Mapping`](../data.md#trace) |

A `TracedRun` is `{ id, process, time, agent?, group? }`, with one `[start, end]` or `null` per step in `time`; a list of them is valid `data.values`.

| Function | Returns |
|---|---|
| `tables(runs)` | the [`Tables`](../tables.md) of `TracedRun[]`: `{ runs, variants, tokens, steps, times }`, arrays of rows |

## Grammar

| Function | Returns |
|---|---|
| `parse(text)` | a `Node`; throws `ParseError` with `position` and `reason` |
| `print(node)` | the canonical text |
| `trace(text)` | a ground `Node`; throws `TraceError` |
| `isGround(node)`, `size(node)` | whether a node is a trace, and its number of steps |
| `conforms(run, spec)` | `true` when the run is in the spec's language |
| `find(run, query)` | `Hit[]`: the `text` of each match and the positions of its `steps` |
| `abstract(node, level)`, `fold(node)` | a coarser node |
| `seq`, `par`, `alt`, `repeat`, `step` | node constructors; `repeat(node, lo, hi, parallel?)` |
| `steps(node)` | every step with its depth, in order |

Constants: `ACTORS`, `LEVELS`, `MAX_DEPTH`, `MAX_STEPS`, `DEFAULT_CONFIG`, `version`.

## Types

`Spec`, `UnitSpec`, `DiagramSpec`, `TimelineSpec`, `IcicleSpec`, `VariantsSpec`, `TransitionsSpec`, `GraphSpec`, `SankeySpec`, `ActivitiesSpec`, `SequencesSpec`, `VConcatSpec`, `HConcatSpec`, `FacetSpec`, `Facet`, `Panel`, `Views`, `ConfigSpec`, `Data`, `InlineData`, `UrlData`, `Format`, `Transform`, `FilterTransform`, `Predicate`, `EqualPredicate`, `OneOfPredicate`, `RangePredicate`, `ValidPredicate`, `AndPredicate`, `OrPredicate`, `NotPredicate`, `Scalar`, `Mapping`, `GroupChannel`, `Sourced`, `ActorChannel`, `FailedChannel`, `TimeChannel`, `TimeUnit`, `FieldName`, `Interval`, `Param`, `Name`, `Node`, `Step`, `View`, `ViewEvent`, `Selection`, `Listener`, `TracedRun`, `Tables`, `RunRow`, `VariantRow`, `TokenRow`, `StepRow`, `TimeRow`.

The JSON Schema is `vega-agent/view.schema.json`.

## CLI

```bash
vega-agent view.json -o figure.svg          # a data.url is relative to view.json
vega-agent view.json --vega -o figure.vg.json
vega-agent "(model -> tool[])* -> model" > loop.svg
cat view.json | vega-agent -
```
