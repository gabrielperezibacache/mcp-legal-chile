import type { CitationResult, SearchResponse } from "../types.js";
import { parseCaseIdentifiers } from "../parsers.js";
import {
  fetchText,
  stripHtml,
  uniqueByUrl,
  WEB_SEARCH_USER_AGENT,
} from "../util.js";
import {
  CGR_HOSTS,
  DIPRES_HOSTS,
  isAllowedHost,
  publisherForOfficialUrl,
} from "./hostAllowlist.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

/** CGR numbers: classic N° or expediente-style E370813/2023. */
function extractDictamenNumber(query: string): string | undefined {
  const expediente = query.match(
    /\b([Ee]\d{4,8}\s*[-/]\s*\d{2,4})\b/,
  );
  if (expediente?.[1]) return expediente[1].replace(/\s+/g, "");
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
  if (!isAllowedHost(url, CGR_HOSTS)) {
    return {
      warning:
        "URL fuera de contraloria.cl: no se extrae ni se marca verified (evitar atribución falsa).",
    };
  }
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
  if (!isAllowedHost(hit.url, CGR_HOSTS)) {
    return {
      ...hit,
      evidence: "link_only",
      metadata: {
        ...(hit.metadata ?? {}),
        integrity: "candidate",
        rejectedVerifiedReason: "non_cgr_host",
      },
    };
  }
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

/** Drop SERP noise; never keep off-domain hits in the CGR/DIPRES buckets. */
export function filterOfficialDictamenHits(
  hits: CitationResult[],
  allowedDomains: readonly string[],
): { kept: CitationResult[]; dropped: number } {
  const kept: CitationResult[] = [];
  let dropped = 0;
  for (const hit of hits) {
    if (!isAllowedHost(hit.url, allowedDomains)) {
      dropped += 1;
      continue;
    }
    const publisher = publisherForOfficialUrl(hit.url, [
      { domains: CGR_HOSTS, publisher: "Contraloría General de la República" },
      { domains: DIPRES_HOSTS, publisher: "Dirección de Presupuestos" },
    ]);
    kept.push({
      ...hit,
      publisher: publisher ?? hit.publisher,
      evidence: "link_only",
      metadata: {
        ...(hit.metadata ?? {}),
        integrity: "candidate",
      },
    });
  }
  return { kept, dropped };
}

export async function searchDictamenes(
  query: string,
  limit = 8,
  opts: { signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  const warnings: string[] = [
    "Solo se aceptan URLs en contraloria.cl / dipres.gob.cl. Sin cuerpo HTML oficial: evidence=link_only. verified solo con extracto de ficha CGR.",
  ];
  const results: CitationResult[] = [];
  const dictamenNumber = extractDictamenNumber(query);

  if (dictamenNumber) {
    const cgrSearch = cgrSearchUrl(dictamenNumber);
    const portalHit: CitationResult = {
      source: "dictamenes",
      title: `[Candidato · verificar] Dictamen N° ${dictamenNumber} — búsqueda portal CGR`,
      citation: `Dictamen N° ${dictamenNumber} (enlace de búsqueda; texto no recuperado)`,
      url: cgrSearch,
      publisher: "Contraloría General de la República",
      id: dictamenNumber,
      evidence: "link_only",
      summary:
        "NO es el texto del dictamen. Solo un enlace de búsqueda al portal CGR por número. Confirma existencia y texto íntegro en Contraloría antes de citar.",
      metadata: {
        integrity: "candidate",
        portalGenerico:
          "https://www.contraloria.cl/web/cgr/dictamenes-y-pronunciamientos-juridicos",
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
      hosts: CGR_HOSTS,
    },
    {
      site: "dipres.gob.cl",
      publisher: "Dirección de Presupuestos",
      hosts: DIPRES_HOSTS,
    },
  ] as const;

  for (const { site, publisher, hosts } of sites) {
    try {
      const hits = await searchWeb(
        dictamenNumber ? `dictamen ${dictamenNumber}` : `${query} dictamen`,
        {
          site,
          limit: Math.max(3, Math.ceil(limit / sites.length)),
          signal: opts.signal,
        },
      );
      const raw = webHitsToCitations(hits, "dictamenes", publisher);
      const { kept, dropped } = filterOfficialDictamenHits(raw, hosts);
      if (dropped > 0) {
        warnings.push(
          `Se descartaron ${dropped} resultado(s) fuera de ${hosts.join("/") } (SERP contaminada).`,
        );
      }
      const citations = await Promise.all(
        kept.map(async (hit) => {
          const ids = parseCaseIdentifiers(hit.title, hit.summary ?? "");
          let enriched: CitationResult = {
            ...hit,
            evidence: "link_only",
            id: ids.dictamen ?? hit.id,
            citation: ids.dictamen
              ? `Dictamen N° ${ids.dictamen}`
              : hit.citation,
            metadata: {
              ...(hit.metadata ?? {}),
              integrity: "candidate",
            },
          };
          if (
            isAllowedHost(hit.url, CGR_HOSTS) &&
            hit.url &&
            !/\.pdf(\?|#|$)/i.test(hit.url)
          ) {
            const body = await tryExtractCgrBody(hit.url, opts.signal);
            if (body.warning) warnings.push(body.warning);
            if (body.excerpt) {
              enriched = withOptionalExcerpt(enriched, body.excerpt);
            }
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
      "No se indexaron dictámenes oficiales. Usa el buscador de la Contraloría; no cites resultados web genéricos.",
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
