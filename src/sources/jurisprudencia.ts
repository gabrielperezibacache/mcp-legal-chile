import type { CitationResult, SearchResponse } from "../types.js";
import { normalizeRol, parseCaseIdentifiers } from "../parsers.js";
import {
  buildPortalLinks,
  matchTribunalPortal,
  tribunalSearchSites,
} from "./tribunalesCatalog.js";
import {
  excerptForQuote,
  getTcFicha,
  searchTcSentencias,
  tcCitation,
  type TcSearchHit,
} from "./tcBuscador.js";
import { uniqueByUrl } from "../util.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

export interface ResolveRolResult {
  rol: string;
  tribunal?: string;
  anio?: string;
  citation: string;
  results: CitationResult[];
  portals: Record<string, string>;
  warnings: string[];
}

export interface TcFalloPack {
  rol: string;
  citation: string;
  competencia?: string;
  fecha?: string;
  resultado?: string;
  doctrina?: string;
  gestion?: string;
  votosMayoria?: string;
  articulosCpr?: string;
  url: string;
  pdfUrl?: string;
  excerpt: string;
  blockquote: string;
  markdown: string;
}

function looksLikeCourtHit(title: string, url: string): boolean {
  const hay = `${title} ${url}`.toLowerCase();
  return (
    hay.includes("sentencia") ||
    hay.includes("fallo") ||
    hay.includes("ruling") ||
    hay.includes("getruling") ||
    hay.includes("causa") ||
    hay.includes("rol") ||
    hay.includes("tribunal") ||
    hay.includes("corte") ||
    hay.includes("juzgado") ||
    url.includes("pjud.cl") ||
    url.includes("tribunalconstitucional.cl") ||
    url.includes("buscador.tcchile.cl")
  );
}

function enrich(hits: CitationResult[]): CitationResult[] {
  return hits.map((hit) => {
    const ids = parseCaseIdentifiers(hit.title, hit.summary ?? "");
    return {
      ...hit,
      evidence: hit.evidence ?? ("link_only" as const),
      rol: ids.rol ?? hit.rol,
      rit: ids.rit,
      ruc: ids.ruc,
      tribunal: ids.tribunal ?? hit.tribunal,
      citation:
        ids.rol && ids.tribunal
          ? `${ids.tribunal}, rol ${ids.rol}`
          : hit.citation,
      metadata: {
        ...hit.metadata,
        anio: ids.anio,
      },
    };
  });
}

function tcHitToCitation(hit: TcSearchHit): CitationResult {
  return {
    source: "jurisprudencia",
    title: `TC rol ${hit.rol}${hit.competencia ? ` — ${hit.competencia}` : ""}`,
    citation: tcCitation(hit.rol, hit.competenciaShort ?? hit.competencia),
    summary: hit.excerpt,
    url: hit.fichaUrl,
    secondaryUrl: hit.pdfUrl,
    publisher: "Tribunal Constitucional",
    tribunal: "Tribunal Constitucional",
    rol: hit.rol,
    id: hit.id,
    evidence: hit.excerpt ? "metadata" : "link_only",
    metadata: {
      tcId: hit.id,
      sentenceId: hit.sentenceId,
      competencia: hit.competencia,
      pdfUrl: hit.pdfUrl,
      provider: "tc_buscador",
    },
  };
}

function isTcContext(tribunal?: string, norm?: ReturnType<typeof normalizeRol>): boolean {
  const portal = matchTribunalPortal(tribunal ?? "");
  if (portal?.id === "tc") return true;
  return norm?.likelyTc ?? false;
}

function exactTcHits(
  hits: TcSearchHit[],
  norm: ReturnType<typeof normalizeRol>,
): TcSearchHit[] {
  return hits.filter(
    (h) =>
      h.rol === norm.numero ||
      h.rol === norm.display ||
      h.rol.startsWith(`${norm.numero}-`) ||
      norm.searchTerms.some((t) => h.rol === t || h.rol.includes(t.replace(/-20/g, "-"))),
  );
}

