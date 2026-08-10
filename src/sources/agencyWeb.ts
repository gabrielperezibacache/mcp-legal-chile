import type { CitationResult } from "../types.js";
import {
  fetchText,
  stripHtml,
  uniqueByUrl,
  WEB_SEARCH_USER_AGENT,
} from "../util.js";
import { isAllowedHost } from "./hostAllowlist.js";
import { searchWeb, webHitsToCitations } from "./websearch.js";

/** Best-effort HTML body from an agency page (never invent text). */
export async function tryExtractAgencyBody(
  url: string,
  opts: {
    label: string;
    anchors: RegExp;
    timeoutMs?: number;
    signal?: AbortSignal;
    /** Required official domains; refuse extract otherwise. */
    allowedHosts?: readonly string[];
  },
): Promise<{ excerpt?: string; title?: string; warning?: string }> {
  if (opts.allowedHosts && !isAllowedHost(url, opts.allowedHosts)) {
    return {
      warning: `URL fuera de dominios oficiales (${opts.allowedHosts.join(", ")}): no se extrae ni se marca verified.`,
    };
  }
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
  allowedHosts?: readonly string[],
): CitationResult {
  if (allowedHosts && !isAllowedHost(hit.url, allowedHosts)) {
    return {
      ...hit,
      evidence: "link_only",
      metadata: {
        ...(hit.metadata ?? {}),
        integrity: "candidate",
        rejectedVerifiedReason: "non_official_host",
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
      excerptSource,
    },
  };
}

export async function searchAgencySites(opts: {
  query: string;
  limit: number;
  sites: ReadonlyArray<{
    site: string;
    publisher: string;
    /** Domains that may keep a hit (default: site itself). */
    allowedHosts?: readonly string[];
  }>;
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
  for (const { site, publisher, allowedHosts } of opts.sites) {
    const hosts = allowedHosts ?? [site];
    try {
      const hits = await searchWeb(opts.searchQuery, {
        site,
        limit: Math.max(3, Math.ceil(opts.limit / opts.sites.length)),
        signal: opts.signal,
      });
      const raw = webHitsToCitations(hits, opts.source, publisher);
      let dropped = 0;
      const official = raw.filter((hit) => {
        const ok = isAllowedHost(hit.url, hosts);
        if (!ok) dropped += 1;
        return ok;
      });
      if (dropped > 0) {
        warnings.push(
          `Se descartaron ${dropped} resultado(s) fuera de ${hosts.join("/")} (SERP contaminada).`,
        );
      }
      const citations = await Promise.all(
        official.map(async (hit) => {
          let enriched: CitationResult = {
            ...hit,
            publisher,
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
              allowedHosts: hosts,
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
                hosts,
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
