# Stability

What you can rely on when you build on this library.

- **Every valid spec renders.** A spec that passes `validate` compiles to a Vega spec that renders a finite, well-formed SVG. This is tested on fixtures and on randomized expressions and corpora. A failure inside Vega is thrown by `render` and `embed`, never drawn as a broken figure.
- **Deterministic.** `compile` is a pure function of the spec, and `render` gives the same SVG for the same spec.
- **Invalid input fails early and says where.** Specs raise `SpecError` with a path such as `spec.data[3]`, expressions raise `ParseError` with a position, and non-traces raise `TraceError`. `embed` and `view.update` leave the current view untouched when they fail.
- **Readers never crash on records.** They raise `TypeError` only for a wrong argument. Records they do not recognise, values of the wrong type, and runs over the size limits are skipped; missing ids and times are tolerated, and parent cycles are broken.
- **Bounded work.** Expressions nest at most 64 levels, counts and traces are at most 100,000 steps, and sizes are at most 1,000,000 pixels, so parsing, grounding and reading never overflow the stack or expand without bound.
- **One contract, two languages.** Python and TypeScript pass the same cases in `grammar/` for the grammar, the standards and the view specs.
- **Semantic versioning.** The spec format, the exported functions and the Python API change only with a major version. Changes are listed in the [changelog](https://github.com/sjoerdvink99/vega-agent/blob/main/CHANGELOG.md).
