export type LegalSourceKind =
  | "legislacion"
  | "jurisprudencia"
  | "doctrina"
  | "dictamenes"
  | "administrativo"
  | "causas";

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

/**
 * Case-tracking (seguimiento de causas) record scraped from PJUD's Oficina
 * Judicial Virtual. Distinct from CitationResult: a causa has parties/status/
 * movimientos rather than a citable text excerpt, and it is ALWAYS
 * integrity="candidate" (see docs/pjud-casetracking-solution.md) — this is
 * live-scraped data obtained via an anti-automation (CAPTCHA-solving)
 * workaround, never an official/endorsed API.
 */
export interface CausaPjud {
  tribunal: string;
  rol?: string;
  rit?: string;
  ruc?: string;
  caratulado?: string;
  fecha?: string;
  estado?: string;
  litigantes?: string[];
  ultimaActuacion?: string;
  movimientos?: Array<{ fecha?: string; tramite?: string; etapa?: string }>;
  url: string;
  /** Always "candidate": scraped via CAPTCHA-solving workaround, never official. */
  integrity: "candidate";
  warning: string;
}

export interface CausaPjudSearchResponse {
  query: string;
  source: "causas";
  results: CausaPjud[];
  warnings: string[];
  searchUrls?: Record<string, string>;
}
