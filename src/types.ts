export type LegalSourceKind =
  "legislacion" | "jurisprudencia" | "doctrina" | "dictamenes";

export type EvidenceKind = "full_text" | "metadata" | "link_only";

export interface CitationResult {
  source: LegalSourceKind;
  title: string;
  citation: string;
  summary?: string;
  date?: string;
  url: string;
  secondaryUrl?: string;
  publisher?: string;
  id?: string;
  evidence?: EvidenceKind;
  rol?: string;
  rit?: string;
  ruc?: string;
  tribunal?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface SearchResponse {
  query: string;
  source: LegalSourceKind | "todas";
  results: CitationResult[];
  warnings?: string[];
  searchUrls?: Record<string, string>;
  pendingSources?: string[];
}
