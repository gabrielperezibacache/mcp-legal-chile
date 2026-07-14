import type { CitationResult, SearchResponse } from "../types.js";
import { fetchJson, uniqueByUrl } from "../util.js";

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

export interface DoctrineRecord {
  title: string;
  authors: string[];
  authorsShort: string;
  year?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  url: string;
  pdfUrl?: string;
  abstract?: string;
  citationChile: string;
  citationApa: string;
  openAlexId?: string;
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

export function formatDoctrineCitationChile(d: {
  authors: string[];
  title: string;
  journal?: string;
  year?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
}): string {
  const authors =
    d.authors.length === 0
      ? "s/a"
      : d.authors.length === 1
        ? d.authors[0]
        : d.authors.length === 2
          ? `${d.authors[0]} y ${d.authors[1]}`
          : `${d.authors[0]} et al.`;
  const loc = [
    d.journal,
    d.volume ? `vol. ${d.volume}` : undefined,
    d.issue ? `núm. ${d.issue}` : undefined,
    d.pages ? `pp. ${d.pages}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const year = d.year ? `(${d.year})` : "";
  const doi = d.doi ? ` DOI: ${d.doi.replace(/^https?:\/\/doi\.org\//i, "")}` : "";
  return `${authors} ${year} "${d.title}"${loc ? `, ${loc}` : ""}.${doi}`.replace(
    /\s+/g,
    " ",
  ).trim();
}

export function formatDoctrineCitationApa(d: {
  authors: string[];
  title: string;
  journal?: string;
  year?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
}): string {
  // Keep full Spanish display names — splitting family/initials is unreliable.
  const authors =
    d.authors.length === 0
      ? "s/a"
      : d.authors.length <= 2
        ? d.authors.join(" & ")
        : `${d.authors[0]} et al.`;
  const year = d.year ?? "s.f.";
  const journal = d.journal ? `${d.journal}` : undefined;
  const volIssue = d.volume
    ? d.issue
      ? `${d.volume}(${d.issue})`
      : `${d.volume}`
    : undefined;
  const doi = d.doi
    ? d.doi.startsWith("http")
      ? d.doi
      : `https://doi.org/${d.doi}`
    : undefined;
  return [
    `${authors} (${year}). ${d.title}.`,
    journal,
    volIssue,
    d.pages,
    doi,
  ]
    .filter(Boolean)
    .join(" ");
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
  const base = {
    authors,
    title,
    journal,
    year,
    volume: work.biblio?.volume ?? undefined,
    issue: work.biblio?.issue ?? undefined,
    pages,
    doi,
  };
  return {
    ...base,
    authorsShort:
      authors.length <= 2
        ? authors.join(" y ")
        : `${authors[0]} et al.`,
    url,
    pdfUrl: work.primary_location?.pdf_url ?? undefined,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    citationChile: formatDoctrineCitationChile(base),
    citationApa: formatDoctrineCitationApa(base),
    openAlexId: work.id,
  };
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
  const base = {
    authors,
    title,
    journal,
    year: year || undefined,
    volume: item.volume,
    issue: item.issue,
    pages: item.page,
    doi,
  };
  return {
    ...base,
    authorsShort:
      authors.length <= 2
        ? authors.join(" y ")
        : `${authors[0]} et al.`,
    url: item.URL ?? (doi ? `https://doi.org/${doi}` : ""),
    abstract: item.abstract
      ? item.abstract.replace(/<[^>]+>/g, " ").slice(0, 900)
      : undefined,
    citationChile: formatDoctrineCitationChile(base),
    citationApa: formatDoctrineCitationApa(base),
  };
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
    id: d.doi ?? d.openAlexId,
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
    },
  };
}

async function searchOpenAlex(
  query: string,
  limit: number,
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
  );
  return data.results
    .map(fromOpenAlex)
    .filter((r): r is DoctrineRecord => r !== null);
}

async function searchCrossrefDoctrine(
  query: string,
  limit: number,
): Promise<DoctrineRecord[]> {
  const params = new URLSearchParams({
    query: `${query} derecho Chile`,
    rows: String(Math.min(limit, 10)),
    select:
      "title,author,published,issued,container-title,volume,issue,page,DOI,URL,abstract",
  });
  const data = await fetchJson<{ message: { items: CrossrefItem[] } }>(
    `https://api.crossref.org/works?${params}`,
  );
  return data.message.items
    .map(fromCrossref)
    .filter((r): r is DoctrineRecord => r !== null && Boolean(r.url));
}

export async function searchDoctrina(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Doctrina = fuente no vinculante. Preferir texto de LeyChile para normas.",
  ];
  const records: DoctrineRecord[] = [];

  try {
    records.push(...(await searchOpenAlex(query, limit)));
  } catch (error) {
    warnings.push(
      `OpenAlex: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (records.length < limit) {
    try {
      records.push(
        ...(await searchCrossrefDoctrine(query, limit - records.length)),
      );
    } catch (error) {
      warnings.push(
        `Crossref: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const results = uniqueByUrl(records.map(toCitationResult)).slice(0, limit);

  return {
    query,
    source: "doctrina",
    results,
    searchUrls: {
      openAlex: `https://openalex.org/works?q=${encodeURIComponent(query)}`,
      scieloChile: `https://www.scielo.cl/scielo.php?script=sci_search&query=${encodeURIComponent(query)}`,
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

export async function obtenerDoctrina(opts: {
  doi?: string;
  openAlexId?: string;
}): Promise<DoctrineRecord> {
  if (opts.doi) {
    const doi = opts.doi.replace(/^https?:\/\/doi\.org\//i, "");
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
  throw new Error("Indica doi o openAlexId válido.");
}

export function doctrineToMarkdown(d: DoctrineRecord): string {
  return [
    `### ${d.title}`,
    `- **Cita (Chile):** ${d.citationChile}`,
    `- **Cita (APA):** ${d.citationApa}`,
    d.year ? `- **Año:** ${d.year}` : undefined,
    d.journal ? `- **Revista:** ${d.journal}` : undefined,
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
