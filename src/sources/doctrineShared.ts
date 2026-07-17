export type DoctrineProvider = "scielo" | "doaj" | "openalex" | "crossref";

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

const PROVIDER_RANK: Record<DoctrineProvider, number> = {
  scielo: 4,
  doaj: 3,
  openalex: 2,
  crossref: 1,
};

const LEGAL_TOKENS = [
  "derecho",
  "jurid",
  "jurispruden",
  "constituc",
  "ley",
  "legal",
  "penal",
  "civil",
  "laboral",
  "procesal",
  "administrativ",
  "tributar",
  "contrato",
  "sentencia",
  "tribunal",
  "recurso",
  "doctrina",
  "normativ",
];

/** Shared query enrichment for OpenAlex / DOAJ / Crossref. */
export function enrichDoctrineQuery(
  query: string,
  country?: string,
): string {
  const q = query.trim();
  if (country === "BR") {
    return /\bdireito\b|\bjurid/i.test(q) ? q : `${q} direito`;
  }
  if (/\bderecho\b|\bjurispruden|\bjuridic|\blaw\b/i.test(q)) return q;
  if (country === "CL" || !country) {
    return /\bchile\b/i.test(q) ? `${q} derecho` : `${q} derecho Chile`;
  }
  return `${q} derecho`;
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function queryTokens(query: string): string[] {
  const stop = new Set([
    "de",
    "del",
    "la",
    "el",
    "los",
    "las",
    "y",
    "en",
    "un",
    "una",
    "para",
    "por",
    "con",
    "derecho",
    "chile",
  ]);
  return fold(query)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
}

/**
 * Normalize author display to Chilean/academic short form: "Apellido, N."
 */
export function normalizeAuthorName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;
  if (cleaned.includes(",")) {
    const [family, rest] = cleaned.split(",").map((s) => s.trim());
    if (!family) return cleaned;
    if (!rest) return family;
    const initials = rest
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => `${p[0]!.toUpperCase()}.`)
      .join(" ");
    return `${family}, ${initials}`;
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!;
  const family = parts[parts.length - 1]!;
  const given = parts.slice(0, -1);
  const initials = given.map((p) => `${p[0]!.toUpperCase()}.`).join(" ");
  return `${family}, ${initials}`;
}

export function formatAuthorFromParts(
  given?: string,
  family?: string,
): string {
  const g = given?.trim();
  const f = family?.trim();
  if (f && g) {
    const initials = g
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => `${p[0]!.toUpperCase()}.`)
      .join(" ");
    return `${f}, ${initials}`;
  }
  if (f) return f;
  return g ? normalizeAuthorName(g) : "";
}

export function normalizeAuthorList(authors: string[]): string[] {
  return authors
    .map((a) => normalizeAuthorName(a))
    .filter(Boolean)
    .slice(0, 8);
}

function looksLegal(hay: string): boolean {
  return LEGAL_TOKENS.some((t) => hay.includes(t));
}

/** Relevance score for ranking doctrine hits. */
export function scoreDoctrineRecord(
  record: DoctrineRecord,
  query: string,
  catalogJournalNames: Set<string> = new Set(),
): number {
  let score = 0;
  const titleFold = fold(record.title);
  const abstractFold = fold(record.abstract ?? "");
  const journalFold = fold(record.journal ?? "");
  const hay = `${titleFold} ${abstractFold} ${journalFold}`;
  const tokens = queryTokens(query);

  for (const t of tokens) {
    if (titleFold.includes(t)) score += t.length > 5 ? 10 : 6;
    else if (abstractFold.includes(t)) score += t.length > 5 ? 5 : 3;
    else if (journalFold.includes(t)) score += 2;
  }
  for (let i = 0; i + 1 < tokens.length; i++) {
    const bg = `${tokens[i]} ${tokens[i + 1]}`;
    if (titleFold.includes(bg)) score += 12;
    else if (abstractFold.includes(bg)) score += 6;
  }

  const inCatalog =
    Boolean(record.journal && catalogJournalNames.has(journalFold));
  if (inCatalog) score += 14;
  if (record.country === "CL") score += 5;
  if (record.abstract) score += 6;
  if (record.doi) score += 4;
  if (record.pdfUrl) score += 4;
  if (record.scieloPid) score += 6;
  if (record.provider) score += PROVIDER_RANK[record.provider] * 2;
  if (record.authors.length) score += 2;
  if (record.volume || record.pages) score += 2;

  if (!inCatalog && !looksLegal(hay) && tokens.length > 0) {
    score -= 18;
  }
  if (!record.abstract && !record.doi && !inCatalog) {
    score -= 8;
  }

  return score;
}

