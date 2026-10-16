import type { AssetResult } from './types';

/** Bounded media reuse with coalesced loads and retryable failures. */
export class MediaAssetCache {
  private resolved = new Map<string, { asset: AssetResult; bytes: number }>();
  private pending = new Map<string, Promise<AssetResult>>();
  private bytes = 0;
  private inFlight = 0;
  private waiting: Array<() => void> = [];
  constructor(private maxEntries = 16, private maxBytes = 8 * 1024 * 1024, private maxLoads = 4) {
    if (maxLoads < 1) throw new Error('Media concurrency must be positive');
  }
  private slot(): Promise<void> {
    if (this.inFlight < this.maxLoads) { this.inFlight += 1; return Promise.resolve(); }
    return new Promise((resolve) => this.waiting.push(resolve));
  }
  private releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.inFlight -= 1;
  }
  get(key: string, loader: () => Promise<AssetResult>): Promise<AssetResult> {
    const cached = this.resolved.get(key);
    if (cached) { this.resolved.delete(key); this.resolved.set(key, cached); return Promise.resolve(cached.asset); }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const request = this.slot().then(async () => {
      try { return await loader(); }
      finally { this.releaseSlot(); }
    }).then((asset) => {
      const bytes = asset.dataUri.length * 2;
      this.resolved.set(key, { asset, bytes }); this.bytes += bytes;
      while (this.resolved.size > this.maxEntries || this.bytes > this.maxBytes) {
        const oldest = this.resolved.keys().next().value;
        if (oldest === undefined) break;
        this.bytes -= this.resolved.get(oldest)!.bytes;
        this.resolved.delete(oldest);
      }
      return asset;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
