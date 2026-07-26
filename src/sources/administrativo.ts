import type { CitationResult, SearchResponse } from "../types.js";
import { parseCaseIdentifiers } from "../parsers.js";
import { uniqueByUrl } from "../util.js";
import {
  matchSuperintendencia,
  SUPERINTENDENCIAS,
  type SuperintendenciaPortal,
} from "./superintendenciasCatalog.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

function portalStubFor(
  portal: SuperintendenciaPortal,
  query: string,
): CitationResult {
  return {
    source: "administrativo",
    title: `[Portal sugerido · NO es un documento] ${portal.name} — buscar: ${query}`,
    citation: `Búsqueda sugerida en ${portal.name} (sin documento recuperado): ${query}`,
    summary:
      "NO es una norma/circular/dictamen encontrado. Este organismo no tiene API pública documentada: abre el portal y verifica manualmente antes de citar.",
    url: portal.searchUrl(query),
    publisher: portal.name,
    evidence: "link_only",
    metadata: {
      provider: "portal_link",
      integrity: "portal_stub",
      query,
    },
  };
}

/**
 * Búsqueda administrativa (superintendencias sin API pública). Sigue el
 * mismo patrón de honestidad que `dictamenes.ts`: siempre entrega al menos
 * un portal_stub al organismo detectado (o a los organismos del catálogo si
 * no se detecta ninguno en particular), y complementa best-effort con
 * candidatos de búsqueda web (link_only) contra el dominio oficial.
 */
export async function searchAdministrativo(
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Evidencia=link_only/portal_stub: ninguna de estas superintendencias tiene API pública documentada; confirma siempre en el portal oficial.",
  ];
  const results: CitationResult[] = [];

  const matched = matchSuperintendencia(query);
  const targets = matched ? [matched] : SUPERINTENDENCIAS;
  if (!matched) {
    warnings.push(
      "No se detectó un organismo específico en la consulta; se sugieren portales de todas las superintendencias del catálogo.",
    );
  }

  for (const portal of targets) {
    results.push(portalStubFor(portal, query));
  }

  for (const portal of targets) {
    try {
      const hits = await searchWeb(query, {
        site: portal.sites[0],
        limit: Math.max(2, Math.ceil(limit / targets.length)),
        signal: opts.signal,
      });
      const citations = webHitsToCitations(
        hits,
        "administrativo",
        portal.name,
      ).map((hit) => {
        const ids = parseCaseIdentifiers(hit.title, hit.summary ?? "");
        return {
          ...hit,
          evidence: "link_only" as const,
          id: ids.dictamen ?? hit.id,
        };
      });
      results.push(...citations);
    } catch (error) {
      warnings.push(
        `No se pudo consultar ${portal.sites[0]}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const deduped = uniqueByUrl(results).slice(0, limit);

  return {
    query,
    source: "administrativo",
    results: deduped,
    warnings,
    searchUrls: Object.fromEntries(
      targets.map((p) => [p.id, p.searchUrl(query)]),
    ),
  };
}
