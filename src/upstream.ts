import { isAbortLikeError } from "./deadline.js";
import { metrics } from "./metrics.js";

export type HostKey =
  | "leychile"
  | "bcn"
  | "tc"
  | "openalex"
  | "crossref"
  | "doaj"
  | "scielo"
  | "contraloria"
  | "pjud"
  | "diariooficial"
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
  doaj: makeCircuit(),
  scielo: makeCircuit(),
  contraloria: makeCircuit(),
  pjud: makeCircuit(),
  diariooficial: makeCircuit(),
  websearch: makeCircuit(),
};

const startQueues: Record<HostKey, Promise<unknown>> = {
  leychile: Promise.resolve(),
  bcn: Promise.resolve(),
  tc: Promise.resolve(),
  openalex: Promise.resolve(),
  crossref: Promise.resolve(),
  doaj: Promise.resolve(),
  scielo: Promise.resolve(),
  contraloria: Promise.resolve(),
  pjud: Promise.resolve(),
  diariooficial: Promise.resolve(),
  websearch: Promise.resolve(),
};

const active: Record<HostKey, number> = {
  leychile: 0,
  bcn: 0,
  tc: 0,
  openalex: 0,
  crossref: 0,
  doaj: 0,
  scielo: 0,
  contraloria: 0,
  pjud: 0,
  diariooficial: 0,
  websearch: 0,
};

const waiters: Record<HostKey, Array<() => void>> = {
  leychile: [],
  bcn: [],
  tc: [],
  openalex: [],
  crossref: [],
  doaj: [],
  scielo: [],
  contraloria: [],
  pjud: [],
  diariooficial: [],
  websearch: [],
};

const MAX_CONCURRENT: Record<HostKey, number> = {
  leychile: Number(process.env.LEYCHILE_MAX_CONCURRENT ?? 1),
  bcn: Number(process.env.BCN_MAX_CONCURRENT ?? 2),
  tc: Number(process.env.TC_MAX_CONCURRENT ?? 2),
  openalex: Number(process.env.OPENALEX_MAX_CONCURRENT ?? 2),
  crossref: Number(process.env.CROSSREF_MAX_CONCURRENT ?? 2),
  doaj: Number(process.env.DOAJ_MAX_CONCURRENT ?? 2),
  scielo: Number(process.env.SCIELO_MAX_CONCURRENT ?? 2),
  // Contraloria/PJUD/Diario Oficial have no official API — scraped best-effort,
  // so they get their own (conservative) buckets instead of sharing the
  // generic `websearch` circuit with DuckDuckGo/Yahoo scraping.
  contraloria: Number(process.env.CONTRALORIA_MAX_CONCURRENT ?? 2),
  pjud: Number(process.env.PJUD_MAX_CONCURRENT ?? 1),
  diariooficial: Number(process.env.DIARIO_OFICIAL_MAX_CONCURRENT ?? 2),
  websearch: Number(process.env.WEBSEARCH_MAX_CONCURRENT ?? 3),
};

const MIN_INTERVAL_MS: Record<HostKey, number> = {
  leychile: Number(process.env.LEYCHILE_MIN_INTERVAL_MS ?? 1000),
  bcn: Number(process.env.BCN_MIN_INTERVAL_MS ?? 400),
  tc: Number(process.env.TC_MIN_INTERVAL_MS ?? 200),
  openalex: Number(process.env.OPENALEX_MIN_INTERVAL_MS ?? 150),
  crossref: Number(process.env.CROSSREF_MIN_INTERVAL_MS ?? 150),
  doaj: Number(process.env.DOAJ_MIN_INTERVAL_MS ?? 150),
  scielo: Number(process.env.SCIELO_MIN_INTERVAL_MS ?? 200),
  contraloria: Number(process.env.CONTRALORIA_MIN_INTERVAL_MS ?? 300),
  pjud: Number(process.env.PJUD_MIN_INTERVAL_MS ?? 500),
  diariooficial: Number(process.env.DIARIO_OFICIAL_MIN_INTERVAL_MS ?? 300),
  websearch: Number(process.env.WEBSEARCH_MIN_INTERVAL_MS ?? 100),
};

const CIRCUIT_OPEN_MS = Number(process.env.CIRCUIT_OPEN_MS ?? 90_000);
const CIRCUIT_THRESHOLD = Number(process.env.CIRCUIT_THRESHOLD ?? 3);

async function acquireSlot(key: HostKey): Promise<void> {
  while (active[key] >= MAX_CONCURRENT[key]) {
    await new Promise<void>((resolve) => waiters[key].push(resolve));
  }
  active[key] += 1;
}

function releaseSlot(key: HostKey): void {
  active[key] = Math.max(0, active[key] - 1);
  // Wake waiters one by one; each re-checks capacity in acquireSlot's while loop.
  waiters[key].shift()?.();
}

