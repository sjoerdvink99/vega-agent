import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { find, read, render, type TracedRun } from "vega-agent";

const CHECKS: Record<string, string> = {
  "failed tool call": "tool!",
  "retry after a failure": "tool! -> model -> tool",
  "delegated to a sub-agent": "agent",
};
const TOLERANCE = 0.05;

type Group = { name: string; runs: TracedRun[] };

const [before, after, out = "report"] = process.argv.slice(2);
if (!before || !after) {
  console.error("usage: tsx report.ts <before.jsonl> <after.jsonl> [out]");
  process.exit(2);
}

const load = (path: string): Group => ({
  name: basename(path).replace(/\.jsonl?$/, ""),
  runs: read(readFileSync(path, "utf8")),
});

const rate = (runs: TracedRun[], query: string) => runs.filter((run) => find(run.process, query).length > 0).length / Math.max(1, runs.length);

const groups: [Group, Group] = [load(before), load(after)];
const values = groups.flatMap((group) => group.runs.map((run) => ({ ...run, corpus: group.name })));
mkdirSync(out, { recursive: true });
for (const mark of ["variants", "transitions", "icicle"] as const) {
  const svg = await render({ mark, data: { values }, trace: { group: "corpus" }, level: "names", title: `${groups[0].name} → ${groups[1].name}`, width: 900 });
  writeFileSync(join(out, `${mark}.svg`), svg);
}

const rows = Object.entries(CHECKS).map(([check, query]) => {
  const [a, b] = groups.map((group) => rate(group.runs, query));
  return { check, query, [groups[0].name]: a.toFixed(3), [groups[1].name]: b.toFixed(3), regressed: b - a > TOLERANCE };
});
console.table(rows);
console.log(`figures written to ${out}/`);
process.exit(rows.some((row) => row.regressed) ? 1 : 0);
