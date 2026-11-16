export type Words = { variant: number; words: string[] };

const ROUNDS = 64;
const TINY = 1e-12;

type Row = { keys: number[]; values: number[] };

const dot = (a: Float64Array, b: Float64Array) => a.reduce((sum, value, index) => sum + value * b[index], 0);

function normalize(vector: Float64Array): Float64Array {
  const length = Math.sqrt(dot(vector, vector));
  return length > TINY ? vector.map((value) => value / length) : vector.fill(0);
}

function features(items: Words[]): { rows: Row[]; size: number } {
  const index = new Map<string, number>();
  const key = (word: string) => index.get(word) ?? index.set(word, index.size).size - 1;
  const rows = items.map(({ words }) => {
    const found = new Map<number, number>();
    for (const word of [...words, ...words.slice(1).map((after, position) => `${words[position]}\u0000${after}`)])
      found.set(key(word), (found.get(key(word)) ?? 0) + 1);
    const values = [...found.values()].map(Math.sqrt);
    const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
    return { keys: [...found.keys()], values: values.map((value) => value / length) };
  });
  return { rows, size: index.size };
}

function component(rows: Row[], mean: Float64Array, against: Float64Array[]): Float64Array {
  let axis = normalize(Float64Array.from(mean, (_, index) => 1 / (index + 1)));
  for (let round = 0; round < ROUNDS; round += 1) {
    const shift = dot(mean, axis);
    const scores = rows.map((row) => row.keys.reduce((sum, key, position) => sum + axis[key] * row.values[position], 0) - shift);
    const next = new Float64Array(mean.length);
    rows.forEach((row, position) => row.keys.forEach((key, at) => (next[key] += row.values[at] * scores[position])));
    const total = scores.reduce((sum, score) => sum + score, 0);
    mean.forEach((value, index) => (next[index] -= value * total));
    for (const other of against) {
      const overlap = dot(next, other);
      other.forEach((value, index) => (next[index] -= overlap * value));
    }
    axis = normalize(next);
  }
  return axis;
}

function coordinates(rows: Row[], mean: Float64Array, axis: Float64Array): number[] {
  const shift = dot(mean, axis);
  const values = rows.map((row) => row.keys.reduce((sum, key, position) => sum + axis[key] * row.values[position], 0) - shift);
  const peak = Math.max(...values.map(Math.abs));
  const sign = Math.sign(values.find((value) => Math.abs(value) > 1e-9) ?? 1);
  return values.map((value) => (peak > 1e-9 ? (sign * value) / peak : 0));
}

export function project(items: Words[]): Map<number, [number, number]> {
  if (items.length < 2) return new Map(items.map(({ variant }) => [variant, [0, 0]]));
  const { rows, size } = features(items);
  const mean = new Float64Array(size);
  rows.forEach((row) => row.keys.forEach((key, at) => (mean[key] += row.values[at] / rows.length)));
  const first = component(rows, mean, []);
  const second = component(rows, mean, [first]);
  const [xs, ys] = [first, second].map((axis) => coordinates(rows, mean, axis));
  return new Map(items.map(({ variant }, position) => [variant, [xs[position], ys[position]]]));
}
