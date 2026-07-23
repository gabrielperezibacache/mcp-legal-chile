/**
 * Simple API-key auth + daily quotas for remote MCP access.
 * Stdio / missing MCP_API_KEYS = open access (local/dev).
 * Cuotas persisten en Redis cuando REDIS_URL está configurado.
 */

import { getSharedRedis, secondsUntilUtcDayEnd } from "./redisClient.js";

type QuotaState = { day: string; used: number };

const usage = new Map<string, QuotaState>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function quotaRedisKey(token: string, day: string): string {
  return `mcp:quota:${day}:${token}`;
}

function configuredKeys(): Map<string, { name: string; dailyLimit: number }> {
  const raw = process.env.MCP_API_KEYS?.trim();
  const map = new Map<string, { name: string; dailyLimit: number }>();
  if (!raw) return map;
  for (const part of raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)) {
    const bits = part.split(":");
    if (bits.length >= 3) {
      map.set(bits[1], {
        name: bits[0],
        dailyLimit: Number(bits[2]) || 200,
      });
    } else if (bits.length === 1) {
      map.set(bits[0], { name: "client", dailyLimit: 200 });
    } else if (bits.length === 2) {
      map.set(bits[1], { name: bits[0], dailyLimit: 200 });
    }
  }
  return map;
}

async function readQuotaUsed(token: string, day: string): Promise<number> {
  const redis = await getSharedRedis();
  if (redis) {
    try {
      const raw = await redis.get(quotaRedisKey(token, day));
      return raw ? Number(raw) || 0 : 0;
    } catch {
      /* fallback memory */
    }
  }
  const current = usage.get(token);
  return current && current.day === day ? current.used : 0;
}

async function incrementQuota(
  token: string,
  day: string,
  delta: number,
): Promise<number> {
  const redis = await getSharedRedis();
  if (redis) {
    try {
      const key = quotaRedisKey(token, day);
      const next = await redis.incrBy(key, delta);
      if (next === delta) {
        await redis.expire(key, secondsUntilUtcDayEnd());
      }
      return next;
    } catch {
      /* fallback memory */
    }
  }
  const current = usage.get(token);
  const used = current && current.day === day ? current.used : 0;
  const next = used + delta;
  usage.set(token, { day, used: next });
  return next;
}

export function authEnabled(): boolean {
  return configuredKeys().size > 0;
}

export function extractBearer(authHeader?: string): string | undefined {
  if (!authHeader) return undefined;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim();
}

export type AuthResult =
  | { ok: true; keyId: string; remaining: number }
  | { ok: false; status: number; message: string };

const COST = {
  cheap: 1,
  expensive: 3,
} as const;

export async function authorizeRequest(
  authHeader: string | undefined,
  cost: keyof typeof COST = "cheap",
): Promise<AuthResult> {
  const keys = configuredKeys();
  if (keys.size === 0) {
    return { ok: true, keyId: "open", remaining: Number.POSITIVE_INFINITY };
  }

  const token = extractBearer(authHeader);
  if (!token || !keys.has(token)) {
    return {
      ok: false,
      status: 401,
      message:
        "Unauthorized. Send Authorization: Bearer <API_KEY>. Get a key from the operator.",
    };
  }

  const meta = keys.get(token)!;
  const day = todayKey();
  const used = await readQuotaUsed(token, day);
  const next = used + COST[cost];
  if (next > meta.dailyLimit) {
    return {
      ok: false,
      status: 429,
      message: `Cuota diaria agotada (${meta.dailyLimit}). Reintenta mañana.`,
    };
  }
  const confirmed = await incrementQuota(token, day, COST[cost]);
  if (confirmed > meta.dailyLimit) {
    return {
      ok: false,
      status: 429,
      message: `Cuota diaria agotada (${meta.dailyLimit}). Reintenta mañana.`,
    };
  }
  return {
    ok: true,
    keyId: meta.name,
    remaining: meta.dailyLimit - confirmed,
  };
}

export async function quotaSnapshot() {
  const day = todayKey();
  const keys = configuredKeys();
  const clients: Array<{ keyPrefix: string; day: string; used: number }> = [];

  for (const token of keys.keys()) {
    const used = await readQuotaUsed(token, day);
    if (used > 0) {
      clients.push({
        keyPrefix: token.slice(0, 6),
        day,
        used,
      });
    }
  }

  for (const [token, v] of usage.entries()) {
    if (
      v.day === day &&
      !clients.some((c) => c.keyPrefix === token.slice(0, 6))
    ) {
      clients.push({
        keyPrefix: token.slice(0, 6),
        day: v.day,
        used: v.used,
      });
    }
  }

  return {
    authEnabled: authEnabled(),
    day,
    storage: (await getSharedRedis()) ? "redis" : "memory",
    clients,
  };
}
