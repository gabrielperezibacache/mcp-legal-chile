import type { CitationResult } from "../types.js";
import { formatChileanCitation } from "../citation.js";
import { webCache } from "../cache.js";
import { throwIfAborted } from "../deadline.js";
import { parseCaseIdentifiers } from "../parsers.js";
import {
  fetchText,
  isRetryableFetchError,
  stripHtml,
  uniqueByUrl,
  WEB_SEARCH_USER_AGENT,
  BOT_USER_AGENT,
} from "../util.js";

export interface WebHit {
  title: string;
  url: string;
  snippet?: string;
}

const WEB_SEARCH_TIMEOUT_MS = Number(
  process.env.WEB_SEARCH_TIMEOUT_MS ?? 5_000,
);
/** Short TTL so a DDG block does not burn every tool deadline for minutes. */
const WEB_FAIL_CACHE_MS = Number(process.env.WEB_FAIL_CACHE_MS ?? 180_000);

const failCache = new Map<string, number>();

function isFailCached(key: string): boolean {
  const until = failCache.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    failCache.delete(key);
    return false;
  }
  return true;
}

function markFail(key: string): void {
  failCache.set(key, Date.now() + WEB_FAIL_CACHE_MS);
}

function extractDuckDuckGoHits(html: string): WebHit[] {
  const hits: WebHit[] = [];
  const blockRe =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>)?/gi;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    const rawHref = match[1];
    const title = stripHtml(match[2] ?? "");
    const snippet = stripHtml(match[3] ?? match[4] ?? "");
    let url = rawHref;
    try {
      const parsed = new URL(rawHref, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      url = uddg ? decodeURIComponent(uddg) : parsed.toString();
    } catch {
      continue;
    }
    if (!title || !url.startsWith("http")) continue;
    hits.push({ title, url, snippet: snippet || undefined });
  }

  if (hits.length === 0) {
    const linkRe = /uddg=([^&"]+)/g;
    const seen = new Set<string>();
    while ((match = linkRe.exec(html)) !== null) {
      const url = decodeURIComponent(match[1]);
      if (seen.has(url) || !url.startsWith("http")) continue;
      seen.add(url);
      hits.push({ title: url, url });
    }
  }

  return hits;
}

/** Yahoo wraps outbound links in r.search.yahoo.com redirects with the real
 * target URL percent-encoded in the `RU=` path/query segment. */
function decodeYahooRedirect(rawUrl: string): string {
  const match =
    /[?&]RU=([^&/]+)/.exec(rawUrl) ?? /\/RU=([^/]+)\/RK=/.exec(rawUrl);
  if (!match) return rawUrl;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return rawUrl;
  }
}

function extractYahooHits(html: string): WebHit[] {
  const hits: WebHit[] = [];
  const blockRe =
    /<div class="compTitle[^"]*"[^>]*>[\s\S]*?<a[^>]*href="(https:\/\/r\.search\.yahoo\.com\/[^"]+)"[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>[\s\S]*?<div class="compText[^"]*">([\s\S]*?)<\/div>/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    const url = decodeYahooRedirect(match[1]);
    const title = stripHtml(match[2] ?? "");
    const snippet = stripHtml(match[3] ?? "");
    if (!title || !url.startsWith("http")) continue;
    // Skip Yahoo's own properties (mail/finance/shopping/news portals, etc.).
    if (/(^|\.)yahoo\.com$/i.test(new URL(url).hostname)) continue;
    hits.push({ title, url, snippet: snippet || undefined });
  }
  return hits;
}

async function fetchYahooHtml(
  query: string,
  signal?: AbortSignal,
): Promise<string> {
  const url = `https://search.yahoo.com/search?p=${encodeURIComponent(query)}`;
  return fetchText(
    url,
    {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
        "User-Agent": WEB_SEARCH_USER_AGENT,
      },
    },
    WEB_SEARCH_TIMEOUT_MS,
    signal,
  );
}

/** Yahoo occasionally 500s transiently (~1 in 5 requests); one quick retry
 * clears most of these without eating the tight search budget. */
