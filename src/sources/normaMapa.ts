import {
  HOT_NORMAS,
  listHotNormas,
  resolveHotNorma,
  type HotNorma,
  type LegalArea,
} from "../catalog.js";
import {
  findArticulo,
  parseNormaTexto,
  type NormaTexto,
} from "./normaTexto.js";
import { getNorma } from "./legislacion.js";

export function listarNormasFrecuentes(area?: LegalArea): {
  count: number;
  area?: LegalArea;
  normas: Array<{
    idNorma: string;
    label: string;
    aliases: string[];
    areas: LegalArea[];
    url: string;
  }>;
  markdown: string;
} {
  const normas = listHotNormas(area);
  const rows = normas.map((n) => ({
    idNorma: n.idNorma,
    label: n.label,
    aliases: n.aliases,
    areas: n.areas,
    url: `https://www.bcn.cl/leychile/navegar?idNorma=${n.idNorma}`,
  }));
  const markdown = [
    `## Normas frecuentes${area ? ` — área \`${area}\`` : ""}`,
    "",
    `Total: **${rows.length}**`,
    "",
    ...rows.map(
      (n) =>
        `- **${n.label}** — idNorma \`${n.idNorma}\` · áreas: ${n.areas.join(", ")} · [LeyChile](${n.url})`,
    ),
    "",
    "→ Usa `resolver_norma_frecuente` con un alias o `obtener_articulo` con el idNorma.",
  ].join("\n");
  return { count: rows.length, area, normas: rows, markdown };
}

export function resolverNormaFrecuente(alias: string): {
  found: boolean;
  norma?: HotNorma & { url: string };
  markdown: string;
} {
  const hit = resolveHotNorma(alias);
  if (!hit) {
    return {
      found: false,
      markdown: [
        `## Norma frecuente no resuelta`,
        "",
        `Alias: _${alias}_`,
        "",
        "Prueba `listar_normas_frecuentes` o `buscar_legislacion` con el número de ley.",
      ].join("\n"),
    };
  }
  const url = `https://www.bcn.cl/leychile/navegar?idNorma=${hit.idNorma}`;
  return {
    found: true,
    norma: { ...hit, url },
    markdown: [
      `## Norma frecuente resuelta`,
      "",
      `- **${hit.label}**`,
      `- **idNorma:** \`${hit.idNorma}\``,
      `- **Áreas:** ${hit.areas.join(", ")}`,
      `- **Aliases:** ${hit.aliases.slice(0, 12).join("; ")}`,
      `- **URL:** ${url}`,
      "",
      `→ \`obtener_articulo\` / \`citar_texto_legal\` / \`mapa_norma\` con id_norma=${hit.idNorma}`,
    ].join("\n"),
  };
}

export interface MapaNormaResult {
  idNorma: string;
  titulo: string;
  tipo?: string;
  numero?: string;
  fechaPublicacion?: string;
  fechaVersion?: string;
  derogadoNorma?: string;
  materias: string[];
  url: string;
  articulosTotal: number;
  articulosDerogados: number;
  articulos: Array<{
    numero: string;
    derogado?: string;
    url: string;
    idParte?: string;
  }>;
  integrity: "verified";
  markdown: string;
}

export async function mapaNorma(
  idNorma: string,
  opts: { signal?: AbortSignal } = {},
): Promise<MapaNormaResult> {
  const norma = await parseNormaTexto(idNorma, { signal: opts.signal });
  const articulos = norma.articulos.map((a) => ({
    numero: a.numero,
    derogado: a.derogado,
    url: a.url,
    idParte: a.idParte,
  }));
  const articulosDerogados = articulos.filter((a) =>
    Boolean(a.derogado && !/^no$/i.test(a.derogado)),
  ).length;

  const markdown = [
    `## Mapa de norma — ${norma.titulo}`,
    "",
    `- **Integridad:** \`verified\` (XML LeyChile)`,
    `- **idNorma:** \`${norma.idNorma}\``,
    norma.tipo ? `- **Tipo:** ${norma.tipo}` : null,
    norma.numero ? `- **Número:** ${norma.numero}` : null,
    norma.fechaPublicacion
      ? `- **Publicación:** ${norma.fechaPublicacion}`
      : null,
    norma.fechaVersion ? `- **Versión XML:** ${norma.fechaVersion}` : null,
    norma.derogado ? `- **Estado norma:** ${norma.derogado}` : null,
    norma.materias.length
      ? `- **Materias:** ${norma.materias.slice(0, 12).join("; ")}`
      : null,
    `- **Artículos:** ${articulos.length} (señal derogado en ${articulosDerogados})`,
    `- **URL:** ${norma.url}`,
    "",
    "### Índice",
    "",
    ...articulos.slice(0, 200).map((a) => {
      const flag =
        a.derogado && !/^no$/i.test(a.derogado)
          ? ` **[derogado: ${a.derogado}]**`
          : "";
      return `- art. ${a.numero}${flag} — ${a.url}`;
    }),
    articulos.length > 200
      ? `- _…y ${articulos.length - 200} artículos más_`
      : null,
    "",
    "→ Para texto: `obtener_articulo` / `citar_texto_legal`. Para vigencia: `estado_norma`.",
  ]
    .filter((x) => x != null)
    .join("\n");

  return {
    idNorma: norma.idNorma,
    titulo: norma.titulo,
    tipo: norma.tipo,
    numero: norma.numero,
    fechaPublicacion: norma.fechaPublicacion,
    fechaVersion: norma.fechaVersion,
    derogadoNorma: norma.derogado,
    materias: norma.materias,
    url: norma.url,
    articulosTotal: articulos.length,
    articulosDerogados,
    articulos,
    integrity: "verified",
    markdown,
  };
}

