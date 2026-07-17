import { resolveHotNorma } from "../catalog.js";
import {
  remainingMs,
  runWithDeadline,
} from "../deadline.js";
import {
  assistantIntegrityBlock,
  integrityOf,
  sealSearchResponse,
} from "../integrity.js";
import { nextStepFor, toBlockquote } from "../present.js";
import type { SearchResponse } from "../types.js";
import { extractRolMention, normalizeRol } from "../parsers.js";
import { searchDictamenes } from "./dictamenes.js";
import { searchDoctrina } from "./doctrina.js";
import {
  obtenerFalloTc,
  resolverRol,
  searchJurisprudencia,
  type ResolveRolResult,
} from "./jurisprudencia.js";
import { searchLegislacion } from "./legislacion.js";
import {
  findArticulo,
  parseNormaTexto,
} from "./normaTexto.js";

function extractArticuloMention(query: string): string | undefined {
  const m = query.match(/art[ií]culo\s*([0-9]+(?:\s*bis)?)/i);
  return m?.[1]?.replace(/\s+/g, " ");
}

function isTcMention(query: string): boolean {
  return /\b(?:tc|tribunal constitucional|ina|inc|cpt|caa|cds)\b/i.test(query);
}

function shouldFetchTcFallo(
  query: string,
  resolved?: ResolveRolResult,
): boolean {
  if (isTcMention(query)) return true;
  return Boolean(
    resolved?.results.some((r) => r.tribunal === "Tribunal Constitucional"),
  );
}

function truncateArticleQuote(texto: string, maxChars: number): string {
  const clean = texto.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…`;
}

function capMarkdown(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n_…respuesta truncada para no saturar el contexto. Usa obtener_articulo / citar_texto_legal / obtener_fallo_tc para detalle._`;
}

/**
 * Pack orquestado con presupuesto global duro.
 * Diseño: responder siempre antes de PACK_TOTAL_MS con resultados parciales OK.
 * Evita el fallo típico de clientes MCP (~60s) por fases secuenciales sin tope.
 */