async function searchYahoo(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<WebHit[]> {
  try {
    const html = await fetchYahooHtml(query, signal);
    return uniqueByUrl(extractYahooHits(html)).slice(0, limit);
  } catch (error) {
    throwIfAborted(signal);
    if (!isRetryableFetchError(error)) throw error;
    await new Promise((r) => setTimeout(r, 250));
    throwIfAborted(signal);
    const html = await fetchYahooHtml(query, signal);
    return uniqueByUrl(extractYahooHits(html)).slice(0, limit);
  }
}

function extractLiteHits(html: string): WebHit[] {
  const hits: WebHit[] = [];
  const re = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((match = re.exec(html)) !== null) {
    let url = match[1];
    const title = stripHtml(match[2] ?? "");
    try {
      const parsed = new URL(url, "https://lite.duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      url = uddg ? decodeURIComponent(uddg) : parsed.toString();
    } catch {
      continue;
    }
    if (!url.startsWith("http") || seen.has(url)) continue;
    if (/duckduckgo\.com/i.test(url)) continue;
    seen.add(url);
    hits.push({ title: title || url, url });
  }
  return hits;
}

async function searchDuckDuckGoHtml(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<WebHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(
    url,
    {
      headers: {
        Accept: "text/html",
        "Accept-Language": "es-CL,es;q=0.9",
        "User-Agent": BOT_USER_AGENT,
      },
    },
    WEB_SEARCH_TIMEOUT_MS,
    signal,
  );
  return uniqueByUrl(extractDuckDuckGoHits(html)).slice(0, limit);
}

async function searchDuckDuckGoLite(
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<WebHit[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(
    url,
    {
      headers: {
        Accept: "text/html",
        "Accept-Language": "es-CL,es;q=0.9",
        "User-Agent": BOT_USER_AGENT,
      },
    },
    WEB_SEARCH_TIMEOUT_MS,
    signal,
  );
  const hits = uniqueByUrl(extractLiteHits(html)).slice(0, limit);
  if (hits.length === 0) {
    // lite pages sometimes reuse classic classes
    return uniqueByUrl(extractDuckDuckGoHits(html)).slice(0, limit);
  }
  return hits;
}

/** Free web search via DuckDuckGo HTML, then lite fallback (best-effort). */
export async function searchWeb(
  query: string,
  opts: { site?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<WebHit[]> {
  throwIfAborted(opts.signal);
  const limit = opts.limit ?? 8;
  const q = opts.site ? `${query} site:${opts.site}` : query;
  const failKey = `webfail:${q}`;
  if (isFailCached(failKey)) {
    throw new Error(
      "Búsqueda web libre en enfriamiento tras bloqueo/vacío reciente. Usa portales oficiales o citar_jurisprudencia con texto.",
    );
  }

  const cacheKey = `web:v5:yahoo:${q}:${limit}`;
  return webCache.getOrSet(cacheKey, async () => {
    throwIfAborted(opts.signal);
    // Yahoo HTML SERP is the primary free backend: as of 2026 DuckDuckGo's
    // html/lite endpoints consistently return anti-bot CAPTCHA challenges
    // (status 202 + anomaly-modal) instead of results.
    try {
      const hits = await searchYahoo(q, limit, opts.signal);
      if (hits.length) return hits;
      throw new Error("Yahoo Search vacío");
    } catch (yahooError) {
      throwIfAborted(opts.signal);
      try {
        const html = await searchDuckDuckGoHtml(q, limit, opts.signal);
        if (html.length) return html;
        throw new Error("DuckDuckGo HTML vacío");
      } catch {
        throwIfAborted(opts.signal);
        try {
          const lite = await searchDuckDuckGoLite(q, limit, opts.signal);
          if (lite.length) return lite;
          markFail(failKey);
          throw new Error(
            `Búsqueda web libre sin resultados (posible bloqueo). ${yahooError instanceof Error ? yahooError.message : String(yahooError)}`,
          );
        } catch (liteError) {
          markFail(failKey);
          throw liteError instanceof Error
            ? liteError
            : new Error(String(liteError));
        }
      }
    }
  });
}

export function webHitsToCitations(
  hits: WebHit[],
  source: CitationResult["source"],
  publisher: string,
): CitationResult[] {
  return hits.map((hit) => {
    const ids = parseCaseIdentifiers(hit.title, hit.snippet ?? "");
    const rol = ids.rol;
    const tribunal = ids.tribunal;
    const anio = ids.anio;
    const tipo = ids.tipo ?? (rol ? "Sentencia" : undefined);
    let citation: string;
    if (rol) {
      citation = formatChileanCitation({
        tribunal: tribunal ?? publisher,
        tipo,
        rol,
        anio,
        url: hit.url,
      }).citation;
    } else {
      const short = hit.title.replace(/\s+/g, " ").trim().slice(0, 140);
      citation = short
        ? `Candidato (verificar): ${short}`
        : "Candidato (verificar): sin ROL parseado";
    }
    return {
      source,
      title: hit.title,
      citation,
      summary: hit.snippet,
      url: hit.url,
      publisher,
      evidence: "link_only" as const,
      rol,
      tribunal,
      rit: ids.rit,
      ruc: ids.ruc,
      metadata: {
        anio,
        tipo,
        integrity: "candidate",
      },
    };
  });
}
