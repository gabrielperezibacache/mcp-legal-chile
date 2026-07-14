import { resolveHotNorma } from "../catalog.js";
import type { SearchResponse } from "../types.js";
import { searchDictamenes } from "./dictamenes.js";
import { searchDoctrina } from "./doctrina.js";
import { searchJurisprudencia } from "./jurisprudencia.js";
import { searchLegislacion } from "./legislacion.js";
import {
  findArticulo,
  parseNormaTexto,
} from "./normaTexto.js";

function extractArticuloMention(query: string): string | undefined {
  const m = query.match(/art[ií]culo\s*([0-9]+(?:\s*bis)?)/i);
  return m?.[1]?.replace(/\s+/g, " ");
}

export async function investigarTema(
  consulta: string,
  limitePorFuente = 3,
): Promise<string> {
  const timeoutMs = Number(process.env.PACK_TIMEOUT_MS ?? 8000);
  const withTimeout = <T>(p: Promise<T>, label: string) =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout ${label} (${timeoutMs}ms)`)),
          timeoutMs,
        ),
      ),
    ]);

  const pending: string[] = [];
  const [leg, juris, doc, dict] = await Promise.allSettled([
    withTimeout(searchLegislacion(consulta, limitePorFuente), "legislacion"),
    withTimeout(
      searchJurisprudencia(consulta, limitePorFuente),
      "jurisprudencia",
    ),
    withTimeout(searchDoctrina(consulta, limitePorFuente), "doctrina"),
    withTimeout(searchDictamenes(consulta, limitePorFuente), "dictamenes"),
  ]);

  const sections: string[] = [
    `# Pack de investigación — ${consulta}`,
    "",
    "_Usa solo las fuentes listadas. No inventes fallos, dictámenes ni artículos._",
    "",
  ];

  // Marco normativo
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

  // Auto article fetch
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
