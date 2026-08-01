import { HOT_NORMAS, resolveHotNorma } from "./catalog.js";

export function resolverNormaFrecuente(consulta: string): string {
  const q = consulta.trim();
  if (q.length < 2) {
    throw new Error(
      "Indica un alias o nombre de norma (ej. Código del Trabajo, CPR, 19.880).",
    );
  }

  const hit = resolveHotNorma(q);
  const lines = ["# Norma frecuente", "", `**Consulta:** ${q}`, ""];

  if (!hit) {
    lines.push(
      "No hay alias en el catálogo local para esta consulta.",
      "",
      "## Qué hacer",
      "- `buscar_legislacion` con la misma consulta.",
      "- O revisa aliases con `listar_normas_frecuentes`.",
      "",
      "## Aliases de ejemplo",
      ...HOT_NORMAS.slice(0, 6).map(
        (n) => `- ${n.label}: ${n.aliases.slice(0, 4).join(", ")}`,
      ),
    );
    return lines.join("\n");
  }

  const url = `https://www.bcn.cl/leychile/navegar?idNorma=${hit.idNorma}`;
  lines.push(
    `**Norma:** ${hit.label}`,
    `- **idNorma:** \`${hit.idNorma}\``,
    `- **URL:** ${url}`,
    `- **Aliases:** ${hit.aliases.join(", ")}`,
    `- **Integridad de este atajo:** \`candidate\` (catálogo local; el texto se verifica con LeyChile XML)`,
    "",
    "## Siguiente paso",
    `- \`obtener_articulo\` / \`citar_texto_legal\` con id_norma=\`${hit.idNorma}\``,
    `- O \`lista_prueba_normativa\` sobre el mismo tema`,
    "",
    "_Este resultado no descarga el XML; no cites artículos hasta obtenerlos._",
  );
  return lines.join("\n");
}

export function listarNormasFrecuentes(): string {
  const lines = [
    "# Catálogo de normas frecuentes (hot)",
    "",
    `_Total: ${HOT_NORMAS.length}. Atajos locales → luego LeyChile XML._`,
    "",
  ];
  for (const n of HOT_NORMAS) {
    lines.push(
      `## ${n.label}`,
      `- idNorma \`${n.idNorma}\``,
      `- URL: https://www.bcn.cl/leychile/navegar?idNorma=${n.idNorma}`,
      `- Aliases: ${n.aliases.join(", ")}`,
      "",
    );
  }
  lines.push(
    "## Uso",
    "- `resolver_norma_frecuente` con un alias.",
    "- Texto oficial: `obtener_articulo` / `citar_texto_legal`.",
  );
  return lines.join("\n");
}
