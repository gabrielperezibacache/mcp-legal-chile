import { metrics } from "./metrics.js";

type CacheEntry<T> = {
  expiresAt: number;
  staleUntil: number;
  value: T;
};

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
}

class MemoryStore implements CacheStore {
  private map = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    this.map.set(key, {
      value,
      expiresAt: Date.now() + ttlSec * 1000,
    });
  }
}

type RedisClient = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    opts: { EX: number },
  ) => Promise<unknown>;
  connect: () => Promise<unknown>;
  on: (event: string, cb: (err: Error) => void) => void;
  isOpen?: boolean;
};

let redisClientPromise: Promise<RedisClient | null> | null = null;

async function getRedisClient(url: string): Promise<RedisClient | null> {
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const { createClient } = await import("redis");
        const client = createClient({ url }) as unknown as RedisClient;
        client.on("error", () => undefined);
        await client.connect();
        return client;
      } catch {
        return null;
      }
    })();
  }
  return redisClientPromise;
}

class RedisStore implements CacheStore {
  constructor(private url: string) {}

  async get(key: string): Promise<string | null> {
    const client = await getRedisClient(this.url);
    if (!client) return null;
    try {
      return await client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSec: number): Promise<void> {
    const client = await getRedisClient(this.url);
    if (!client) return;
    try {
      await client.set(key, value, { EX: Math.max(1, ttlSec) });
    } catch {
      /* ignore */
    }
  }
}

/** In-memory singleflight + optional Redis backing with stale-if-error. */
export class TtlCache {
  private local = new Map<string, CacheEntry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private store: CacheStore;

  constructor(
    private defaultTtlMs: number,
    private staleTtlMs = defaultTtlMs * 3,
  ) {
    const redisUrl = process.env.REDIS_URL?.trim();
    this.store = redisUrl ? new RedisStore(redisUrl) : new MemoryStore();
  }

  get<T>(key: string): T | undefined {
    const hit = this.local.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) return undefined;
    metrics.markCacheHit();
    return hit.value as T;
  }

  getStale<T>(key: string): T | undefined {
    const hit = this.local.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.staleUntil) return undefined;
    return hit.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): T {
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttlMs,
      staleUntil: Date.now() + Math.max(ttlMs, this.staleTtlMs),
    };
    this.local.set(key, entry as CacheEntry<unknown>);
    void this.store.set(
      key,
      JSON.stringify({
        value,
        expiresAt: entry.expiresAt,
        staleUntil: entry.staleUntil,
      }),
      Math.ceil(Math.max(ttlMs, this.staleTtlMs) / 1000),
    );
    return value;
  }

  private async hydrate<T>(key: string): Promise<T | undefined> {
    const raw = await this.store.get(key);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as CacheEntry<T>;
      this.local.set(key, parsed as CacheEntry<unknown>);
      if (Date.now() <= parsed.expiresAt) {
        metrics.markCacheHit();
        return parsed.value;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async getOrSet<T>(
    key: string,
    loader: () => Promise<T>,
    ttlMs = this.defaultTtlMs,
  ): Promise<T> {
    const local = this.get<T>(key);
    if (local !== undefined) return local;

    const hydrated = await this.hydrate<T>(key);
    if (hydrated !== undefined) return hydrated;

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    metrics.markCacheMiss();
    const promise = (async () => {
      try {
        const value = await loader();
        return this.set(key, value, ttlMs);
      } catch (error) {
        const stale = this.getStale<T>(key);
        if (stale !== undefined) return stale;
        const remote = await this.store.get(key);
        if (remote) {
          try {
            const parsed = JSON.parse(remote) as CacheEntry<T>;
            if (Date.now() <= parsed.staleUntil) return parsed.value;
          } catch {
            /* ignore */
          }
        }
        throw error;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }
}

/** TTLs aligned to the performance plan. */
export const sparqlCache = new TtlCache(12 * 60 * 60_000, 36 * 60 * 60_000);
export const xmlCache = new TtlCache(7 * 24 * 60 * 60_000, 14 * 24 * 60 * 60_000);
export const webCache = new TtlCache(60 * 60_000, 3 * 60 * 60_000);
