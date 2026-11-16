# Agent trace explorer

A small visual analytics tool built on `vega-agent`: open OpenTelemetry GenAI traces, browse their variants, highlight runs with a query, inspect one run as a diagram over a timeline, and compare two files.

```bash
cd ../../js && npm install && npm run build
cd ../examples/explorer && npm install && npm run dev
```

Everything it does goes through the public API: `read` reads the traces, `embed` draws each view from a JSON spec, `view.on("select")` links the views, and `view.update` changes them. Use it as a starting point for your own tool.
