#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { compile, load, render, version } from "./index";
import type { Spec } from "./spec";

const USAGE = `usage: vega-agent <spec.json | expression | -> [-o out] [--vega]

  vega-agent view.json -o figure.svg
  vega-agent view.json --vega -o figure.vg.json
  vega-agent "(model -> tool[])* -> model" > loop.svg
  cat view.json | vega-agent -`;

function read(source: string): Spec {
  if (source === "-") return JSON.parse(readFileSync(0, "utf8"));
  if (source.endsWith(".json")) return JSON.parse(readFileSync(source, "utf8"));
  return { mark: "diagram", process: source };
}

const args = process.argv.slice(2);
const output = args.includes("-o") ? args[args.indexOf("-o") + 1] : null;
const source = args.find((arg, index) => !arg.startsWith("--") && arg !== "-o" && args[index - 1] !== "-o");

if (args.includes("-v") || args.includes("--version")) {
  console.log(version);
  process.exit(0);
}

const help = args.includes("-h") || args.includes("--help");

if (!source || help) {
  console.error(USAGE);
  process.exit(help ? 0 : 1);
}

try {
  const spec = read(source);
  const base = source.endsWith(".json") ? `${dirname(source)}/` : "";
  const text = args.includes("--vega") ? JSON.stringify(compile(await load(spec, base)), null, 2) : await render(spec, base);
  if (output) writeFileSync(output, text);
  else process.stdout.write(text + "\n");
} catch (error) {
  console.error(`vega-agent: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
