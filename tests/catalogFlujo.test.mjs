import test from "node:test";
import assert from "node:assert/strict";
import {
  REQUIRED_STUDY_TOOLS,
  formatCatalogoFlujos,
  inferModoFromConsulta,
  inferTipoEscrito,
  listaAntecedentes,
  listaPruebaNormativa,
  mapEscritoToAntecedentes,
  resolveFlujoModo,
} from "../dist/catalogFlujo.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("formatCatalogoFlujos incluye flujos clave", () => {
  const md = formatCatalogoFlujos();
  assert.match(md, /Memo IRAC/);
  assert.match(md, /preparar_entregable/);
  assert.match(md, /legalchile:\/\/guia\/memo/);
  assert.match(md, /lista_antecedentes/);
});

test("listaAntecedentes laboral pide contrato y finiquito", () => {
  const md = listaAntecedentes({
    materia: "laboral",
    hechos: "despido verbal",
  });
  assert.match(md, /Contrato de trabajo/);
  assert.match(md, /finiquito/i);
  assert.match(md, /207436/);
  assert.match(md, /despido verbal/);
});

test("mapEscritoToAntecedentes alinea plantillas", () => {
  assert.equal(mapEscritoToAntecedentes("demanda_laboral"), "laboral");
  assert.equal(mapEscritoToAntecedentes("recurso_proteccion"), "proteccion");
  assert.equal(mapEscritoToAntecedentes("recurso_casacion"), "civil_general");
});

test("inferModoFromConsulta detecta seguimiento y escrito", () => {
  assert.equal(
    inferModoFromConsulta("últimos movimientos de la causa"),
    "seguimiento_causa",
  );
  assert.equal(
    inferModoFromConsulta("redactar recurso de protección"),
    "escrito",
  );
  assert.equal(inferModoFromConsulta("memo IRAC sobre arriendo"), "memo");
});

test("resolveFlujoModo auto infiere y modo explícito no", () => {
  const auto = resolveFlujoModo("auto", "demanda por despido injustificado");
  assert.equal(auto.modo, "escrito");
  assert.equal(auto.inferred, true);
  const fixed = resolveFlujoModo("memo", "demanda por despido");
  assert.equal(fixed.modo, "memo");
  assert.equal(fixed.inferred, false);
});

test("inferTipoEscrito detecta tutela y protección", () => {
  assert.equal(
    inferTipoEscrito("tutela laboral por discriminación"),
    "tutela_laboral",
  );
  assert.equal(
    inferTipoEscrito("recurso de protección contra municipalidad"),
    "recurso_proteccion",
  );
  assert.equal(inferTipoEscrito("despido injustificado"), "demanda_laboral");
});

test("listaPruebaNormativa sugiere artículos CT", () => {
  const md = listaPruebaNormativa({
    tema: "despido injustificado artículo 162",
  });
  assert.match(md, /207436/);
  assert.match(md, /Art\. 162/);
  assert.match(md, /obtener_articulo/);
  assert.match(md, /demanda_laboral/);
});

test("tools de catálogo v1.18 están registrados en workflow.ts", () => {
  const src = readFileSync(join(root, "src/tools/workflow.ts"), "utf8");
  for (const name of [
    "catalogo_flujos",
    "lista_antecedentes",
    "preparar_entregable",
  ]) {
    assert.match(src, new RegExp(`"${name}"`));
  }
  for (const name of REQUIRED_STUDY_TOOLS) {
    // Each required study tool should appear somewhere in src/tools
    const hit = ["workflow", "jurisprudencia", "dictamenes"].some((file) => {
      const body = readFileSync(join(root, `src/tools/${file}.ts`), "utf8");
      return body.includes(`"${name}"`);
    });
    assert.ok(hit, `missing registration for ${name}`);
  }
});

test("smoke.mjs exige tools de estudio", () => {
  const smoke = readFileSync(join(root, "scripts/smoke.mjs"), "utf8");
  assert.match(smoke, /preparar_entregable/);
  assert.match(smoke, /catalogo_flujos/);
  assert.match(smoke, /lista_antecedentes/);
});