export function rankDoctrineRecords(
  records: DoctrineRecord[],
  query: string,
  catalogJournalNames: Set<string> = new Set(),
): DoctrineRecord[] {
  return [...records].sort(
    (a, b) =>
      scoreDoctrineRecord(b, query, catalogJournalNames) -
      scoreDoctrineRecord(a, query, catalogJournalNames),
  );
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
  const doi = d.doi
    ? ` DOI: ${d.doi.replace(/^https?:\/\/doi\.org\//i, "")}`
    : "";
  return `${authors} ${year} "${d.title}"${loc ? `, ${loc}` : ""}.${doi}`
    .replace(/\s+/g, " ")
    .trim();
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
  const journal = d.journal;
  const volIssue = d.volume
    ? d.issue
      ? `${d.volume}(${d.issue})`
      : `${d.volume}`
    : undefined;
  const pages = d.pages ? d.pages : undefined;
  const doi = d.doi
    ? d.doi.startsWith("http")
      ? d.doi
      : `https://doi.org/${d.doi}`
    : undefined;
  return [
    `${authors} (${year}). ${d.title}.`,
    journal ? `${journal}.` : undefined,
    volIssue,
    pages,
    doi,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildDoctrineRecord(base: {
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
}): DoctrineRecord {
  const authors = normalizeAuthorList(base.authors);
  const cite = {
    authors,
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
      authors.length === 0
        ? "s/a"
        : authors.length <= 2
          ? authors.join(" y ")
          : `${authors[0]} et al.`,
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

function preferRecord(a: DoctrineRecord, b: DoctrineRecord): DoctrineRecord {
  const rankA = a.provider ? PROVIDER_RANK[a.provider] : 0;
  const rankB = b.provider ? PROVIDER_RANK[b.provider] : 0;
  let winner = a;
  let other = b;
  if (rankB > rankA) {
    winner = b;
    other = a;
  } else if (rankA === rankB) {
    if (!a.abstract && b.abstract) {
      winner = b;
      other = a;
    } else if (!a.pdfUrl && b.pdfUrl) {
      winner = b;
      other = a;
    }
  }
  const merged = {
    authors: winner.authors.length ? winner.authors : other.authors,
    title: winner.title,
    journal: winner.journal ?? other.journal,
    year: winner.year ?? other.year,
    volume: winner.volume ?? other.volume,
    issue: winner.issue ?? other.issue,
    pages: winner.pages ?? other.pages,
    doi: winner.doi ?? other.doi,
    url: winner.url,
    pdfUrl: winner.pdfUrl ?? other.pdfUrl,
    abstract: winner.abstract ?? other.abstract,
    scieloPid: winner.scieloPid ?? other.scieloPid,
    openAlexId: winner.openAlexId ?? other.openAlexId,
    scieloCollection: winner.scieloCollection ?? other.scieloCollection,
    country: winner.country ?? other.country,
    provider: winner.provider,
  };
  return buildDoctrineRecord(merged);
}

export function dedupeDoctrineRecords(records: DoctrineRecord[]): DoctrineRecord[] {
  const map = new Map<string, DoctrineRecord>();
  for (const r of records) {
    const key = doctrineDedupeKey(r);
    const prev = map.get(key);
    map.set(key, prev ? preferRecord(prev, r) : r);
  }
  return [...map.values()];
}
