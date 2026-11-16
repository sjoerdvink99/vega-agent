import type { View } from "vega";
import { compile, type Spec } from "../src";
import { instantiate } from "../src/runtime";

export async function run(spec: Spec): Promise<View> {
  const { view, check } = instantiate(compile(spec), { renderer: "none" });
  await view.runAsync();
  check();
  return view;
}

type Item = { datum: Record<string, unknown>; tooltip?: Record<string, unknown>; opacity?: number };
type Node = { marktype?: string; name?: string; items?: (Item & { items?: Node[] })[] };

export function items(view: View, name: string): Item[] {
  const found: Item[] = [];
  const walk = (node: Node) => {
    if (node.name === name) found.push(...(node.items ?? []));
    for (const item of node.items ?? []) for (const child of item.items ?? []) walk(child);
  };
  walk((view.scenegraph() as unknown as { root: Node }).root);
  return found;
}
