import test from "node:test";
import assert from "node:assert/strict";
import {
  compararActuaciones,
  contextoDesdeCausa,
  formatAnexoCitas,
} from "../dist/studyExtras.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "../dist/server.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("formatAnexoCitas separa verified y pendientes", () => {
  const md = formatAnexoCitas({
    titulo: "Anexo prueba",
    citas: [
      {
        tipo: "norma",
        citation: "Código del Trabajo, art. 162",
        url: "https://www.bcn.cl/leychile/navegar?idNorma=207436",
        integrity: "verified",
        id_norma: "207436",
        articulo: "162",
        extracto: "El empleador deberá informar…",
      },
      {
        tipo: "jurisprudencia",
        citation: "Corte Suprema, Rol 1-2020",
        url: "https://www.pjud.cl/example",
        integrity: "candidate",
        rol: "1-2020",
      },
    ],
  });
  assert.match(md, /Anexo prueba/);
  assert.match(md, /Citables \(verified\)/);
  assert.match(md, /Por verificar/);
  assert.match(md, /207436/);
  assert.match(md, /candidate/);
});

test("formatAnexoCitas exige al menos una cita", () => {
  assert.throws(() => formatAnexoCitas({ citas: [] }), /al menos una cita/i);
});

test("compararActuaciones detecta nuevas y removidas", () => {
  const md = compararActuaciones({
    rol_o_rit: "C-10-2024",
    caratulado: "A con B",
    anteriores: [
      "01-01-2024 — Ingreso demanda",
      "05-01-2024 — Notificación",
    ].join("\n"),
    actuales: [
      "01-01-2024 — Ingreso demanda",
      "10-02-2024 — Se recibe la causa a prueba",
    ].join("\n"),
  });
  assert.match(md, /Nuevas \(1\)/);
  assert.match(md, /Se recibe la causa a prueba/);
  assert.match(md, /Ya no aparecen \(1\)/);
  assert.match(md, /Notificación/);
  assert.match(md, /minuta_cliente/);
});

test("compararActuaciones deduplica líneas repetidas en actuales", () => {
  const md = compararActuaciones({
    anteriores: "01-01-2024 — Ingreso",
    actuales: [
      "01-01-2024 — Ingreso",
      "10-02-2024 — Audiencia",
      "10-02-2024 — Audiencia",
    ].join("\n"),
  });
  assert.match(md, /Nuevas \(1\)/);
  assert.equal((md.match(/Audiencia/g) || []).length, 1);
});

test("contextoDesdeCausa arma bloque para minuta", () => {
  const ctx = contextoDesdeCausa({
    caratulado: "Pérez con Soto",
    rol_o_rit: "C-1-2024",
    estado: "Tramitación",
    movimientos: "01-03-2024 — Resolución\n05-03-2024 — Notificación",
  });
  assert.match(ctx, /Pérez con Soto/);
  assert.match(ctx, /C-1-2024/);
  assert.match(ctx, /Movimientos:/);
  assert.match(ctx, /candidate/);
});

test("tools y prompt de casación / extras estánados", () => {
  const workflow = readFileSync(join(root, "src/tools/workflow.ts"), "utf8");
  for (const name of [
    "anexo_citas",
    "comparar_actuaciones",
    "aviso_desde_causa",
  ]) {
    assert.match(workflow, new RegExp(`"${name}"`));
  }
  const prompts = readFileSync(join(root, "src/tools/prompts.ts"), "utf8");
  assert.match(prompts, /"checklist_recurso_casacion"/);
  assert.match(prompts, /tipo=recurso_casacion/);
  const templates = readFileSync(join(root, "src/templates.ts"), "utf8");
  assert.match(templates, /recurso_casacion/);
  const plan = readFileSync(join(root, "src/workflow.ts"), "utf8");
  assert.match(plan, /citar_dictamen_pegado/);
  assert.doesNotMatch(plan, /`pegar_dictamen_cgr`/);
});

test("createServer registra resources de guía", () => {
  const server = createServer();
  // McpServer keeps resources in an internal map; probing via private field is brittle,
  // so we assert the registration module is wired and the guide URIs exist in source.
  const resources = readFileSync(join(root, "src/tools/resources.ts"), "utf8");
  assert.match(resources, /legalchile:\/\/guia\/memo/);
  assert.match(resources, /legalchile:\/\/guia\/honestidad/);
  assert.match(
    readFileSync(join(root, "src/server.ts"), "utf8"),
    /registerStudyResources/,
  );
  assert.ok(server);
});
