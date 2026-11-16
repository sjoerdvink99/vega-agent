const wrap = (expression: string) => `(${expression})`;

export const literal = (value: unknown): string => JSON.stringify(value);

export function percent(value: string): string {
  const x = wrap(value);
  return `format(${x}, ${x} > 0 && ${x} < 0.1 ? '.1%' : '.0%')`;
}

export function signed(value: string, digits: number, unit: string): string {
  const x = wrap(value);
  return `((${x} >= 0 ? '+' : '−') + format(abs(${x}), '.${digits}f') + ' ${unit}')`;
}

export const fixed = (value: string, digits: number) => `format(${wrap(value)}, '.${digits}f')`;

export function duration(value: string): string {
  const t = wrap(value);
  return `(${t} === 0 ? '0' : ${t} < 1 ? round(${t} * 1000) + ' ms' : ${t} < 60 ? format(${t}, ${t} < 10 ? '.1f' : '.0f') + ' s' : format(${t} / 60, '.1f') + ' min')`;
}

export function plural(value: string, noun: string): string {
  const n = wrap(value);
  return `('' + ${n} + (${n} === 1 ? ' ${noun}' : ' ${noun}s'))`;
}

export const each = (groups: number, value: (group: number) => string) =>
  wrap(Array.from({ length: groups }, (_, group) => `'' + ${wrap(value(group))}`).join(" + ' → ' + "));

export const sum = (groups: number, value: (group: number) => string) => wrap(Array.from({ length: groups }, (_, group) => wrap(value(group))).join(" + "));

export const first = (data: string, fallback: Record<string, unknown>) => `(length(data(${literal(data)})) ? data(${literal(data)})[0] : ${literal(fallback)})`;

export const fit = (text: string, width: string, size: number, advance: number) => `truncate(${text}, max(0, floor(${wrap(width)} / ${size * advance})))`;
