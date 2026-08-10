import { searchDictamenes } from "./dictamenes.js";
import { searchDictamenesDt } from "./dictamenesDt.js";
import { findArticulo, parseNormaTexto } from "./normaTexto.js";
import { getNorma, searchLegislacion } from "./legislacion.js";
import { getCachedFallo } from "./falloImport.js";
import {
  extractRolMention,
  normalizeRol,
  parseCaseIdentifiers,
} from "../parsers.js";
import { resolveHotNorma } from "../catalog.js";

export type VerifyIntegrity =
  | "verified"
  | "candidate"
  | "portal_stub"
  | "not_found";

export interface VerificarCitaResult {
  input: string;
  kind: "articulo" | "rol" | "dictamen" | "norma" | "unknown";
  integrity: VerifyIntegrity;
  summary: string;
  url?: string;
  idNorma?: string;
  articulo?: string;
  rol?: string;
  dictamen?: string;
  nextStep?: string;
  warnings: string[];
  markdown: string;
}

function extractArticuloRef(text: string): {
  articulo?: string;
  normaHint?: string;
} {
  const art = text.match(
    /\bart(?:[ií]culo)?\.?\s*([0-9]+(?:\s*(?:bis|ter|quater|quáter))?)/i,
  );
  const articulo = art?.[1]?.replace(/\s+/g, " ").trim();
  const after = text
    .replace(
      /\bart(?:[ií]culo)?\.?\s*[0-9]+(?:\s*(?:bis|ter|quater|quáter))?/i,
      " ",
    )
    .trim();
  const de = after.match(
    /\b(?:del?|de\s+la|de\s+los?)\s+(.+)$/i,
  )?.[1]?.trim();
  const hot = resolveHotNorma(de || after || text);
  return {
    articulo,
    normaHint: hot?.label ?? de,
  };
}

function extractDictamenNumber(text: string): string | undefined {
  return (
    parseCaseIdentifiers(text).dictamen ??
    text.match(
      /(?:dictamen(?:es)?|n[ºo°.]?)\s*([0-9]{1,6}(?:\s*[-/]\s*[0-9]{2,4})?)/i,
    )?.[1]?.replace(/\s+/g, "")
  );
}

/**
 * Resolve a free-form citation hint and report what the MCP can verify.
 */
