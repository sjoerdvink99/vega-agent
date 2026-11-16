import type { RenderProps } from "@anywidget/types";
import { embed, type Selection, type View } from "./embed";
import type { Spec } from "./spec";

type Model = { spec: Spec; selection: Selection };

function report(el: HTMLElement, error: unknown) {
  const message = Object.assign(document.createElement("pre"), { textContent: error instanceof Error ? error.message : String(error) });
  message.style.cssText = "color:#e5484d;font:12px ui-monospace,monospace;white-space:pre-wrap;margin:0";
  el.replaceChildren(message);
}

async function render({ model, el }: RenderProps<Model>) {
  let view: View | null = null;
  const draw = async () => {
    try {
      if (view) await view.update(model.get("spec"));
      else {
        view = await embed(el, model.get("spec"));
        view.on("select", (selection) => {
          model.set("selection", selection);
          model.save_changes();
        });
      }
    } catch (error) {
      view?.destroy();
      view = null;
      report(el, error);
    }
  };
  const redraw = () => void draw();
  model.on("change:spec", redraw);
  await draw();
  return () => {
    model.off("change:spec", redraw);
    view?.destroy();
  };
}

export default { render };
