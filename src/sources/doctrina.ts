import type { CitationResult, SearchResponse } from "../types.js";
import {
  buildDoctrineRecord,
  dedupeDoctrineRecords,
  type DoctrineRecord,
} from "./doctrineShared.js";
import {
  inferCollectionFromDoi,
  issnsForCountry,
  LATAM_COUNTRY_LABELS,
  type LatamCountry,
} from "./journalCatalog.js";
import {
  obtenerArticuloPorDoiSciELO,
  obtenerArticuloSciELO,
  searchDoctrineJournals,
  searchSciELOChile,
} from "./scielo.js";
import { throwIfAborted } from "../deadline.js";
import { fetchJson, uniqueByUrl } from "../util.js";

export type { DoctrineRecord } from "./doctrineShared.js";
export {
  formatDoctrineCitationApa,
  formatDoctrineCitationChile,
} from "./doctrineShared.js";

interface OpenAlexWork {
  id: string;
  title?: string | null;
  display_name?: string | null;
  doi?: string | null;
  publication_year?: number | null;
  type?: string | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  biblio?: {
    volume?: string | null;
    issue?: string | null;
    first_page?: string | null;
    last_page?: string | null;
  } | null;
  primary_location?: {
    landing_page_url?: string | null;
    pdf_url?: string | null;
    source?: {
      display_name?: string | null;
      issn_l?: string | null;
    } | null;
  } | null;
  authorships?: Array<{
    author?: { display_name?: string | null } | null;
    author_position?: string | null;
  }>;
}

interface OpenAlexResponse {
  results: OpenAlexWork[];
}

interface CrossrefItem {
  title?: string[];
  author?: Array<{ given?: string; family?: string }>;
  published?: { "date-parts"?: number[][] };
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  abstract?: string;
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
    .slice(0, 900);
}

function pagesOf(biblio?: OpenAlexWork["biblio"], page?: string): string | undefined {
  if (page) return page;
  if (!biblio?.first_page) return undefined;
  return biblio.last_page
    ? `${biblio.first_page}-${biblio.last_page}`
    : biblio.first_page;
}

