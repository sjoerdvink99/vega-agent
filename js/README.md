# vega-agent

A visualization grammar for agent traces. Put your traces in a JSON view spec, map their fields to a grammar of agent processes, and compile it to a [Vega](https://vega.github.io/vega/) spec that renders the same in a browser, Node or a notebook.

```bash
npm install vega-agent
```

```ts
import { compile, embed, render } from "vega-agent";

const svg = await render({ mark: "diagram", process: "(model -> tool[])* -> model" });

const view = await embed(element, {
  mark: "variants",
  data: { url: "events.jsonl" },
  trace: { run: "session", actor: "type", name: "tool", start: "at" },
  level: "names",
  params: [{ name: "picked", select: "click" }],
  highlight: { param: "picked" },
});
view.on("select", ({ picked }) => console.log(picked));

const vega = compile({ mark: "sequences", data: { values: spans } });
```

```bash
npx vega-agent "(model -> tool[])* -> model" -o loop.svg
npx vega-agent view.json --vega -o view.vg.json
```

Documentation: <https://sjoerdvink99.github.io/vega-agent/> · Source: <https://github.com/sjoerdvink99/vega-agent>
