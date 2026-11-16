# vega-agent

A visualization grammar for agent traces. A JSON view spec holds the records (`data`), maps their fields to the grammar (`trace`), and describes a figure; the figure is a pure function of the spec. The grammar is the center: everything else reads into it, renders from it, or writes out of it. Like Vega-Lite, views compile to Vega: vega-agent maps records to traces, abstracts runs and lays out railroad diagrams, Vega does the aggregation, layout, scales, guides, rendering and interaction.

## Layout

- `grammar/`: the shared contract. `fixtures.json` (grammar), `tables.json` (the tables of a corpus), `standards.json` (readers), `mappings.json` (records → traces by a `trace` mapping), `specs.json` (view specs), `conventions.json` (telemetry → actor mapping), `view.schema.json` (generated from `js/src/spec.ts`).
- `js/`: the `vega-agent` npm package and the only compiler. `src/grammar` (parse, print, trace, match, abstract), `src/data` (`tables.ts`: the five tables of a corpus; `corpus.ts` loads and memoizes them; `transform.ts` filters records), `src/compile` (`index.ts` composes views, `unit.ts` is the contract a mark compiles against, `corpus.ts` the shared corpus dataflow, `focus.ts` the run a single-run mark draws, `follows.ts` the pair dataflow, `tooltip.ts`, `expr.ts`), `src/marks` (one file per mark), `spec.ts`, `validate.ts`, `config.ts` (theme to Vega config), `runtime.ts` (a checked Vega view), `load.ts` (fetches `data.url`), `render.ts`, `embed.ts`, `standards/` (readers, and `mapping.ts` for the `trace` mapping), `cli.ts`, `widget.ts`.
- `python/`: the `vega-agent` PyPI package (`import vega_agent as va`): grammar, corpus analysis, readers and exports, and chart builders whose widget uses the built JS in `python/src/vega_agent/static`.
- `examples/`: notebooks, a TypeScript explorer, a Node regression report, a plain web page.
- `docs/`: the site (`mkdocs.yml`, built with zensical). Every ` ```vega-agent ` block is a live view and is rendered by `js/test/docs.test.ts`.

## Marks

`diagram`, `timeline` (`lanes`: step or agent), `handoffs`, `icicle`, `variants`, `transitions`, `graph`, `sankey`, `activities`, `sequences`, `distribution`, `durations`, `projection`, composed with `vconcat` and `hconcat`, and split into panels with `facet`. Each comes from a view in the agent or event-sequence visualization literature; the docs gallery shows them and maps each category of agent visualization to its mark.

## Commands

- `make install`: build the JS library and install the Python package with its dev, docs and notebook extras.
- `make test`: both test suites. `make lint`: typecheck, ESLint, Prettier, ruff, pyright. `make check`: lint, test, generated files up to date, examples build.
- `make build`: regenerate the schema, the bundles and `python/src/vega_agent/static` after changing `js/`. Needs Node 22+ (`.nvmrc`).
- `cd js && npm run format`: apply Prettier. `make docs` / `make serve`: build or serve the docs.

## Rules

- No comments in code. Name things so they read well.
- Frontend code is TypeScript, never JavaScript.
- Python and TypeScript agree: any grammar, reader, mapping or spec change gets a case in `grammar/*.json` that both suites run.
- Stability first: invalid input raises `ParseError`, `SpecError`, `TraceError` or `TypeError` with a location; readers skip what they cannot read; every valid spec renders, finite and well-formed; Vega errors are thrown, never drawn.
- Vega first: counting, ranking, layout, guides and interaction belong in the compiled Vega spec; precompute in TypeScript only what needs the grammar. The compiled spec stays portable: no custom Vega functions.
- Views read tables, never the grammar: a corpus is `runs`, `variants`, `tokens`, `steps` and `times` (`data/tables.ts`, mirrored in `python/src/vega_agent/tables.py`), shipped once per data source. A view's Vega dataflow starts from `active` (`base`), joins runs to per-variant rows with `joined`, and labels steps with `stepsAt`; TypeScript computes from the tables only layout that must stay put under interaction. ESLint forbids grammar imports in `src/marks` except `diagram.ts`. Never emit rows per run and step, and project before writing formulas on a table, since sourced Vega data shares its rows.
- Steps carry no ids: a step is its position in the trace's walk, a step before its body.
- Reuse the compile building blocks before writing Vega by hand: `scopeOf`, `base`, `joined`, `stepsAt`, `table`, `counted`, `weigh`, `tally`, `ranked`, `perRun`, `perLevel`, `swatches`, `gradient` and `divergence` in `compile/corpus.ts`; `membership`, `band`, `dim` and `hit` in `compile/unit.ts`; `focus`, `ofVariant`, `matched` and `actorsShown` in `compile/focus.ts` for marks that draw one run; `byVariant`, `labelOf` and `clockOf` in `data/tables.ts`. Join tables on `run` (a position), select on `id`.
- Vega names: mark names end in `_mark` (`unit.mark(role)`), since Vega puts mark and data names in one namespace; never name a signal `width` or `height`.
- Keep it lean: no unused exports, files or dependencies; the public API is what `js/src/index.ts` and `python/src/vega_agent/__init__.py` export.
- A new view property goes in `js/src/spec.ts`, `js/src/validate.ts` and `grammar/specs.json`, then `make build`.
- A new mark also needs `js/src/marks/<mark>.ts` returning a `Part` whose selectable marks carry `ids` (run or step ids), a tooltip and `matching` under a highlight, its tooltip fields in `FIELDS` in `js/src/validate.ts`, an entry in `MARKS` in `js/src/compile/index.ts`, `DEFAULT_LEVEL` in `js/src/compile/corpus.ts` when it has `level`, a builder in `python/src/vega_agent/chart.py` and `MARKS`, a section in `docs/views.md`, a row in `docs/vega.md`, an entry in `docs/gallery.md`, and, for a corpus mark, a measure in `js/test/aggregation.test.ts`.
- Keep the docs and READMEs in step with the code, and concise.
- Never credit Claude in commits or pull requests.