export async function verificarCita(
  cita: string,
  opts: { signal?: AbortSignal } = {},
): Promise<VerificarCitaResult> {
  const input = cita.trim();
  const warnings: string[] = [];
  if (input.length < 3) {
    return build({
      input,
      kind: "unknown",
      integrity: "not_found",
      summary: "Cita demasiado corta.",
      warnings: ["Indica artículo+norma, ROL o número de dictamen."],
    });
  }

  const dictamen = extractDictamenNumber(input);
  if (
    dictamen &&
    /(?:dictamen|ord(?:enanza)?\.?)/i.test(input)
  ) {
    const isDt =
      /\b(?:dt|trabajo|dirtrab|ordenanza|ord\.?)\b/i.test(input) &&
      !/\b(?:cgr|contralor[ií]a)\b/i.test(input);
    const res = isDt
      ? await searchDictamenesDt(`ord ${dictamen}`, 3, { signal: opts.signal })
      : await searchDictamenes(`dictamen ${dictamen}`, 3, {
          signal: opts.signal,
        });
    const hit = res.results[0];
    const verified = hit?.evidence === "full_text";
    const agency = isDt ? "DT" : "CGR";
    return build({
      input,
      kind: "dictamen",
      integrity: verified
        ? "verified"
        : hit
          ? "candidate"
          : "not_found",
      summary: verified
        ? `${agency} N° ${dictamen} con extracto recuperado.`
        : hit
          ? `${agency} N° ${dictamen}: solo enlace/candidato (confirma en portal).`
          : `No se encontró candidato para ${agency} N° ${dictamen}.`,
      url: hit?.url,
      dictamen,
      nextStep: verified
        ? `Puedes citar el extracto; verifica el texto íntegro en ${agency}.`
        : isDt
          ? "Abre dt.gob.cl o usa resolver_dictamen_dt con el número."
          : "Abre el portal CGR o usa resolver_dictamen con el número.",
      warnings: res.warnings ?? [],
    });
  }

  const rolMention =
    extractRolMention(input) ||
    (/\b[0-9]{1,6}\s*[-–./]\s*[0-9]{2,4}\b/.test(input)
      ? input.match(/[0-9]{1,6}\s*[-–./]\s*[0-9]{2,4}/)?.[0]
      : undefined);
  if (rolMention) {
    const norm = normalizeRol(rolMention);
    const cached = getCachedFallo(norm.display);
    if (cached) {
      return build({
        input,
        kind: "rol",
        integrity: "verified",
        summary: `ROL ${norm.display} está en cache de importar_fallo (${cached.considerandos.length} considerandos indexados).`,
        url: cached.url,
        rol: norm.display,
        nextStep: `Usa citar_jurisprudencia con rol ${norm.display} (sin volver a pegar texto).`,
        warnings,
      });
    }
    return build({
      input,
      kind: "rol",
      integrity: "candidate",
      summary: `ROL ${norm.display} detectado; texto no verificado aquí. TC: obtener_fallo_tc / citar_jurisprudencia. PJUD: importar_fallo o pegar texto.`,
      url: norm.likelyTc
        ? `https://buscador.tcchile.cl/#/?q=${encodeURIComponent(norm.display)}`
        : "https://www.pjud.cl/portal-unificado-sentencias",
      rol: norm.display,
      nextStep: norm.likelyTc
        ? `obtener_fallo_tc o citar_jurisprudencia con rol ${norm.display}`
        : `importar_fallo con rol ${norm.display} y texto/URL, luego citar_jurisprudencia`,
      warnings,
    });
  }

  const { articulo, normaHint } = extractArticuloRef(input);
  const hot =
    resolveHotNorma(input) ||
    (normaHint ? resolveHotNorma(normaHint) : undefined);

  if (articulo && (hot || normaHint)) {
    let idNorma = hot?.idNorma;
    if (!idNorma) {
      const search = await searchLegislacion(normaHint || input, 3, {
        signal: opts.signal,
      });
      idNorma = search.results[0]?.id ?? search.results[0]?.metadata?.leychileCode as
        | string
        | undefined;
      if (!idNorma) {
        return build({
          input,
          kind: "articulo",
          integrity: "not_found",
          summary: `No se resolvió la norma para citar artículo ${articulo}.`,
          articulo,
          nextStep: "Prueba con número de ley o alias (ej. Código del Trabajo).",
          warnings: search.warnings ?? [],
        });
      }
    }
    try {
      const norma = await parseNormaTexto(idNorma);
      const art = findArticulo(norma, articulo);
      if (!art) {
        return build({
          input,
          kind: "articulo",
          integrity: "not_found",
          summary: `Artículo ${articulo} no encontrado en ${norma.titulo} (idNorma ${idNorma}).`,
          idNorma,
          articulo,
          url: norma.url,
          nextStep: "Usa obtener_texto_norma modo=indice para ver artículos detectados.",
          warnings,
        });
      }
      return build({
        input,
        kind: "articulo",
        integrity: "verified",
        summary: `Artículo ${art.numero} verificado en ${norma.titulo}.`,
        idNorma: norma.idNorma,
        articulo: art.numero,
        url: art.url,
        nextStep: `citar_texto_legal o obtener_articulo con id_norma=${norma.idNorma} articulo=${art.numero}`,
        warnings: warnings,
      });
    } catch (error) {
      return build({
        input,
        kind: "articulo",
        integrity: "candidate",
        summary: `No se pudo verificar el texto del artículo ${articulo} (idNorma ${idNorma}).`,
        idNorma,
        articulo,
        url: `https://www.bcn.cl/leychile/navegar?idNorma=${idNorma}`,
        nextStep: "Reintenta obtener_articulo más tarde o abre la URL oficial.",
        warnings: [
          ...warnings,
          error instanceof Error ? error.message : String(error),
        ],
      });
    }
  }

  if (hot) {
    try {
      const meta = await getNorma({ leychileCode: hot.idNorma });
      const hit = meta.results[0];
      return build({
        input,
        kind: "norma",
        integrity: "candidate",
        summary: `Norma frecuente resuelta: ${hot.label} (idNorma ${hot.idNorma}).`,
        idNorma: hot.idNorma,
        url: hit?.url ?? `https://www.bcn.cl/leychile/navegar?idNorma=${hot.idNorma}`,
        nextStep: `obtener_articulo / citar_texto_legal con id_norma=${hot.idNorma}`,
        warnings: meta.warnings ?? [],
      });
    } catch {
      return build({
        input,
        kind: "norma",
        integrity: "candidate",
        summary: `Alias hot: ${hot.label} (idNorma ${hot.idNorma}).`,
        idNorma: hot.idNorma,
        url: `https://www.bcn.cl/leychile/navegar?idNorma=${hot.idNorma}`,
        nextStep: `obtener_articulo con id_norma=${hot.idNorma}`,
        warnings,
      });
    }
  }

  const leg = await searchLegislacion(input, 3, { signal: opts.signal });
  if (leg.results[0]) {
    const hit = leg.results[0];
    return build({
      input,
      kind: "norma",
      integrity: "candidate",
      summary: `Candidato normativo: ${hit.title}`,
      idNorma: hit.id,
      url: hit.url,
      nextStep: hit.id
        ? `obtener_articulo / obtener_texto_norma con id_norma=${hit.id}`
        : "Confirma en la URL de LeyChile.",
      warnings: leg.warnings ?? [],
    });
  }

  return build({
    input,
    kind: "unknown",
    integrity: "not_found",
    summary: "No se pudo clasificar ni resolver la cita.",
    nextStep:
      "Prueba formatos: «art. 161 Código del Trabajo», «rol 12345-2020», «dictamen 12345».",
    warnings: leg.warnings ?? warnings,
  });
}

function build(
  partial: Omit<VerificarCitaResult, "markdown">,
): VerificarCitaResult {
  const markdown = [
    `## Verificación de cita`,
    "",
    `**Entrada:** ${partial.input}`,
    `- **Tipo:** \`${partial.kind}\``,
    `- **Integridad:** \`${partial.integrity}\``,
    `- **Resumen:** ${partial.summary}`,
    partial.idNorma ? `- **idNorma:** \`${partial.idNorma}\`` : null,
    partial.articulo ? `- **Artículo:** ${partial.articulo}` : null,
    partial.rol ? `- **ROL:** \`${partial.rol}\`` : null,
    partial.dictamen ? `- **Dictamen:** N° ${partial.dictamen}` : null,
    partial.url ? `- **URL:** ${partial.url}` : null,
    partial.nextStep ? `- **Siguiente paso:** ${partial.nextStep}` : null,
    "",
    partial.warnings.length
      ? ["### Advertencias", ...partial.warnings.map((w) => `- ${w}`)].join(
          "\n",
        )
      : null,
    "",
    "_Si integrity no es `verified`, no afirmes el contenido como texto oficial recuperado._",
  ]
    .filter((x) => x != null && x !== "")
    .join("\n");

  return { ...partial, markdown };
}