function fromOpenAlex(work: OpenAlexWork): DoctrineRecord | null {
  const title = work.title ?? work.display_name;
  if (!title) return null;
  const authors =
    work.authorships
      ?.map((a) => a.author?.display_name)
      .filter((x): x is string => Boolean(x))
      .slice(0, 6) ?? [];
  const journal = work.primary_location?.source?.display_name ?? undefined;
  const year = work.publication_year
    ? String(work.publication_year)
    : undefined;
  const pages = pagesOf(work.biblio);
  const doi = work.doi?.replace(/^https?:\/\/doi\.org\//i, "") ?? undefined;
  const url =
    work.primary_location?.landing_page_url ||
    (doi ? `https://doi.org/${doi}` : work.id);

  return buildDoctrineRecord({
    authors,
    title,
    journal,
    year,
    volume: work.biblio?.volume ?? undefined,
    issue: work.biblio?.issue ?? undefined,
    pages,
    doi,
    url,
    pdfUrl: work.primary_location?.pdf_url ?? undefined,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    openAlexId: work.id,
    provider: "openalex",
  });
}

function fromCrossref(item: CrossrefItem): DoctrineRecord | null {
  const title = item.title?.[0];
  if (!title) return null;
  const authors =
    item.author
      ?.map((a) => [a.given, a.family].filter(Boolean).join(" "))
      .filter(Boolean)
      .slice(0, 6) ?? [];
  const year = String(
    item.published?.["date-parts"]?.[0]?.[0] ??
      item.issued?.["date-parts"]?.[0]?.[0] ??
      "",
  );
  const journal = item["container-title"]?.[0];
  const doi = item.DOI;

  return buildDoctrineRecord({
    authors,
    title,
    journal,
    year: year || undefined,
    volume: item.volume,
    issue: item.issue,
    pages: item.page,
    doi,
    url: item.URL ?? (doi ? `https://doi.org/${doi}` : ""),
    abstract: item.abstract
      ? item.abstract.replace(/<[^>]+>/g, " ").slice(0, 900)
      : undefined,
    provider: "crossref",
  });
}

function toCitationResult(d: DoctrineRecord): CitationResult {
  return {
    source: "doctrina",
    title: d.title,
    citation: d.citationChile,
    summary: d.abstract,
    date: d.year,
    url: d.url,
    secondaryUrl: d.pdfUrl,
    publisher: d.journal ?? "Doctrina académica",
    id: d.doi ?? d.scieloPid ?? d.openAlexId,
    evidence: d.abstract ? "metadata" : "metadata",
    metadata: {
      citationApa: d.citationApa,
      citationChile: d.citationChile,
      doi: d.doi,
      volume: d.volume,
      issue: d.issue,
      pages: d.pages,
      authors: d.authors.join("; "),
      pdfUrl: d.pdfUrl,
      openAlexId: d.openAlexId,
      scieloPid: d.scieloPid,
      scieloCollection: d.scieloCollection,
      country: d.country,
      provider: d.provider,
    },
  };
}

async function searchOpenAlex(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<DoctrineRecord[]> {
  const enriched = /\bderecho\b|\bchile\b|\bjurispruden/i.test(query)
    ? query
    : `${query} derecho Chile`;
  const params = new URLSearchParams({
    search: enriched,
    filter: "authorships.institutions.country_code:CL",
    "per-page": String(Math.min(Math.max(limit, 1), 25)),
    sort: "relevance_score:desc",
    select:
      "id,title,display_name,doi,publication_year,type,abstract_inverted_index,biblio,primary_location,authorships",
  });
  const data = await fetchJson<OpenAlexResponse>(
    `https://api.openalex.org/works?${params}`,
    {},
    undefined,
    signal,
  );
  return data.results
    .map(fromOpenAlex)
    .filter((r): r is DoctrineRecord => r !== null);
}

async function searchCrossrefDoctrine(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<DoctrineRecord[]> {
  const params = new URLSearchParams({
    query: `${query} derecho Chile`,
    rows: String(Math.min(limit, 10)),
    select:
      "title,author,published,issued,container-title,volume,issue,page,DOI,URL,abstract",
  });
  const data = await fetchJson<{ message: { items: CrossrefItem[] } }>(
    `https://api.crossref.org/works?${params}`,
    {},
    undefined,
    signal,
  );
  return data.message.items
    .map(fromCrossref)
    .filter((r): r is DoctrineRecord => r !== null && Boolean(r.url));
}

export async function searchDoctrina(
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal; fast?: boolean } = {},
): Promise<SearchResponse> {
  throwIfAborted(opts.signal);
  const warnings: string[] = [
    "Doctrina = fuente no vinculante. Preferir texto de LeyChile para normas.",
  ];
  if (opts.fast) {
    warnings.push("Modo pack rápido: solo SciELO/OpenAlex (sin Crossref).");
  }
  const records: DoctrineRecord[] = [];

  try {
    records.push(...(await searchSciELOChile(query, limit, opts.signal)));
  } catch (error) {
    warnings.push(
      `SciELO Chile: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (records.length < limit) {
    throwIfAborted(opts.signal);
    try {
      records.push(
        ...(await searchOpenAlex(query, limit - records.length, opts.signal)),
      );
    } catch (error) {
      warnings.push(
        `OpenAlex: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!opts.fast && records.length < limit) {
    throwIfAborted(opts.signal);
    try {
      records.push(
        ...(await searchCrossrefDoctrine(
          query,
          limit - records.length,
          opts.signal,
        )),
      );
    } catch (error) {
      warnings.push(
        `Crossref: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const merged = dedupeDoctrineRecords(records);
  const sorted = [
    ...merged.filter((r) => r.provider === "scielo"),
    ...merged.filter((r) => r.provider !== "scielo"),
  ];
  const results = uniqueByUrl(sorted.map(toCitationResult)).slice(0, limit);

  return {
    query,
    source: "doctrina",
    results,
    searchUrls: {
      scieloChile: `https://www.scielo.cl/scielo.php?script=sci_search&query=${encodeURIComponent(query)}`,
      articleMeta: `https://articlemeta.scielo.org/api/v1/article/identifiers/?collection=chl`,
      openAlex: `https://openalex.org/works?q=${encodeURIComponent(query)}`,
      crossref: `https://search.crossref.org/?q=${encodeURIComponent(query)}`,
    },
    warnings:
      results.length === 0
        ? [
            ...warnings,
            "No se encontró doctrina académica indexada para esta consulta.",
          ]
        : warnings,
  };
}

const SCielo_SEARCH: Partial<Record<LatamCountry, string>> = {
  CL: "https://www.scielo.cl/scielo.php?script=sci_search",
  BR: "https://search.scielo.org/?q=",
  AR: "https://www.scielo.org.ar/scielo.php?script=sci_search",
  MX: "https://www.scielo.org.mx/scielo.php?script=sci_search",
  PE: "https://www.scielo.org.pe/scielo.php?script=sci_search",
  CO: "https://www.scielo.org.co/scielo.php?script=sci_search",
};

/** Doctrina en revistas jurídicas de un país LATAM (catálogo de referencia). */
export async function searchDoctrinaLatam(
  query: string,
  limit = 8,
  pais: LatamCountry,
): Promise<SearchResponse> {
  const label = LATAM_COUNTRY_LABELS[pais];
  const warnings: string[] = [
    `Doctrina ${label} = fuente no vinculante. Contrastar con norma chilena aplicable.`,
  ];
  const issns = issnsForCountry(pais);
  if (issns.length === 0) {
    return {
      query,
      source: "doctrina",
      results: [],
      warnings: [...warnings, `Sin catálogo ISSN para país ${pais}.`],
    };
  }

  let records: DoctrineRecord[] = [];
  try {
    records = await searchDoctrineJournals(query, limit, issns, pais);
  } catch (error) {
    warnings.push(
      `OpenAlex (${label}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const results = uniqueByUrl(
    dedupeDoctrineRecords(records).map(toCitationResult),
  ).slice(0, limit);

  const scieloBase = SCielo_SEARCH[pais];
  const searchUrls: Record<string, string> = {
    openAlex: `https://openalex.org/works?q=${encodeURIComponent(query)}`,
    crossref: `https://search.crossref.org/?q=${encodeURIComponent(query)}`,
  };
  if (scieloBase) {
    searchUrls.scielo = scieloBase.includes("?q=")
      ? `${scieloBase}${encodeURIComponent(query)}`
      : `${scieloBase}&query=${encodeURIComponent(query)}`;
  }

  return {
    query,
    source: "doctrina",
    results,
    searchUrls,
    warnings:
      results.length === 0
        ? [
            ...warnings,
            `No se encontró doctrina en el catálogo de referencia de ${label}.`,
          ]
        : warnings,
  };
}

export function formatDoctrineSearchMarkdown(
  data: SearchResponse,
  heading: string,
): string {
  const lines: string[] = [
    `## ${heading}`,
    "",
    "_Fuente no vinculante. Contrastar con texto oficial de LeyChile._",
    "",
  ];
  for (const [i, r] of data.results.entries()) {
    lines.push(`### ${i + 1}. ${r.title}`);
    lines.push(`- **Cita (Chile):** ${r.citation}`);
    if (r.metadata?.citationApa) {
      lines.push(`- **Cita (APA):** ${String(r.metadata.citationApa)}`);
    }
    if (r.date) lines.push(`- **Año:** ${r.date}`);
    if (r.publisher) lines.push(`- **Revista:** ${r.publisher}`);
    if (r.metadata?.country) {
      lines.push(`- **País:** ${String(r.metadata.country)}`);
    }
    if (r.id) lines.push(`- **DOI/ID:** ${r.id}`);
    if (r.metadata?.scieloPid) {
      lines.push(`- **SciELO PID:** ${String(r.metadata.scieloPid)}`);
    }
    if (r.metadata?.scieloCollection) {
      lines.push(
        `- **Colección SciELO:** ${String(r.metadata.scieloCollection)}`,
      );
    }
    if (r.metadata?.provider) {
      lines.push(`- **Fuente:** ${String(r.metadata.provider)}`);
    }
    lines.push(`- **URL:** ${r.url}`);
    if (r.secondaryUrl) lines.push(`- **PDF:** ${r.secondaryUrl}`);
    lines.push("");
    if (r.summary) {
      lines.push("**Extracto:**", "", `> ${r.summary}`, "");
    }
  }
  if (data.warnings?.length) {
    lines.push("### Advertencias", ...data.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}

export async function obtenerDoctrina(opts: {
  doi?: string;
  openAlexId?: string;
  scieloPid?: string;
  collection?: string;
}): Promise<DoctrineRecord> {
  if (opts.scieloPid) {
    return obtenerArticuloSciELO(opts.scieloPid, opts.collection);
  }
  if (opts.doi) {
    const doi = opts.doi.replace(/^https?:\/\/doi\.org\//i, "");
    const collection = opts.collection ?? inferCollectionFromDoi(doi);
    if (
      collection ||
      doi.startsWith("10.4067/") ||
      doi.startsWith("10.1590/") ||
      doi.startsWith("10.22201/")
    ) {
      try {
        return await obtenerArticuloPorDoiSciELO(doi, collection);
      } catch {
        // fallback OpenAlex
      }
    }
    const work = await fetchJson<OpenAlexWork>(
      `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?select=id,title,display_name,doi,publication_year,type,abstract_inverted_index,biblio,primary_location,authorships`,
    );
    const parsed = fromOpenAlex(work);
    if (parsed) return parsed;
  }
  if (opts.openAlexId) {
    const id = opts.openAlexId.startsWith("http")
      ? opts.openAlexId
      : `https://openalex.org/${opts.openAlexId}`;
    const work = await fetchJson<OpenAlexWork>(
      `https://api.openalex.org/works/${encodeURIComponent(id)}?select=id,title,display_name,doi,publication_year,type,abstract_inverted_index,biblio,primary_location,authorships`,
    );
    const parsed = fromOpenAlex(work);
    if (parsed) return parsed;
  }
  throw new Error("Indica scielo_pid, doi, collection o openAlexId válido.");
}

export function doctrineToMarkdown(d: DoctrineRecord): string {
  return [
    `### ${d.title}`,
    `- **Cita (Chile):** ${d.citationChile}`,
    `- **Cita (APA):** ${d.citationApa}`,
    d.year ? `- **Año:** ${d.year}` : undefined,
    d.journal ? `- **Revista:** ${d.journal}` : undefined,
    d.scieloPid ? `- **SciELO PID:** ${d.scieloPid}` : undefined,
    d.scieloCollection
      ? `- **Colección SciELO:** ${d.scieloCollection}`
      : undefined,
    d.country ? `- **País:** ${d.country}` : undefined,
    d.provider ? `- **Fuente:** ${d.provider}` : undefined,
    d.doi ? `- **DOI:** https://doi.org/${d.doi.replace(/^https?:\/\/doi\.org\//i, "")}` : undefined,
    `- **URL:** ${d.url}`,
    d.pdfUrl ? `- **PDF:** ${d.pdfUrl}` : undefined,
    "",
    d.abstract
      ? ["**Abstract / extracto:**", "", `> ${d.abstract}`, ""].join("\n")
      : "_Sin abstract disponible en la fuente._",
    "",
    "_Doctrina no vinculante. Contrastar siempre con el texto oficial de LeyChile._",
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");
}
