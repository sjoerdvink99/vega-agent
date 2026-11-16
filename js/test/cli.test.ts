import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { version } from "../src";

const folder = mkdtempSync(join(tmpdir(), "vega-agent-cli-"));
const cli = join(folder, "cli.mjs");

beforeAll(async () => {
  await build({
    entryPoints: [fileURLToPath(new URL("../src/cli.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: cli,
    logLevel: "silent",
  });
}, 60_000);

const call = (args: string[], input?: string) => spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8", cwd: folder });

describe("cli", () => {
  it("prints its version and its usage", () => {
    expect(call(["--version"]).stdout.trim()).toBe(version);
    const bare = call([]);
    expect(bare.status).toBe(1);
    expect(bare.stderr).toMatch(/^usage: vega-agent/);
    expect(call(["--help"]).status).toBe(0);
  });

  it("draws an expression as a diagram", () => {
    const result = call(["model -> tool"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^<svg/);
  });

  it("reads a spec from a file or standard input, and writes a file or a Vega spec", () => {
    writeFileSync(join(folder, "runs.jsonl"), '{"process":"model -> tool"}\n{"process":"model"}\n');
    writeFileSync(join(folder, "view.json"), JSON.stringify({ mark: "variants", data: { url: "runs.jsonl" } }));
    expect(call(["view.json", "-o", "figure.svg"]).status).toBe(0);
    expect(readFileSync(join(folder, "figure.svg"), "utf8")).toMatch(/^<svg/);
    const vega = JSON.parse(call(["view.json", "--vega"]).stdout);
    expect(vega.$schema).toMatch(/vega\/v6/);
    expect(call(["-"], JSON.stringify({ mark: "diagram", process: "human -> model" })).stdout).toMatch(/^<svg/);
  });

  it("reports what is wrong and fails", () => {
    const result = call(["-"], JSON.stringify({ mark: "variants", level: "everything", data: { values: [] } }));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^vega-agent: .*level/);
    expect(call(["model ->"]).stderr).toMatch(/^vega-agent: spec\.process: not a valid expression: expected name/);
  });
});
