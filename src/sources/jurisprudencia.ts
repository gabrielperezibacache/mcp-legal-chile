import type { CitationResult, SearchResponse } from "../types.js";
import { formatChileanCitation } from "../citation.js";
import { isAbortLikeError, runWithDeadline } from "../deadline.js";
import {
  extractRolMention,
  normalizeRol,
  parseCaseIdentifiers,
  rolMatches,
} from "../parsers.js";
import {
  buildPortalLinks,
  foldTribunalText,
  matchTribunalPortal,
  TRIBUNAL_PORTALS,
  tribunalSearchSites,
} from "./tribunalesCatalog.js";
import {
  parseConsiderandos,
  rankConsiderandos,
} from "./considerandos.js";
import {
  excerptForQuote,
  getTcFicha,
  searchTcSentencias,
  type TcSearchHit,
} from "./tcBuscador.js";
import { uniqueByUrl } from "../util.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

/** Fail-fast web scrape budget so DDG/datacenter blocks never eat the tool deadline. */
const JURIS_WEB_BUDGET_MS = Number(process.env.JURIS_WEB_BUDGET_MS ?? 5_000);

const QUERY_STOPWORDS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "el",
  "en",
  "la",
  "las",
  "lo",
  "los",
  "para",
  "por",
  "que",
  "se",
  "un",
  "una",
  "y",
  "o",
  "sentencia",
  "fallo",
  "causa",
  "rol",
  "jurisprudencia",
]);

const OFFICIAL_HOST_FRAGMENTS = [
  "pjud.cl",
  "tribunalconstitucional.cl",
  "buscador.tcchile.cl",
  "tcchile.cl",
  ...TRIBUNAL_PORTALS.flatMap((p) => p.sites),
];

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
  tipoResolucion?: string;
  fecha?: string;
  anio?: string;
  resultado?: string;
  doctrina?: string;
  gestion?: string;
  votosMayoria?: string;
  articulosCpr?: string;
  url: string;
  pdfUrl?: string;
  excerpt: string;
  blockquote: string;
  considerandos: Array<{ numero?: number; label: string }>;
  markdown: string;
}

function isOfficialHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_HOST_FRAGMENTS.some(
      (frag) => host === frag || host.endsWith(`.${frag}`) || host.includes(frag),
    );
  } catch {
    return OFFICIAL_HOST_FRAGMENTS.some((frag) => url.includes(frag));
  }
}

/** Score > 0 means the hit looks like a court ruling / causa page. */
export function scoreCourtHit(
  title: string,
  url: string,
  snippet = "",
): number {
  const hay = foldTribunalText(`${title} ${snippet} ${url}`);
  let score = 0;

  if (isOfficialHost(url)) score += 40;
  if (
    url.includes("pjud.cl") ||
    url.includes("tribunalconstitucional.cl") ||
    url.includes("buscador.tcchile.cl")
  ) {
    score += 20;
  }

  const strong = [
    "sentencia",
    "fallo",
    "ruling",
    "getruling",
    "jurisprudencia",
    "resolucion",
    "resolución",
  ];
  const medium = ["causa", "rol", "expediente", "rit", "ruc"];
  const weak = ["tribunal", "corte", "juzgado", "sala"];

  for (const k of strong) if (hay.includes(foldTribunalText(k))) score += 18;
  for (const k of medium) if (hay.includes(foldTribunalText(k))) score += 10;
  for (const k of weak) if (hay.includes(foldTribunalText(k))) score += 4;

  if (/\b\d{1,6}\s*[-–./]\s*\d{2,4}\b/.test(`${title} ${snippet}`)) score += 15;

  return score;
}

function looksLikeCourtHit(title: string, url: string, snippet = ""): boolean {
  return scoreCourtHit(title, url, snippet) >= 18;
}

function queryTokens(query: string): string[] {
  return foldTribunalText(query)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !QUERY_STOPWORDS.has(t));
}

function yearVariants(anio?: string): string[] {
  if (!anio) return [];
  const y = anio.trim();
  if (!y) return [];
  const out = [y];
  if (/^(19|20)\d{2}$/.test(y)) out.push(y.slice(-2));
  return out;
}

