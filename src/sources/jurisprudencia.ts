import type { CitationResult, SearchResponse } from "../types.js";
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

export async function searchJurisprudencia(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const warnings: string[] = [
    "El Poder Judicial no publica una API abierta de fallos. Estos resultados son enlaces públicos indexados; verifica siempre el texto oficial de la sentencia.",
  ];
  const results: CitationResult[] = [];

  const sources = [
    {
      site: "pjud.cl",
      publisher: "Poder Judicial de Chile",
      share: 0.7,
    },
    {
      site: "tribunalconstitucional.cl",
      publisher: "Tribunal Constitucional de Chile",
      share: 0.3,
    },
  ] as const;

  for (const { site, publisher, share } of sources) {
    try {
      const hits = await searchWeb(
        `${query} (sentencia OR fallo OR causa)`,
        {
          site,
          limit: Math.max(2, Math.ceil(limit * share)),
        },
      );
      const filtered = hits.filter((h) => looksLikeCourtHit(h.title, h.url));
      results.push(
        ...webHitsToCitations(
          filtered.length ? filtered : hits,
          "jurisprudencia",
          publisher,
        ),
      );
    } catch (error) {
      warnings.push(
        `Búsqueda en ${site} limitada: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const deduped = uniqueByUrl(results).slice(0, limit);

  if (deduped.length === 0) {
    warnings.push(
      "No se indexaron fallos automáticamente. Usa el portal unificado de sentencias del Poder Judicial.",
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
