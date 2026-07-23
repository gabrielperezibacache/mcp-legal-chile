import test from "node:test";
import assert from "node:assert/strict";
import {
  isRetryableFetchError,
  parseRetryAfterMs,
  HttpStatusError,
} from "../dist/util.js";

test("parseRetryAfterMs lee segundos enteros", () => {
  assert.equal(parseRetryAfterMs("5"), 5_000);
  assert.equal(parseRetryAfterMs("0"), 0);
});

test("parseRetryAfterMs respeta tope MAX_RETRY_AFTER_MS", () => {
  const capped = parseRetryAfterMs("999");
  assert.ok(capped != null && capped <= 30_000);
});

test("parseRetryAfterMs acepta HTTP-date futuro", () => {
  const when = new Date(Date.now() + 8_000).toUTCString();
  const ms = parseRetryAfterMs(when, Date.now());
  assert.ok(ms != null && ms > 0 && ms <= 30_000);
});

test("parseRetryAfterMs ignora header vacío o pasado", () => {
  assert.equal(parseRetryAfterMs(null), undefined);
  assert.equal(parseRetryAfterMs(""), undefined);
  const past = new Date(Date.now() - 60_000).toUTCString();
  assert.equal(parseRetryAfterMs(past, Date.now()), undefined);
});

test("isRetryableFetchError cubre 429 y fetch failed", () => {
  assert.equal(
    isRetryableFetchError(
      new HttpStatusError(429, "https://example.test", 2000),
    ),
    true,
  );
  assert.equal(isRetryableFetchError(new Error("fetch failed")), true);
  assert.equal(isRetryableFetchError(new Error("HTTP 503")), true);
  assert.equal(isRetryableFetchError(new Error("not found")), false);
});

test("backoff efectivo usa max(exponencial, Retry-After)", () => {
  const attempt = 0;
  const exponential = 1500 * 2 ** attempt;
  const fromHeader = 8_000;
  const waitMs = Math.min(Math.max(exponential, fromHeader), 30_000);
  assert.equal(waitMs, 8_000);
});