function normalizeDerogadoFlag(raw?: string): {
  derogado: boolean;
  label: string;
} {
  if (!raw || /^no$/i.test(raw.trim())) {
    return { derogado: false, label: "vigente (sin señal de derogación en XML)" };
  }
  return { derogado: true, label: raw.trim() };
}

/** Enrich estado_norma with XML derogado flags at norma and article level. */
export async function estadoNormaEnriquecido(
  idNorma: string,
  opts: { articulo?: string; signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  const code = idNorma.replace(/\D/g, "");
  const meta = await getNorma({ leychileCode: code });
  const result = meta.results[0];
  const base = {
    idNorma: code,
    titulo: result?.title,
    citation: result?.citation,
    fechaPublicacion: result?.date,
    url: result?.url ?? `https://www.bcn.cl/leychile/navegar?idNorma=${code}`,
    historiaUrl: `https://www.bcn.cl/leychile/navegar?idNorma=${code}&tipoVersion=H`,
    metadata: result?.metadata,
  };

  let xml: NormaTexto | undefined;
  const warnings: string[] = [
    ...(meta.warnings ?? []),
  ];
  try {
    xml = await parseNormaTexto(code, { signal: opts.signal });
  } catch (error) {
    warnings.push(
      `XML LeyChile no disponible para vigencia detallada: ${error instanceof Error ? error.message : String(error)}`,
      "Confirma vigencia en la historia oficial de LeyChile.",
    );
    return {
      ...base,
      warnings,
      integrity: "candidate",
    };
  }

  const normaFlag = normalizeDerogadoFlag(xml.derogado);
  let articuloInfo: Record<string, unknown> | undefined;
  if (opts.articulo) {
    const art = findArticulo(xml, opts.articulo);
    if (!art) {
      warnings.push(
        `Artículo ${opts.articulo} no encontrado en el XML para evaluar vigencia puntual.`,
      );
    } else {
      const artFlag = normalizeDerogadoFlag(art.derogado);
      articuloInfo = {
        numero: art.numero,
        derogado: artFlag.derogado,
        derogadoLabel: artFlag.label,
        url: art.url,
      };
    }
  }

  const derogados = xml.articulos.filter(
    (a) => a.derogado && !/^no$/i.test(a.derogado),
  ).length;

  return {
    ...base,
    titulo: xml.titulo ?? base.titulo,
    fechaPublicacion: xml.fechaPublicacion ?? base.fechaPublicacion,
    fechaVersion: xml.fechaVersion,
    derogadoNorma: normaFlag.derogado,
    derogadoNormaLabel: normaFlag.label,
    articulosTotal: xml.articulos.length,
    articulosConSenalDerogado: derogados,
    articulo: articuloInfo,
    integrity: "verified",
    warnings: [
      "Señal `derogado` del XML LeyChile; confirma siempre en la historia oficial si hay duda.",
      ...warnings,
    ],
  };
}

export interface CompararVersionResult {
  idNorma: string;
  articulo?: string;
  fechaA: string;
  fechaB: string;
  integrity: "verified" | "candidate";
  sameText?: boolean;
  textoA?: string;
  textoB?: string;
  fechaVersionA?: string;
  fechaVersionB?: string;
  urlHistoria: string;
  warnings: string[];
  markdown: string;
}

/**
 * Best-effort article/norma diff across LeyChile XML versions (`idVersion`).
 * If a historical version cannot be fetched (429 / unsupported), returns candidate + historia URL.
 */
export async function compararVersionNorma(opts: {
  id_norma: string;
  fecha_a: string;
  fecha_b: string;
  articulo?: string;
  signal?: AbortSignal;
}): Promise<CompararVersionResult> {
  const code = opts.id_norma.replace(/\D/g, "");
  const fechaA = opts.fecha_a.trim();
  const fechaB = opts.fecha_b.trim();
  const urlHistoria = `https://www.bcn.cl/leychile/navegar?idNorma=${code}&tipoVersion=H`;
  const warnings: string[] = [];

  async function load(label: string, idVersion: string): Promise<NormaTexto | null> {
    try {
      return await parseNormaTexto(code, {
        idVersion,
        signal: opts.signal,
        retries: 2,
      });
    } catch (error) {
      warnings.push(
        `Versión ${label} (${idVersion}): ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  const [a, b] = await Promise.all([
    load("A", fechaA),
    load("B", fechaB),
  ]);

  if (!a || !b) {
    // Fallback: current XML metadata only.
    let current: NormaTexto | undefined;
    try {
      current = await parseNormaTexto(code, { signal: opts.signal });
    } catch (error) {
      warnings.push(
        `Tampoco se pudo cargar la versión vigente: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const markdown = [
      `## Comparación de versiones — idNorma \`${code}\``,
      "",
      `- **Integridad:** \`candidate\` (no se recuperaron ambas versiones XML)`,
      `- **fecha_a:** ${fechaA}`,
      `- **fecha_b:** ${fechaB}`,
      current?.fechaVersion
        ? `- **Versión XML vigente disponible:** ${current.fechaVersion}`
        : null,
      `- **Historia oficial:** ${urlHistoria}`,
      "",
      "LeyChile a veces no entrega XML histórico por `idVersion` (o rate-limita). Abre la historia y compara manualmente.",
      "",
      warnings.length
        ? ["### Advertencias", ...warnings.map((w) => `- ${w}`)].join("\n")
        : null,
    ]
      .filter((x) => x != null)
      .join("\n");

    return {
      idNorma: code,
      articulo: opts.articulo,
      fechaA,
      fechaB,
      integrity: "candidate",
      fechaVersionA: a?.fechaVersion,
      fechaVersionB: b?.fechaVersion ?? current?.fechaVersion,
      urlHistoria,
      warnings,
      markdown,
    };
  }

  let textoA = "";
  let textoB = "";
  if (opts.articulo) {
    const artA = findArticulo(a, opts.articulo);
    const artB = findArticulo(b, opts.articulo);
    if (!artA || !artB) {
      warnings.push(
        `Artículo ${opts.articulo} no encontrado en una de las versiones (A=${Boolean(artA)}, B=${Boolean(artB)}).`,
      );
    }
    textoA = artA?.texto ?? "";
    textoB = artB?.texto ?? "";
  } else {
    textoA = a.articulos.map((x) => `### ${x.numero}\n${x.texto}`).join("\n\n");
    textoB = b.articulos.map((x) => `### ${x.numero}\n${x.texto}`).join("\n\n");
  }

  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const sameText = norm(textoA) === norm(textoB) && textoA.length > 0;

  const markdown = [
    `## Comparación de versiones — idNorma \`${code}\``,
    "",
    `- **Integridad:** \`verified\` (ambos XML recuperados)`,
    opts.articulo ? `- **Artículo:** ${opts.articulo}` : `- **Alcance:** norma completa (índice de artículos)`,
    `- **fecha_a / versión A:** ${fechaA} (XML fechaVersion=${a.fechaVersion ?? "n/d"})`,
    `- **fecha_b / versión B:** ${fechaB} (XML fechaVersion=${b.fechaVersion ?? "n/d"})`,
    `- **¿Mismo texto?** ${sameText ? "sí" : "no / revisar"}`,
    `- **Historia:** ${urlHistoria}`,
    "",
    "### Extracto A",
    "",
    textoA
      ? textoA
          .slice(0, 1_500)
          .split(/(?<=\.)\s+/)
          .slice(0, 8)
          .map((l) => `> ${l}`)
          .join("\n")
      : "_sin texto_",
    "",
    "### Extracto B",
    "",
    textoB
      ? textoB
          .slice(0, 1_500)
          .split(/(?<=\.)\s+/)
          .slice(0, 8)
          .map((l) => `> ${l}`)
          .join("\n")
      : "_sin texto_",
    "",
    warnings.length
      ? ["### Advertencias", ...warnings.map((w) => `- ${w}`)].join("\n")
      : null,
  ]
    .filter((x) => x != null)
    .join("\n");

  return {
    idNorma: code,
    articulo: opts.articulo,
    fechaA,
    fechaB,
    integrity: "verified",
    sameText,
    textoA: textoA.slice(0, 8_000),
    textoB: textoB.slice(0, 8_000),
    fechaVersionA: a.fechaVersion,
    fechaVersionB: b.fechaVersion,
    urlHistoria,
    warnings,
    markdown,
  };
}

/** @deprecated keep export surface for catalog size checks in tests */
export const HOT_CATALOG_SIZE = HOT_NORMAS.length;
