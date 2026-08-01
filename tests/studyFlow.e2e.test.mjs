/**
 * Offline end-to-end chain of study-workflow helpers (no network).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  formatCatalogoFlujos,
  inferTipoEscrito,
  listaAntecedentes,
  listaPruebaNormativa,
  resolveFlujoModo,
} from "../dist/catalogFlujo.js";
import { resolverNormaFrecuente } from "../dist/normaFrecuente.js";
import { siguientePaso } from "../dist/siguientePaso.js";
import { formatAnexoCitas } from "../dist/studyExtras.js";
import { borradorMensajeCliente, plantillaEscrito } from "../dist/templates.js";
import { planFlujoEstudio } from "../dist/workflow.js";

test("cadena offline: consulta laboral → escrito → cliente", () => {
  const consulta = "demanda por despido injustificado";
  const catalog = formatCatalogoFlujos();
  assert.match(catalog, /preparar_entregable/);

  const { modo, inferred } = resolveFlujoModo("auto", consulta);
  assert.equal(modo, "escrito");
  assert.equal(inferred, true);

  const plan = planFlujoEstudio({ modo, consulta });
  assert.match(plan, /investigar_tema|plantilla_escrito|pegar_fallo_pjud/);

  const tipo = inferTipoEscrito(consulta);
  assert.equal(tipo, "demanda_laboral");

  const norma = resolverNormaFrecuente("código del trabajo");
  assert.match(norma, /207436/);

  const prueba = listaPruebaNormativa({ tema: consulta, tipo_escrito: tipo });
  assert.match(prueba, /obtener_articulo/);
  assert.match(prueba, /162/);

  const plantilla = plantillaEscrito({
    tipo,
    materia: consulta,
    hechos: "trabajador despedido sin carta",
  });
  assert.match(plantilla, /Pretensiones/);
  assert.match(plantilla, /POR VERIFICAR/);

  const anexo = formatAnexoCitas({
    citas: [
      {
        tipo: "norma",
        citation: "Código del Trabajo, art. 162",
        url: "https://www.bcn.cl/leychile/navegar?idNorma=207436",
        integrity: "verified",
        id_norma: "207436",
        articulo: "162",
      },
    ],
  });
  assert.match(anexo, /Citables \(verified\)/);

  const antecedentes = listaAntecedentes({
    materia: "laboral",
    hechos: consulta,
  });
  assert.match(antecedentes, /Contrato/);

  const borrador = borradorMensajeCliente({
    tipo: "solicitud_antecedentes",
    contexto: consulta,
    pedir_antecedentes: ["Contrato de trabajo", "Carta de despido"],
    destinatario: "Cliente",
  });
  assert.match(borrador, /Contrato de trabajo/);
  assert.match(borrador, /Notas internas/);

  const next = siguientePaso({ estado: "escrito_estructurado", consulta });
  assert.match(next, /anexo_citas/);
});

test("cadena offline: seguimiento causa → borrador", () => {
  const consulta = "movimientos de la causa C-1-2024";
  const { modo } = resolveFlujoModo("auto", consulta);
  assert.equal(modo, "seguimiento_causa");

  const plan = planFlujoEstudio({ modo, consulta, rol: "C-1-2024" });
  assert.match(
    plan,
    /obtener_causa_pjud|aviso_desde_causa|comparar_actuaciones/,
  );

  const borrador = borradorMensajeCliente({
    tipo: "actualizacion_causa",
    rol_o_rit: "C-1-2024",
    caratulado: "Pérez con Soto",
    contexto: "Estado: Tramitación\n- 01-05-2024 — Notificación",
  });
  assert.match(borrador, /Notificación/);
  assert.match(borrador, /C-1-2024/);

  const next = siguientePaso({ estado: "causa_obtenida" });
  assert.match(next, /borrador_mensaje_cliente|aviso_desde_causa/);
});
