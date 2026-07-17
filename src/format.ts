import {
  assistantIntegrityBlock,
  integrityLabel,
  integrityOf,
  sealSearchResponse,
} from "./integrity.js";
import {
  citationReadyBlock,
  evidenceLabel,
  integrityBadge,
  nextStepFor,
  nextStepsForSearch,
  toBlockquote,
} from "./present.js";
import type { CitationResult, SearchResponse } from "./types.js";

export function formatCitationMarkdown(result: CitationResult): string {
  const integrity = integrityOf(result);
  const lines: string[] = [
    `### ${result.title}`,
    "",
    citationReadyBlock(result.citation),
    "",
    `- **Fuente:** ${labelForSource(result.source)}`,
    `- **Integridad:** ${integrityBadge(integrity)} — ${integrityLabel(integrity)}`,
    `- **Evidencia:** ${evidenceLabel(result.evidence)}`,
  ];

  const ids: string[] = [];
  if (result.id) ids.push(`id \`${result.id}\``);
  if (result.rol) ids.push(`ROL \`${result.rol}\``);
  if (result.rit) ids.push(`RIT \`${result.rit}\``);
  if (result.tribunal) ids.push(result.tribunal);
  if (result.date) ids.push(result.date);
  if (ids.length) lines.push(`- **Identificadores:** ${ids.join(" · ")}`);
  if (result.publisher) lines.push(`- **Publicado por:** ${result.publisher}`);
  lines.push(`- **URL:** ${result.url}`);
  if (result.secondaryUrl) lines.push(`- **PDF / secundaria:** ${result.secondaryUrl}`);

  if (result.summary?.trim()) {
    const extractTitle =
      result.evidence === "full_text"
        ? "**Extracto verificado**"
        : result.source === "doctrina"
          ? "**Abstract (no vinculante)**"
          : "**Extracto (metadata; verificar en URL)**";
    lines.push("", extractTitle, "", toBlockquote(result.summary, 8));
  }

  if (integrity === "portal_stub") {
    lines.push(
      "",
      "_Este ítem es solo un portal de búsqueda. No cites ratio decidendi ni hechos._",
    );
  } else if (result.evidence === "link_only") {
    lines.push(
      "",
      "_Enlace candidato: no afirmes el contenido del documento hasta verificarlo._",
    );
  } else if (result.source === "doctrina") {
    lines.push(
      "",
      "_Doctrina académica: no vinculante; no la presentes como norma o jurisprudencia._",
    );
  }

  const next = nextStepFor(result);
  if (next) lines.push("", `→ ${next}`);

  return lines.join("\n");
}

export function formatSearchMarkdown(response: SearchResponse): string {
  const sealed = sealSearchResponse(response);
  const docs = sealed.results.filter((r) => integrityOf(r) !== "portal_stub");
  const stubs = sealed.results.filter((r) => integrityOf(r) === "portal_stub");

  const lines: string[] = [
    `## Resultados — ${labelForSource(sealed.source)}`,
    "",
    `| | |`,
    `|---|---|`,
    `| **Consulta** | ${sealed.query} |`,
    `| **Documentos / candidatos** | ${docs.length} |`,
    `| **Portales sugeridos** | ${stubs.length} |`,
    "",
  ];

  if (sealed.results.length === 0) {
    lines.push(
      "No hay coincidencias verificables para esta consulta.",
      "",
      "No inventes fuentes, ROL, dictámenes ni artículos.",
      "",
    );
  } else {
    if (docs.length) {
      lines.push("### Documentos y candidatos", "");
      for (const [i, result] of docs.entries()) {
        lines.push(`#### ${i + 1}.`, formatCitationMarkdown(result), "");
      }
    }
    if (stubs.length) {
      lines.push(
        "### Portales sugeridos (no son documentos encontrados)",
        "",
      );
      for (const [i, result] of stubs.entries()) {
        lines.push(
          `${i + 1}. **${result.title}** — ${result.url}`,
          `   ${nextStepFor(result) ?? "Verifica manualmente en el portal."}`,
          "",
        );
      }
    }
  }

  const next = nextStepsForSearch({
    source: sealed.source,
    realCount: docs.length,
    stubCount: stubs.length,
    empty: sealed.results.length === 0,
  });
  if (next.length) {
    lines.push("### Qué puedes hacer ahora");
    for (const step of next) lines.push(`- ${step}`);
    lines.push("");
  }

  // Prefer domain-specific warnings; skip generic integrity duplicates in the body.
  const bodyWarnings = (sealed.warnings ?? []).filter(
    (w) => !/^Integridad:/i.test(w),
  );
  if (bodyWarnings.length) {
    lines.push("### Advertencias");
    for (const w of bodyWarnings) lines.push(`- ${w}`);
    lines.push("");
  }

  if (sealed.pendingSources?.length) {
    lines.push("### Fuentes pendientes / incompletas");
    for (const w of sealed.pendingSources) lines.push(`- ${w}`);
    lines.push("");
  }

  if (sealed.searchUrls && Object.keys(sealed.searchUrls).length) {
    lines.push("### Buscadores oficiales");
    for (const [name, url] of Object.entries(sealed.searchUrls)) {
      lines.push(`- [${name}](${url})`);
    }
    lines.push("");
  }

  lines.push(assistantIntegrityBlock(), "");
  return lines.join("\n");
}

function labelForSource(
  source: SearchResponse["source"] | CitationResult["source"],
): string {
  switch (source) {
    case "legislacion":
      return "Legislación (BCN / LeyChile)";
    case "jurisprudencia":
      return "Jurisprudencia";
    case "doctrina":
      return "Doctrina académica";
    case "dictamenes":
      return "Dictámenes / administración";
    case "todas":
      return "Búsqueda unificada";
    default:
      return source;
  }
}
