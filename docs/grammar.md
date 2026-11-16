# Grammar

An expression describes an agent process: what happened in one run, or what may happen in any run.

You rarely write one. A view maps your records to one trace per run through its [`trace`](data.md#trace) mapping, so a session of model and tool calls becomes `model -> tool.read -> model -> tool.write! -> model`. Views count and compare these traces at a [level](#levels) of detail. You write expressions yourself only to draw a design as a `diagram` and to `highlight` a pattern.

## Processes

A process is a step, or processes composed. Two operators compose, one chooses, and each composition repeats:

```text
process ::= step
          | process -> process      sequence
          | process || process      parallel
          | process | process       choice
          | process{m,n}            m to n times in sequence
          | process[m,n]            m to n copies in parallel
```

| Composition | Of two | Repeated |
|---|---|---|
| sequence | `model -> tool` | `(model -> tool){2,5}` |
| parallel | `tool.read \|\| tool.grep` | `model.answer[3,5]` |
| choice | `agent.billing \| agent.tech` | |

## Steps

```text
step ::= actor.name(signature){process}!
```

Only the actor is required:

| Actor | Means | Example |
|---|---|---|
| `model` | one inference | `model.plan` |
| `tool` | an action the model chose | `tool.search` |
| `agent` | a delegated process with its own context | `agent.worker{ model -> tool }` |
| `human` | input, approval or feedback | `human.approve` |
| `code` | deterministic harness logic | `code.check` |

The name says which one, the signature what goes in and out, the body `{ process }` what happens inside the step's own context, and `!` that it failed: `tool.search(query:text => hit:doc[])!`.

```vega-agent
{ "mark": "diagram", "process": "model.route -> (agent.billing{ model -> tool.refund? } | agent.tech | model.answer) -> human.approve?" }
```

## Notation

Shorthands for common bounds, printed wherever they apply:

| Shorthand | Means | |
|---|---|---|
| `a*` `a+` `a?` | `a{0,}` `a{1,}` `a{0,1}` | any number, at least one, optional |
| `a{n}` | `a{n,n}` | exactly `n` times |
| `a[]` | `a[0,]` | any number, one per item |
| `a[n]` | `a[n,n]` | exactly `n` copies |

Names are letters, digits and `_`, and do not start with a digit; counts are whole numbers. An open bound such as `{2,}` or `[1,]` has no upper limit. Parentheses group; without them, `|` binds loosest, then `->`, then `||`, then the repeats, so `model -> tool || code*` reads as `model -> (tool || (code*))`. A signature lists inputs and outputs as `role:medium`, with `[]` for a list, and either side may be empty: `model.plan(=> task:text[])`. In queries, the actor `_` matches any step.

## Traces, designs and queries

One syntax does three jobs:

| | Is | Used by |
|---|---|---|
| **trace** | one run: no choice, no `_`, every repeat exact | every view, built from your records |
| **design** | every run it allows | `diagram`, `conforms(trace, design)` |
| **query** | a pattern to find inside runs | `highlight`, `find(trace, query)` |

```python
va.conforms("model -> tool -> model", "(model -> tool[])* -> model")    # True
va.find("model -> tool! -> model -> tool! -> model", "(model -> tool!){2,}")
# [Hit(text='(model -> tool!){2}', steps=(0, 1, 2, 3))]
```

Matching follows three rules:

- A step in a design or query matches any step at least as specific: `tool` matches `tool.search(q => r)!`, `tool!` matches only failed tools, and `agent{ model }` matches an agent whose body it accepts.
- Parallel branches match in any order: `tool.a || tool.b` accepts `tool.b || tool.a`.
- A query finds the longest match from the left, then continues after it, at every depth of the run.

A step is identified by its position: the order in which the trace prints it, a step before its body. `find` returns the positions of each match, `steps=(0, 1, 2, 3)` above, and a run's times are listed in the same order.

## Levels

Views compare runs at a level of detail. Two runs are the same **variant** at a level when they are equal once that level's detail is dropped:

| Level | Keeps | `model -> tool.read(q => r) -> model -> tool.read -> model` |
|---|---|---|
| `full` | everything | `model -> tool.read(q => r) -> model -> tool.read -> model` |
| `names` | actors and names | `(model -> tool.read){2} -> model` |
| `actors` | actors | `(model -> tool){2} -> model` |
| `loops` | the shape of repeats | `(model -> tool)+ -> model` |

`full`, `names` and `actors` keep how often each step ran; `loops` also forgets how often a loop ran, so a run with two rounds and a run with five are one variant. `abstract(trace, level)` returns the right-hand column. The [tables](tables.md) of a corpus name every run's variant at each level.

## Limits

Expressions nest at most 64 levels deep, counts are at most 100,000, and a trace has at most 100,000 steps. Beyond these, `parse` raises `ParseError` and `trace` raises `TraceError`, and readers skip the run.
