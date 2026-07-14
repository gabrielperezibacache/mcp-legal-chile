import test from "node:test";
import assert from "node:assert/strict";
import { DeadlineError, remainingMs, runWithDeadline } from "../dist/deadline.js";

test("runWithDeadline aborta trabajo lento", async () => {
  await assert.rejects(
    () =>
      runWithDeadline("slow", 50, async (signal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    (error) => error instanceof DeadlineError,
  );
});

test("runWithDeadline deja pasar trabajo rápido", async () => {
  const value = await runWithDeadline("fast", 500, async () => "ok");
  assert.equal(value, "ok");
});

test("remainingMs no es negativo", () => {
  const started = Date.now() - 5_000;
  assert.equal(remainingMs(started, 3_000), 0);
  assert.ok(remainingMs(Date.now(), 1_000) > 0);
});
