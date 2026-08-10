import type { CitationResult } from "../types.js";
import {
  fetchText,
  stripHtml,
  uniqueByUrl,
  WEB_SEARCH_USER_AGENT,
} from "../util.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

/** Best-effort HTML body from an agency page (never invent text). */
export async function tryExtractAgencyBody(
  url: string,
  opts: {
    label: string;
    anchors: RegExp;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<{ excerpt?: string; title?: string; warning?: string }> {
  if (/\.pdf(\?|#|$)/i.test(url)) {
    return {
      warning: `URL PDF ${opts.label}: no se extrae texto binario; abre el PDF manualmente.`,
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
      opts.timeoutMs ?? 10_000,
      opts.signal,
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
        warning: `Página ${opts.label} sin cuerpo usable (portal JS o ficha mínima); se mantiene link_only.`,
      };
    }
    const anchor = text.search(opts.anchors);
    const start = anchor >= 0 ? Math.max(0, anchor - 80) : 0;
    const excerpt = text.slice(start, start + 1_200).trim();
    if (excerpt.length < 200) {
      return {
        title,
        warning: `Extracto ${opts.label} demasiado corto; link_only.`,
      };
    }
    return { excerpt, title };
  } catch (error) {
    return {
      warning: `No se pudo leer ficha ${opts.label}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function withAgencyExcerpt(
  hit: CitationResult,
  excerpt: string,
  excerptSource: string,
): CitationResult {
  return {
    ...hit,
    evidence: "full_text",
    summary: excerpt,
    metadata: {
      ...(hit.metadata ?? {}),
      integrity: "verified",
      excerptSource,
    },
  };
}

export async function searchAgencySites(opts: {
  query: string;
  limit: number;
  sites: ReadonlyArray<{ site: string; publisher: string }>;
  source: CitationResult["source"];
  searchQuery: string;
  signal?: AbortSignal;
  extract?: {
    label: string;
    anchors: RegExp;
    timeoutMs?: number;
    siteFilter?: string;
    excerptSource: string;
  };
}): Promise<{ results: CitationResult[]; warnings: string[] }> {
  const results: CitationResult[] = [];
  const warnings: string[] = [];
  for (const { site, publisher } of opts.sites) {
    try {
      const hits = await searchWeb(opts.searchQuery, {
        site,
        limit: Math.max(3, Math.ceil(opts.limit / opts.sites.length)),
        signal: opts.signal,
      });
      const citations = await Promise.all(
        webHitsToCitations(hits, opts.source, publisher).map(async (hit) => {
          let enriched: CitationResult = {
            ...hit,
            evidence: "link_only",
            metadata: {
              ...(hit.metadata ?? {}),
              integrity: "candidate",
              agencySite: site,
            },
          };
          if (
            opts.extract &&
            hit.url &&
            !/\.pdf(\?|#|$)/i.test(hit.url) &&
            (!opts.extract.siteFilter || site === opts.extract.siteFilter)
          ) {
            const body = await tryExtractAgencyBody(hit.url, {
              label: opts.extract.label,
              anchors: opts.extract.anchors,
              timeoutMs: opts.extract.timeoutMs,
              signal: opts.signal,
            });
            if (body.warning) warnings.push(body.warning);
            if (body.excerpt) {
              enriched = withAgencyExcerpt(
                {
                  ...enriched,
                  title: body.title ?? enriched.title,
                },
                body.excerpt,
                opts.extract.excerptSource,
              );
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
  return { results: uniqueByUrl(results).slice(0, opts.limit), warnings };
}
