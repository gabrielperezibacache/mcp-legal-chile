import test from "node:test";
import assert from "node:assert/strict";
import { isAbortLikeError, DeadlineError } from "../dist/deadline.js";
import { normalizeTcSearchQuery } from "../dist/sources/tcBuscador.js";

test("normalizeTcSearchQuery quita stopwords que vacían el AND del TC", () => {
  assert.equal(normalizeTcSearchQuery("derecho a la vida"), "derecho vida");
  assert.equal(
    normalizeTcSearchQuery("protección de datos personales"),
    "protección datos personales",
  );
  assert.equal(normalizeTcSearchQuery("9666-2020"), "9666-2020");
});

test("normalizeTcSearchQuery conserva tokens útiles", () => {
  assert.equal(normalizeTcSearchQuery("habeas corpus"), "habeas corpus");
  assert.equal(normalizeTcSearchQuery("  despido injustificado  "), "despido injustificado");
});

test("isAbortLikeError detecta abort/timeout", () => {
  assert.equal(isAbortLikeError(new DeadlineError("x", 1)), true);
  assert.equal(isAbortLikeError(new DOMException("Aborted", "AbortError")), true);
  assert.equal(isAbortLikeError(new Error("The operation was aborted")), true);
  assert.equal(isAbortLikeError(new Error("HTTP 500")), false);
});

test("uniqueByUrl conserva fichas TC con hash SPA", async () => {
  const { uniqueByUrl } = await import("../dist/util.js");
  const items = [
    { url: "https://buscador.tcchile.cl/#/ficha/5174" },
    { url: "https://buscador.tcchile.cl/#/ficha/7418" },
    { url: "https://buscador.tcchile.cl/#/ficha/5174" },
    { url: "https://example.com/page?q=1#section" },
    { url: "https://example.com/page?q=1#other" },
  ];
  const out = uniqueByUrl(items);
  assert.equal(out.length, 3);
  assert.equal(out[0].url, "https://buscador.tcchile.cl/#/ficha/5174");
  assert.equal(out[1].url, "https://buscador.tcchile.cl/#/ficha/7418");
  assert.equal(out[2].url, "https://example.com/page?q=1#section");
});
