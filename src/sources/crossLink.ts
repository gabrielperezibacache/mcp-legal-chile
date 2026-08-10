import { resolveHotNorma } from "../catalog.js";
import { sealSearchResponse } from "../integrity.js";
import { nextStepFor, toBlockquote } from "../present.js";
import type { SearchResponse } from "../types.js";
import { searchDoctrina, searchDoctrinaLatam } from "./doctrina.js";
import { getNorma, normasRelacionadas } from "./legislacion.js";
import { findArticulo, parseNormaTexto } from "./normaTexto.js";

export interface InvestigarNormaRelacionadaOpts {
  articulo?: string;
  limite?: number;
  incluirLatam?: boolean;
  paisLatam?: "PE" | "BR" | "AR" | "MX" | "CO";
  signal?: AbortSignal;
}

/**
 * Cross-link: metadata norma → normas_relacionadas BCN → doctrina OA por keywords.
 * Doctrina NUNCA se marca como citando el idNorma de forma estructurada (solo keyword match).
 */
export async function investigarNormaRelacionada(
  idNorma: string,
  opts: InvestigarNormaRelacionadaOpts = {},
): Promise<{ markdown: string; pack: Record<string, unknown> }> {
  const code = idNorma.replace(/\D/g, "");
  const limite = opts.limite ?? 4;
  const warnings: string[] = [
    "Doctrina vinculada por keywords (título/número/alias), no por grafo de citas estructurado. No afirmes que el artículo «cita» el idNorma salvo que el abstract lo diga.",
  ];

  const normaRes = await getNorma({ leychileCode: code });
  const normaHit = normaRes.results[0];
  const hot = resolveHotNorma(normaHit?.title ?? code);
  const title = normaHit?.title ?? hot?.label ?? `idNorma ${code}`;
  const number =
    (normaHit?.metadata?.leychileCode as string | undefined) ?? code;

  let articuloQuote: string | undefined;
  let articuloIntegrity: string | undefined;
  if (opts.articulo) {
    try {
      const parsed = await parseNormaTexto(code, { signal: opts.signal });
      const art = findArticulo(parsed, opts.articulo);
      if (art?.texto) {
        articuloQuote = art.texto.replace(/\s+/g, " ").trim().slice(0, 1_200);
        articuloIntegrity = "verified";
      } else {
        warnings.push(
          `Artículo ${opts.articulo} no encontrado en XML LeyChile; se omite blockquote.`,
        );
      }
    } catch (error) {
      warnings.push(
        `XML artículo: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const relacionadas = await normasRelacionadas(code);

  const doctrineQueryParts = [
    title.replace(/\s+/g, " ").slice(0, 80),
    hot?.label,
    opts.articulo ? `artículo ${opts.articulo}` : undefined,
    "Chile",
  ].filter(Boolean);
  const doctrineQuery = doctrineQueryParts.join(" ");

  let doctrinaCl: SearchResponse | undefined;
  try {
    doctrinaCl = sealSearchResponse(
      await searchDoctrina(doctrineQuery, limite, {
        signal: opts.signal,
        fast: true,
      }),
    );
  } catch (error) {
    warnings.push(
      `Doctrina CL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let doctrinaLatam: SearchResponse | undefined;
  if (opts.incluirLatam && opts.paisLatam) {
    try {
      doctrinaLatam = sealSearchResponse(
        await searchDoctrinaLatam(doctrineQuery, limite, opts.paisLatam),
      );
    } catch (error) {
      warnings.push(
        `Doctrina LATAM: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const sections: string[] = [
    `# Norma relacionada — investigación`,
    "",
    `**idNorma:** \`${code}\``,
    `**Título:** ${title}`,
    opts.articulo ? `**Artículo:** ${opts.articulo}` : null,
    "",
    `_Relaciones BCN = candidate. Doctrina = candidate/metadata (keyword). Texto de artículo = verified solo si XML OK._`,
    "",
  ].filter((x): x is string => x != null);

  if (articuloQuote) {
    sections.push(
      "## Artículo (XML LeyChile)",
      "",
      `Integrity: \`verified\``,
      "",
      toBlockquote(articuloQuote),
      "",
      `Fuente: https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
      "",
    );
  }

  sections.push("## Normas relacionadas (BCN)");
  if (relacionadas.results.length === 0) {
    sections.push(
      "",
      "_(Sin predicados estructurados en BCN.)_",
      ...(relacionadas.warnings ?? []).map((w) => `- ${w}`),
      "",
    );
  } else {
    sections.push("");
    for (const r of relacionadas.results.slice(0, 8)) {
      const step = nextStepFor(r);
      sections.push(`- **${r.title}** — ${r.citation}`, `  - ${r.url}`);
      if (step) sections.push(`  - ${step}`);
    }
    sections.push("");
  }

  sections.push("## Doctrina candidata (Chile OA)");
  if (!doctrinaCl?.results.length) {
    sections.push("", "_(Sin hits de doctrina.)_", "");
  } else {
    sections.push("");
    for (const r of doctrinaCl.results.slice(0, limite)) {
      sections.push(`- **${r.title}** — ${r.citation}`, `  - ${r.url}`);
      if (r.summary) sections.push(`  - ${r.summary.slice(0, 180)}…`);
    }
    sections.push("");
  }

  if (doctrinaLatam) {
    sections.push(`## Doctrina LATAM candidata (${opts.paisLatam})`);
    if (!doctrinaLatam.results.length) {
      sections.push("", "_(Sin hits LATAM.)_", "");
    } else {
      sections.push("");
      for (const r of doctrinaLatam.results.slice(0, limite)) {
        sections.push(`- **${r.title}** — ${r.citation}`, `  - ${r.url}`);
      }
      sections.push("");
    }
  }

  sections.push(
    "## Siguiente paso",
    "",
    `- Texto oficial: \`citar_texto_legal\` / \`obtener_articulo\` idNorma \`${code}\`${opts.articulo ? ` art. ${opts.articulo}` : ""}.`,
    "- Doctrina: `obtener_doctrina` con DOI/OpenAlex del hit; no es vinculante.",
    "- Relacionadas: `mapa_norma` / `buscar_reglamentos` si hay «regulada por».",
    "",
  );

  if (warnings.length) {
    sections.push("## Warnings", "", ...warnings.map((w) => `- ${w}`), "");
  }

  return {
    markdown: sections.filter((x) => x != null).join("\n"),
    pack: {
      idNorma: code,
      title,
      number,
      articulo: opts.articulo,
      articuloIntegrity,
      relacionadasCount: relacionadas.results.length,
      doctrinaClCount: doctrinaCl?.results.length ?? 0,
      doctrinaLatamCount: doctrinaLatam?.results.length ?? 0,
      warnings,
    },
  };
}
