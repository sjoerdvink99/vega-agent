import { resetSVGDefIds } from "vega";
import { translate } from "./compile";
import { load } from "./load";
import { instantiate } from "./runtime";
import type { Spec } from "./spec";

const UNSAFE = /[^\P{Cc}\t\n\r]|\p{Noncharacter_Code_Point}/gu;

export async function render(spec: Spec, base?: string): Promise<string> {
  const { view, check } = instantiate(translate(await load(spec, base)), { renderer: "none" });
  try {
    await view.runAsync();
    check();
    resetSVGDefIds();
    return (await view.toSVG()).replace(UNSAFE, "");
  } finally {
    view.finalize();
  }
}
