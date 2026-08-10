import type { CitationResult, SearchResponse } from "../types.js";
import { uniqueByUrl } from "../util.js";
import { searchAgencySites } from "./agencyWeb.js";

export type OrganismoRegulatorio = "sernac" | "cmf";

const PORTALS: Record<
  OrganismoRegulatorio,
  { site: string; publisher: string; portal: string; label: string }
> = {
  sernac: {
    site: "sernac.cl",
    publisher: "SERNAC",
    portal: "https://www.sernac.cl/",
    label: "SERNAC",
  },
  cmf: {
    site: "cmfchile.cl",
    publisher: "Comisión para el Mercado Financiero",
    portal: "https://www.cmfchile.cl/",
    label: "CMF",
  },
};

async function searchRegulatorio(
  organismo: OrganismoRegulatorio,
  query: string,
  limit: number,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const cfg = PORTALS[organismo];
  const warnings: string[] = [
    `${cfg.label}: circulares/oficios como candidate/link_only salvo extracto HTML usable (verified). No inventes el contenido.`,
  ];

  const portalHit: CitationResult = {
    source: "dictamenes",
    title: `[Portal · verificar] Búsqueda ${cfg.label}: ${query.slice(0, 80)}`,
    citation: `${cfg.label} — portal de búsqueda (no es un documento)`,
    url: cfg.portal,
    publisher: cfg.publisher,
    evidence: "link_only",
    summary:
      "Stub de portal. No cites contenido desde aquí; abre la URL y confirma el acto administrativo.",
    metadata: {
      integrity: "portal_stub",
      agency: organismo,
    },
  };

  const { results: webResults, warnings: webWarnings } =
    await searchAgencySites({
      query,
      limit: Math.max(1, limit - 1),
      source: "dictamenes",
      searchQuery: `${query} circular OR oficio OR resolución`,
      sites: [{ site: cfg.site, publisher: cfg.publisher }],
      signal: opts.signal,
      extract: {
        label: cfg.label,
        anchors: /\b(?:circular|oficio|resoluci[oó]n|sernac|cmf)\b/i,
        timeoutMs: Number(process.env.REGULATORIO_FETCH_TIMEOUT_MS ?? 8_000),
        excerptSource: `${organismo}_html`,
      },
    });
  warnings.push(...webWarnings);

  const results = uniqueByUrl([
    ...webResults.map((hit) => ({
      ...hit,
      metadata: { ...(hit.metadata ?? {}), agency: organismo },
    })),
    ...(webResults.length ? [] : [portalHit]),
  ]).slice(0, limit);

  if (!webResults.length) {
    warnings.push(
      `Sin hits web en ${cfg.site}; se incluye stub del portal oficial.`,
    );
  }

  return {
    query,
    source: "dictamenes",
    results,
    warnings,
    searchUrls: {
      [organismo]: cfg.portal,
      busquedaSugerida: `https://duckduckgo.com/?q=${encodeURIComponent(
        `${query} site:${cfg.site}`,
      )}`,
    },
  };
}

export async function searchSernac(
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  return searchRegulatorio("sernac", query, limit, opts);
}

export async function searchCmf(
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  return searchRegulatorio("cmf", query, limit, opts);
}

export async function searchRegulatorioOrganismo(
  organismo: OrganismoRegulatorio,
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  return searchRegulatorio(organismo, query, limit, opts);
}
