import {
  assistantIntegrityBlock,
  integrityLabel,
  integrityOf,
  sealSearchResponse,
} from "../integrity.js";
import {
  citationReadyBlock,
  nextStepsForSearch,
  toBlockquote,
} from "../present.js";
import type { CitationResult, SearchResponse } from "../types.js";
import {
  buildDoctrineRecord,
  dedupeDoctrineRecords,
  enrichDoctrineQuery,
  formatAuthorFromParts,
  rankDoctrineRecords,
  type DoctrineRecord,
} from "./doctrineShared.js";
import { searchDoajDoctrine } from "./doaj.js";
import {
  CHILE_LEGAL_JOURNALS,
  inferCollectionFromDoi,
  issnsForCountry,
  LATAM_COUNTRY_LABELS,
  LATAM_REFERENCE_JOURNALS,
  type LatamCountry,
} from "./journalCatalog.js";
import {
  obtenerArticuloPorDoiSciELO,
  obtenerArticuloSciELO,
  searchDoctrineJournals,
  searchSciELOChile,
} from "./scielo.js";
import { throwIfAborted } from "../deadline.js";
import { fetchJson, politeUrl, uniqueByUrl } from "../util.js";

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
  // buildDoctrineRecord normalizes "Given Family" → "Family, G."
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
      ?.map((a) => formatAuthorFromParts(a.given, a.family))
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
    evidence: "metadata",
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
      integrity: "candidate",
      vinculante: false,
    },
  };
}

function catalogJournalNames(country?: LatamCountry): Set<string> {
  const journals =
    !country || country === "CL"
      ? CHILE_LEGAL_JOURNALS
      : LATAM_REFERENCE_JOURNALS.filter((j) => j.country === country);
  return new Set(
    journals.map((j) =>
      j.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, ""),
    ),
  );
}

function looksLikeScieloDoi(doi?: string): boolean {
  if (!doi) return false;
  const d = doi.replace(/^https?:\/\/doi\.org\//i, "");
  return (
    d.startsWith("10.4067/") ||
    d.startsWith("10.1590/") ||
    d.startsWith("10.22201/")
  );
}

async function fetchCrossrefAbstract(
  doi: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const data = await fetchJson<{ message: CrossrefItem }>(
      politeUrl(
        `https://api.crossref.org/works/${encodeURIComponent(doi)}?select=abstract`,
      ),
      {},
      8_000,
      signal,
    );
    const abs = data.message.abstract;
    return abs ? abs.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900) : undefined;
  } catch {
    return undefined;
  }
}

async function backfillAbstracts(
  records: DoctrineRecord[],
  signal?: AbortSignal,
): Promise<DoctrineRecord[]> {
  const out: DoctrineRecord[] = [];
  for (const r of records) {
    if (r.abstract || !r.doi) {
      out.push(r);
      continue;
    }
    throwIfAborted(signal);
    const abs = await fetchCrossrefAbstract(r.doi, signal);
    out.push(abs ? { ...r, abstract: abs } : r);
  }
  return out;
}

async function enrichScieloHits(
  records: DoctrineRecord[],
  signal?: AbortSignal,
  maxEnrich = 4,
): Promise<DoctrineRecord[]> {
  const out: DoctrineRecord[] = [];
  let enriched = 0;
  for (const r of records) {
    const doi = r.doi;
    if (
      enriched < maxEnrich &&
      r.provider !== "scielo" &&
      doi &&
      looksLikeScieloDoi(doi)
    ) {
      throwIfAborted(signal);
      try {
        const scielo = await obtenerArticuloPorDoiSciELO(
          doi,
          inferCollectionFromDoi(doi),
        );
        enriched += 1;
        out.push({
          ...scielo,
          abstract: scielo.abstract ?? r.abstract,
          openAlexId: r.openAlexId ?? scielo.openAlexId,
        });
        continue;
      } catch {
        /* keep original */
      }
    }
    out.push(r);
  }
  return out;
}

