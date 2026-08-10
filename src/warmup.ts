import { HOT_IDS_FOR_WARMUP } from "./catalog.js";
import { LeyChileRateLimitError, parseNormaTexto } from "./sources/normaTexto.js";

export type WarmupResult = {
  id: string;
  ok: boolean;
  error?: string;
  rateLimited?: boolean;
};

export type WarmupReport = {
  ok: boolean;
  warmed: WarmupResult[];
  offset: number;
  nextOffset: number;
  count: number;
  delayMs: number;
  totalHot: number;
};

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/** How many hot normas to warm per run (cron default 3, boot default 4). */
export function warmupCount(kind: "cron" | "boot"): number {
  const fallback = kind === "boot" ? 4 : 3;
  const max = kind === "boot" ? 6 : 8;
  return clampInt(process.env.WARMUP_COUNT, fallback, 1, max);
}

/** Pause between XML fetches to avoid LeyChile 429 storms. */
export function warmupDelayMs(): number {
  return clampInt(process.env.WARMUP_DELAY_MS, 2_000, 0, 15_000);
}

/**
 * Rotating window over HOT_IDS_FOR_WARMUP.
 * - WARMUP_OFFSET fixed (optional)
 * - else time-based rotate every WARMUP_ROTATE_MINUTES (default 30)
 */
export function warmupSlice(
  allIds: string[] = HOT_IDS_FOR_WARMUP,
  count = warmupCount("cron"),
  nowMs = Date.now(),
): { ids: string[]; offset: number; nextOffset: number } {
  if (!allIds.length) return { ids: [], offset: 0, nextOffset: 0 };
  const n = allIds.length;
  const fixed = process.env.WARMUP_OFFSET;
  let offset: number;
  if (fixed != null && fixed !== "" && Number.isFinite(Number(fixed))) {
    offset = ((Number(fixed) % n) + n) % n;
  } else {
    const rotateMin = clampInt(process.env.WARMUP_ROTATE_MINUTES, 30, 1, 24 * 60);
    offset = Math.floor(nowMs / (rotateMin * 60_000)) % n;
  }
  const ids: string[] = [];
  for (let i = 0; i < Math.min(count, n); i++) {
    ids.push(allIds[(offset + i) % n]!);
  }
  return { ids, offset, nextOffset: (offset + ids.length) % n };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Warm a rotating slice of hot normas with pacing (anti-429). */
export async function runWarmup(opts: {
  kind: "cron" | "boot";
  signal?: AbortSignal;
  onProgress?: (result: WarmupResult) => void;
}): Promise<WarmupReport> {
  const count = warmupCount(opts.kind);
  const delayMs = warmupDelayMs();
  const { ids, offset, nextOffset } = warmupSlice(HOT_IDS_FOR_WARMUP, count);
  const results: WarmupResult[] = [];

  for (let i = 0; i < ids.length; i++) {
    if (opts.signal?.aborted) break;
    const id = ids[i]!;
    let entry: WarmupResult;
    try {
      await parseNormaTexto(id, { signal: opts.signal });
      entry = { id, ok: true };
    } catch (error) {
      const rateLimited = error instanceof LeyChileRateLimitError;
      entry = {
        id,
        ok: false,
        rateLimited,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(entry);
    opts.onProgress?.(entry);
    if (i + 1 < ids.length) await sleep(delayMs);
  }

  return {
    ok: results.some((r) => r.ok) || results.length === 0,
    warmed: results,
    offset,
    nextOffset,
    count,
    delayMs,
    totalHot: HOT_IDS_FOR_WARMUP.length,
  };
}
