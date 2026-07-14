import type { CitationResult, SearchResponse } from "./types.js";

export function formatCitationMarkdown(result: CitationResult): string {
  const lines = [
    `### ${result.title}`,
    `- **Fuente:** ${labelForSource(result.source)}`,
    `- **Cita:** ${result.citation}`,
  ];
  if (result.date) lines.push(`- **Fecha:** ${result.date}`);
  if (result.publisher) lines.push(`- **Publicado por:** ${result.publisher}`);
  if (result.id) lines.push(`- **Identificador:** ${result.id}`);
  lines.push(`- **URL oficial:** ${result.url}`);
  if (result.secondaryUrl) lines.push(`- **URL secundaria:** ${result.secondaryUrl}`);
  if (result.summary) {
    lines.push("", "**Extracto:**", "", result.summary.trim());
  }
  return lines.join("\n");
}

export function formatSearchMarkdown(response: SearchResponse): string {
  const header = [
    `## Resultados — ${labelForSource(response.source)}`,
    `Consulta: _${response.query}_`,
    `Hallazgos: **${response.results.length}**`,
    "",
  ];

  if (response.results.length === 0) {
    header.push("_Sin resultados. No inventes fuentes: indica que no hubo coincidencias._", "");
  } else {
    for (const [i, result] of response.results.entries()) {
      header.push(`#### ${i + 1}.`, formatCitationMarkdown(result), "");
    }
  }

  if (response.warnings?.length) {
    header.push("### Advertencias", ...response.warnings.map((w) => `- ${w}`), "");
  }

  if (response.searchUrls && Object.keys(response.searchUrls).length) {
    header.push("### Buscadores oficiales");
    for (const [name, url] of Object.entries(response.searchUrls)) {
      header.push(`- ${name}: ${url}`);
    }
    header.push("");
  }

  header.push(
    "### Instrucciones para el asistente",
    "- Cita solo lo anterior; no inventes fallos, dictámenes ni normas.",
    "- Incluye siempre la URL oficial al mencionar una fuente.",
    "- Indica si la información es metadata, extracto o texto íntegro de la norma.",
  );

  return header.join("\n");
}

function labelForSource(source: SearchResponse["source"] | CitationResult["source"]): string {
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
