import type { CitationResult, SearchResponse } from "../types.js";
import { fetchJson, uniqueByUrl } from "../util.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

interface CrossrefItem {
  title?: string[];
  URL?: string;
  DOI?: string;
  issued?: { "date-parts"?: number[][] };
  author?: Array<{ given?: string; family?: string }>;
  "container-title"?: string[];
  abstract?: string;
}

interface CrossrefResponse {
  message: { items: CrossrefItem[] };
}

function crossrefToCitation(item: CrossrefItem): CitationResult | null {
  const title = item.title?.[0];
  if (!title) return null;
  const authors =
    item.author
      ?.slice(0, 3)
      .map((a) => [a.given, a.family].filter(Boolean).join(" "))
      .join(", ") || undefined;
  const year = item.issued?.["date-parts"]?.[0]?.[0];
  const journal = item["container-title"]?.[0];
  return {
    source: "jurisprudencia",
    title,
    citation: [authors, title, journal, year].filter(Boolean).join(". "),
    summary: item.abstract
      ? item.abstract.replace(/<[^>]+>/g, " ").slice(0, 500)
      : undefined,
    date: year ? String(year) : undefined,
    url: item.URL ?? (item.DOI ? `https://doi.org/${item.DOI}` : ""),
    publisher: journal ?? "Análisis / fuentes indexadas",
    id: item.DOI,
  };
}

export async function searchJurisprudencia(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const warnings: string[] = [];
  const results: CitationResult[] = [];

  try {
    const webHits = await searchWeb(query, {
      site: "pjud.cl",
      limit: Math.max(4, Math.ceil(limit / 2)),
    });
    results.push(
      ...webHitsToCitations(
        webHits,
        "jurisprudencia",
        "Poder Judicial de Chile (vía búsqueda pública)",
      ),
    );
  } catch (error) {
    warnings.push(
      `Búsqueda en pjud.cl limitada: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const tcHits = await searchWeb(query, {
      site: "tribunalconstitucional.cl",
      limit: Math.max(2, Math.floor(limit / 3)),
    });
    results.push(
      ...webHitsToCitations(
        tcHits,
        "jurisprudencia",
        "Tribunal Constitucional de Chile (vía búsqueda pública)",
      ),
    );
  } catch {
    // optional source
  }

  try {
    const params = new URLSearchParams({
      query: `${query} jurisprudencia Chile`,
      rows: String(Math.min(limit, 10)),
      select: "title,URL,DOI,author,issued,container-title,abstract",
    });
    const data = await fetchJson<CrossrefResponse>(
      `https://api.crossref.org/works?${params}`,
    );
    for (const item of data.message.items) {
      const citation = crossrefToCitation(item);
      if (citation?.url) results.push(citation);
    }
  } catch (error) {
    warnings.push(
      `Crossref no disponible: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const deduped = uniqueByUrl(results).slice(0, limit);

  if (deduped.length === 0) {
    warnings.push(
      "No se obtuvieron fallos indexables automáticamente. Usa los enlaces oficiales del buscador del Poder Judicial.",
    );
  } else {
    warnings.push(
      "El Poder Judicial no ofrece una API pública abierta. Los resultados combinan links indexados públicamente y análisis académicos; verifica siempre el texto oficial del fallo.",
    );
  }

  return {
    query,
    source: "jurisprudencia",
    results: deduped,
    warnings,
    searchUrls: {
      poderJudicial:
        "https://www.pjud.cl/portal-unificado-sentencias",
      tribunalConstitucional:
        "https://www.tribunalconstitucional.cl/sentencias",
      busquedaSugerida: `https://duckduckgo.com/?q=${encodeURIComponent(`${query} site:pjud.cl`)}`,
    },
  };
}
