import {
  buildDoctrineRecord,
  formatAuthorFromParts,
  type DoctrineRecord,
} from "./doctrineShared.js";
import {
  chileLegalJournalIssns,
  inferCollectionFromDoi,
  journalByIssn,
  type LatamCountry,
} from "./journalCatalog.js";
import { fetchJson, politeUrl } from "../util.js";
import { enrichDoctrineQuery } from "./doctrineShared.js";

const ARTICLEMETA_BASE = "https://articlemeta.scielo.org/api/v1/article/";

const SCielo_SITES: Record<string, string> = {
  chl: "https://www.scielo.cl",
  scl: "https://www.scielo.br",
  arg: "https://www.scielo.org.ar",
  mex: "https://www.scielo.org.mx",
  per: "https://www.scielo.org.pe",
  col: "https://www.scielo.org.co",
};

const ARTICLEMETA_COLLECTIONS = [
  "chl",
  "scl",
  "arg",
  "mex",
  "per",
  "col",
] as const;

interface SciELOTag {
  _?: string;
  l?: string;
  s?: string;
  n?: string;
  f?: string;
}

interface ArticleMetaResponse {
  code: string;
  collection: string;
  publication_year?: string | number;
  doi?: string;
  article?: Record<string, SciELOTag[]>;
  issue?: {
    issue?: Record<string, SciELOTag[]>;
  };
  fulltexts?: {
    html?: Record<string, string>;
    pdf?: Record<string, string>;
  };
}

interface OpenAlexWork {
  id: string;
  title?: string | null;
  display_name?: string | null;
  doi?: string | null;
  publication_year?: number | null;
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
  }>;
}

interface OpenAlexResponse {
  results: OpenAlexWork[];
}

function pickLang(
  tags: SciELOTag[] | undefined,
  lang = "es",
): string | undefined {
  if (!tags?.length) return undefined;
  const hit = tags.find((t) => t.l === lang) ?? tags[0];
  return hit?._?.trim() || undefined;
}

function parseAuthors(tags: SciELOTag[] | undefined): string[] {
  if (!tags?.length) return [];
  return tags
    .map(
      (t) =>
        formatAuthorFromParts(t.n, t.s) ||
        [t.n, t.s].filter(Boolean).join(" ").trim(),
    )
    .filter(Boolean)
    .slice(0, 6);
}

function parseAbstract(
  article: Record<string, SciELOTag[]> | undefined,
): string | undefined {
  if (!article) return undefined;
  // SciELO ISIS tags commonly used for abstracts.
  for (const key of ["v83", "v85", "v72", "v83a"]) {
    const text = pickLang(article[key]);
    if (text && text.length > 40) {
      return text.replace(/\s+/g, " ").trim().slice(0, 900);
    }
  }
  return undefined;
}

function parsePages(tags: SciELOTag[] | undefined): string | undefined {
  const row = tags?.[0];
  if (!row) return undefined;
  if (row.f && row.l) return `${row.f}-${row.l}`;
  return row.f || row.l || undefined;
}

export function normalizeSciELOPid(pid: string): string {
  const trimmed = pid.trim();
  return trimmed.startsWith("S") ? trimmed : `S${trimmed}`;
}

export function doiFromSciELOPid(pid: string, collection = "chl"): string {
  const clean = normalizeSciELOPid(pid).slice(1).toLowerCase();
  if (collection === "scl") return `10.1590/${clean}`;
  return `10.4067/s${clean}`;
}

