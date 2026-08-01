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
  resolveEntregableModo,
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
  assert.equal(inferTipoEscrito("despido y tutela"), "tutela_laboral");
  assert.equal(
    inferTipoEscrito("recurso de protección contra municipalidad"),
    "recurso_proteccion",
  );
  assert.equal(inferTipoEscrito("despido injustificado"), "demanda_laboral");
});

test("inferTipoEscrito no confunde protección de datos/consumidor con recurso", () => {
  assert.equal(inferTipoEscrito("protección de datos personales"), "generico");
  assert.equal(inferTipoEscrito("ley de protección al consumidor"), "generico");
});

test("inferModoFromConsulta prioriza memo y escrito sobre cita/seguimiento", () => {
  assert.equal(inferModoFromConsulta("memo sobre casación"), "memo");
  assert.equal(inferModoFromConsulta("tutela laboral"), "escrito");
  assert.equal(
    inferModoFromConsulta(
      "demanda citando artículo 162 del Código del Trabajo",
    ),
    "escrito",
  );
  assert.equal(
    inferModoFromConsulta("recurso de protección artículo 20 CPR"),
    "escrito",
  );
  assert.equal(
    inferModoFromConsulta("impugnar dictamen CGR con demanda contencioso"),
    "escrito",
  );
  assert.equal(
    inferModoFromConsulta("teoría de la causa en el contrato"),
    "consulta",
  );
  assert.equal(
    inferModoFromConsulta("memo sobre seguimiento de causa"),
    "memo",
  );
  assert.equal(
    inferModoFromConsulta("asesoría sobre movimientos de la causa"),
    "memo",
  );
  assert.equal(
    inferModoFromConsulta("qué dice el artículo 162 del Código del Trabajo"),
    "cita_rapida",
  );
});

test("inferTipoEscrito prioriza recursos sobre despido y evita familia genérica", () => {
  assert.equal(
    inferTipoEscrito("recurso de protección por despido de funcionario"),
    "recurso_proteccion",
  );
  assert.equal(
    inferTipoEscrito("recurso de protección laboral"),
    "recurso_proteccion",
  );
  assert.equal(
    inferTipoEscrito("casación en el fondo despido"),
    "recurso_casacion",
  );
  assert.equal(inferTipoEscrito("empresa familiar"), "generico");
  assert.equal(
    inferTipoEscrito("demanda de alimentos ante tribunal de familia"),
    "escrito_familia",
  );
  assert.equal(
    inferTipoEscrito("consulta cotizaciones previsionales AFP"),
    "generico",
  );
});

test("resolveEntregableModo no fuerza escrito en seguimiento/cita", () => {
  const seg = resolveEntregableModo("auto", "últimos movimientos de la causa");
  assert.equal(seg.modo, "memo");
  assert.equal(seg.sugerido, "seguimiento_causa");
  const cita = resolveEntregableModo("auto", "citar artículo 19 CPR");
  assert.equal(cita.modo, "memo");
  assert.equal(cita.sugerido, "cita_rapida");
  const esc = resolveEntregableModo("auto", "demanda por despido");
  assert.equal(esc.modo, "escrito");
  assert.equal(esc.sugerido, undefined);
  const fixed = resolveEntregableModo("escrito", "movimientos de la causa");
  assert.equal(fixed.modo, "escrito");
  assert.equal(fixed.inferred, false);
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

test("listaPruebaNormativa sugiere CPC en casación y tutela CT", () => {
  const cas = listaPruebaNormativa({
    tema: "recurso de casación en el fondo",
    tipo_escrito: "recurso_casacion",
  });
  assert.match(cas, /22740/);
  assert.match(cas, /Art\. 767|Art\. 764/);
  const tut = listaPruebaNormativa({
    tema: "tutela laboral discriminación",
    tipo_escrito: "tutela_laboral",
  });
  assert.match(tut, /207436/);
  assert.match(tut, /Art\. 485/);
});

test("tools de estudio están registrados", () => {
  const src = readFileSync(join(root, "src/tools/workflow.ts"), "utf8");
  for (const name of [
    "catalogo_flujos",
    "lista_antecedentes",
    "preparar_entregable",
  ]) {
    assert.match(src, new RegExp(`"${name}"`));
  }
  for (const name of REQUIRED_STUDY_TOOLS) {
    const hit = [
      "workflow",
      "jurisprudencia",
      "dictamenes",
      "legislacion",
      "causas",
      "meta",
    ].some((file) => {
      try {
        const body = readFileSync(join(root, `src/tools/${file}.ts`), "utf8");
        return body.includes(`"${name}"`);
      } catch {
        return false;
      }
    });
    assert.ok(hit, `missing registration for ${name}`);
  }
});

test("smoke.mjs exige tools de estudio", () => {
  const smoke = readFileSync(join(root, "scripts/smoke.mjs"), "utf8");
  assert.match(smoke, /preparar_entregable/);
  assert.match(smoke, /catalogo_flujos/);
  assert.match(smoke, /lista_antecedentes/);
  assert.match(smoke, /flujo_estudio/);
  assert.match(smoke, /indice_considerandos/);
  assert.match(smoke, /comparar_actuaciones/);
  for (const name of REQUIRED_STUDY_TOOLS) {
    assert.match(smoke, new RegExp(`"${name}"`));
  }
});
