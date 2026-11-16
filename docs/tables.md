# Tables

A corpus of traces has one relational form: five tables. Every application of the grammar reads them. Views draw them with Vega, Python analyses them with pandas, and you can join them with anything else you hold about your runs.

| Table | One row per | Columns |
|---|---|---|
| `runs` | run | `run`, `id`, `group`, and its variant at each level: `full`, `names`, `actors`, `loops` |
| `variants` | variant at a level | `variant`, `level`, `label`, `length` |
| `tokens` | item of a variant's sequence | `variant`, `index`, `token`, `actors`, `failed` |
| `steps` | step of a `full` variant | `variant`, `index`, `depth`, `parent`, `actor`, `name`, `signature`, `failed` |
| `times` | timed step of a run | `run`, `index`, `start`, `end` |

Take two runs:

```text
a   model -> tool.read -> model -> tool.read -> model
b   model -> tool.edit! -> model
```

**`runs`** names each run's variant at every [level](grammar.md#levels). Runs with equal traces share every variant; at `loops`, runs that differ only in how often a loop ran share one.

| run | id | group | full | names | actors | loops |
|---|---|---|---|---|---|---|
| 0 | `a` | | 0 | 2 | 4 | 6 |
| 1 | `b` | | 1 | 3 | 5 | 7 |

**`variants`** holds each variant once. Its `label` is the variant in the grammar, `abstract(trace, level)`, and `length` is the number of items in its sequence.

| variant | level | label | length |
|---|---|---|---|
| 0 | `full` | `(model -> tool.read){2} -> model` | 5 |
| 6 | `loops` | `(model -> tool)+ -> model` | 2 |

**`tokens`** spells out each variant's sequence: the trace's top-level items at that level, one per step except at `loops`, where a loop is one item. The icicle, Sankey and variants views draw these.

**`steps`** holds every step of every `full` variant, in the order the trace prints it. A step is identified by that position, `index`; `parent` is the index of the step whose body holds it, or `-1`, and `depth` its nesting. The table encodes each distinct trace without loss.

**`times`** holds each timed step of each run, at the same `index`. Runs that share a trace share its steps, but not their times.

Every count a view shows is a join of these tables. Activity uses, for instance, are `steps` grouped by variant and activity, joined to `runs` on `full`; the [Compiling to Vega](vega.md) page shows that join in the compiled spec.

## In code

```python
import vega_agent as va

found = va.tables(va.read("spans.jsonl"))
found.runs.groupby("actors").size()          # runs per variant at actors
found.steps.query("failed").actor.value_counts()
```

```ts
import { read, tables } from "vega-agent";

const { runs, variants, tokens, steps, times } = tables(read(records));
```

`va.Corpus(runs).tables` holds the same tables for a corpus. Both languages build identical tables, held to [`grammar/tables.json`](https://github.com/sjoerdvink99/vega-agent/blob/main/grammar/tables.json).