export async function investigarTema(
  consulta: string,
  limitePorFuente = 3,
): Promise<string> {
  const startedAt = Date.now();
  const totalMs = Number(process.env.PACK_TOTAL_MS ?? 12_000);
  const perSourceMs = Number(
    process.env.PACK_TIMEOUT_MS ?? Math.min(6_000, Math.floor(totalMs * 0.55)),
  );
  const maxChars = Number(process.env.PACK_MAX_CHARS ?? 10_000);
  const articleQuoteChars = Number(process.env.PACK_ARTICLE_CHARS ?? 1_200);
  const pending: string[] = [];
  const rolMention = extractRolMention(consulta);
  const tcMention = isTcMention(consulta);
  const packController = new AbortController();
  const packTimer = setTimeout(() => packController.abort(), totalMs);

  try {
    const [leg, juris, doc, dict, rolRes] = await Promise.allSettled([
      runWithDeadline(
        "legislacion",
        perSourceMs,
        (signal) =>
          searchLegislacion(consulta, limitePorFuente, { signal }),
        packController.signal,
      ),
      runWithDeadline(
        "jurisprudencia",
        perSourceMs,
        (signal) =>
          searchJurisprudencia(consulta, limitePorFuente, { signal }),
        packController.signal,
      ),
      runWithDeadline(
        "doctrina",
        perSourceMs,
        (signal) =>
          searchDoctrina(consulta, limitePorFuente, {
            signal,
            fast: true,
          }),
        packController.signal,
      ),
      runWithDeadline(
        "dictamenes",
        perSourceMs,
        (signal) =>
          searchDictamenes(consulta, limitePorFuente, { signal }),
        packController.signal,
      ),
      rolMention
        ? runWithDeadline(
            "resolver_rol",
            perSourceMs,
            (signal) =>
              resolverRol({
                rol: rolMention,
                tribunal: tcMention ? "Tribunal Constitucional" : undefined,
                limite: limitePorFuente,
                signal,
              }),
            packController.signal,
          )
        : Promise.resolve(undefined),
    ]);

    const rolResolved =
      rolRes.status === "fulfilled" ? rolRes.value : undefined;
    let falloTc: Awaited<ReturnType<typeof obtenerFalloTc>> | undefined;
    if (rolRes.status === "rejected") pending.push("resolver_rol");

    const leftForTc = remainingMs(startedAt, totalMs);
    if (
      rolMention &&
      shouldFetchTcFallo(consulta, rolResolved) &&
      leftForTc >= 2_000
    ) {
      try {
        falloTc = await runWithDeadline(
          "obtener_fallo_tc",
          Math.min(4_000, leftForTc - 200),
          (signal) => obtenerFalloTc(rolMention, signal),
          packController.signal,
        );
      } catch {
        pending.push("obtener_fallo_tc");
      }
    } else if (
      rolMention &&
      shouldFetchTcFallo(consulta, rolResolved)
    ) {
      pending.push("obtener_fallo_tc (presupuesto agotado)");
    }

    const sections: string[] = [
      `# Pack de investigación`,
      "",
      `**Consulta:** ${consulta}`,
      "",
      `_Presupuesto ${totalMs}ms · resultados parciales OK. Usa solo lo listado. Prohibido inventar fallos, dictámenes, artículos o considerandos._`,
      "",
    ];

    sections.push("## 1. Marco normativo");
    if (leg.status === "fulfilled" && leg.value.results.length) {
      for (const r of leg.value.results) {
        sections.push(`- **${r.title}**`);
        sections.push(`  - Cita: ${r.citation}`);
        if (r.id) sections.push(`  - idNorma: \`${r.id}\``);
        sections.push(`  - URL: ${r.url}`);
        if (r.id) {
          sections.push(
            `  - → \`citar_texto_legal\` / \`obtener_articulo\` con idNorma \`${r.id}\``,
          );
        }
      }
    } else {
      pending.push("legislacion");
      sections.push("- Sin resultados de legislación en el tiempo disponible.");
    }

    const articulo = extractArticuloMention(consulta);
    const hot = resolveHotNorma(consulta);
    const idFromLeg =
      leg.status === "fulfilled"
        ? leg.value.results.find((r) => r.id)?.id
        : undefined;
    const idNorma = hot?.idNorma ?? idFromLeg;
    const leftForXml = remainingMs(startedAt, totalMs);
    if (idNorma && articulo && leftForXml >= 1_500) {
      sections.push("", "## 1.b Texto legal citado (oficial LeyChile)");
      try {
        const norma = await runWithDeadline(
          "xml_articulo",
          Math.min(4_000, leftForXml - 200),
          (signal) =>
            parseNormaTexto(String(idNorma), {
              signal,
              timeoutMs: 8_000,
              retries: 1,
            }),
          packController.signal,
        );
        const art = findArticulo(norma, articulo);
        if (art) {
          const quote = truncateArticleQuote(art.texto, articleQuoteChars);
          const artLines = [
            `**${norma.tipo ?? "Norma"} ${norma.numero}, art. ${art.numero}** — ${norma.titulo}`,
            art.url,
            "",
            ...quote.split(/(?<=\.)\s+/).map((line) => `> ${line}`),
            "",
            `_Cita sugerida: ${norma.tipo ?? "Norma"} N° ${norma.numero}, art. ${art.numero}._`,
          ];
          if (art.texto.length > articleQuoteChars) {
            artLines.push(
              `_Extracto truncado (${articleQuoteChars} chars). Usa citar_texto_legal / obtener_articulo para el íntegro._`,
            );
          }
          sections.push(...artLines);
        } else {
          sections.push(
            `No se encontró art. ${articulo}. Índice: ${norma.articulos
              .map((a) => a.numero)
              .slice(0, 20)
              .join(", ")}`,
          );
        }
      } catch (error) {
        pending.push("xml_articulo");
        sections.push(
          `No se pudo traer el XML (${error instanceof Error ? error.message : String(error)}).`,
          `URL: https://www.bcn.cl/leychile/navegar?idNorma=${idNorma}`,
        );
      }
    } else if (idNorma && articulo) {
      pending.push("xml_articulo (presupuesto agotado)");
      sections.push(
        "",
        `_Hay idNorma=${idNorma} art. ${articulo}, pero el presupuesto del pack se agotó. Usa citar_texto_legal._`,
      );
    } else if (idNorma) {
      sections.push(
        "",
        `_Norma candidata idNorma=${idNorma}. Usa citar_texto_legal / obtener_articulo para el cuerpo._`,
      );
    }

    if (rolMention) {
      sections.push("", "## 1.c ROL detectado");
      if (rolResolved) {
        sections.push(
          `**ROL normalizado:** ${normalizeRol(rolMention).display}`,
        );
        sections.push(`**Cita sugerida:** ${rolResolved.citation}`);
        const tcResults = rolResolved.results.filter(
          (r) => r.tribunal === "Tribunal Constitucional",
        );
        const otherResults = rolResolved.results.filter(
          (r) => r.tribunal !== "Tribunal Constitucional",
        );
        if (tcResults.length) {
          sections.push("", "**Candidatos TC:**");
          for (const r of tcResults.slice(0, limitePorFuente)) {
            sections.push(
              `- ${r.citation} — ${r.url}${r.secondaryUrl ? ` (PDF: ${r.secondaryUrl})` : ""}`,
            );
          }
        }
        if (otherResults.length) {
          sections.push("", "**Candidatos PJUD / otros portales:**");
          for (const r of otherResults.slice(0, limitePorFuente)) {
            sections.push(`- ${r.title} — ${r.url}`);
          }
        }
        if (falloTc) {
          const shortExcerpt = truncateArticleQuote(falloTc.excerpt, 900);
          sections.push(
            "",
            "### Extracto oficial TC",
            "",
            "**Cita lista para pegar:**",
            "",
            `> ${falloTc.citation}`,
            "",
            falloTc.url,
            "",
            toBlockquote(shortExcerpt, 6),
            "",
            "→ Más detalle / PDF: `obtener_fallo_tc`. Cita por considerando: `citar_jurisprudencia`.",
          );
        }
        if (rolResolved.warnings.length) {
          sections.push(
            "",
            ...rolResolved.warnings
              .slice(0, 3)
              .map((w) => `- _Advertencia ROL:_ ${w}`),
          );
        }
      } else {
        sections.push("- No se pudo resolver el ROL en el tiempo disponible.");
      }
    }

    const dumpSource = (
      title: string,
      result: PromiseSettledResult<SearchResponse>,
      label: string,
    ) => {
      sections.push("", `## ${title}`);
      if (result.status !== "fulfilled") {
        pending.push(label);
        sections.push(`- Fuente incompleta: ${String(result.reason)}`);
        return;
      }
      const sealed = sealSearchResponse(result.value);
      if (!sealed.results.length) {
        sections.push(
          "- Sin hallazgos verificables. No inventes fuentes para esta sección.",
        );
        return;
      }
      for (const r of sealed.results.slice(0, limitePorFuente)) {
        const integrity = integrityOf(r);
        sections.push(`- **${r.title}**`);
        sections.push(`  - Cita: ${r.citation}`);
        const meta = [
          r.rol ? `ROL \`${r.rol}\`` : null,
          r.tribunal,
          `integridad=\`${integrity}\``,
          r.evidence ? `evidencia=${r.evidence}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        if (meta) sections.push(`  - ${meta}`);
        sections.push(`  - URL: ${r.url}`);
        if (label === "doctrina" && r.summary) {
          sections.push(
            `  - Abstract: ${String(r.summary).replace(/\s+/g, " ").slice(0, 200)}…`,
          );
        }
        const next = nextStepFor(r);
        if (next) sections.push(`  - → ${next.replace(/^Siguiente:\s*/i, "")}`);
      }
      if (sealed.warnings?.length) {
        sections.push(
          ...sealed.warnings
            .slice(0, 3)
            .map((w) => `  - _Advertencia:_ ${w}`),
        );
      }
    };

    dumpSource(
      "2. Jurisprudencia (verificar texto oficial)",
      juris,
      "jurisprudencia",
    );
    dumpSource("3. Dictámenes (verificar texto oficial)", dict, "dictamenes");
    dumpSource("4. Doctrina académica (no vinculante)", doc, "doctrina");

    const elapsed = Date.now() - startedAt;
    sections.push("", "## 5. Lagunas / verificación pendiente");
    if (pending.length) {
      sections.push(
        `- Fuentes incompletas por timeout/error: ${pending.join(", ")}`,
      );
    }
    sections.push(
      `- Tiempo pack: ${elapsed}ms (tope ${totalMs}ms).`,
      "- Confirma vigencia en LeyChile antes de asesorar.",
      "- No cites ratio decidendi desde títulos de links (evidence=link_only / portal_stub).",
      "- Fallos PJUD: pega el texto en `citar_jurisprudencia` (sin API abierta del Poder Judicial).",
      "- Doctrina: metadata OA (no vinculante); preferir LeyChile para normas.",
      "- Si una sección dice «Sin hallazgos», no completes con memoria ni fuentes no listadas.",
      "- Este pack no constituye asesoría jurídica formal.",
      "",
      assistantIntegrityBlock(),
    );

    return capMarkdown(sections.join("\n"), maxChars);
  } finally {
    clearTimeout(packTimer);
  }
}
