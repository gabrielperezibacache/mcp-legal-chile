import { resolveHotNorma } from "../catalog.js";
import { runWithDeadline } from "../deadline.js";
import type { SearchResponse } from "../types.js";
import { normalizeRol } from "../parsers.js";
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

function extractRolMention(query: string): string | undefined {
  const m = query.match(
    /\b(?:rol|rol\s*n[ºo°.]?)\s*[:.]?\s*([0-9]{1,6}\s*[-–.\/]\s*[0-9]{2,4}(?:\s*[-–]\s*[A-Z]{2,4})?)\b/i,
  );
  return m?.[1]?.replace(/\s+/g, "");
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

export async function investigarTema(
  consulta: string,
  limitePorFuente = 3,
): Promise<string> {
  const timeoutMs = Number(process.env.PACK_TIMEOUT_MS ?? 8000);
  const pending: string[] = [];
  const rolMention = extractRolMention(consulta);
  const tcMention = isTcMention(consulta);

  const [leg, juris, doc, dict, rolRes] = await Promise.allSettled([
    runWithDeadline("legislacion", timeoutMs, (signal) =>
      searchLegislacion(consulta, limitePorFuente, { signal }),
    ),
    runWithDeadline("jurisprudencia", timeoutMs, (signal) =>
      searchJurisprudencia(consulta, limitePorFuente, { signal }),
    ),
    runWithDeadline("doctrina", timeoutMs, (signal) =>
      searchDoctrina(consulta, limitePorFuente, { signal }),
    ),
    runWithDeadline("dictamenes", timeoutMs, (signal) =>
      searchDictamenes(consulta, limitePorFuente, { signal }),
    ),
    rolMention
      ? runWithDeadline("resolver_rol", timeoutMs, (signal) =>
          resolverRol({
            rol: rolMention,
            tribunal: tcMention ? "Tribunal Constitucional" : undefined,
            limite: limitePorFuente,
            signal,
          }),
        )
      : Promise.resolve(undefined),
  ]);

  const rolResolved =
    rolRes.status === "fulfilled" ? rolRes.value : undefined;
  let falloTc: Awaited<ReturnType<typeof obtenerFalloTc>> | undefined;
  if (rolRes.status === "rejected") pending.push("resolver_rol");
  if (rolMention && shouldFetchTcFallo(consulta, rolResolved)) {
    try {
      falloTc = await runWithDeadline("obtener_fallo_tc", timeoutMs, (signal) =>
        obtenerFalloTc(rolMention, signal),
      );
    } catch {
      pending.push("obtener_fallo_tc");
    }
  }

  const sections: string[] = [
    `# Pack de investigación — ${consulta}`,
    "",
    "_Usa solo las fuentes listadas. No inventes fallos, dictámenes ni artículos._",
    "",
  ];

  sections.push("## 1. Marco normativo");
  if (leg.status === "fulfilled" && leg.value.results.length) {
    for (const r of leg.value.results) {
      sections.push(
        `- **${r.title}** — ${r.citation} — ${r.url}${r.id ? ` (idNorma ${r.id})` : ""}`,
      );
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
  if (idNorma && articulo) {
    sections.push("", "## 1.b Texto legal citado (oficial LeyChile)");
    try {
      const norma = await parseNormaTexto(String(idNorma));
      const art = findArticulo(norma, articulo);
      if (art) {
        sections.push(
          `**${norma.tipo ?? "Norma"} ${norma.numero}, art. ${art.numero}** — ${norma.titulo}`,
          art.url,
          "",
          ...art.texto.split(/(?<=\.)\s+/).map((line) => `> ${line}`),
          "",
          `_Cita sugerida: ${norma.tipo ?? "Norma"} N° ${norma.numero}, art. ${art.numero}._`,
        );
      } else {
        sections.push(
          `No se encontró art. ${articulo}. Índice: ${norma.articulos
            .map((a) => a.numero)
            .slice(0, 20)
            .join(", ")}`,
        );
      }
    } catch (error) {
      sections.push(
        `No se pudo traer el XML (${error instanceof Error ? error.message : String(error)}).`,
        `URL: https://www.bcn.cl/leychile/navegar?idNorma=${idNorma}`,
      );
    }
  } else if (idNorma) {
    sections.push(
      "",
      `_Norma candidata idNorma=${idNorma}. Usa citar_texto_legal / obtener_articulo para el cuerpo._`,
    );
  }

  if (rolMention) {
    sections.push("", "## 1.c ROL detectado");
    if (rolResolved) {
      sections.push(`**ROL normalizado:** ${normalizeRol(rolMention).display}`);
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
        sections.push("", "### Extracto oficial TC", falloTc.markdown);
      }
      if (rolResolved.warnings.length) {
        sections.push(
          "",
          ...rolResolved.warnings.map((w) => `- _Advertencia ROL:_ ${w}`),
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
    if (!result.value.results.length) {
      sections.push("- Sin hallazgos.");
      return;
    }
    for (const r of result.value.results) {
      if (label === "doctrina") {
        sections.push(`- **${r.title}**`);
        sections.push(`  - Cita: ${r.citation}`);
        if (r.metadata?.citationApa) {
          sections.push(`  - APA: ${String(r.metadata.citationApa)}`);
        }
        sections.push(`  - URL: ${r.url}`);
        if (r.summary) {
          sections.push(`  - Extracto: ${String(r.summary).slice(0, 280)}…`);
        }
      } else {
        const ids = [
          r.rol ? `ROL ${r.rol}` : null,
          r.tribunal,
          r.evidence ? `evidencia=${r.evidence}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        sections.push(`- **${r.title}**${ids ? ` (${ids})` : ""} — ${r.url}`);
      }
    }
    if (result.value.warnings?.length) {
      sections.push(
        ...result.value.warnings.map((w) => `  - _Advertencia:_ ${w}`),
      );
    }
  };

  dumpSource("2. Jurisprudencia (verificar texto oficial)", juris, "jurisprudencia");
  dumpSource("3. Dictámenes (verificar texto oficial)", dict, "dictamenes");
  dumpSource("4. Doctrina académica (no vinculante)", doc, "doctrina");

  sections.push("", "## 5. Lagunas / verificación pendiente");
  if (pending.length) {
    sections.push(
      `- Fuentes incompletas por timeout/error: ${pending.join(", ")}`,
    );
  }
  sections.push(
    "- Confirma vigencia en LeyChile antes de asesorar.",
    "- No cites ratio decidendi desde títulos de links.",
    "- Este pack no constituye asesoría jurídica formal.",
  );

  return sections.join("\n");
}
