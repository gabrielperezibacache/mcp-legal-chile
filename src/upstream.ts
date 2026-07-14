import { metrics } from "./metrics.js";

export type HostKey =
  | "leychile"
  | "bcn"
  | "tc"
  | "openalex"
  | "crossref"
  | "scielo"
  | "websearch";

interface CircuitState {
  failures: number;
  openedAt: number | null;
  last429At: number | null;
}

function makeCircuit(): CircuitState {
  return { failures: 0, openedAt: null, last429At: null };
}

const circuits: Record<HostKey, CircuitState> = {
  leychile: makeCircuit(),
  bcn: makeCircuit(),
  tc: makeCircuit(),
  openalex: makeCircuit(),
  crossref: makeCircuit(),
  scielo: makeCircuit(),
  websearch: makeCircuit(),
};

const queues: Record<HostKey, Promise<unknown>> = {
  leychile: Promise.resolve(),
  bcn: Promise.resolve(),
  tc: Promise.resolve(),
  openalex: Promise.resolve(),
  crossref: Promise.resolve(),
  scielo: Promise.resolve(),
  websearch: Promise.resolve(),
};

const MIN_INTERVAL_MS: Record<HostKey, number> = {
  leychile: Number(process.env.LEYCHILE_MIN_INTERVAL_MS ?? 1000),
  bcn: Number(process.env.BCN_MIN_INTERVAL_MS ?? 400),
  tc: Number(process.env.TC_MIN_INTERVAL_MS ?? 200),
  openalex: Number(process.env.OPENALEX_MIN_INTERVAL_MS ?? 150),
  crossref: Number(process.env.CROSSREF_MIN_INTERVAL_MS ?? 150),
  scielo: Number(process.env.SCIELO_MIN_INTERVAL_MS ?? 200),
  websearch: Number(process.env.WEBSEARCH_MIN_INTERVAL_MS ?? 100),
};

const CIRCUIT_OPEN_MS = Number(process.env.CIRCUIT_OPEN_MS ?? 90_000);
const CIRCUIT_THRESHOLD = Number(process.env.CIRCUIT_THRESHOLD ?? 3);

export function upstreamHostKey(url: string): HostKey {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("datos.bcn.cl")) return "bcn";
    if (host.includes("leychile") || host.includes("bcn.cl")) return "leychile";
    if (host.includes("tcchile.cl")) return "tc";
    if (host.includes("openalex.org")) return "openalex";
    if (host.includes("crossref.org")) return "crossref";
    if (host.includes("scielo")) return "scielo";
  } catch {
    /* ignore */
  }
  return "websearch";
}

export class CircuitOpenError extends Error {
  retryAfterMs: number;
  constructor(host: HostKey, retryAfterMs: number) {
    super(
      `Circuito abierto para ${host}. Reintenta en ~${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = "CircuitOpenError";
    this.retryAfterMs = retryAfterMs;
  }
}

function assertCircuit(key: HostKey): void {
  const c = circuits[key];
  if (c.openedAt != null) {
    const elapsed = Date.now() - c.openedAt;
    if (elapsed < CIRCUIT_OPEN_MS) {
      throw new CircuitOpenError(key, CIRCUIT_OPEN_MS - elapsed);
    }
    c.openedAt = null;
    c.failures = 0;
  }
}

function noteSuccess(key: HostKey): void {
  circuits[key].failures = 0;
  circuits[key].openedAt = null;
}

function noteFailure(key: HostKey, status?: number): void {
  metrics.markUpstreamError();
  if (status === 429) {
    metrics.markUpstream429();
    circuits[key].last429At = Date.now();
  }
  circuits[key].failures += 1;
  if (circuits[key].failures >= CIRCUIT_THRESHOLD) {
    circuits[key].openedAt = Date.now();
    metrics.markCircuitOpen();
  }
}

/** Serialize upstream calls per host and enforce min interval + circuit breaker. */
export async function withUpstreamLimit<T>(
  url: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = upstreamHostKey(url);
  assertCircuit(key);

  const run = queues[key].then(async () => {
    assertCircuit(key);
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS[key]));
    try {
      const value = await fn();
      noteSuccess(key);
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusMatch = message.match(/HTTP (\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : undefined;
      noteFailure(key, status);
      throw error;
    }
  });

  queues[key] = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function upstreamStatus() {
  return Object.fromEntries(
    Object.entries(circuits).map(([k, v]) => [
      k,
      {
        failures: v.failures,
        open: v.openedAt != null && Date.now() - v.openedAt < CIRCUIT_OPEN_MS,
        openedAt: v.openedAt,
        last429At: v.last429At,
        minIntervalMs: MIN_INTERVAL_MS[k as HostKey],
      },
    ]),
  );
}
