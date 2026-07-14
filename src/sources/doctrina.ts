import type { CitationResult, SearchResponse } from "../types.js";
import { fetchJson, uniqueByUrl } from "../util.js";

interface OpenAlexWork {
  id: string;
  title?: string | null;
  display_name?: string | null;
  doi?: string | null;
  publication_year?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    source?: { display_name?: string | null } | null;
  } | null;
  authorships?: Array<{
    author?: { display_name?: string | null } | null;
  }>;
}

interface OpenAlexResponse {
  results: OpenAlexWork[];
  meta?: { count?: number };
}

function reconstructAbstract(
  inverted?: Record<string, number[]> | null,
): string | undefined {
  if (!inverted) return undefined;
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inverted)) {
    for (const pos of positions) pairs.push([pos, word]);
  }
  if (pairs.length === 0) return undefined;
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs
    .map(([, w]) => w)
    .join(" ")
    .slice(0, 600);
}

function toCitation(work: OpenAlexWork): CitationResult | null {
  const title = work.title ?? work.display_name;
  if (!title) return null;
  const authors =
    work.authorships
      ?.map((a) => a.author?.display_name)
      .filter(Boolean)
      .slice(0, 4)
      .join(", ") || undefined;
  const journal = work.primary_location?.source?.display_name ?? undefined;
  const url =
    work.primary_location?.landing_page_url ||
    work.doi ||
    work.id;
  const citation = [authors, title, journal, work.publication_year]
    .filter(Boolean)
    .join(". ");

  return {
    source: "doctrina",
    title,
    citation,
    summary: reconstructAbstract(work.abstract_inverted_index),
    date: work.publication_year ? String(work.publication_year) : undefined,
    url,
    secondaryUrl: work.primary_location?.pdf_url ?? undefined,
    publisher: journal ?? "OpenAlex / fuentes académicas",
    id: work.doi ?? work.id,
    metadata: {
      openAlexId: work.id,
      doi: work.doi,
    },
  };
}

export async function searchDoctrina(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const enriched = /\bderecho\b|\bchile\b|\bjurispruden/i.test(query)
    ? query
    : `${query} derecho Chile`;

  const params = new URLSearchParams({
    search: enriched,
    filter: "authorships.institutions.country_code:CL",
    "per-page": String(Math.min(Math.max(limit, 1), 25)),
    sort: "relevance_score:desc",
  });

  const data = await fetchJson<OpenAlexResponse>(
    `https://api.openalex.org/works?${params}`,
  );

  const results = uniqueByUrl(
    data.results.map(toCitation).filter((r): r is CitationResult => r !== null),
  )
    .map((r) => ({ ...r, evidence: "metadata" as const }))
    .slice(0, limit);

  return {
    query,
    source: "doctrina",
    results,
    searchUrls: {
      openAlex: `https://openalex.org/works?q=${encodeURIComponent(query)}`,
      scieloChile: `https://www.scielo.cl/scielo.php?script=sci_search&query=${encodeURIComponent(query)}`,
    },
    warnings:
      results.length === 0
        ? [
            "No se encontró doctrina académica chilena indexada en OpenAlex para esta consulta.",
          ]
        : undefined,
  };
}
