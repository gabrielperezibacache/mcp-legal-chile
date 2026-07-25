import test from "node:test";
import assert from "node:assert/strict";
import { parseLeyChileBuscadorHtml } from "../dist/sources/legislacion.js";
import { resolveHotNorma } from "../dist/catalog.js";

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
