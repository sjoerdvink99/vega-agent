import { Error as ERRORS, logger, parse, View, type Spec as VegaSpec, type ViewOptions } from "vega";

type Checked = { view: View; check: () => void; release: () => void };

export function instantiate(spec: VegaSpec, options: ViewOptions = {}): Checked {
  const failures: unknown[] = [];
  const strict = logger(ERRORS, "error", (_method, _level, args) => failures.push(args[0]));
  const view = new View(parse(spec), { ...options, logger: strict });
  const check = () => {
    const [failure] = failures.splice(0);
    if (failure !== undefined) throw failure instanceof Error ? failure : new Error(String(failure));
  };
  const release = () => void view.logger(logger(ERRORS, "error"));
  return { view, check, release };
}
