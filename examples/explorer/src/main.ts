import { embed, read, type Sourced, type Spec, type TracedRun, type TransitionsSpec, type VariantsSpec, type View } from "vega-agent";
import example from "../../data/copilot-model-b.jsonl?raw";
import "./style.css";

type Corpus = { name: string; runs: TracedRun[] };

const element = (id: string) => document.getElementById(id)!;

const state: { corpora: Corpus[]; selected: string[]; shown: string | null } = {
  corpora: [],
  selected: [],
  shown: null,
};

const corpusOf = (name: string, text: string): Corpus => ({ name, runs: read(text) });

function source(): Sourced {
  if (state.corpora.length < 2) return { data: { values: state.corpora[0].runs } };
  const values = state.corpora.flatMap((corpus) => corpus.runs.map((run) => ({ ...run, corpus: corpus.name })));
  return { data: { values }, trace: { group: "corpus" } };
}

function find(id: string): TracedRun | undefined {
  return state.corpora.flatMap((corpus) => corpus.runs).find((run) => run.id === id);
}

function runSpec(run: TracedRun): Spec {
  const step = { params: [{ name: "step", select: "hover" as const }], highlight: { param: "step" } };
  const diagram = { mark: "diagram" as const, process: run.process, ...step };
  if (!run.time.some(Boolean)) return { ...diagram, title: `run ${run.id}` };
  return {
    title: `run ${run.id}`,
    width: "container",
    vconcat: [diagram, { mark: "timeline", data: { values: [run] }, ...step }],
  };
}

const variants: View = await embed(element("variants"), {
  mark: "variants",
  data: { values: [] },
  level: "names",
  width: "container",
  params: [{ name: "picked", select: "click" }],
  highlight: { param: "picked" },
});
const transitions: View = await embed(element("transitions"), {
  mark: "transitions",
  data: { values: [] },
  width: "container",
});
let run: View | null = null;

async function show(id: string | null): Promise<void> {
  state.shown = id;
  for (const button of element("runs").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.id === id));
  const found = id ? find(id) : undefined;
  if (!found) {
    run?.destroy();
    run = null;
    return;
  }
  if (run) await run.update(runSpec(found));
  else run = await embed(element("run"), runSpec(found));
}

function select(ids: string[]): void {
  state.selected = ids;
  const buttons = ids.slice(0, 40).map((id) =>
    Object.assign(document.createElement("button"), {
      textContent: id.slice(0, 8),
      title: id,
      onclick: () => void show(id),
    }),
  );
  buttons.forEach((button, index) => (button.dataset.id = ids[index]));
  const hint = Object.assign(document.createElement("p"), {
    className: "hint",
    textContent: "Click a variant to list its runs.",
  });
  element("runs").replaceChildren(...(buttons.length ? buttons : [hint]));
  void show(ids[0] ?? null);
}

async function load(corpora: Corpus[]): Promise<void> {
  state.corpora = corpora;
  element("summary").textContent = corpora.map((corpus) => `${corpus.name} · ${corpus.runs.length} runs`).join("  vs  ");
  await variants.update({
    ...(variants.spec as VariantsSpec),
    ...source(),
    params: [{ name: "picked", select: "click" }],
  });
  await transitions.update({
    ...(transitions.spec as TransitionsSpec),
    ...source(),
  });
  select([]);
}

async function highlight(query: string): Promise<void> {
  try {
    await variants.update({
      ...(variants.spec as VariantsSpec),
      highlight: query.trim() || { param: "picked" },
    });
    element("problem").textContent = "";
  } catch (error) {
    element("problem").textContent = (error as Error).message;
  }
}

async function open(input: HTMLInputElement, keep: boolean): Promise<void> {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const corpus = corpusOf(file.name, await file.text());
    await load(keep ? [state.corpora[0], corpus] : [corpus]);
  } catch (error) {
    element("summary").textContent = `Could not read ${file.name}: ${(error as Error).message}`;
  }
  input.value = "";
}

variants.on("select", ({ picked }) => select(picked));
element("query").addEventListener("input", (event) => void highlight((event.target as HTMLInputElement).value));
element("open").addEventListener("change", (event) => open(event.target as HTMLInputElement, false));
element("compare").addEventListener("change", (event) => open(event.target as HTMLInputElement, true));

await load([corpusOf("copilot-model-b.jsonl", example)]);