function matchesYearFilter(
  hit: CitationResult,
  anio?: string,
): boolean {
  if (!anio) return true;
  const variants = yearVariants(anio);
  const hay = `${hit.title} ${hit.summary ?? ""} ${hit.rol ?? ""} ${hit.date ?? ""} ${hit.metadata?.anio ?? ""}`;
  return variants.some((v) => hay.includes(v));
}

/** Relevance rank for mixed TC + web jurisprudence results. */
export function scoreJurisprudenciaHit(
  hit: CitationResult,
  query: string,
  opts: { anio?: string; tribunal?: string } = {},
): number {
  let score = scoreCourtHit(hit.title, hit.url, hit.summary ?? "");
  const tokens = queryTokens(query);
  const hay = foldTribunalText(
    `${hit.title} ${hit.summary ?? ""} ${hit.citation} ${hit.rol ?? ""}`,
  );
  for (const token of tokens) {
    if (hay.includes(token)) score += token.length > 4 ? 12 : 7;
  }

  if (hit.evidence === "full_text") score += 35;
  else if (hit.evidence === "metadata") score += 25;
  else score += 5;

  if (hit.metadata?.provider === "tc_buscador") score += 20;
  if (isOfficialHost(hit.url)) score += 15;
  if (hit.rol) score += 10;
  if (hit.secondaryUrl) score += 5;

  if (opts.tribunal) {
    const wanted = foldTribunalText(opts.tribunal);
    const got = foldTribunalText(hit.tribunal ?? hit.publisher ?? "");
    if (got && (got.includes(wanted) || wanted.includes(got))) score += 18;
  }

  if (opts.anio && matchesYearFilter(hit, opts.anio)) score += 12;

  const rolMention = extractRolMention(query);
  if (rolMention && hit.rol && rolMatches(hit.rol, rolMention)) score += 50;

  return score;
}

export function rankJurisprudenciaResults(
  hits: CitationResult[],
  query: string,
  opts: { anio?: string; tribunal?: string } = {},
): CitationResult[] {
  return [...hits].sort(
    (a, b) =>
      scoreJurisprudenciaHit(b, query, opts) -
      scoreJurisprudenciaHit(a, query, opts),
  );
}

