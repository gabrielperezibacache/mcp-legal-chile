import test from "node:test";
import assert from "node:assert/strict";
import { DeadlineError, runWithDeadline } from "../dist/deadline.js";

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
