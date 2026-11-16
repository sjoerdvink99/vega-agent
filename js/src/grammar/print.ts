import type { Node, Rep, Repeat, Sig, Step } from "./ast";

export const rep = ({ role, medium, many }: Rep) => `${role}${medium ? `:${medium}` : ""}${many ? "[]" : ""}`;

export function signature({ inputs, outputs }: Sig): string {
  const parts = [inputs.map(rep).join(", "), outputs.length ? `=> ${outputs.map(rep).join(", ")}` : ""];
  return `(${parts.filter(Boolean).join(" ")})`;
}

const head = (node: Step) => `${node.actor}${node.name ? `.${node.name}` : ""}${node.sig ? signature(node.sig) : ""}`;

export const label = (node: Step) => head(node) + (node.failed ? "!" : "");

function bound({ lo, hi, parallel }: Repeat): string {
  if (parallel) {
    if (lo === 0 && hi === null) return "[]";
    return lo === hi ? `[${lo}]` : `[${lo},${hi ?? ""}]`;
  }
  if (lo === 0 && hi === null) return "*";
  if (lo === 1 && hi === null) return "+";
  if (lo === 0 && hi === 1) return "?";
  return lo === hi ? `{${lo}}` : `{${lo},${hi ?? ""}}`;
}

export const print = (node: Node): string => within(node, 0);

function within(node: Node, outer: number): string {
  const [text, precedence] = format(node);
  return precedence < outer ? `(${text})` : text;
}

function format(node: Node): [string, number] {
  switch (node.t) {
    case "step":
      return [node.body ? `${head(node)}{ ${within(node.body, 0)} }${node.failed ? "!" : ""}` : label(node), 4];
    case "repeat":
      return [within(node.node, 3) + bound(node), 3];
    case "par":
      return [node.items.map((item) => within(item, 3)).join(" || "), 2];
    case "seq":
      return [node.items.map((item) => within(item, 2)).join(" -> "), 1];
    case "alt":
      return [node.items.map((item) => within(item, 1)).join(" | "), 0];
  }
}
