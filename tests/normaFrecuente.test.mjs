import test from "node:test";
import assert from "node:assert/strict";
import {
  listarNormasFrecuentes,
  resolverNormaFrecuente,
} from "../dist/normaFrecuente.js";

test("resolverNormaFrecuente resuelve Código del Trabajo", () => {
  const md = resolverNormaFrecuente("código del trabajo");
  assert.match(md, /207436/);
  assert.match(md, /obtener_articulo/);
  assert.match(md, /candidate/);
});

test("resolverNormaFrecuente sugiere buscar si no hay alias", () => {
  const md = resolverNormaFrecuente("ley inventada xyz 99999");
  assert.match(md, /buscar_legislacion/);
  assert.match(md, /listar_normas_frecuentes/);
});

test("listarNormasFrecuentes incluye CPR y CT", () => {
  const md = listarNormasFrecuentes();
  assert.match(md, /242302/);
  assert.match(md, /207436/);
  assert.match(md, /210676/);
});
