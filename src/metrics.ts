/** In-process metrics for SLOs and /metrics endpoint. */

import pkg from "../package.json" with { type: "json" };
import type { IntegrityKind } from "./integrity.js";

type LatencyBucket = number[];

const MAX_SAMPLES = 200;

const integrityCounts: Record<IntegrityKind, number> = {
  verified: 0,
  candidate: 0,
  portal_stub: 0,
};

const integrityByTool: Record<string, Record<IntegrityKind, number>> = {};

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

function summarize(name: string): {
  p50: number | null;
  p95: number | null;
  n: number;
} {
  const samples = [...(state.latenciesMs[name] ?? [])].sort((a, b) => a - b);
  return {
    n: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
  };
}

function emptyIntegrity(): Record<IntegrityKind, number> {
  return { verified: 0, candidate: 0, portal_stub: 0 };
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
  markIntegrity(kind: IntegrityKind, tool?: string): void {
    integrityCounts[kind] += 1;
    if (tool) {
      const bucket =
        integrityByTool[tool] ?? (integrityByTool[tool] = emptyIntegrity());
      bucket[kind] += 1;
    }
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
  snapshot(version = pkg.version) {
    const slo = {
      obtener_articulo_cache_hit_p95_ms: 500,
      obtener_articulo_cold_p95_ms: 5000,
      buscar_legislacion_p95_ms: 4000,
      buscar_derecho_chileno_p95_ms: 8000,
      investigar_tema_total_p95_ms: 18_000,
      xml_success_rate_24h_target: 0.95,
    };
    const upstreamKeys = [
      "leychile_xml",
      "bcn",
      "tc",
      "openalex",
      "crossref",
      "doaj",
      "scielo",
      "contraloria",
      "pjud",
      "diariooficial",
      "websearch",
      "pjudCauses",
      "tool",
    ] as const;
    const integrityTotal =
      integrityCounts.verified +
      integrityCounts.candidate +
      integrityCounts.portal_stub;
    const pct = (n: number) =>
      integrityTotal === 0
        ? null
        : Math.round((n / integrityTotal) * 1000) / 10;
    const toolP95 = summarize("tool").p95;
    const leychileP95 = summarize("leychile_xml").p95;
    const sloWarnings: string[] = [];
    if (
      toolP95 != null &&
      toolP95 > slo.investigar_tema_total_p95_ms
    ) {
      sloWarnings.push(
        `tool p95 ${toolP95}ms > investigar_tema target ${slo.investigar_tema_total_p95_ms}ms`,
      );
    }
    if (
      leychileP95 != null &&
      leychileP95 > slo.obtener_articulo_cold_p95_ms
    ) {
      sloWarnings.push(
        `leychile_xml p95 ${leychileP95}ms > cold article target ${slo.obtener_articulo_cold_p95_ms}ms`,
      );
    }
    if (state.upstream429 > 0 && state.requests > 0) {
      const rate = state.upstream429 / Math.max(1, state.requests);
      if (rate > 0.2) {
        sloWarnings.push(
          `upstream429 rate ${(rate * 100).toFixed(1)}% (requests=${state.requests})`,
        );
      }
    }
    if (
      integrityTotal >= 10 &&
      pct(integrityCounts.portal_stub) != null &&
      (pct(integrityCounts.portal_stub) as number) > 60
    ) {
      sloWarnings.push(
        `portal_stubPct ${pct(integrityCounts.portal_stub)}% > 60% (revisar fuentes link-only)`,
      );
    }
    return {
      service: "mcp-legal-chile",
      version,
      uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
      counters: {
        requests: state.requests,
        toolCalls: state.toolCalls,
        cacheHits: state.cacheHits,
        cacheMisses: state.cacheMisses,
        upstream429: state.upstream429,
        upstreamErrors: state.upstreamErrors,
        circuitOpens: state.circuitOpens,
        integrity: { ...integrityCounts },
        integrityByTool: { ...integrityByTool },
      },
      integrityRates: {
        total: integrityTotal,
        verifiedPct: pct(integrityCounts.verified),
        candidatePct: pct(integrityCounts.candidate),
        portalStubPct: pct(integrityCounts.portal_stub),
      },
      latencies: Object.fromEntries(
        upstreamKeys.map((name) => [name, summarize(name)]),
      ),
      slo,
      sloStatus: {
        ok: sloWarnings.length === 0,
        warnings: sloWarnings,
      },
    };
  },
};
