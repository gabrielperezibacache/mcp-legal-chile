import test from "node:test";
import assert from "node:assert/strict";
import { searchJurisprudencia } from "../dist/sources/jurisprudencia.js";

test("searchJurisprudencia con upstream caído entrega portal stubs + warning", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };
  try {
    const res = await searchJurisprudencia("despido injustificado", 4, {
      signal: AbortSignal.timeout(4_000),
    });
    assert.ok(res.results.length >= 1, "debe haber al menos stubs de portal");
    assert.ok(
      res.results.every(
        (r) =>
          r.metadata?.integrity === "portal_stub" || r.evidence === "link_only",
      ),
    );
    assert.ok(
      res.results.some((r) => /pjud\.cl/i.test(r.url)),
      "incluye portal PJUD",
    );
    assert.ok(
      res.warnings?.some((w) =>
        /temporalmente limitada|portales oficiales|No se indexaron/i.test(w),
      ),
      `warnings: ${JSON.stringify(res.warnings)}`,
    );
  } finally {
    globalThis.fetch = original;
  }
});
