type CacheEntry<T> = { expiresAt: number; value: T };

export class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();

  constructor(private defaultTtlMs: number) {}

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): T {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs = this.defaultTtlMs,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    return this.set(key, value, ttlMs);
  }
}

/** Shared short-TTL caches for upstream legal APIs. */
export const sparqlCache = new TtlCache(10 * 60_000);
export const xmlCache = new TtlCache(30 * 60_000);
export const webCache = new TtlCache(5 * 60_000);
