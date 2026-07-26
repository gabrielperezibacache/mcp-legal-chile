import test from "node:test";
import assert from "node:assert/strict";
import {
  extractLawNumber,
  parseLeyChileBuscadorHtml,
  searchLegislacion,
} from "../dist/sources/legislacion.js";
import { resolveHotNorma } from "../dist/catalog.js";
import { resetUpstreamForTests, upstreamStatus } from "../dist/upstream.js";

const FIXTURE = `
<html><body>
  <a href="/leychile/navegar?idNorma=207436">C&oacute;digo del Trabajo</a>
  <a href="https://www.bcn.cl/leychile/navegar?idNorma=172986">Código Civil</a>
  <a href="/leychile/navegar?idNorma=207436">duplicado</a>
</body></html>
`;

test("parseLeyChileBuscadorHtml extrae idNorma y títulos", () => {
  const results = parseLeyChileBuscadorHtml(FIXTURE, 8);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, "207436");
  assert.match(results[0].title, /Trabajo/i);
  assert.equal(results[0].evidence, "metadata");
  assert.equal(results[0].metadata?.integrity, "candidate");
  assert.equal(results[1].id, "172986");
});

test("catálogo hot resuelve despido injustificado → Código del Trabajo", () => {
  const hot = resolveHotNorma("despido injustificado indemnización");
  assert.ok(hot);
  assert.equal(hot.idNorma, "207436");
});

test("catálogo hot no confunde alias cortos con substrings de otras palabras", () => {
  // "protección" contiene las letras "cc" (alias de Código Civil) pero no
  // debe matchear: el alias sólo debe activarse como palabra completa.
  assert.equal(resolveHotNorma("protección de datos personales"), undefined);
  assert.equal(resolveHotNorma("circular sobre construcción"), undefined);
  assert.equal(resolveHotNorma("arriendo de inmuebles urbanos"), undefined);
});

test("catálogo hot sigue resolviendo alias cortos como palabra completa", () => {
  assert.equal(resolveHotNorma("cc")?.idNorma, "172986");
  assert.equal(resolveHotNorma("recurso cc")?.idNorma, "172986");
  assert.equal(resolveHotNorma("ct")?.idNorma, "207436");
  assert.equal(resolveHotNorma("texto del cpc")?.idNorma, "22740");
});

test("extractLawNumber no trata años sueltos como número de ley", () => {
  assert.equal(extractLawNumber("reforma 2024"), undefined);
  assert.equal(extractLawNumber("ley 19628"), "19628");
  assert.equal(extractLawNumber("19.628"), "19628");
  assert.equal(extractLawNumber("207436"), "207436");
});

test("searchLegislacion multi-fallback no abre circuito bcn con varios HTTP 500", async () => {
  resetUpstreamForTests();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const u = String(url);
    // Fail every BCN/SPARQL/HTML attempt so all stages error.
    if (u.includes("bcn.cl") || u.includes("datos.bcn")) {
      return {
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () => "err",
        json: async () => ({}),
      };
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  try {
    const res = await searchLegislacion("indemnización por despido laboral", 3);
    assert.equal(res.results.length, 0);
    assert.ok(calls >= 2, `esperaba varias etapas, got ${calls}`);
    // One terminal count max — circuit must stay closed (threshold 3).
    assert.equal(upstreamStatus().bcn.open, false);
    assert.ok(
      upstreamStatus().bcn.failures <= 1,
      `failures=${upstreamStatus().bcn.failures}`,
    );
  } finally {
    globalThis.fetch = original;
    resetUpstreamForTests();
  }
});
