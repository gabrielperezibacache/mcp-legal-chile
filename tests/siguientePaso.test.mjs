import test from "node:test";
import assert from "node:assert/strict";
import { guiaDiaTipico, siguientePaso } from "../dist/siguientePaso.js";
import { borradorMensajeCliente } from "../dist/templates.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("siguientePaso pack_listo apunta a prueba normativa", () => {
  const md = siguientePaso({ estado: "pack_listo", consulta: "despido" });
  assert.match(md, /lista_prueba_normativa/);
  assert.match(md, /obtener_articulo/);
  assert.match(md, /despido/);
});

test("siguientePaso causa_obtenida apunta a borrador", () => {
  const md = siguientePaso({ estado: "causa_obtenida" });
  assert.match(md, /borrador_mensaje_cliente|aviso_desde_causa/);
  assert.match(md, /comparar_actuaciones/);
});

test("guiaDiaTipico menciona mañana y tarde", () => {
  const md = guiaDiaTipico();
  assert.match(md, /Mañana/);
  assert.match(md, /Tarde/);
  assert.match(md, /asesorar/);
  assert.match(md, /obtener_causa_pjud/);
});

test("borradorMensajeCliente no inventa movimientos", () => {
  const md = borradorMensajeCliente({
    tipo: "actualizacion_causa",
    rol_o_rit: "C-9-2024",
    caratulado: "X con Y",
    destinatario: "María",
    contexto: "Estado: Tramitación\n- 01-04-2024 — Se recibe la causa a prueba",
  });
  assert.match(md, /María/);
  assert.match(md, /C-9-2024/);
  assert.match(md, /Se recibe la causa a prueba/);
  assert.doesNotMatch(md, /sentencia definitiva/i);
  assert.match(md, /Notas internas/);
});

test("borrador solicitud usa lista explícita", () => {
  const md = borradorMensajeCliente({
    tipo: "solicitud_antecedentes",
    contexto: "Caso laboral",
    pedir_antecedentes: ["Contrato", "Finiquito"],
  });
  assert.match(md, /1\. Contrato/);
  assert.match(md, /2\. Finiquito/);
});

test("resources incluyen dia-tipico y tools nuevas", () => {
  const resources = readFileSync(join(root, "src/tools/resources.ts"), "utf8");
  assert.match(resources, /legalchile:\/\/guia\/dia-tipico/);
  const workflow = readFileSync(join(root, "src/tools/workflow.ts"), "utf8");
  assert.match(workflow, /"borrador_mensaje_cliente"/);
  assert.match(workflow, /"siguiente_paso"/);
});
