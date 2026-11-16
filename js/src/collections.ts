export function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

type Cache<K, V> = { get(key: K): V | undefined; set(key: K, value: V): unknown };

export function remember<K, V>(cache: Cache<K, V>, key: K, compute: () => V): V {
  const found = cache.get(key);
  if (found !== undefined) return found;
  const value = compute();
  cache.set(key, value);
  return value;
}