/** Stagger request starts without serializing the whole network operation. */
async function scheduleStart(key: HostKey): Promise<void> {
  const scheduled = startQueues[key].then(
    () =>
      new Promise<void>((resolve) => setTimeout(resolve, MIN_INTERVAL_MS[key])),
  );
  startQueues[key] = scheduled.then(
    () => undefined,
    () => undefined,
  );
  await scheduled;
}

/**
 * Classify upstream hosts into isolated circuit buckets.
 * LeyChile XML (`leychile.cl`) is separate from BCN metadata/HTML (`bcn.cl`)
 * so a 429 on obtxml does not block SPARQL or the LeyChile HTML buscador.
 */
export function upstreamHostKey(url: string): HostKey {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("leychile.cl")) return "leychile";
    if (host.includes("bcn.cl")) return "bcn";
    if (host.includes("tcchile.cl")) return "tc";
    if (host.includes("openalex.org")) return "openalex";
    if (host.includes("crossref.org")) return "crossref";
    if (host.includes("doaj.org")) return "doaj";
    if (host.includes("scielo")) return "scielo";
    // Official-but-unofficial-API sources scraped best-effort: isolated from
    // the generic websearch bucket so a CGR/PJUD/Diario Oficial outage or
    // block doesn't starve (or get starved by) DuckDuckGo/Yahoo scraping.
    if (host.includes("contraloria.cl") || host.includes("dipres.gob.cl"))
      return "contraloria";
    if (host.includes("pjud.cl")) return "pjud";
    if (host.includes("diariooficial.interior.gob.cl")) return "diariooficial";
  } catch {
    /* ignore */
  }
  return "websearch";
}

export class CircuitOpenError extends Error {
  host: HostKey;
  retryAfterMs: number;
  constructor(host: HostKey, retryAfterMs: number) {
    super(
      `Circuito abierto para ${host}. Reintenta en ~${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = "CircuitOpenError";
    this.host = host;
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

/** Record a 429 without opening the circuit (retries may still succeed). */
function noteTransient429(key: HostKey): void {
  metrics.markUpstreamError();
  metrics.markUpstream429();
  circuits[key].last429At = Date.now();
}

/** Metrics-only: mid-retry / mid-fallback failures must not open the circuit. */
function noteTransientFailure(key: HostKey, status?: number): void {
  metrics.markUpstreamError();
  if (status === 429) {
    metrics.markUpstream429();
    circuits[key].last429At = Date.now();
  }
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

/**
 * Count a terminal upstream failure after retries / fallbacks are exhausted.
 * Mid-retry errors go through withUpstreamLimit as transient only.
 */
export function noteTerminalUpstreamFailure(
  url: string,
  status?: number,
): void {
  noteFailure(upstreamHostKey(url), status);
}

/** True when the host circuit is open or saw a recent 429 (warmup should skip). */
export function isUpstreamCoolingDown(
  key: HostKey,
  recent429Ms = 60_000,
): boolean {
  const c = circuits[key];
  if (c.openedAt != null && Date.now() - c.openedAt < CIRCUIT_OPEN_MS) {
    return true;
  }
  if (c.last429At != null && Date.now() - c.last429At < recent429Ms) {
    return true;
  }
  return false;
}

/** Limit concurrency per provider and stagger starts without head-of-line blocking. */
export async function withUpstreamLimit<T>(
  url: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = upstreamHostKey(url);
  assertCircuit(key);
  await acquireSlot(key);
  try {
    await scheduleStart(key);
    assertCircuit(key);
    try {
      const value = await fn();
      noteSuccess(key);
      return value;
    } catch (error) {
      // Deadlines/aborts are client-side budget — do not punish the host circuit.
      if (isAbortLikeError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const statusMatch = message.match(/HTTP (\d+)/);
      const status = statusMatch ? Number(statusMatch[1]) : undefined;
      // Never open the circuit here: fetchTextWithRetry / searchWeb count
      // a single terminal failure after all attempts are exhausted.
      if (status === 429) {
        noteTransient429(key);
      } else {
        noteTransientFailure(key, status);
      }
      throw error;
    }
  } finally {
    releaseSlot(key);
  }
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
        active: active[k as HostKey],
        queued: waiters[k as HostKey].length,
        maxConcurrent: MAX_CONCURRENT[k as HostKey],
      },
    ]),
  );
}

/** Test helper: reset all circuits/slots between unit tests. */
export function resetUpstreamForTests(): void {
  for (const key of Object.keys(circuits) as HostKey[]) {
    circuits[key] = makeCircuit();
    active[key] = 0;
    waiters[key] = [];
    startQueues[key] = Promise.resolve();
  }
}
