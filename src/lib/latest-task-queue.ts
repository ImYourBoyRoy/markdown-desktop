/** One active task per key; retain only the latest pending request. */
export function createLatestTaskQueue<K, V>(
  run: (key: K, value: V, isCurrent: () => boolean) => Promise<void>,
  onError: (error: unknown) => void,
) {
  const pending = new Map<K, { value: V; token: object }>();
  const latest = new Map<K, object>();
  const active = new Set<K>();
  async function drain(key: K) {
    active.add(key);
    try {
      while (pending.has(key)) {
        const request = pending.get(key)!;
        pending.delete(key);
        try {
          await run(key, request.value, () => latest.get(key) === request.token);
        } catch (error) { onError(error); }
      }
    } finally {
      active.delete(key);
      latest.delete(key);
    }
  }
  return {
    enqueue(key: K, value: V) {
      const coalesced = active.has(key);
      const token = {};
      latest.set(key, token);
      pending.set(key, { value, token });
      if (!active.has(key)) void drain(key);
      return coalesced;
    },
    delete(key: K) { pending.delete(key); latest.delete(key); },
    clear() { pending.clear(); latest.clear(); },
  };
}
