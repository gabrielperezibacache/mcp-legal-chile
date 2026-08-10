import type { CitationResult, SearchResponse } from "../types.js";
import { parseCaseIdentifiers } from "../parsers.js";
import {
  fetchText,
  stripHtml,
  uniqueByUrl,
  WEB_SEARCH_USER_AGENT,
} from "../util.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

function extractDictamenNumber(query: string): string | undefined {
  const match = query.match(
    /(?:dictamen(?:es)?|n[ºo°.]?)\s*([0-9]{1,6}(?:\s*[-/]\s*[0-9]{2,4})?)/i,
  );
  return match?.[1]?.replace(/\s+/g, "");
}

function cgrSearchUrl(dictamenNumber: string): string {
  return `https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos?p_p_id=buscadordictamenes_WAR_buscadordictamenesportlet&p_p_lifecycle=0&_buscadordictamenes_WAR_buscadordictamenesportlet_numero=${encodeURIComponent(dictamenNumber)}`;
}

/** Best-effort body extraction from a public CGR HTML page. */
export async function tryExtractCgrBody(
  url: string,
  signal?: AbortSignal,
): Promise<{ excerpt?: string; title?: string; warning?: string }> {
  if (/\.pdf(\?|#|$)/i.test(url)) {
    return {
      warning:
        "URL PDF CGR: no se extrae texto binario; abre el PDF manualmente.",
    };
  }
  try {
    const html = await fetchText(
      url,
      {
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "User-Agent": WEB_SEARCH_USER_AGENT,
        },
      },
      Number(process.env.CGR_FETCH_TIMEOUT_MS ?? 10_000),
      signal,
    );
    if (html.startsWith("%PDF")) {
      return { warning: "Respuesta PDF binaria; no se extrajo cuerpo." };
    }
    const title =
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || undefined;
    const text = stripHtml(html).replace(/\s+/g, " ").trim();
    if (text.length < 280) {
      return {
        title,
        warning:
          "Página CGR sin cuerpo usable (portal JS o ficha mínima); se mantiene link_only.",
      };
    }
    const anchor = text.search(/\bdictamen\b/i);
    const start = anchor >= 0 ? Math.max(0, anchor - 80) : 0;
    const excerpt = text.slice(start, start + 1_200).trim();
    return excerpt.length >= 200
      ? { excerpt, title }
      : { title, warning: "Extracto CGR demasiado corto; link_only." };
  } catch (error) {
    return {
      warning: `No se pudo leer ficha CGR: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function withOptionalExcerpt(
  hit: CitationResult,
  excerpt?: string,
): CitationResult {
  if (!excerpt) return hit;
  return {
    ...hit,
    evidence: "full_text",
    summary: excerpt,
    metadata: {
      ...(hit.metadata ?? {}),
      integrity: "verified",
      excerptSource: "cgr_html",
    },
  };
}

export async function searchDictamenes(
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Sin cuerpo HTML: evidencia=link_only. Con extracto de ficha pública: integrity=verified (confirma íntegro en CGR).",
  ];
  const results: CitationResult[] = [];
  const dictamenNumber = extractDictamenNumber(query);

  if (dictamenNumber) {
    const cgrSearch = cgrSearchUrl(dictamenNumber);
    const ddgDeep = `https://duckduckgo.com/?q=${encodeURIComponent(`dictamen ${dictamenNumber} site:contraloria.cl`)}`;
    const portalHit: CitationResult = {
      source: "dictamenes",
      title: `[Candidato · verificar] Dictamen N° ${dictamenNumber} — búsqueda portal CGR`,
      citation: `Dictamen N° ${dictamenNumber} (enlace de búsqueda; texto no recuperado)`,
      url: cgrSearch,
      secondaryUrl: ddgDeep,
      publisher: "Contraloría General de la República",
      id: dictamenNumber,
      evidence: "link_only",
      summary:
        "NO es el texto del dictamen. Solo un enlace de búsqueda al portal CGR por número. Confirma existencia y texto íntegro en Contraloría antes de citar.",
      metadata: {
        integrity: "candidate",
        portalGenerico:
          "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
        busquedaSugerida: ddgDeep,
      },
    };
    const extracted = await tryExtractCgrBody(cgrSearch, opts.signal);
    if (extracted.warning) warnings.push(extracted.warning);
    results.push(
      extracted.excerpt
        ? withOptionalExcerpt(
            {
              ...portalHit,
              title:
                extracted.title ??
                `Dictamen N° ${dictamenNumber} — extracto CGR`,
              citation: `Dictamen N° ${dictamenNumber} (extracto HTML CGR; verificar íntegro)`,
              summary: extracted.excerpt,
            },
            extracted.excerpt,
          )
        : portalHit,
    );
  }

  const sites = [
    {
      site: "contraloria.cl",
      publisher: "Contraloría General de la República",
    },
    {
      site: "dipres.gob.cl",
      publisher: "Dirección de Presupuestos",
    },
  ] as const;

  for (const { site, publisher } of sites) {
    try {
      const hits = await searchWeb(
        dictamenNumber ? `dictamen ${dictamenNumber}` : `${query} dictamen`,
        {
          site,
          limit: Math.max(3, Math.ceil(limit / sites.length)),
          signal: opts.signal,
        },
      );
      const citations = await Promise.all(
        webHitsToCitations(hits, "dictamenes", publisher).map(async (hit) => {
          const ids = parseCaseIdentifiers(hit.title, hit.summary ?? "");
          let enriched: CitationResult = {
            ...hit,
            evidence: "link_only" as const,
            id: ids.dictamen ?? hit.id,
            citation: ids.dictamen
              ? `Dictamen N° ${ids.dictamen}`
              : hit.citation,
          };
          if (
            site === "contraloria.cl" &&
            hit.url &&
            !/\.pdf(\?|#|$)/i.test(hit.url)
          ) {
            const body = await tryExtractCgrBody(hit.url, opts.signal);
            if (body.warning) warnings.push(body.warning);
            if (body.excerpt) enriched = withOptionalExcerpt(enriched, body.excerpt);
          }
          return enriched;
        }),
      );
      results.push(...citations);
    } catch (error) {
      warnings.push(
        `No se pudo consultar ${site}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const deduped = uniqueByUrl(results).slice(0, limit);
  if (deduped.length === 0) {
    warnings.push(
      "No se indexaron dictámenes automáticamente. Usa el buscador oficial de la Contraloría.",
    );
  }

  return {
    query,
    source: "dictamenes",
    results: deduped,
    warnings,
    searchUrls: {
      contraloria:
        "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
      busquedaSugerida: `https://duckduckgo.com/?q=${encodeURIComponent(
        `${query} dictamen site:contraloria.cl`,
      )}`,
    },
  };
}

export async function resolverDictamen(
  numero: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  return searchDictamenes(`dictamen ${numero}`, 5, { signal: opts.signal });
}
