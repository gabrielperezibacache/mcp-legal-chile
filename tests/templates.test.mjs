import test from "node:test";
import assert from "node:assert/strict";
import { plantillaEscrito, minutaCliente } from "../dist/templates.js";
import { indiceConsiderandos } from "../dist/sources/indiceConsiderandos.js";
import { shouldRunPack } from "../dist/workflow.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const FALLO_FIXTURE = `
Corte Suprema
Sentencia de 12 de marzo de 2020
Rol 12345-2020

CONSIDERANDO:

Primero: Que la competencia del tribunal se encuentra establecida en la ley.

Segundo: Que el despido injustificado requiere acreditar la causal invocada por el empleador conforme al Código del Trabajo.

Tercero: Que la indemnización por años de servicio procede cuando no se justifica el término del contrato.

Por estas consideraciones se declara.
`.trim();

test("shouldRunPack solo en modos de investigación", () => {
  assert.equal(shouldRunPack("memo"), true);
  assert.equal(shouldRunPack("escrito"), true);
  assert.equal(shouldRunPack("consulta"), true);
  assert.equal(shouldRunPack("cita_rapida"), false);
  assert.equal(shouldRunPack("seguimiento_causa"), false);
});

test("plantillaEscrito demanda laboral incluye CT y pretensiones", () => {
  const md = plantillaEscrito({
    tipo: "demanda_laboral",
    materia: "despido",
    hechos: "trabajador despedido sin carta",
  });
  assert.match(md, /207436/);
  assert.match(md, /Pretensiones/);
  assert.match(md, /POR VERIFICAR/);
  assert.match(md, /No inventes/);
});

test("plantillaEscrito recurso de protección cita CPR", () => {
  const md = plantillaEscrito({ tipo: "recurso_proteccion", hechos: "acto" });
  assert.match(md, /242302/);
  assert.match(md, /art\. 20/);
});

test("plantillaEscrito tutela laboral y casación", () => {
  const tut = plantillaEscrito({
    tipo: "tutela_laboral",
    materia: "discriminación",
    hechos: "despido con vulneración",
  });
  assert.match(tut, /207436/);
  assert.match(tut, /tutela/i);
  assert.match(tut, /Qué falta verificar/);
  const cas = plantillaEscrito({
    tipo: "recurso_casacion",
    hechos: "sentencia de segunda instancia",
  });
  assert.match(cas, /22740/);
  assert.match(cas, /casaci/i);
  assert.match(cas, /anexo_citas|Qué falta verificar/);
});

test("minutaCliente actualizacion_causa usa solo contexto", () => {
  const md = minutaCliente({
    tipo: "actualizacion_causa",
    contexto: "Se dictó resolución que cita a audiencia el 10/04.",
    rol_o_rit: "C-1-2024",
    caratulado: "Pérez con Soto",
  });
  assert.match(md, /C-1-2024/);
  assert.match(md, /últimos movimientos/i);
  assert.match(md, /solo.*contexto/i);
  assert.match(md, /Se dictó resolución/);
});

test("indiceConsiderandos lista y rankea", () => {
  const md = indiceConsiderandos({
    texto: FALLO_FIXTURE,
    rol: "12345-2020",
    consulta: "despido injustificado",
  });
  assert.match(md, /Considerandos detectados:\*\* 3/);
  assert.match(md, /Ranking por consulta/);
  assert.match(md, /pegar_fallo_pjud/);
  assert.match(md, /Corte Suprema/);
});

test("indiceConsiderandos rechaza texto corto", () => {
  assert.throws(
    () => indiceConsiderandos({ texto: "corto" }),
    /demasiado corto/i,
  );
});

test("tools de workflow v1.16 están registrados", () => {
  const workflow = readFileSync(join(root, "src/tools/workflow.ts"), "utf8");
  for (const name of [
    "asesorar",
    "plantilla_escrito",
    "minuta_cliente",
    "flujo_estudio",
  ]) {
    assert.match(workflow, new RegExp(`"${name}"`));
  }
  const juris = readFileSync(join(root, "src/tools/jurisprudencia.ts"), "utf8");
  assert.match(juris, /"indice_considerandos"/);
});
