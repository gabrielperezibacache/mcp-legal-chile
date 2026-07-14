import type { CitationResult, SearchResponse } from "../types.js";
import { parseCaseIdentifiers } from "../parsers.js";
import { uniqueByUrl } from "../util.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

function looksLikeCourtHit(title: string, url: string): boolean {
  const hay = `${title} ${url}`.toLowerCase();
  return (
    hay.includes("sentencia") ||
    hay.includes("fallo") ||
    hay.includes("ruling") ||
    hay.includes("getruling") ||
    hay.includes("causa") ||
    hay.includes("rol") ||
    hay.includes("tribunal") ||
    hay.includes("corte") ||
    hay.includes("juzgado") ||
    url.includes("pjud.cl") ||
    url.includes("tribunalconstitucional.cl")
  );
}

function enrich(hits: CitationResult[]): CitationResult[] {
  return hits.map((hit) => {
    const ids = parseCaseIdentifiers(hit.title, hit.summary ?? "");
    return {
      ...hit,
      evidence: "link_only" as const,
      rol: ids.rol,
      rit: ids.rit,
      ruc: ids.ruc,
      tribunal: ids.tribunal,
      citation:
        ids.rol && ids.tribunal
          ? `${ids.tribunal}, rol ${ids.rol}`
          : hit.citation,
      metadata: {
        ...hit.metadata,
        anio: ids.anio,
      },
    };
  });
}

export async function searchJurisprudencia(
  query: string,
  limit = 8,
  opts: {
    anio?: string;
    tribunal?: string;
    soloOficiales?: boolean;
    site?: string;
  } = {},
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Evidencia=link_only: el Poder Judicial no publica API abierta. Verifica el texto oficial del fallo antes de citar ratio decidendi.",
  ];
  const results: CitationResult[] = [];

  const qParts = [query, "(sentencia OR fallo OR causa)"];
  if (opts.anio) qParts.push(opts.anio);
  if (opts.tribunal) qParts.push(opts.tribunal);
  const q = qParts.join(" ");

  const sources = opts.site
    ? [{ site: opts.site, publisher: opts.site, share: 1 }]
    : [
        { site: "pjud.cl", publisher: "Poder Judicial de Chile", share: 0.7 },
        {
          site: "tribunalconstitucional.cl",
          publisher: "Tribunal Constitucional",
          share: 0.3,
        },
      ];

  for (const { site, publisher, share } of sources) {
    try {
      const hits = await searchWeb(q, {
        site,
        limit: Math.max(2, Math.ceil(limit * share)),
      });
      const filtered = hits.filter((h) => looksLikeCourtHit(h.title, h.url));
      let citations = webHitsToCitations(
        filtered.length ? filtered : hits,
        "jurisprudencia",
        publisher,
      );
      if (opts.soloOficiales) {
        citations = citations.filter(
          (c) =>
            c.url.includes("pjud.cl") ||
            c.url.includes("tribunalconstitucional.cl"),
        );
      }
      if (opts.anio) {
        citations = citations.filter(
          (c) =>
            c.title.includes(opts.anio!) ||
            c.summary?.includes(opts.anio!) ||
            String(c.metadata?.anio ?? "") === opts.anio,
        );
      }
      results.push(...citations);
    } catch (error) {
      warnings.push(
        `Búsqueda en ${site} limitada: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const deduped = uniqueByUrl(enrich(results)).slice(0, limit);
  if (deduped.length === 0) {
    warnings.push(
      "No se indexaron fallos automáticamente. Usa el portal unificado de sentencias.",
    );
  }

  return {
    query,
    source: "jurisprudencia",
    results: deduped,
    warnings,
    searchUrls: {
      poderJudicial: "https://www.pjud.cl/portal-unificado-sentencias",
      tribunalConstitucional: "https://www.tribunalconstitucional.cl/sentencias",
      busquedaSugerida: `https://duckduckgo.com/?q=${encodeURIComponent(`${query} sentencia site:pjud.cl`)}`,
    },
  };
}

export async function searchTribunalConstitucional(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  return searchJurisprudencia(query, limit, {
    site: "tribunalconstitucional.cl",
    tribunal: "Tribunal Constitucional",
    soloOficiales: true,
  });
}
