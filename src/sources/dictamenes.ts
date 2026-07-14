import type { CitationResult, SearchResponse } from "../types.js";
import { parseCaseIdentifiers } from "../parsers.js";
import { uniqueByUrl } from "../util.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

function extractDictamenNumber(query: string): string | undefined {
  const match = query.match(
    /(?:dictamen(?:es)?|n[ºo°.]?)\s*([0-9]{1,6}(?:\s*[-\/]\s*[0-9]{2,4})?)/i,
  );
  return match?.[1]?.replace(/\s+/g, "");
}

export async function searchDictamenes(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Evidencia=link_only: confirma el texto íntegro en el portal de la Contraloría.",
  ];
  const results: CitationResult[] = [];
  const dictamenNumber = extractDictamenNumber(query);

  if (dictamenNumber) {
    results.push({
      source: "dictamenes",
      title: `Dictamen N° ${dictamenNumber} (portal CGR)`,
      citation: `Dictamen N° ${dictamenNumber}`,
      url: "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
      publisher: "Contraloría General de la República",
      id: dictamenNumber,
      evidence: "link_only",
      summary:
        "Abre el buscador oficial de la CGR e ingresa el número del dictamen para obtener el texto íntegro.",
    });
  }

  const sites = [
    {
      site: "contraloria.cl",
      publisher: "Contraloría General de la República",
    },
    {
      site: "dipres.gob.cl",
      publisher: "Dirección de Presupuestos",
    },
  ] as const;

  for (const { site, publisher } of sites) {
    try {
      const hits = await searchWeb(
        dictamenNumber ? `dictamen ${dictamenNumber}` : `${query} dictamen`,
        {
          site,
          limit: Math.max(3, Math.ceil(limit / sites.length)),
        },
      );
      const citations = webHitsToCitations(hits, "dictamenes", publisher).map(
        (hit) => {
          const ids = parseCaseIdentifiers(hit.title, hit.summary ?? "");
          return {
            ...hit,
            evidence: "link_only" as const,
            id: ids.dictamen ?? hit.id,
            citation: ids.dictamen
              ? `Dictamen N° ${ids.dictamen}`
              : hit.citation,
          };
        },
      );
      results.push(...citations);
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
  }

  return {
    query,
    source: "dictamenes",
    results: deduped,
    warnings,
    searchUrls: {
      contraloria:
        "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
      busquedaSugerida: `https://duckduckgo.com/?q=${encodeURIComponent(
        `${query} dictamen site:contraloria.cl`,
      )}`,
    },
  };
}

export async function resolverDictamen(
  numero: string,
): Promise<SearchResponse> {
  return searchDictamenes(`dictamen ${numero}`, 5);
}
