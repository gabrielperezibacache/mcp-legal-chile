export type SharedRedisClient = {
  get: (key: string) => Promise<string | null>;
  set: (
    key: string,
    value: string,
    opts: { EX: number },
  ) => Promise<unknown>;
  incrBy: (key: string, amount: number) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  connect: () => Promise<unknown>;
  on: (event: string, cb: (err: Error) => void) => void;
  isOpen?: boolean;
};

let redisClientPromise: Promise<SharedRedisClient | null> | null = null;

export async function getSharedRedis(): Promise<SharedRedisClient | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (!redisClientPromise) {
    redisClientPromise = (async () => {
      try {
        const { createClient } = await import("redis");
        const client = createClient({ url }) as unknown as SharedRedisClient;
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

export function secondsUntilUtcDayEnd(): number {
  const now = new Date();
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return Math.max(60, Math.ceil((end.getTime() - now.getTime()) / 1000));
}