export function scieloPidFromDoi(doi?: string): string | undefined {
  if (!doi) return undefined;
  const norm = doi.replace(/^https?:\/\/doi\.org\//i, "");
  const m = norm.match(/^10\.(?:4067|1590)\/s?(.+)$/i);
  if (!m) return undefined;
  return normalizeSciELOPid(m[1]);
}

export function scieloArtUrl(
  pid: string,
  collection = "chl",
  lang = "es",
): string {
  const base = SCielo_SITES[collection] ?? SCielo_SITES.chl;
  return `${base}/scielo.php?script=sci_arttext&pid=${encodeURIComponent(normalizeSciELOPid(pid))}&tlng=${lang}`;
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

function pagesOf(biblio?: OpenAlexWork["biblio"]): string | undefined {
  if (!biblio?.first_page) return undefined;
  return biblio.last_page
    ? `${biblio.first_page}-${biblio.last_page}`
    : biblio.first_page;
}

function fromArticleMeta(data: ArticleMetaResponse): DoctrineRecord {
  const article = data.article ?? {};
  const issueMeta = data.issue?.issue ?? {};
  const pid = normalizeSciELOPid(data.code);
  const collection = data.collection || "chl";
  const title =
    pickLang(article.v12) ?? pickLang(article.v1) ?? `Artículo SciELO ${pid}`;
  const authors = parseAuthors(article.v10);
  const journal =
    pickLang(issueMeta.v130) ??
    pickLang(article.v30) ??
    pickLang(issueMeta.v151);
  const volume = pickLang(article.v31) ?? pickLang(issueMeta.v31);
  const issue = pickLang(article.v32) ?? pickLang(issueMeta.v32);
  const pages = parsePages(article.v14);
  const year = String(data.publication_year ?? "").trim() || undefined;
  const doi =
    data.doi?.replace(/^https?:\/\/doi\.org\//i, "") ??
    (collection === "chl" ? doiFromSciELOPid(pid, collection) : undefined);
  const url =
    data.fulltexts?.html?.es ??
    data.fulltexts?.html?.pt ??
    scieloArtUrl(pid, collection);
  const pdfUrl =
    data.fulltexts?.pdf?.es ?? data.fulltexts?.pdf?.pt ?? undefined;
  const journalMeta = journalByIssn(issueMeta.v35?.[0]?._);

  return buildDoctrineRecord({
    authors,
    title,
    journal,
    year,
    volume,
    issue,
    pages,
    doi,
    url,
    pdfUrl,
    abstract: parseAbstract(article),
    scieloPid: pid,
    scieloCollection: collection,
    country: journalMeta?.country,
    provider: "scielo",
  });
}

function fromOpenAlexJournal(work: OpenAlexWork): DoctrineRecord | null {
  const title = work.title ?? work.display_name;
  if (!title) return null;
  const authors =
    work.authorships
      ?.map((a) => a.author?.display_name)
      .filter((x): x is string => Boolean(x))
      .slice(0, 6) ?? [];
  const journal = work.primary_location?.source?.display_name ?? undefined;
  const issn = work.primary_location?.source?.issn_l ?? undefined;
  const journalMeta = journalByIssn(issn);
  const year = work.publication_year
    ? String(work.publication_year)
    : undefined;
  const pages = pagesOf(work.biblio);
  const doi = work.doi?.replace(/^https?:\/\/doi\.org\//i, "") ?? undefined;
  const collection =
    journalMeta?.collection ?? inferCollectionFromDoi(doi ?? "");
  const scieloPid = scieloPidFromDoi(doi);
  const url =
    work.primary_location?.landing_page_url ||
    (scieloPid && collection
      ? scieloArtUrl(scieloPid, collection)
      : doi
        ? `https://doi.org/${doi}`
        : work.id);
  const pdfUrl = work.primary_location?.pdf_url ?? undefined;

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
    pdfUrl,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    scieloPid,
    scieloCollection: collection,
    country: journalMeta?.country ?? (collection ? "CL" : undefined),
    openAlexId: work.id,
    // OpenAlex ISSN hit — only ArticleMeta lookups use provider "scielo".
    provider: "openalex",
  });
}

/** Búsqueda en catálogo ISSN vía OpenAlex (polite pool). */
export async function searchDoctrineJournals(
  query: string,
  limit: number,
  issns: string[],
  country?: LatamCountry,
  signal?: AbortSignal,
): Promise<DoctrineRecord[]> {
  if (issns.length === 0) return [];
  const params = new URLSearchParams({
    search: enrichDoctrineQuery(query, country),
    filter: `primary_location.source.issn:${issns.join("|")}`,
    "per-page": String(Math.min(Math.max(limit, 1), 25)),
    sort: "relevance_score:desc",
    select:
      "id,title,display_name,doi,publication_year,abstract_inverted_index,biblio,primary_location,authorships",
  });
  const data = await fetchJson<OpenAlexResponse>(
    politeUrl(`https://api.openalex.org/works?${params}`),
    {},
    undefined,
    signal,
  );
  return data.results
    .map(fromOpenAlexJournal)
    .filter((r): r is DoctrineRecord => r !== null);
}

/** Búsqueda en revistas jurídicas chilenas del catálogo. */
export async function searchSciELOChile(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<DoctrineRecord[]> {
  return searchDoctrineJournals(
    query,
    limit,
    chileLegalJournalIssns(),
    "CL",
    signal,
  );
}

export async function obtenerArticuloSciELO(
  pid: string,
  collection?: string,
): Promise<DoctrineRecord> {
  const code = normalizeSciELOPid(pid);
  const collections = collection ? [collection] : [...ARTICLEMETA_COLLECTIONS];

  let lastError: unknown;
  for (const col of collections) {
    try {
      const params = new URLSearchParams({ code, collection: col });
      const data = await fetchJson<ArticleMetaResponse>(
        `${ARTICLEMETA_BASE}?${params}`,
      );
      if (data?.code) return fromArticleMeta(data);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `SciELO ArticleMeta no devolvió artículo para pid=${code}${
      collection ? ` (collection=${collection})` : ""
    }: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export async function obtenerArticuloPorDoiSciELO(
  doi: string,
  collection?: string,
): Promise<DoctrineRecord> {
  const norm = doi.replace(/^https?:\/\/doi\.org\//i, "");
  const col = collection ?? inferCollectionFromDoi(norm);
  const collections = col ? [col] : [...ARTICLEMETA_COLLECTIONS];

  let lastError: unknown;
  for (const c of collections) {
    try {
      const params = new URLSearchParams({ code: norm, collection: c });
      const data = await fetchJson<ArticleMetaResponse>(
        `${ARTICLEMETA_BASE}?${params}`,
      );
      if (data?.code) return fromArticleMeta(data);
    } catch (error) {
      lastError = error;
    }
  }

  if (scieloPidFromDoi(norm)) {
    return obtenerArticuloSciELO(
      norm.replace(/^10\.(?:4067|1590)\/s?/i, "S"),
      col,
    );
  }

  throw new Error(
    `ArticleMeta no resolvió DOI ${norm}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export { chileLegalJournalIssns };
