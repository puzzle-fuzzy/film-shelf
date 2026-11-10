/** Per-provider, bounded LRU of successful results; failed work is retried. */
export function createMetadataCache<T>() {
  const entries = new Map<string, { expiresAt: number; value: T }>();
  const pending = new Map<string, Promise<T>>();
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const entry = entries.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    }
    entries.delete(key);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = load().then((value) => {
      entries.set(key, { expiresAt: Date.now() + 10 * 60 * 1000, value });
      while (entries.size > 100) entries.delete(entries.keys().next().value!);
      return value;
    }).finally(() => { pending.delete(key); });
    pending.set(key, request);
    return request;
  };
}
