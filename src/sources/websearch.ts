import type { CitationResult } from "../types.js";
import { webCache } from "../cache.js";
import { fetchJson, fetchText, stripHtml, uniqueByUrl } from "../util.js";

export interface WebHit {
  title: string;
  url: string;
  snippet?: string;
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

async function searchWithSerper(query: string, limit: number): Promise<WebHit[]> {
  const key = process.env.SEARCH_API_KEY ?? process.env.SERPER_API_KEY;
  if (!key) throw new Error("no search api key");
  const data = await fetchJson<{
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
  }>("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": key,
    },
    body: JSON.stringify({ q: query, num: limit }),
  });
  return (data.organic ?? [])
    .filter((r) => r.title && r.link)
    .map((r) => ({
      title: r.title!,
      url: r.link!,
      snippet: r.snippet,
    }));
}

async function searchWithBrave(query: string, limit: number): Promise<WebHit[]> {
  const key = process.env.BRAVE_API_KEY;
  if (!key) throw new Error("no brave key");
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const data = await fetchJson<{
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  }>(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
  });
  return (data.web?.results ?? [])
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: r.description,
    }));
}

async function searchDuckDuckGo(query: string, limit: number): Promise<WebHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, {
    headers: {
      Accept: "text/html",
      "Accept-Language": "es-CL,es;q=0.9",
    },
  });
  return uniqueByUrl(extractDuckDuckGoHits(html)).slice(0, limit);
}

export async function searchWeb(
  query: string,
  opts: { site?: string; limit?: number } = {},
): Promise<WebHit[]> {
  const limit = opts.limit ?? 8;
  const q = opts.site ? `${query} site:${opts.site}` : query;
  const cacheKey = `web:${q}:${limit}`;
  return webCache.getOrSet(cacheKey, async () => {
    const provider = (process.env.SEARCH_PROVIDER ?? "auto").toLowerCase();
    try {
      if (
        provider === "serper" ||
        (provider === "auto" &&
          (process.env.SEARCH_API_KEY || process.env.SERPER_API_KEY))
      ) {
        return uniqueByUrl(await searchWithSerper(q, limit)).slice(0, limit);
      }
      if (
        provider === "brave" ||
        (provider === "auto" && process.env.BRAVE_API_KEY)
      ) {
        return uniqueByUrl(await searchWithBrave(q, limit)).slice(0, limit);
      }
    } catch {
      /* fall through to DDG */
    }
    return searchDuckDuckGo(q, limit);
  });
}

export function webHitsToCitations(
  hits: WebHit[],
  source: CitationResult["source"],
  publisher: string,
): CitationResult[] {
  return hits.map((hit) => ({
    source,
    title: hit.title,
    citation: hit.title,
    summary: hit.snippet,
    url: hit.url,
    publisher,
    evidence: "link_only" as const,
  }));
}
