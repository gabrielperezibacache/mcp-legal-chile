/**
 * Simple API-key auth + daily quotas for remote MCP access.
 * Stdio / missing MCP_API_KEYS = open access (local/dev).
 */

type QuotaState = { day: string; used: number };

const usage = new Map<string, QuotaState>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function configuredKeys(): Map<string, { name: string; dailyLimit: number }> {
  const raw = process.env.MCP_API_KEYS?.trim();
  const map = new Map<string, { name: string; dailyLimit: number }>();
  if (!raw) return map;
  // Format: name:key:limit,name2:key2:limit  OR key,key2
  for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
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

export function authorizeRequest(
  authHeader: string | undefined,
  cost: keyof typeof COST = "cheap",
): AuthResult {
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
  const current = usage.get(token);
  const used = current && current.day === day ? current.used : 0;
  const next = used + COST[cost];
  if (next > meta.dailyLimit) {
    return {
      ok: false,
      status: 429,
      message: `Cuota diaria agotada (${meta.dailyLimit}). Reintenta mañana.`,
    };
  }
  usage.set(token, { day, used: next });
  return {
    ok: true,
    keyId: meta.name,
    remaining: meta.dailyLimit - next,
  };
}

export function quotaSnapshot() {
  return {
    authEnabled: authEnabled(),
    clients: [...usage.entries()].map(([key, v]) => ({
      keyPrefix: key.slice(0, 6),
      day: v.day,
      used: v.used,
    })),
  };
}
