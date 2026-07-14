import type { CitationResult } from "../types.js";
import { fetchText, stripHtml, uniqueByUrl } from "../util.js";

interface WebHit {
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

  // Fallback: uddg links if structured parse failed
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

export async function searchWeb(
  query: string,
  opts: { site?: string; limit?: number } = {},
): Promise<WebHit[]> {
  const limit = opts.limit ?? 8;
  const q = opts.site ? `${query} site:${opts.site}` : query;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const html = await fetchText(url, {
    headers: {
      Accept: "text/html",
      "Accept-Language": "es-CL,es;q=0.9",
    },
  });
  return uniqueByUrl(extractDuckDuckGoHits(html)).slice(0, limit);
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
  }));
}
