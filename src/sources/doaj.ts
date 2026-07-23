import { throwIfAborted } from "../deadline.js";
import { fetchJson } from "../util.js";
import {
  buildDoctrineRecord,
  enrichDoctrineQuery,
  type DoctrineRecord,
} from "./doctrineShared.js";
import type { LatamCountry } from "./journalCatalog.js";

const DOAJ_SEARCH = "https://doaj.org/api/search/articles";

interface DoajAuthor {
  name?: string;
}

interface DoajLink {
  url?: string;
  type?: string;
  content_type?: string;
}

interface DoajIdentifier {
  type?: string;
  id?: string;
}

interface DoajBibjson {
  title?: string;
  author?: DoajAuthor[];
  year?: string | number;
  journal?: {
    title?: string;
    country?: string;
    issns?: string[];
    volume?: string | number;
    number?: string | number;
  };
  start_page?: string | number;
  end_page?: string | number;
  page?: string;
  abstract?: string;
  link?: DoajLink[];
  identifier?: DoajIdentifier[];
  keywords?: string[];
  subject?: Array<{ term?: string }>;
}

interface DoajHit {
  bibjson?: DoajBibjson;
  id?: string;
}

interface DoajResponse {
  results?: DoajHit[];
  total?: number;
}

const COUNTRY_QUERY: Record<LatamCountry, string> = {
  CL: "Chile",
  PE: "Peru OR Perú",
  BR: "Brazil OR Brasil",
  AR: "Argentina",
  MX: "Mexico OR México",
  CO: "Colombia",
};

function doiOf(bib: DoajBibjson): string | undefined {
  const id = bib.identifier?.find((i) => i.type?.toLowerCase() === "doi")?.id;
  return id?.replace(/^https?:\/\/doi\.org\//i, "");
}

function urlsOf(bib: DoajBibjson): { url: string; pdfUrl?: string } {
  const links = bib.link ?? [];
  const fulltext = links.find((l) => /fulltext|full.?text/i.test(l.type ?? ""));
  const pdf = links.find(
    (l) =>
      /pdf/i.test(l.type ?? "") ||
      /pdf/i.test(l.content_type ?? "") ||
      /\.pdf(\?|$)/i.test(l.url ?? ""),
  );
  const any = links.find((l) => l.url)?.url;
  const doi = doiOf(bib);
  const url =
    fulltext?.url ||
    pdf?.url ||
    any ||
    (doi ? `https://doi.org/${doi}` : "") ||
    "https://doaj.org/";
  return { url, pdfUrl: pdf?.url };
}

/** Map a DOAJ API hit to DoctrineRecord (exported for offline tests). */
export function mapDoajHit(hit: DoajHit): DoctrineRecord | null {
  const bib = hit.bibjson;
  const title = bib?.title?.trim();
  if (!bib || !title) return null;
  const authors =
    bib.author
      ?.map((a) => a.name?.trim())
      .filter((x): x is string => Boolean(x))
      .slice(0, 6) ?? [];
  const doi = doiOf(bib);
  const { url, pdfUrl } = urlsOf(bib);
  if (!url || url === "https://doaj.org/") return null;
  const year = bib.year != null ? String(bib.year) : undefined;
  const abstract = bib.abstract
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
  const volume =
    bib.journal?.volume != null ? String(bib.journal.volume) : undefined;
  const issue =
    bib.journal?.number != null ? String(bib.journal.number) : undefined;
  let pages = bib.page?.trim() || undefined;
  if (!pages && bib.start_page != null) {
    pages =
      bib.end_page != null
        ? `${bib.start_page}-${bib.end_page}`
        : String(bib.start_page);
  }

  return buildDoctrineRecord({
    authors,
    title,
    journal: bib.journal?.title,
    year,
    volume,
    issue,
    pages,
    doi,
    url,
    pdfUrl,
    abstract: abstract || undefined,
    country: bib.journal?.country?.toUpperCase(),
    provider: "doaj",
  });
}

export async function searchDoajDoctrine(
  query: string,
  limit = 8,
  opts: {
    countryHint?: LatamCountry;
    signal?: AbortSignal;
  } = {},
): Promise<DoctrineRecord[]> {
  throwIfAborted(opts.signal);
  const country = opts.countryHint ?? "CL";
  const base = enrichDoctrineQuery(query, country);
  // Keep the path query simple — DOAJ query_string is brittle with nested fields.
  const q = `${base} ${COUNTRY_QUERY[country]}`;
  const pathQuery = encodeURIComponent(q);
  const params = new URLSearchParams({
    pageSize: String(Math.min(Math.max(limit * 2, 5), 25)),
    page: "1",
  });
  const data = await fetchJson<DoajResponse>(
    `${DOAJ_SEARCH}/${pathQuery}?${params}`,
    {
      headers: {
        Accept: "application/json",
      },
    },
    10_000,
    opts.signal,
  );
  const countryCode = country.toUpperCase();
  const mapped = (data.results ?? [])
    .map(mapDoajHit)
    .filter((r): r is DoctrineRecord => r !== null)
    .filter((r) => {
      if (!r.country) return true;
      return r.country.toUpperCase() === countryCode;
    });
  // If country filter wiped everything, keep unfiltered OA hits (still free/useful).
  const chosen = mapped.length
    ? mapped
    : (data.results ?? [])
        .map(mapDoajHit)
        .filter((r): r is DoctrineRecord => r !== null);
  return chosen.slice(0, limit);
}
