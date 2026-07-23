import type { CitationResult, EvidenceKind } from "./types.js";
import { integrityOf, type IntegrityKind } from "./integrity.js";

/** Split prose into markdown blockquote lines (sentence-aware). */
export function toBlockquote(text: string, maxSentences = 12): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "> _(sin extracto)_";
  const parts = cleaned.split(/(?<=\.)\s+/).filter(Boolean);
  return parts
    .slice(0, maxSentences)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function evidenceLabel(evidence?: EvidenceKind): string {
  switch (evidence) {
    case "full_text":
      return "texto íntegro verificado";
    case "metadata":
      return "metadata (no es texto oficial íntegro)";
    default:
      return "solo enlace (verificar en la URL)";
  }
}

export function integrityBadge(kind: IntegrityKind): string {
  switch (kind) {
    case "verified":
      return "`verified`";
    case "portal_stub":
      return "`portal_stub`";
    default:
      return "`candidate`";
  }
}

/** Concrete next tool suggestion based on what was returned. */
export function nextStepFor(result: CitationResult): string | undefined {
  const integrity = integrityOf(result);
  if (integrity === "portal_stub") {
    if (/tcchile|tribunal constitucional/i.test(result.url + result.title)) {
      return "Siguiente: `buscar_tc` o `obtener_fallo_tc` con el ROL (si lo tienes).";
    }
    if (/pjud|corte/i.test(result.url + result.title)) {
      return "Siguiente: abre el portal, copia el fallo y usa `citar_jurisprudencia` con `texto` + `rol`.";
    }
    return "Siguiente: verifica en la URL; no cites contenido desde este stub.";
  }

  if (result.source === "legislacion" && result.id) {
    return `Siguiente: \`citar_texto_legal\` / \`obtener_articulo\` con idNorma \`${result.id}\`.`;
  }
  if (result.source === "jurisprudencia") {
    if (
      result.tribunal === "Tribunal Constitucional" ||
      /tcchile/i.test(result.url)
    ) {
      return result.rol
        ? `Siguiente: \`obtener_fallo_tc\` o \`citar_jurisprudencia\` con rol \`${result.rol}\`.`
        : "Siguiente: `obtener_fallo_tc` / `citar_jurisprudencia` con el ROL de la ficha.";
    }
    if (result.evidence === "link_only") {
      return "Siguiente: verifica el PDF/portal; para citar, pega el texto en `citar_jurisprudencia`.";
    }
  }
  if (result.source === "dictamenes") {
    return "Siguiente: abre la URL CGR y confirma el texto íntegro antes de citar.";
  }
  if (result.source === "doctrina") {
    return "Siguiente: usa la cita Chile/APA arriba; contrastar norma con LeyChile (`citar_texto_legal`).";
  }
  return undefined;
}

export function nextStepsForSearch(opts: {
  source: string;
  realCount: number;
  stubCount: number;
  empty: boolean;
}): string[] {
  if (opts.empty) {
    return [
      "Reformula con ROL, idNorma, número de dictamen o términos más precisos.",
      "Para normas conocidas: `citar_texto_legal` con idNorma + artículo.",
      "Para TC: `buscar_tc` / `resolver_rol`. Para PJUD: portal + `citar_jurisprudencia` con texto pegado.",
    ];
  }
  const steps: string[] = [];
  if (opts.realCount > 0) {
    if (opts.source === "legislacion" || opts.source === "todas") {
      steps.push(
        "Texto oficial: `citar_texto_legal` o `obtener_articulo` con el idNorma listado.",
      );
    }
    if (opts.source === "jurisprudencia" || opts.source === "todas") {
      steps.push(
        "TC con extracto: `obtener_fallo_tc` / `citar_jurisprudencia`. PJUD: pegar texto del fallo.",
      );
    }
    if (opts.source === "doctrina") {
      steps.push(
        "Doctrina no vinculante: cita el DOI/URL listado; norma aplicable vía LeyChile.",
      );
    }
    if (opts.source === "dictamenes") {
      steps.push(
        "Confirma el dictamen en el portal CGR; no afirmes el contenido desde el título.",
      );
    }
  }
  if (opts.stubCount > 0) {
    steps.push(
      "Los `portal_stub` solo indican dónde buscar; no son documentos recuperados.",
    );
  }
  return steps;
}

/** Ready-to-paste citation callout. */
export function citationReadyBlock(citation: string): string {
  return ["**Cita lista para pegar:**", "", `> ${citation}`].join("\n");
}