/** Build a formal jurisprudence citation; never use a raw page title. */
export function buildJurisCitation(opts: {
  tribunal?: string;
  tipo?: string;
  rol?: string;
  anio?: string;
  url?: string;
  titleFallback?: string;
}): string {
  if (opts.rol) {
    return formatChileanCitation({
      tribunal: opts.tribunal,
      tipo: opts.tipo ?? "Sentencia",
      rol: opts.rol,
      anio: opts.anio,
      url: opts.url,
    }).citation;
  }
  const short = (opts.titleFallback ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
  return short
    ? `Candidato (verificar): ${short}`
    : "Candidato (verificar): sin identificadores parseados";
}

function anioFromRol(rol: string): string | undefined {
  const norm = normalizeRol(rol);
  return norm.anio || undefined;
}

function enrich(hits: CitationResult[]): CitationResult[] {
  return hits.map((hit) => {
    const ids = parseCaseIdentifiers(hit.title, hit.summary ?? "");
    const rol = hit.rol ?? ids.rol;
    const tribunal = hit.tribunal ?? ids.tribunal;
    const anio =
      (hit.metadata?.anio as string | undefined) ?? ids.anio ?? (rol ? anioFromRol(rol) : undefined);
    const tipo =
      (hit.metadata?.tipo as string | undefined) ??
      ids.tipo ??
      (hit.metadata?.provider === "tc_buscador" ? "Sentencia" : undefined);
    const citation =
      hit.metadata?.provider === "tc_buscador" && hit.citation && !/Candidato/i.test(hit.citation)
        ? hit.citation
        : buildJurisCitation({
            tribunal,
            tipo,
            rol,
            anio,
            url: hit.url,
            titleFallback: hit.title,
          });
    return {
      ...hit,
      evidence: hit.evidence ?? ("link_only" as const),
      rol,
      rit: hit.rit ?? ids.rit,
      ruc: hit.ruc ?? ids.ruc,
      tribunal,
      citation,
      metadata: {
        ...hit.metadata,
        anio,
        tipo,
      },
    };
  });
}

function tcHitToCitation(hit: TcSearchHit, query?: string): CitationResult {
  const anio = anioFromRol(hit.rol);
  const citation = formatChileanCitation({
    tribunal: "Tribunal Constitucional",
    tipo: "Sentencia",
    rol: hit.rol,
    anio,
    url: hit.fichaUrl,
  }).citation;

  let summary = hit.excerpt;
  const content = hit.content?.trim() ?? "";
  if (content.length >= 400) {
    if (query) {
      const ranked = rankConsiderandos(parseConsiderandos(content), query);
      if (ranked[0]) {
        summary = excerptForQuote(ranked[0].texto, 2_800);
      } else {
        summary = pickTcExcerpt({
          highlights: hit.highlights,
          excerpt: hit.excerpt,
          content,
          query,
        });
      }
    } else {
      summary = pickTcExcerpt({
        highlights: hit.highlights,
        excerpt: hit.excerpt,
        content,
      });
    }
  }

  const evidence =
    content.length >= 400
      ? ("full_text" as const)
      : summary
        ? ("metadata" as const)
        : ("link_only" as const);

  return {
    source: "jurisprudencia",
    title: `TC rol ${hit.rol}${hit.competencia ? ` — ${hit.competencia}` : ""}`,
    citation,
    summary,
    url: hit.fichaUrl,
    secondaryUrl: hit.pdfUrl,
    publisher: "Tribunal Constitucional",
    tribunal: "Tribunal Constitucional",
    rol: hit.rol,
    id: hit.id,
    evidence,
    metadata: {
      integrity: evidence === "full_text" ? "verified" : "candidate",
      tcId: hit.id,
      sentenceId: hit.sentenceId,
      competencia: hit.competencia,
      pdfUrl: hit.pdfUrl,
      provider: "tc_buscador",
      anio,
      tipo: "Sentencia",
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
  return hits.filter((h) => rolMatches(h.rol, norm));
}

function pickTcExcerpt(opts: {
  doctrina?: string;
  highlights?: string[];
  excerpt?: string;
  content?: string;
  query?: string;
}): string {
  const doctrina = opts.doctrina?.replace(/\s+/g, " ").trim() ?? "";
  const highlights = (opts.highlights ?? [])
    .map((h) => h.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  let highlightText = highlights.join(" ");
  if (opts.query && highlights.length > 1) {
    const tokens = queryTokens(opts.query);
    if (tokens.length) {
      const ranked = [...highlights].sort((a, b) => {
        const score = (t: string) => {
          const hay = foldTribunalText(t);
          return tokens.reduce(
            (s, tok) => s + (hay.includes(tok) ? (tok.length > 4 ? 3 : 1) : 0),
            0,
          );
        };
        return score(b) - score(a);
      });
      highlightText = ranked.join(" ");
    }
  }
  const excerpt = opts.excerpt?.replace(/\s+/g, " ").trim() ?? "";
  const content = excerptForQuote(opts.content ?? "", 3500);

  if (doctrina && doctrina.length >= 120) {
    return excerptForQuote(doctrina, 3500);
  }
  if (doctrina && highlightText) {
    const merged = highlightText.includes(doctrina)
      ? highlightText
      : `${doctrina} ${highlightText}`;
    return excerptForQuote(merged, 3500);
  }
  if (doctrina) return excerptForQuote(doctrina, 3500);
  if (highlightText) return excerptForQuote(highlightText, 3500);
  if (excerpt) return excerptForQuote(excerpt, 3500);
  return content;
}

function buildWebQuery(
  query: string,
  opts: { anio?: string; tribunal?: string },
): string {
  const parts = [query, "(sentencia OR fallo OR causa OR jurisprudencia)"];
  if (opts.anio) parts.push(opts.anio);
  if (opts.tribunal) parts.push(`"${opts.tribunal}"`);
  return parts.join(" ");
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
        const hits = await searchTcSentencias(term, opts.limite ?? 3, opts.signal, {
          anio,
        });
        const exact = exactTcHits(hits, norm);
        results.push(
          ...(exact.length || !explicitTc ? exact : hits).map((h) =>
            tcHitToCitation(h, opts.rol),
          ),
        );
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
      const q = `rol ${norm.display} ${tribunal ?? ""} (sentencia OR fallo)`.trim();
      for (const site of sites) {
        const hits = await searchWeb(q, {
          site,
          limit: opts.limite ?? 5,
          signal: opts.signal,
        });
        const filtered = hits.filter((h) =>
          looksLikeCourtHit(h.title, h.url, h.snippet),
        );
        // Prefer hits that mention the same ROL number.
        const ranked = (filtered.length ? filtered : hits).sort((a, b) => {
          const aHit = rolMatches(a.title, norm) || rolMatches(a.snippet ?? "", norm) ? 1 : 0;
          const bHit = rolMatches(b.title, norm) || rolMatches(b.snippet ?? "", norm) ? 1 : 0;
          if (aHit !== bHit) return bHit - aHit;
          return (
            scoreCourtHit(b.title, b.url, b.snippet) -
            scoreCourtHit(a.title, a.url, a.snippet)
          );
        });
        results.push(
          ...webHitsToCitations(
            ranked,
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

  const deduped = uniqueByUrl(
    rankJurisprudenciaResults(enrich(results), `rol ${norm.display}`, {
      anio,
      tribunal,
    }),
  );
  const citation = formatChileanCitation({
    tribunal: tribunal ?? undefined,
    tipo: "Sentencia",
    rol: norm.display,
    anio,
  }).citation;

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
    const hits = await searchTcSentencias(term, 8, signal, { anio: norm.anio });
    hit = exactTcHits(hits, norm)[0] ?? hits.find((h) => rolMatches(h.rol, norm));
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

  const excerpt = pickTcExcerpt({
    doctrina: ficha?.doctrina,
    highlights: hit.highlights,
    excerpt: hit.excerpt,
    content: hit.content,
  });
  const blockquote = excerpt
    .split(/(?<=\.)\s+/)
    .slice(0, 8)
    .map((line) => `> ${line}`)
    .join("\n");
  const anio =
    ficha?.fecha?.slice(0, 4) ||
    norm.anio ||
    undefined;
  const tipoResolucion = ficha?.tipoResolucion ?? "Sentencia";
  const rolDisplay = norm.display;
  const url = ficha?.fichaUrl ?? hit.fichaUrl;
  const pdfUrl = ficha?.pdfUrl ?? hit.pdfUrl;
  const citation = formatChileanCitation({
    tribunal: "Tribunal Constitucional",
    tipo: tipoResolucion,
    rol: rolDisplay,
    anio,
    url,
  }).citation;
  const considerandos = parseConsiderandos(hit.content ?? "")
    .slice(0, 60)
    .map((c) => ({ numero: c.numero, label: c.label }));

  const markdown = [
    `### Fallo TC`,
    "",
    "**Cita lista para pegar:**",
    "",
    `> ${citation}`,
    "",
    `- **Tribunal:** Tribunal Constitucional`,
    `- **Tipo:** ${tipoResolucion}`,
    `- **ROL:** \`${rolDisplay}\``,
    anio ? `- **Año:** ${anio}` : undefined,
    ficha?.fecha ? `- **Fecha:** ${ficha.fecha}` : undefined,
    ficha?.resultado ? `- **Resultado:** ${ficha.resultado}` : undefined,
    ficha?.gestion ? `- **Gestión:** ${ficha.gestion}` : undefined,
    ficha?.articulosCpr ? `- **Artículos CPR:** ${ficha.articulosCpr}` : undefined,
    ficha?.votosMayoria ? `- **Votos mayoría:** ${ficha.votosMayoria}` : undefined,
    considerandos.length
      ? `- **Considerandos detectados:** ${considerandos.length}`
      : undefined,
    `- **Integridad:** \`verified\` (extracto) / verificar PDF para citas procesales`,
    `- **Ficha:** ${url}`,
    pdfUrl ? `- **PDF oficial:** ${pdfUrl}` : undefined,
    "",
    "**Extracto / doctrina (TC):**",
    "",
    blockquote,
    "",
    considerandos.length
      ? [
          "**Índice de considerandos:**",
          ...considerandos
            .slice(0, 25)
            .map(
              (c) =>
                `- ${c.numero != null ? `${c.numero}º` : "?"} — ${c.label}`,
            ),
          "",
          "→ Cita textual: `citar_jurisprudencia` con `rol` + `considerando` (ej. `15`) o `consulta` temática.",
          "",
        ].join("\n")
      : undefined,
    "_Fuente: buscador oficial del Tribunal Constitucional (tcchile.cl)._",
  ]
    .filter((x): x is string => Boolean(x))
    .join("\n");

  return {
    rol: rolDisplay,
    citation,
    competencia: hit.competencia ?? ficha?.competencia,
    tipoResolucion,
    fecha: ficha?.fecha,
    anio,
    resultado: ficha?.resultado,
    doctrina: ficha?.doctrina,
    gestion: ficha?.gestion,
    votosMayoria: ficha?.votosMayoria,
    articulosCpr: ficha?.articulosCpr,
    url,
    pdfUrl,
    excerpt,
    blockquote,
    considerandos,
    markdown,
  };
}

function portalLinkResults(query: string): CitationResult[] {
  return [
    {
      source: "jurisprudencia",
      title: `[Portal sugerido · NO es un fallo] PJUD — buscar: ${query}`,
      citation: `Búsqueda sugerida PJUD (sin documento recuperado): ${query}`,
      summary:
        "NO es un fallo encontrado. PJUD no ofrece API abierta: abre el portal y verifica manualmente. No cites ratio decidendi desde este enlace.",
      url: "https://www.pjud.cl/portal-unificado-sentencias",
      publisher: "Poder Judicial de Chile",
      evidence: "link_only",
      metadata: {
        provider: "portal_link",
        integrity: "portal_stub",
        query,
      },
    },
    {
      source: "jurisprudencia",
      title: `[Portal sugerido · NO es un fallo] TC — buscar: ${query}`,
      citation: `Búsqueda sugerida TC (sin documento recuperado): ${query}`,
      summary:
        "NO es un fallo encontrado. Usa buscar_tc / obtener_fallo_tc para metadatos y extracto oficial del Tribunal Constitucional.",
      url: `https://buscador.tcchile.cl/#/?q=${encodeURIComponent(query)}`,
      publisher: "Tribunal Constitucional",
      evidence: "link_only",
      metadata: {
        provider: "portal_link",
        integrity: "portal_stub",
        query,
      },
    },
  ];
}

async function searchTcForQuery(
  query: string,
  limit: number,
  signal: AbortSignal | undefined,
  anio?: string,
  filters: { competencia?: string; tipoResolucion?: string } = {},
): Promise<CitationResult[]> {
  const rolMention = extractRolMention(query);
  const results: CitationResult[] = [];

  if (rolMention) {
    const norm = normalizeRol(rolMention);
    for (const term of norm.searchTerms.slice(0, 3)) {
      const hits = await searchTcSentencias(term, Math.max(limit, 5), signal, {
        anio: anio ?? norm.anio,
        competencia: filters.competencia,
        tipoResolucion: filters.tipoResolucion,
      });
      const exact = exactTcHits(hits, norm);
      if (exact.length) {
        results.push(...exact.map((h) => tcHitToCitation(h, query)));
        break;
      }
    }
  }

  if (results.length < limit) {
    const hits = await searchTcSentencias(query, limit, signal, {
      anio,
      competencia: filters.competencia,
      tipoResolucion: filters.tipoResolucion,
    });
    results.push(...hits.map((h) => tcHitToCitation(h, query)));
  }

  return uniqueByUrl(results);
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

  const portal = matchTribunalPortal(opts.tribunal ?? "");
  const skipTc = Boolean(opts.site) || (portal != null && portal.id !== "tc");

  // 1) TC API first — real metadata, no web scrape.
  if (!skipTc) {
    try {
      const tcHits = await searchTcForQuery(
        query,
        limit,
        opts.signal,
        opts.anio,
      );
      results.push(...tcHits);
    } catch (error) {
      if (opts.signal?.aborted) throw error;
      warnings.push(
        `API TC limitada: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 2) Free DuckDuckGo scrape for PJUD/portals — short budget; on failure → portals.
  const wantWeb =
    !portal || portal.id !== "tc" || Boolean(opts.site);
  if (wantWeb && results.length < limit) {
    const q = buildWebQuery(query, {
      anio: opts.anio,
      tribunal: opts.tribunal,
    });

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
                : site.includes("tcchile") || site.includes("tribunalconstitucional")
                  ? "Tribunal Constitucional"
                  : site,
            share: 1 / tribunalSearchSites().length,
          }));

    try {
      const webParts = await runWithDeadline(
        "web-jurisprudencia",
        JURIS_WEB_BUDGET_MS,
        async (webSignal) => {
          const jobs = sources.map(async ({ site, publisher, share }) => {
            try {
              const hits = await searchWeb(q, {
                site,
                limit: Math.max(2, Math.ceil(limit * share) + 2),
                signal: webSignal,
              });
              const scored = hits
                .map((h) => ({
                  hit: h,
                  score: scoreCourtHit(h.title, h.url, h.snippet),
                }))
                .filter((x) => x.score >= 18)
                .sort((a, b) => b.score - a.score)
                .map((x) => x.hit);
              const chosen = scored.length
                ? scored
                : hits.filter((h) => isOfficialHost(h.url));
              let citations = webHitsToCitations(
                chosen.length ? chosen : hits.slice(0, 2),
                "jurisprudencia",
                publisher,
              );
              if (opts.soloOficiales) {
                citations = citations.filter((c) => isOfficialHost(c.url));
              }
              if (opts.anio) {
                citations = citations.filter((c) =>
                  matchesYearFilter(c, opts.anio),
                );
              }
              return { citations, warning: undefined as string | undefined };
            } catch (error) {
              if (isAbortLikeError(error)) throw error;
              return {
                citations: [] as CitationResult[],
                warning: `Búsqueda libre en ${site} limitada: ${error instanceof Error ? error.message : String(error)}`,
              };
            }
          });
          return Promise.all(jobs);
        },
        opts.signal,
      );
      for (const part of webParts) {
        results.push(...part.citations);
        if (part.warning) warnings.push(part.warning);
      }
    } catch (error) {
      if (opts.signal?.aborted) throw error;
      if (isAbortLikeError(error)) {
        warnings.push(
          `Búsqueda web libre cortada (${error instanceof Error ? error.message : String(error)}). Usa portales oficiales o pegá el texto en citar_jurisprudencia.`,
        );
      } else {
        warnings.push(
          `Búsqueda web libre no disponible: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  let deduped = uniqueByUrl(
    rankJurisprudenciaResults(enrich(results), query, {
      anio: opts.anio,
      tribunal: opts.tribunal,
    }),
  ).slice(0, limit);

  if (deduped.length === 0) {
    warnings.push(
      "No se indexaron fallos automáticamente. Portales oficiales incluidos. TC: obtener_fallo_tc / citar_jurisprudencia. PJUD: pegá el texto en citar_jurisprudencia.",
    );
    deduped = uniqueByUrl(enrich(portalLinkResults(query))).slice(0, limit);
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
  opts: {
    signal?: AbortSignal;
    anio?: string;
    competencia?: string;
    tipoResolucion?: string;
  } = {},
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Fuente: API oficial buscador-backend.tcchile.cl. Usa obtener_fallo_tc para extracto.",
  ];
  const searchUrls = {
    tribunalConstitucional: `https://buscador.tcchile.cl/#/?q=${encodeURIComponent(query)}`,
  };
  try {
    const results = await searchTcForQuery(
      query,
      limit,
      opts.signal,
      opts.anio,
      {
        competencia: opts.competencia,
        tipoResolucion: opts.tipoResolucion,
      },
    );
    return {
      query,
      source: "jurisprudencia",
      results: rankJurisprudenciaResults(results, query, { anio: opts.anio }).slice(
        0,
        limit,
      ),
      warnings,
      searchUrls,
    };
  } catch (error) {
    if (opts.signal?.aborted) throw error;
    // Never cascade into slow DuckDuckGo after a TC abort/timeout — that is what
    // made keyword searches miss the MCP client deadline.
    if (isAbortLikeError(error)) {
      return {
        query,
        source: "jurisprudencia",
        results: [],
        warnings: [
          ...warnings,
          `API TC no respondió a tiempo (${error instanceof Error ? error.message : String(error)}). Reintenta o abre el buscador oficial.`,
        ],
        searchUrls,
      };
    }
    warnings.push(
      `API TC no disponible (${error instanceof Error ? error.message : String(error)}).`,
    );
    // Free fallback: DDG best-effort scoped to TC; then portal links if empty.
    try {
      const fallback = await searchJurisprudencia(query, limit, {
        site: "tribunalconstitucional.cl",
        tribunal: "Tribunal Constitucional",
        soloOficiales: true,
        anio: opts.anio,
        signal: opts.signal,
      });
      if (fallback.results.length) {
        return {
          ...fallback,
          warnings: [...warnings, ...(fallback.warnings ?? [])],
          searchUrls: { ...searchUrls, ...(fallback.searchUrls ?? {}) },
        };
      }
    } catch {
      /* use portal links below */
    }
    return {
      query,
      source: "jurisprudencia",
      results: portalLinkResults(query).filter((r) => r.url.includes("tcchile")),
      warnings: [
        ...warnings,
        "Fallback web libre sin resultados. Abre el buscador oficial TC.",
      ],
      searchUrls,
    };
  }
}

export function resolveRolToMarkdown(res: ResolveRolResult): string {
  const lines = [
    `## Resolución ROL \`${res.rol}\``,
    "",
    "**Cita lista para pegar (si se confirma el fallo):**",
    "",
    `> ${res.citation}`,
    "",
    "### Portales oficiales",
    ...Object.entries(res.portals).map(([k, v]) => `- **${k}:** ${v}`),
    "",
  ];
  if (res.results.length) {
    lines.push("### Candidatos encontrados", "");
    for (const [i, r] of res.results.entries()) {
      lines.push(`#### ${i + 1}. ${r.title}`);
      lines.push(`- **Cita:** ${r.citation}`);
      if (r.rol) lines.push(`- **ROL:** \`${r.rol}\``);
      if (r.tribunal) lines.push(`- **Tribunal:** ${r.tribunal}`);
      lines.push(`- **Evidencia:** ${r.evidence ?? "link_only"}`);
      lines.push(`- **URL:** ${r.url}`);
      if (r.secondaryUrl) lines.push(`- **PDF:** ${r.secondaryUrl}`);
      if (r.summary) lines.push("", toBlockquoteLocal(r.summary), "");
      if (r.tribunal === "Tribunal Constitucional" && r.rol) {
        lines.push(
          `→ \`obtener_fallo_tc\` o \`citar_jurisprudencia\` con rol \`${r.rol}\`.`,
          "",
        );
      } else {
        lines.push(
          "→ Si es PJUD: abre la URL, copia el texto y usa `citar_jurisprudencia`.",
          "",
        );
      }
    }
  } else {
    lines.push(
      "No hay candidatos recuperados automáticamente.",
      "",
      "→ Busca en los portales de arriba; no inventes el contenido del fallo.",
      "",
    );
  }
  if (res.warnings.length) {
    lines.push("### Advertencias", ...res.warnings.map((w) => `- ${w}`));
  }
  return lines.join("\n");
}

function toBlockquoteLocal(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=\.)\s+/)
    .slice(0, 6)
    .map((line) => `> ${line}`)
    .join("\n");
}
