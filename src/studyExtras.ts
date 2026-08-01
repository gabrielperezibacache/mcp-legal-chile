/**
 * Extra study-workflow helpers: citation appendix + movement diffs.
 */

export type CitaAnexoTipo =
  "norma" | "jurisprudencia" | "dictamen" | "doctrina";

export type CitaIntegrity = "verified" | "candidate" | "portal_stub";

export interface CitaAnexoItem {
  tipo: CitaAnexoTipo;
  citation: string;
  url: string;
  integrity: CitaIntegrity;
  extracto?: string;
  rol?: string;
  id_norma?: string;
  articulo?: string;
}

export function formatAnexoCitas(opts: {
  titulo?: string;
  citas: CitaAnexoItem[];
}): string {
  if (!opts.citas.length) {
    throw new Error(
      "Indica al menos una cita con citation, url e integrity. Solo incluye lo ya obtenido por tools.",
    );
  }

  const verified = opts.citas.filter((c) => c.integrity === "verified");
  const pending = opts.citas.filter((c) => c.integrity !== "verified");

  const lines: string[] = [
    `# ${opts.titulo?.trim() || "Anexo de citas"}`,
    "",
    `_Total: ${opts.citas.length} · verified: ${verified.length} · por verificar: ${pending.length}_`,
    "",
    "## Reglas",
    "- Usa este anexo solo con identificadores/URLs/extractos ya devueltos por tools o pegados por el usuario.",
    "- En el escrito: cita libremente lo `verified`; marca `[POR VERIFICAR]` lo demás.",
    "",
  ];

  const render = (items: CitaAnexoItem[], heading: string) => {
    lines.push(`## ${heading}`, "");
    if (!items.length) {
      lines.push("- _(vacío)_", "");
      return;
    }
    for (const [i, c] of items.entries()) {
      lines.push(`### ${i + 1}. [${c.tipo}] ${c.citation}`);
      lines.push(`- **Integridad:** \`${c.integrity}\``);
      lines.push(`- **URL:** ${c.url}`);
      if (c.rol) lines.push(`- **ROL:** \`${c.rol}\``);
      if (c.id_norma) lines.push(`- **idNorma:** \`${c.id_norma}\``);
      if (c.articulo) lines.push(`- **Artículo:** ${c.articulo}`);
      if (c.extracto?.trim()) {
        lines.push(
          "",
          ...c.extracto
            .trim()
            .split(/\n/)
            .map((l) => `> ${l}`),
        );
      }
      lines.push("");
    }
  };

  render(verified, "Citables (verified)");
  render(pending, "Por verificar (candidate / portal_stub)");

  lines.push(
    "## Cómo seguir",
    "- Para bajar a texto: `citar_texto_legal` / `pegar_fallo_pjud` / `citar_dictamen_pegado`.",
    "- Para el cuerpo del escrito: `plantilla_escrito` + relleno con este anexo.",
  );

  return lines.join("\n");
}

function normalizeMovLine(line: string): string {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseMovLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

export function compararActuaciones(opts: {
  anteriores: string;
  actuales: string;
  rol_o_rit?: string;
  caratulado?: string;
}): string {
  const prev = parseMovLines(opts.anteriores);
  const next = parseMovLines(opts.actuales);
  if (!prev.length && !next.length) {
    throw new Error(
      "Pega al menos una lista de actuaciones (una por línea) en anteriores y/o actuales.",
    );
  }

  const prevKeys = new Set(prev.map(normalizeMovLine));
  const nextKeys = new Set(next.map(normalizeMovLine));
  const added = next.filter((l) => !prevKeys.has(normalizeMovLine(l)));
  const removed = prev.filter((l) => !nextKeys.has(normalizeMovLine(l)));
  const same = next.filter((l) => prevKeys.has(normalizeMovLine(l)));

  const lines: string[] = [
    "# Comparación de actuaciones",
    "",
    opts.caratulado ? `**Caratulado:** ${opts.caratulado}` : undefined,
    opts.rol_o_rit ? `**ROL/RIT:** \`${opts.rol_o_rit}\`` : undefined,
    "- **Integridad:** `candidate` — contraste siempre en Oficina Judicial Virtual / portal oficial.",
    "",
    `## Nuevas (${added.length})`,
    ...(added.length ? added.map((l) => `- ${l}`) : ["- _(ninguna)_"]),
    "",
    `## Ya no aparecen (${removed.length})`,
    ...(removed.length ? removed.map((l) => `- ${l}`) : ["- _(ninguna)_"]),
    "",
    `## Sin cambio aparente (${same.length})`,
    ...(same.length
      ? same.slice(0, 12).map((l) => `- ${l}`)
      : ["- _(ninguna)_"]),
    same.length > 12 ? `- _…y ${same.length - 12} más_` : undefined,
    "",
    "## Siguiente paso",
    "- Redacta aviso con `borrador_mensaje_cliente` / `minuta_cliente` (actualizacion_causa), usando sobre todo las **Nuevas**.",
    "- No afirmes efectos jurídicos que no consten en las actuaciones listadas.",
  ].filter((x): x is string => Boolean(x));

  return lines.join("\n");
}

/** Build contexto block for minuta_cliente from structured causa fields. */
export function contextoDesdeCausa(opts: {
  tribunal?: string;
  rol_o_rit?: string;
  caratulado?: string;
  estado?: string;
  litigantes?: string[];
  ultima_actuacion?: string;
  movimientos?: string;
  url?: string;
  notas?: string;
}): string {
  const movs = opts.movimientos?.trim()
    ? parseMovLines(opts.movimientos).map((m) => `- ${m}`)
    : [];
  const parts = [
    opts.caratulado ? `Caratulado: ${opts.caratulado}` : undefined,
    opts.rol_o_rit ? `ROL/RIT: ${opts.rol_o_rit}` : undefined,
    opts.tribunal ? `Tribunal: ${opts.tribunal}` : undefined,
    opts.estado ? `Estado: ${opts.estado}` : undefined,
    opts.litigantes?.length
      ? `Litigantes: ${opts.litigantes.join("; ")}`
      : undefined,
    opts.ultima_actuacion
      ? `Última actuación: ${opts.ultima_actuacion}`
      : undefined,
    opts.url ? `URL portal: ${opts.url}` : undefined,
    movs.length ? ["Movimientos:", ...movs].join("\n") : undefined,
    opts.notas?.trim() ? `Notas del abogado: ${opts.notas.trim()}` : undefined,
    "Integrity: candidate (datos de seguimiento / aportados; verificar en OJV).",
  ].filter((x): x is string => Boolean(x));

  if (parts.length <= 1) {
    throw new Error(
      "Indica al menos caratulado, ROL/RIT, estado o movimientos para armar el contexto.",
    );
  }
  return parts.join("\n");
}
