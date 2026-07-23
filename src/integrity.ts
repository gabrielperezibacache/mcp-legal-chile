import type { CitationResult, EvidenceKind, SearchResponse } from "./types.js";

/** Rules injected into every search/pack response for the consuming LLM. */
export const ANTI_HALLUCINATION_RULES = [
  "Solo usa identificadores, URLs y extractos que aparezcan explícitamente arriba.",
  "Prohibido inventar ROL, RIT, RUC, dictámenes, artículos, considerandos o citas.",
  "Si evidence=link_only o integrity=portal_stub/candidate: no afirmes el contenido del documento.",
  "Si no hay resultados: dilo. No completes con memoria ni con fuentes no listadas.",
  "Doctrina (metadata) no es vinculante y no sustituye el texto oficial de LeyChile.",
  "Todo extracto textual debe provenir de full_text verificado (LeyChile / TC / texto pegado).",
] as const;

export type IntegrityKind = "verified" | "candidate" | "portal_stub";

export function integrityOf(result: CitationResult): IntegrityKind {
  const raw = result.metadata?.integrity;
  if (raw === "verified" || raw === "candidate" || raw === "portal_stub") {
    return raw;
  }
  if (result.metadata?.provider === "portal_link") return "portal_stub";
  if (result.evidence === "full_text") return "verified";
  if (result.evidence === "metadata") return "candidate";
  return "candidate";
}

export function withIntegrity(
  result: CitationResult,
  integrity: IntegrityKind,
  evidence?: EvidenceKind,
): CitationResult {
  return {
    ...result,
    evidence: evidence ?? result.evidence ?? "link_only",
    metadata: {
      ...result.metadata,
      integrity,
    },
  };
}

/** Drop results that cannot be traced to a usable URL. */
export function hasTraceableUrl(result: CitationResult): boolean {
  const url = result.url?.trim();
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

/**
 * Seal a search response so the assistant cannot treat stubs/empty as verified hits.
 */
export function sealSearchResponse(response: SearchResponse): SearchResponse {
  const sealedResults = response.results.filter(hasTraceableUrl).map((r) => {
    const evidence = r.evidence ?? "link_only";
    const integrity = integrityOf({ ...r, evidence });
    return withIntegrity(r, integrity, evidence);
  });

  const stubCount = sealedResults.filter(
    (r) => integrityOf(r) === "portal_stub",
  ).length;
  const realCount = sealedResults.length - stubCount;

  const warnings = [...(response.warnings ?? [])];
  warnings.push(
    "Integridad: no inventes fuentes. Solo cita lo listado con su URL y nivel de evidencia.",
  );
  if (realCount === 0 && stubCount > 0) {
    warnings.push(
      "Solo hay enlaces a portales (portal_stub): NO son fallos/dictámenes encontrados. No cites contenido.",
    );
  }
  if (sealedResults.length === 0) {
    warnings.push(
      "Cero resultados verificables. Indica que no hubo coincidencias; no completes con memoria.",
    );
  }

  return {
    ...response,
    results: sealedResults,
    warnings: uniqueWarnings(warnings),
  };
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.map((w) => w.trim()).filter(Boolean))];
}

export function assistantIntegrityBlock(): string {
  return [
    "### Integridad (obligatorio)",
    ...ANTI_HALLUCINATION_RULES.map((r) => `- ${r}`),
    "",
    "_Resumen: cita solo lo listado; sin resultados, dilo; nunca inventes identificadores._",
  ].join("\n");
}

/** Label for markdown rendering. */
export function integrityLabel(kind: IntegrityKind): string {
  switch (kind) {
    case "verified":
      return "verificado (texto/fuente oficial recuperada)";
    case "portal_stub":
      return "portal sugerido (NO es un documento encontrado)";
    default:
      return "candidato (verificar en la URL antes de citar contenido)";
  }
}
