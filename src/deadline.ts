export class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`Timeout ${label} (${ms}ms)`);
    this.name = "DeadlineError";
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

/** True for deadline, AbortError, or aborted fetch — do not start slow fallbacks. */
export function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DeadlineError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "AbortError" ||
    /aborted|AbortError|Timeout |DeadlineError|The operation was aborted/i.test(
      message,
    )
  );
}

export function remainingMs(startedAt: number, budgetMs: number): number {
  return Math.max(0, budgetMs - (Date.now() - startedAt));
}

/** Runs fn with a deadline; aborts the shared signal when time is up. */
export async function runWithDeadline<T>(
  label: string,
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  if (ms <= 0) {
    throw new DeadlineError(label, 0);
  }
  throwIfAborted(parent);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parent?.addEventListener("abort", onParentAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DeadlineError(label, ms));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener("abort", onParentAbort);
  }
}
