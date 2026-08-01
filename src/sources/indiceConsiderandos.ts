import { parseConsiderandos, rankConsiderandos } from "./considerandos.js";
import { inferMetaFromPastedText } from "./jurisQuote.js";
import { normalizeRol } from "../parsers.js";

export function indiceConsiderandos(opts: {
  texto: string;
  rol?: string;
  consulta?: string;
}): string {
  const pasted = opts.texto.trim();
  if (pasted.length < 80) {
    throw new Error(
      "El texto pegado es demasiado corto. Pega el fallo o al menos la sección de considerandos.",
    );
  }

  const items = parseConsiderandos(pasted);
  const inferred = inferMetaFromPastedText(pasted);
  const ranked = opts.consulta?.trim()
    ? rankConsiderandos(items, opts.consulta.trim())
    : items;

  const rolDisplay = opts.rol ? normalizeRol(opts.rol).display : undefined;
  const lines: string[] = [
    "# Índice de considerandos (texto pegado)",
    "",
    rolDisplay ? `- **ROL:** \`${rolDisplay}\`` : undefined,
    inferred.tribunal
      ? `- **Tribunal detectado:** ${inferred.tribunal}`
      : undefined,
    inferred.tipoResolucion
      ? `- **Tipo detectado:** ${inferred.tipoResolucion}`
      : undefined,
    inferred.anio ? `- **Año detectado:** ${inferred.anio}` : undefined,
    `- **Considerandos detectados:** ${items.length}`,
    "- **Integridad:** `verified` respecto del texto aportado (contrastar con PDF/portal oficial)",
    "",
  ].filter((x): x is string => Boolean(x));

  if (!items.length) {
    lines.push(
      "No se detectaron considerandos numerados.",
      "Puedes igual citar un extracto con `pegar_fallo_pjud` / `citar_jurisprudencia` sin parámetro `considerando`.",
    );
    return lines.join("\n");
  }

  if (opts.consulta?.trim()) {
    lines.push(`## Ranking por consulta («${opts.consulta.trim()}»)`, "");
    for (const c of ranked.slice(0, 15)) {
      const preview = c.texto.replace(/\s+/g, " ").slice(0, 160);
      lines.push(
        `- **${c.numero != null ? `${c.numero}º` : "?"}** (${c.citationLabel}): ${preview}${c.texto.length > 160 ? "…" : ""}`,
      );
    }
    lines.push("");
  }

  lines.push("## Índice completo", "");
  for (const c of items) {
    const preview = c.texto.replace(/\s+/g, " ").slice(0, 120);
    lines.push(
      `- \`${c.numero != null ? c.numero : "?"}\` — ${c.citationLabel}: ${preview}${c.texto.length > 120 ? "…" : ""}`,
    );
  }

  lines.push(
    "",
    "## Siguiente paso",
    "- Llama `pegar_fallo_pjud` con `considerando` (número o rótulo) o `consulta` temática.",
  );
  if (opts.consulta?.trim() && ranked[0]) {
    lines.push(
      `- Candidato sugerido: considerando \`${ranked[0].numero ?? ranked[0].citationLabel}\`.`,
    );
  }

  return lines.join("\n");
}
