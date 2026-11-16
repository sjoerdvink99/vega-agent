import { embed } from "../src";

type Material = { subscribe(callback: () => void): void };

function fail(view: HTMLElement, error: unknown): void {
  view.className = "va-figure va-error";
  view.textContent = error instanceof Error ? error.message : String(error);
}

let blocks = 0;

function listing(code: HTMLElement): HTMLElement {
  const id = `va-spec-${(blocks += 1)}`;
  const button = Object.assign(document.createElement("button"), { className: "md-code__button", title: "Copy to clipboard" });
  button.dataset.clipboardTarget = `#${id} > code`;
  button.dataset.mdType = "copy";
  const nav = Object.assign(document.createElement("nav"), { className: "md-code__nav" });
  nav.append(button);
  const pre = Object.assign(document.createElement("pre"), { id });
  pre.append(nav, code);
  const highlight = Object.assign(document.createElement("div"), { className: "highlight" });
  highlight.append(pre);
  return highlight;
}

function toggle(highlight: HTMLElement): HTMLElement {
  const button = Object.assign(document.createElement("button"), { type: "button", className: "va-toggle", textContent: "Spec" });
  button.setAttribute("aria-expanded", "false");
  highlight.hidden = true;
  button.addEventListener("click", () => {
    highlight.hidden = !highlight.hidden;
    button.setAttribute("aria-expanded", String(!highlight.hidden));
  });
  return button;
}

function mount(block: HTMLElement): void {
  const source = block.textContent?.trim() ?? "";
  const view = Object.assign(document.createElement("div"), { className: "va-figure" });
  const code = Object.assign(document.createElement("code"), { textContent: source });
  const highlight = listing(code);
  const figure = Object.assign(document.createElement("div"), { className: "va-block" });
  figure.append(view, toggle(highlight), highlight);
  block.replaceWith(figure);
  try {
    const spec = JSON.parse(source);
    code.textContent = JSON.stringify(spec, null, 2);
    embed(view, { width: "container", ...spec }).catch((error) => fail(view, error));
  } catch (error) {
    fail(view, error);
  }
}

const mountAll = () => document.querySelectorAll<HTMLElement>("div.vega-agent-spec").forEach(mount);
const material = (window as unknown as { document$?: Material }).document$;

if (material) material.subscribe(mountAll);
else document.addEventListener("DOMContentLoaded", mountAll);
