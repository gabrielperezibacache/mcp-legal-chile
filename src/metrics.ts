/** In-process metrics for SLOs and /metrics endpoint. */

type LatencyBucket = number[];

const MAX_SAMPLES = 200;

const state = {
  startedAt: Date.now(),
  requests: 0,
  toolCalls: 0,
  cacheHits: 0,
  cacheMisses: 0,
  upstream429: 0,
  upstreamErrors: 0,
  circuitOpens: 0,
  latenciesMs: {} as Record<string, LatencyBucket>,
};

function pushLatency(name: string, ms: number): void {
  const bucket = state.latenciesMs[name] ?? (state.latenciesMs[name] = []);
  bucket.push(ms);
  if (bucket.length > MAX_SAMPLES) bucket.shift();
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function summarize(name: string): { p50: number | null; p95: number | null; n: number } {
  const samples = [...(state.latenciesMs[name] ?? [])].sort((a, b) => a - b);
  return {
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
  };
}

export const metrics = {
  markRequest(): void {
    state.requests += 1;
  },
  markToolCall(): void {
    state.toolCalls += 1;
  },
  markCacheHit(): void {
    state.cacheHits += 1;
  },
  markCacheMiss(): void {
    state.cacheMisses += 1;
  },
  markUpstream429(): void {
    state.upstream429 += 1;
  },
  markUpstreamError(): void {
    state.upstreamErrors += 1;
  },
  markCircuitOpen(): void {
    state.circuitOpens += 1;
  },
  observe(name: string, ms: number): void {
    pushLatency(name, ms);
  },
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      pushLatency(name, Date.now() - start);
    }
  },
  snapshot() {
    const slo = {
      obtener_articulo_cache_hit_p95_ms: 500,
      obtener_articulo_cold_p95_ms: 5000,
      buscar_legislacion_p95_ms: 4000,
      buscar_derecho_chileno_p95_ms: 8000,
      xml_success_rate_24h_target: 0.95,
    };
    return {
      service: "mcp-legal-chile",
      version: "1.2.0",
      uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
      counters: {
        requests: state.requests,
        toolCalls: state.toolCalls,
        cacheHits: state.cacheHits,
        cacheMisses: state.cacheMisses,
        upstream429: state.upstream429,
        upstreamErrors: state.upstreamErrors,
        circuitOpens: state.circuitOpens,
      },
      latencies: {
        sparql: summarize("sparql"),
        leychile_xml: summarize("leychile_xml"),
        websearch: summarize("websearch"),
        tool: summarize("tool"),
      },
      slo,
    };
  },
};