/** Resuelve un ROL a enlaces oficiales + candidatos (TC vía API; PJUD vía búsqueda). */
export async function resolverRol(opts: {
  rol: string;
  tribunal?: string;
  anio?: string;
  limite?: number;
  signal?: AbortSignal;
}): Promise<ResolveRolResult> {
  const norm = normalizeRol(opts.rol);
  const explicitTc = isTcContext(opts.tribunal, norm);
  const tribunal = opts.tribunal ?? (explicitTc ? "Tribunal Constitucional" : undefined);
  const anio = opts.anio ?? norm.anio;
  const warnings: string[] = [
    "PJUD no tiene API abierta: los enlaces pjud.cl son candidatos a verificar.",
  ];
  const results: CitationResult[] = [];
  const portals = buildPortalLinks(norm.display, tribunal);
  const shouldSearchTc = explicitTc || !opts.tribunal;
  const shouldSearchPjud = !explicitTc;

  if (shouldSearchTc) {
    try {
      for (const term of norm.searchTerms) {
        const hits = await searchTcSentencias(term, opts.limite ?? 3, opts.signal);
        const exact = exactTcHits(hits, norm);
        results.push(...(exact.length || !explicitTc ? exact : hits).map(tcHitToCitation));
        if (results.length) break;
      }
    } catch (error) {
      warnings.push(
        `TC buscador: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (shouldSearchPjud) {
    const portal = matchTribunalPortal(tribunal ?? "");
    const sites =
      portal && portal.id !== "tc" ? portal.sites : ["pjud.cl"];
    try {
      const q = `rol ${norm.display} ${tribunal ?? ""}`.trim();
      for (const site of sites) {
        const hits = await searchWeb(`${q} (sentencia OR fallo)`, {
          site,
          limit: opts.limite ?? 5,
          signal: opts.signal,
        });
        const filtered = hits.filter((h) => looksLikeCourtHit(h.title, h.url));
        results.push(
          ...webHitsToCitations(
            filtered.length ? filtered : hits,
            "jurisprudencia",
            portal?.name ?? tribunal ?? "Poder Judicial de Chile",
          ),
        );
        if (results.length >= (opts.limite ?? 5)) break;
      }
    } catch (error) {
      warnings.push(
        `PJUD búsqueda: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const deduped = uniqueByUrl(enrich(results));
  const citation = tribunal
    ? `${tribunal}, rol ${norm.display}${anio ? ` (${anio})` : ""}`
    : `rol ${norm.display}${anio ? ` (${anio})` : ""}`;

  return {
    rol: norm.display,
    tribunal,
    anio,
    citation,
    results: deduped,
    portals,
    warnings,
  };
}

/** Obtiene metadatos + extracto oficial de sentencia TC por ROL. */
export async function obtenerFalloTc(
  rol: string,
  signal?: AbortSignal,
): Promise<TcFalloPack> {
  const norm = normalizeRol(rol);
  let hit: TcSearchHit | undefined;
  for (const term of norm.searchTerms) {
    const hits = await searchTcSentencias(term, 5, signal);
    hit =
      hits.find((h) => h.rol === norm.numero || h.rol.startsWith(`${norm.numero}-`)) ??
      hits[0];
    if (hit) break;
  }
  if (!hit) {
    throw new Error(`No se encontró sentencia TC para rol ${norm.display}`);
  }

  let ficha: Awaited<ReturnType<typeof getTcFicha>> | undefined;
  try {
    ficha = await getTcFicha(hit.rol, signal);
  } catch {
    try {
      ficha = await getTcFicha(hit.id, signal);
    } catch {
      /* optional enrichment */
    }
  }

  const excerptSource =
    ficha?.doctrina ||
    hit.highlights?.join(" ") ||
    hit.excerpt ||
    excerptForQuote(hit.content ?? "", 3500);
  const excerpt = excerptForQuote(excerptSource, 3500);
  const blockquote = excerpt
    .split(/(?<=\.)\s+/)
    .slice(0, 8)
    .map((line) => `> ${line}`)
    .join("\n");
  const citation = tcCitation(hit.rol, hit.competencia ?? ficha?.competencia);
  const url = ficha?.fichaUrl ?? hit.fichaUrl;
  const pdfUrl = ficha?.pdfUrl ?? hit.pdfUrl;

  const markdown = [
    `### ${citation}`,
    ficha?.fecha ? `- **Fecha:** ${ficha.fecha}` : undefined,
    ficha?.resultado ? `- **Resultado:** ${ficha.resultado}` : undefined,
    ficha?.gestion ? `- **Gestión:** ${ficha.gestion}` : undefined,
    ficha?.articulosCpr ? `- **Artículos CPR:** ${ficha.articulosCpr}` : undefined,
    ficha?.votosMayoria ? `- **Votos mayoría:** ${ficha.votosMayoria}` : undefined,
    `- **Ficha:** ${url}`,
    pdfUrl ? `- **PDF oficial:** ${pdfUrl}` : undefined,
    "",
    "**Extracto / doctrina (TC):**",
    "",
    blockquote,
    "",
    "_Texto desde buscador oficial del Tribunal Constitucional (tcchile.cl). Verificar PDF para citas procesales._",
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");

  return {
    rol: hit.rol,
    citation,
    competencia: hit.competencia ?? ficha?.competencia,
    fecha: ficha?.fecha,
    resultado: ficha?.resultado,
    doctrina: ficha?.doctrina,
    gestion: ficha?.gestion,
    votosMayoria: ficha?.votosMayoria,
    articulosCpr: ficha?.articulosCpr,
    url,
    pdfUrl,
    excerpt,
    blockquote,
    markdown,
  };
}

function looksLikeCourtHitExport(title: string, url: string): boolean {
  return looksLikeCourtHit(title, url);
}

export async function searchJurisprudencia(
  query: string,
  limit = 8,
  opts: {
    anio?: string;
    tribunal?: string;
    soloOficiales?: boolean;
    site?: string;
    signal?: AbortSignal;
  } = {},
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Evidencia=link_only (PJUD) salvo TC con obtener_fallo_tc. Verifica el texto oficial antes de citar ratio decidendi.",
  ];
  const results: CitationResult[] = [];

  const qParts = [query, "(sentencia OR fallo OR causa)"];
  if (opts.anio) qParts.push(opts.anio);
  if (opts.tribunal) qParts.push(opts.tribunal);
  const q = qParts.join(" ");

  const portal = matchTribunalPortal(opts.tribunal ?? "");
  const sources = opts.site
    ? [{ site: opts.site, publisher: opts.site, share: 1 }]
    : portal
      ? portal.sites.map((site) => ({
          site,
          publisher: portal.name,
          share: 1 / portal.sites.length,
        }))
      : tribunalSearchSites().map((site) => ({
          site,
          publisher:
            site === "pjud.cl"
              ? "Poder Judicial de Chile"
              : site.includes("tcchile")
                ? "Tribunal Constitucional"
                : site,
          share: 1 / tribunalSearchSites().length,
        }));

  const sourceJobs = sources.map(async ({ site, publisher, share }) => {
    try {
      const hits = await searchWeb(q, {
        site,
        limit: Math.max(2, Math.ceil(limit * share)),
        signal: opts.signal,
      });
      const filtered = hits.filter((h) =>
        looksLikeCourtHitExport(h.title, h.url),
      );
      let citations = webHitsToCitations(
        filtered.length ? filtered : hits,
        "jurisprudencia",
        publisher,
      );
      if (opts.soloOficiales) {
        citations = citations.filter(
          (c) =>
            c.url.includes("pjud.cl") ||
            c.url.includes("tribunalconstitucional.cl") ||
            c.url.includes("buscador.tcchile.cl"),
        );
      }
      if (opts.anio) {
        citations = citations.filter(
          (c) =>
            c.title.includes(opts.anio!) ||
            c.summary?.includes(opts.anio!) ||
            String(c.metadata?.anio ?? "") === opts.anio,
        );
      }
      return { citations, warning: undefined as string | undefined };
    } catch (error) {
      return {
        citations: [] as CitationResult[],
        warning: `Búsqueda en ${site} limitada: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

  const settled = await Promise.all(sourceJobs);
  for (const part of settled) {
    results.push(...part.citations);
    if (part.warning) warnings.push(part.warning);
  }

  const deduped = uniqueByUrl(enrich(results)).slice(0, limit);
  if (deduped.length === 0) {
    warnings.push(
      "No se indexaron fallos automáticamente. Prueba resolver_rol si conoces el ROL.",
    );
  }

  return {
    query,
    source: "jurisprudencia",
    results: deduped,
    warnings,
    searchUrls: {
      poderJudicial: "https://www.pjud.cl/portal-unificado-sentencias",
      tribunalConstitucional: "https://buscador.tcchile.cl/",
      busquedaSugerida: `https://duckduckgo.com/?q=${encodeURIComponent(`${query} sentencia site:pjud.cl`)}`,
    },
  };
}

export async function searchTribunalConstitucional(
  query: string,
  limit = 8,
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Fuente: API oficial buscador-backend.tcchile.cl. Usa obtener_fallo_tc para extracto.",
  ];
  try {
    const hits = await searchTcSentencias(query, limit);
    const results = hits.map(tcHitToCitation);
    return {
      query,
      source: "jurisprudencia",
      results,
      warnings,
      searchUrls: {
        tribunalConstitucional: `https://buscador.tcchile.cl/#/?q=${encodeURIComponent(query)}`,
      },
    };
  } catch (error) {
    warnings.push(
      `API TC no disponible (${error instanceof Error ? error.message : String(error)}); fallback web.`,
    );
    const fallback = await searchJurisprudencia(query, limit, {
      site: "tribunalconstitucional.cl",
      tribunal: "Tribunal Constitucional",
      soloOficiales: true,
    });
    return {
      ...fallback,
      warnings: [...warnings, ...(fallback.warnings ?? [])],
    };
  }
}

export function resolveRolToMarkdown(res: ResolveRolResult): string {
  const lines = [
    `## Resolución ROL ${res.rol}`,
    "",
    `**Cita sugerida:** ${res.citation}`,
    "",
    "### Portales oficiales",
    ...Object.entries(res.portals).map(([k, v]) => `- **${k}:** ${v}`),
    "",
  ];
  if (res.results.length) {
    lines.push("### Candidatos");
    for (const [i, r] of res.results.entries()) {
      lines.push(`#### ${i + 1}. ${r.title}`);
      lines.push(`- **Cita:** ${r.citation}`);
      if (r.rol) lines.push(`- **ROL:** ${r.rol}`);
      lines.push(`- **URL:** ${r.url}`);
      if (r.secondaryUrl) lines.push(`- **PDF:** ${r.secondaryUrl}`);
      if (r.summary) lines.push("", `> ${r.summary}`, "");
    }
  }
  if (res.warnings.length) {
    lines.push("### Advertencias", ...res.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}
