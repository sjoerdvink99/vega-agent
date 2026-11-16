import { ACTORS, alt, par, repeat, seq, step, type Node } from "../src";

export function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = [null, "read", "write", "search", "plan"];

export function expression(next: () => number, depth: number, ground: boolean): Node {
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)];
  const roll = next();
  if (depth <= 0 || roll < 0.35) {
    const actor = pick(ACTORS);
    const body = actor === "agent" && depth > 0 && next() < 0.5 ? expression(next, depth - 1, ground) : null;
    return step(actor, { name: pick(NAMES), body, failed: next() < 0.1 });
  }
  const children = () => Array.from({ length: 2 + Math.floor(next() * 2) }, () => expression(next, depth - 1, ground));
  if (roll < 0.6) return seq(...children());
  if (roll < 0.75) return par(...children());
  if (roll < 0.85 && !ground) return alt(...children());
  const inner = expression(next, depth - 1, ground);
  const parallel = next() < 0.5;
  if (ground) return repeat(inner, 2, 2, parallel);
  const lo = pick([0, 1, 2]);
  return repeat(inner, lo, pick([null, lo, lo + 1]), parallel);
}
