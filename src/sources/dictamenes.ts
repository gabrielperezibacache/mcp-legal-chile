import type { CitationResult, SearchResponse } from "../types.js";
import { uniqueByUrl } from "../util.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

export async function searchDictamenes(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const warnings: string[] = [];
  const results: CitationResult[] = [];

  const sites = [
    {
      site: "contraloria.cl",
      publisher: "Contraloría General de la República",
    },
    {
      site: "dipres.gob.cl",
      publisher: "Dirección de Presupuestos / administración del Estado",
    },
  ] as const;

  for (const { site, publisher } of sites) {
    try {
      const hits = await searchWeb(query, {
        site,
        limit: Math.max(3, Math.ceil(limit / sites.length)),
      });
      results.push(...webHitsToCitations(hits, "dictamenes", publisher));
    } catch (error) {
      warnings.push(
        `No se pudo consultar ${site}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const deduped = uniqueByUrl(results).slice(0, limit);

  if (deduped.length === 0) {
    warnings.push(
      "No se indexaron dictámenes automáticamente. Usa el buscador oficial de la Contraloría.",
    );
  } else {
    warnings.push(
      "La CGR no publica una API abierta de dictámenes. Los resultados son enlaces públicos indexados; confirma el texto en el portal oficial.",
    );
  }

  return {
    query,
    source: "dictamenes",
    results: deduped,
    warnings,
    searchUrls: {
      contraloria:
        "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
      busquedaSugerida: `https://duckduckgo.com/?q=${encodeURIComponent(`${query} dictamen site:contraloria.cl`)}`,
    },
  };
}
