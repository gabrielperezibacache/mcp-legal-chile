import { throwIfAborted } from "./deadline.js";
import { metrics } from "./metrics.js";
import {
  noteTerminalUpstreamFailure,
  upstreamHostKey,
  withUpstreamLimit,
} from "./upstream.js";

export const USER_AGENT =
  process.env.USER_AGENT ??
  "MCP-Legal-Chile/1.11 (conector MCP libre; https://mcp-legal-chile.onrender.com)";

/** Contact for OpenAlex/Crossref polite pools (higher rate limits). */
export function contactEmail(): string {
  return (
    process.env.CONTACT_EMAIL?.trim() ||
    "mcp-legal-chile@users.noreply.github.com"
  );
}

/** Append mailto= for OpenAlex / Crossref polite pool. */
export function politeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("mailto")) {
      u.searchParams.set("mailto", contactEmail());
    }
    return u.toString();
  } catch {
    return url;
  }
}

// Search/metadata calls must finish well before common MCP client limits (~60s).
// Long-running XML extraction passes an explicit timeout instead.
const DEFAULT_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS ?? 12_000);
const MAX_RETRY_AFTER_MS = Number(process.env.MAX_RETRY_AFTER_MS ?? 30_000);

export class HttpStatusError extends Error {
  status: number;
  url: string;
  retryAfterMs?: number;

  constructor(status: number, url: string, retryAfterMs?: number) {
    const retryHint =
      retryAfterMs != null
        ? ` (Retry-After ~${Math.ceil(retryAfterMs / 1000)}s)`
        : "";
    super(`HTTP ${status} al consultar ${url}${retryHint}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.url = url;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Parse Retry-After header (seconds or HTTP-date) to milliseconds. */
export function parseRetryAfterMs(
  header: string | null,
  now = Date.now(),
): number | undefined {
  if (!header?.trim()) return undefined;
  const raw = header.trim();
  if (/^\d+$/.test(raw)) {
    const sec = Number(raw);
    if (!Number.isFinite(sec) || sec < 0) return undefined;
    return Math.min(sec * 1000, MAX_RETRY_AFTER_MS);
  }
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return undefined;
  const delta = when - now;
  if (delta <= 0) return undefined;
  return Math.min(delta, MAX_RETRY_AFTER_MS);
}

export function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 429|HTTP 5\d\d|aborted|fetch failed|Circuito abierto/i.test(
    message,
  );
}

async function rawFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  throwIfAborted(signal);
  return withUpstreamLimit(url, async () => {
    // The signal may have aborted while this request waited for a provider slot.
    throwIfAborted(signal);
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          ...(init.headers ?? {}),
        },
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  });
}

function metricForUrl(url: string): string {
  const key = upstreamHostKey(url);
  return key === "leychile" ? "leychile_xml" : key;
}

function throwIfNotOk(response: Response, url: string): void {
  if (response.ok) return;
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  throw new HttpStatusError(response.status, url, retryAfterMs);
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<T> {
  return metrics.time(metricForUrl(url), async () => {
    const response = await rawFetch(
      url,
      {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      },
      timeoutMs,
      signal,
    );
    throwIfNotOk(response, url);
    return (await response.json()) as T;
  });
}

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<string> {
  return metrics.time(metricForUrl(url), async () => {
    const response = await rawFetch(url, init, timeoutMs, signal);
    throwIfNotOk(response, url);
    return await response.text();
  });
}

export async function fetchTextWithRetry(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 4,
  signal?: AbortSignal,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    throwIfAborted(signal);
    try {
      return await fetchText(url, init, timeoutMs, signal);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableFetchError(error);
      if (!retryable || attempt === retries - 1) break;
      const exponential = 1500 * 2 ** attempt;
      const fromHeader =
        error instanceof HttpStatusError ? error.retryAfterMs : undefined;
      const waitMs = Math.min(
        Math.max(exponential, fromHeader ?? 0),
        MAX_RETRY_AFTER_MS,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  const status =
    lastError instanceof HttpStatusError ? lastError.status : undefined;
  // Mid-attempt 429s do not open the circuit; count only the terminal exhaustion.
  if (status === 429) {
    noteTerminalUpstreamFailure(url, status);
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

export function escapeSparqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCharCode(Number.parseInt(n, 10)),
    );
}

export function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function urlDedupeKey(url: string): string {
  try {
    const parsed = new URL(url);
    // SPA routers (TC buscador) encode identity in the hash — keep it.
    if (parsed.hash.startsWith("#/")) {
      return parsed.toString();
    }
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function uniqueByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = urlDedupeKey(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function formatResultsJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