async function searchOpenAlex(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<DoctrineRecord[]> {
  const enriched = enrichDoctrineQuery(query, "CL");
  const params = new URLSearchParams({
    search: enriched,
    filter: "authorships.institutions.country_code:CL",
    "per-page": String(Math.min(Math.max(limit, 1), 25)),
    sort: "relevance_score:desc",
    select:
      "id,title,display_name,doi,publication_year,type,abstract_inverted_index,biblio,primary_location,authorships",
  });
  const data = await fetchJson<OpenAlexResponse>(
    politeUrl(`https://api.openalex.org/works?${params}`),
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
    query: enrichDoctrineQuery(query, "CL"),
    rows: String(Math.min(limit, 10)),
    select:
      "title,author,published,issued,container-title,volume,issue,page,DOI,URL,abstract",
  });
  const data = await fetchJson<{ message: { items: CrossrefItem[] } }>(
    politeUrl(`https://api.crossref.org/works?${params}`),
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
    warnings.push(
      "Modo pack rápido: OpenAlex catálogo + DOAJ (sin Crossref ni enrich lento).",
    );
  }
  const records: DoctrineRecord[] = [];

  // 1) OpenAlex filtered by Chilean legal journal ISSNs (labeled via catalog).
  try {
    records.push(...(await searchSciELOChile(query, limit, opts.signal)));
  } catch (error) {
    warnings.push(
      `Catálogo revistas Chile (OpenAlex): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 2) DOAJ open-access articles (free, no key).
  if (records.length < limit) {
    throwIfAborted(opts.signal);
    try {
      records.push(
        ...(await searchDoajDoctrine(query, limit - records.length + 2, {
          countryHint: "CL",
          signal: opts.signal,
        })),
      );
    } catch (error) {
      warnings.push(
        `DOAJ: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 3) Broader OpenAlex CL institutions.
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

  // 4) Crossref (skip in fast pack mode).
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

  let merged = dedupeDoctrineRecords(records);
  if (!opts.fast) {
    merged = await backfillAbstracts(
      merged.slice(0, Math.min(merged.length, limit + 4)),
      opts.signal,
    );
    merged = await enrichScieloHits(merged, opts.signal, 4);
    merged = dedupeDoctrineRecords(merged);
  }

  const ranked = rankDoctrineRecords(
    merged,
    query,
    catalogJournalNames("CL"),
  );
  const results = uniqueByUrl(ranked.map(toCitationResult)).slice(0, limit);

  return {
    query,
    source: "doctrina",
    results,
    searchUrls: {
      doaj: `https://doaj.org/search/articles?source=%7B%22query%22%3A%7B%22query_string%22%3A%7B%22query%22%3A%22${encodeURIComponent(query)}%22%7D%7D%7D`,
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

/** Doctrina en revistas jurídicas de un país LATAM (catálogo + DOAJ). */
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
  const records: DoctrineRecord[] = [];

  if (issns.length) {
    try {
      records.push(
        ...(await searchDoctrineJournals(query, limit, issns, pais)),
      );
    } catch (error) {
      warnings.push(
        `OpenAlex (${label}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    warnings.push(`Sin catálogo ISSN denso para país ${pais}; se usa DOAJ.`);
  }

  try {
    records.push(
      ...(await searchDoajDoctrine(query, Math.max(4, limit - records.length), {
        countryHint: pais,
      })),
    );
  } catch (error) {
    warnings.push(
      `DOAJ (${label}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const ranked = rankDoctrineRecords(
    dedupeDoctrineRecords(records),
    query,
    catalogJournalNames(pais),
  );
  const results = uniqueByUrl(ranked.map(toCitationResult)).slice(0, limit);

  const scieloBase = SCielo_SEARCH[pais];
  const searchUrls: Record<string, string> = {
    doaj: `https://doaj.org/search/articles?source=%7B%22query%22%3A%7B%22query_string%22%3A%7B%22query%22%3A%22${encodeURIComponent(query)}%22%7D%7D%7D`,
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
            `No se encontró doctrina en el catálogo / DOAJ de ${label}.`,
          ]
        : warnings,
  };
}

export function formatDoctrineSearchMarkdown(
  data: SearchResponse,
  heading: string,
): string {
  const sealed = sealSearchResponse(data);
  const lines: string[] = [
    `## ${heading}`,
    "",
    "| | |",
    "|---|---|",
    `| **Consulta** | ${sealed.query} |`,
    `| **Hallazgos** | ${sealed.results.length} |`,
    `| **Naturaleza** | Doctrina académica (no vinculante) |`,
    "",
    "_Contrastar siempre con el texto oficial de LeyChile. No presentar como norma o jurisprudencia._",
    "",
  ];
  if (!sealed.results.length) {
    lines.push(
      "No se encontraron artículos doctrinales verificables.",
      "",
      "No inventes DOIs, revistas ni autores.",
      "",
    );
  }
  for (const [i, r] of sealed.results.entries()) {
    lines.push(`### ${i + 1}. ${r.title}`, "");
    lines.push(citationReadyBlock(r.citation), "");
    if (r.metadata?.citationApa) {
      lines.push(`**APA:** ${String(r.metadata.citationApa)}`, "");
    }
    lines.push(`- **Integridad:** \`candidate\` — ${integrityLabel(integrityOf(r))}`);
    if (r.metadata?.authors) {
      lines.push(`- **Autores:** ${String(r.metadata.authors)}`);
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
    if (r.metadata?.provider) {
      lines.push(`- **Fuente de metadatos:** ${String(r.metadata.provider)}`);
    }
    lines.push(`- **URL:** ${r.url}`);
    if (r.secondaryUrl) lines.push(`- **PDF:** ${r.secondaryUrl}`);
    lines.push("");
    if (r.summary) {
      lines.push("**Abstract (no vinculante):**", "", toBlockquote(r.summary, 6), "");
    }
  }

  const next = nextStepsForSearch({
    source: "doctrina",
    realCount: sealed.results.length,
    stubCount: 0,
    empty: sealed.results.length === 0,
  });
  if (next.length) {
    lines.push("### Qué puedes hacer ahora");
    for (const step of next) lines.push(`- ${step}`);
    lines.push("");
  }

  const bodyWarnings = (sealed.warnings ?? []).filter(
    (w) => !/^Integridad:/i.test(w),
  );
  if (bodyWarnings.length) {
    lines.push("### Advertencias", ...bodyWarnings.map((w) => `- ${w}`), "");
  }
  lines.push(assistantIntegrityBlock(), "");
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
      politeUrl(
        `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?select=id,title,display_name,doi,publication_year,type,abstract_inverted_index,biblio,primary_location,authorships`,
      ),
    );
    const parsed = fromOpenAlex(work);
    if (parsed) {
      if (!parsed.abstract) {
        const abs = await fetchCrossrefAbstract(doi);
        if (abs) return { ...parsed, abstract: abs };
      }
      return parsed;
    }
  }
  if (opts.openAlexId) {
    const id = opts.openAlexId.startsWith("http")
      ? opts.openAlexId
      : `https://openalex.org/${opts.openAlexId}`;
    const work = await fetchJson<OpenAlexWork>(
      politeUrl(
        `https://api.openalex.org/works/${encodeURIComponent(id)}?select=id,title,display_name,doi,publication_year,type,abstract_inverted_index,biblio,primary_location,authorships`,
      ),
    );
    const parsed = fromOpenAlex(work);
    if (parsed) return parsed;
  }
  throw new Error("Indica scielo_pid, doi, collection o openAlexId válido.");
}

export function doctrineToMarkdown(d: DoctrineRecord): string {
  return [
    `### ${d.title}`,
    "",
    "**Cita lista para pegar (Chile):**",
    "",
    `> ${d.citationChile}`,
    "",
    `**APA:** ${d.citationApa}`,
    "",
    `- **Integridad:** \`candidate\` — metadata académica (no vinculante)`,
    d.authors.length ? `- **Autores:** ${d.authors.join("; ")}` : undefined,
    d.year ? `- **Año:** ${d.year}` : undefined,
    d.journal ? `- **Revista:** ${d.journal}` : undefined,
    d.volume || d.issue || d.pages
      ? `- **Ref.:** ${[d.volume && `vol. ${d.volume}`, d.issue && `núm. ${d.issue}`, d.pages && `pp. ${d.pages}`].filter(Boolean).join(", ")}`
      : undefined,
    d.scieloPid ? `- **SciELO PID:** ${d.scieloPid}` : undefined,
    d.scieloCollection
      ? `- **Colección SciELO:** ${d.scieloCollection}`
      : undefined,
    d.country ? `- **País:** ${d.country}` : undefined,
    d.provider ? `- **Fuente de metadatos:** ${d.provider}` : undefined,
    d.doi
      ? `- **DOI:** https://doi.org/${d.doi.replace(/^https?:\/\/doi\.org\//i, "")}`
      : undefined,
    `- **URL:** ${d.url}`,
    d.pdfUrl ? `- **PDF:** ${d.pdfUrl}` : undefined,
    "",
    d.abstract
      ? ["**Abstract (no vinculante):**", "", toBlockquote(d.abstract, 8), ""].join(
          "\n",
        )
      : "_Sin abstract disponible en la fuente._",
    "",
    "_Doctrina no vinculante. Contrastar siempre con el texto oficial de LeyChile._",
    "",
    "→ Norma aplicable: `citar_texto_legal` / `obtener_articulo` en LeyChile.",
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");
}
