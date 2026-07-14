export type DoctrineProvider = "scielo" | "openalex" | "crossref";

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
  scieloPid?: string;
  scieloCollection?: string;
  country?: string;
  provider?: DoctrineProvider;
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

export function buildDoctrineRecord(
  base: {
    authors: string[];
    title: string;
    journal?: string;
    year?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    doi?: string;
    url: string;
    pdfUrl?: string;
    abstract?: string;
    scieloPid?: string;
    openAlexId?: string;
    scieloCollection?: string;
    country?: string;
    provider?: DoctrineProvider;
  },
): DoctrineRecord {
  const cite = {
    authors: base.authors,
    title: base.title,
    journal: base.journal,
    year: base.year,
    volume: base.volume,
    issue: base.issue,
    pages: base.pages,
    doi: base.doi,
  };
  return {
    ...cite,
    authorsShort:
      base.authors.length <= 2
        ? base.authors.join(" y ")
        : `${base.authors[0]} et al.`,
    url: base.url,
    pdfUrl: base.pdfUrl,
    abstract: base.abstract,
    citationChile: formatDoctrineCitationChile(cite),
    citationApa: formatDoctrineCitationApa(cite),
    scieloPid: base.scieloPid,
    openAlexId: base.openAlexId,
    scieloCollection: base.scieloCollection,
    country: base.country,
    provider: base.provider,
  };
}

export function doctrineDedupeKey(r: DoctrineRecord): string {
  if (r.doi) return `doi:${r.doi.toLowerCase()}`;
  if (r.scieloPid) return `pid:${r.scieloPid}`;
  return `url:${r.url}`;
}

export function dedupeDoctrineRecords(records: DoctrineRecord[]): DoctrineRecord[] {
  const map = new Map<string, DoctrineRecord>();
  for (const r of records) {
    const key = doctrineDedupeKey(r);
    const prev = map.get(key);
    if (!prev || (r.provider === "scielo" && prev.provider !== "scielo")) {
      map.set(key, r);
    }
  }
  return [...map.values()];
}
