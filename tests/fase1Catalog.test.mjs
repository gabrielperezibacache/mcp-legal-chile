import test from "node:test";
import assert from "node:assert/strict";
import {
  HOT_NORMAS,
  inferLegalArea,
  listHotNormas,
  resolveHotNorma,
} from "../dist/catalog.js";
import {
  listarNormasFrecuentes,
  resolverNormaFrecuente,
} from "../dist/sources/normaMapa.js";

test("HOT_NORMAS incluye COT, 19.880, Ley Karin y LOB", () => {
  assert.ok(HOT_NORMAS.length >= 12);
  assert.equal(resolveHotNorma("cot")?.idNorma, "25563");
  assert.equal(resolveHotNorma("19.880")?.idNorma, "210676");
  assert.equal(resolveHotNorma("ley karin")?.idNorma, "1200096");
  assert.equal(resolveHotNorma("lob")?.idNorma, "191865");
  assert.equal(resolveHotNorma("tutela laboral")?.idNorma, "207436");
  assert.equal(resolveHotNorma("20.600")?.idNorma, "1041361");
});

test("resolveHotNorma prefiere alias más largo", () => {
  // "codigo del trabajo" should win over shorter collisions
  const hot = resolveHotNorma("codigo del trabajo despido");
  assert.equal(hot?.idNorma, "207436");
});

test("listHotNormas filtra por área laboral", () => {
  const laboral = listHotNormas("laboral");
  assert.ok(laboral.some((n) => n.idNorma === "207436"));
  assert.ok(laboral.some((n) => n.idNorma === "1200096"));
  assert.ok(!laboral.some((n) => n.idNorma === "1984"));
});

test("inferLegalArea detecta laboral y constitucional", () => {
  assert.equal(inferLegalArea("despido injustificado tutela"), "laboral");
  assert.equal(inferLegalArea("recurso de protección art 19"), "constitucional");
  assert.equal(inferLegalArea("delito de hurto"), "penal");
});

test("listar_normas_frecuentes y resolver_norma_frecuente", () => {
  const list = listarNormasFrecuentes("administrativo");
  assert.ok(list.count >= 2);
  assert.match(list.markdown, /19\.880|18\.575|Karin/i);

  const resolved = resolverNormaFrecuente("Código del Trabajo");
  assert.equal(resolved.found, true);
  assert.equal(resolved.norma?.idNorma, "207436");

  const miss = resolverNormaFrecuente("xyz-norma-inventada-99");
  assert.equal(miss.found, false);
});
