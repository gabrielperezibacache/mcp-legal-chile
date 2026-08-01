import test from "node:test";
import assert from "node:assert/strict";
import { planFlujoEstudio } from "../dist/workflow.js";
import { citarDictamenPegado } from "../dist/sources/dictamenQuote.js";
import { resolveHotNorma } from "../dist/catalog.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("flujo_estudio memo pide investigar_tema e IRAC", () => {
  const plan = planFlujoEstudio({
    modo: "memo",
    consulta: "despido injustificado",
  });
  assert.match(plan, /modo `memo`/);
  assert.match(plan, /investigar_tema/);
  assert.match(plan, /IRAC/);
  assert.match(plan, /pegar_fallo_pjud/);
});

test("flujo_estudio seguimiento_causa usa tools PJUD", () => {
  const plan = planFlujoEstudio({
    modo: "seguimiento_causa",
    consulta: "estado de causa",
    rol: "C-1234-2024",
  });
  assert.match(plan, /obtener_causa_pjud/);
  assert.match(plan, /candidate/);
});

test("citarDictamenPegado formatea texto aportado", () => {
  const quote = citarDictamenPegado({
    numero: "12345N20",
    texto: [
      "Contraloría General de la República",
      "Dictamen N° 12345N20 de 15 de marzo de 2020.",
      "Se ha solicitado un pronunciamiento acerca de la legalidad del acto administrativo impugnado.",
      "Sobre el particular, esta Contraloría cumple con informar que el órgano debe observar el procedimiento de la ley 19.880.",
      "En consecuencia, se remite el presente informe para los fines pertinentes.",
    ].join(" "),
  });
  assert.equal(quote.integrity, "verified");
  assert.equal(quote.sourceMode, "texto_pegado");
  assert.match(quote.citation, /12345N20/);
  assert.match(quote.markdown, /Fragmento textual/);
  assert.match(quote.markdown, /Contraloría/);
});

test("citarDictamenPegado rechaza texto corto", () => {
  assert.throws(
    () => citarDictamenPegado({ numero: "1", texto: "muy corto" }),
    /demasiado corto/i,
  );
});

test("catálogo hot resuelve normas frecuentes de estudio", () => {
  assert.equal(resolveHotNorma("código orgánico de tribunales")?.idNorma, "25563");
  assert.equal(resolveHotNorma("cot")?.idNorma, "25563");
  assert.equal(resolveHotNorma("ley 19.880")?.idNorma, "210676");
  assert.equal(resolveHotNorma("procedimiento administrativo")?.idNorma, "210676");
  assert.equal(resolveHotNorma("18.575")?.idNorma, "29967");
  assert.equal(resolveHotNorma("código tributario")?.idNorma, "6374");
  assert.equal(resolveHotNorma("tribunales de familia")?.idNorma, "229557");
  assert.equal(resolveHotNorma("matrimonio civil")?.idNorma, "225128");
  assert.equal(resolveHotNorma("tribunales ambientales")?.idNorma, "1041361");
  assert.equal(resolveHotNorma("ley 18.101")?.idNorma, "29526");
  assert.equal(resolveHotNorma("código de comercio")?.idNorma, "1974");
});

test("catálogo hot no activa arriendo genérico ni datos personales", () => {
  assert.equal(resolveHotNorma("protección de datos personales"), undefined);
  assert.equal(resolveHotNorma("arriendo de inmuebles urbanos"), undefined);
  assert.equal(resolveHotNorma("arriendo habitacional")?.idNorma, "29526");
});

test("investigar_tema declara secciones fijas de entregable", () => {
  const src = readFileSync(join(root, "src/sources/research.ts"), "utf8");
  assert.match(src, /## 5\. Clasificación por integridad/);
  assert.match(src, /### Verificado/);
  assert.match(src, /### Por verificar/);
  assert.match(src, /### Portales sugeridos/);
  assert.match(src, /## 6\. Próximos pasos/);
  assert.match(src, /pegar_fallo_pjud/);
  assert.match(src, /citar_dictamen_pegado/);
  assert.match(src, /flujo_estudio/);
});

test("prompts de flujo de estudio están registrados", () => {
  const src = readFileSync(join(root, "src/tools/prompts.ts"), "utf8");
  for (const name of [
    "flujo_estudio",
    "pegar_fallo_pjud",
    "pegar_dictamen_cgr",
    "checklist_juicio_ejecutivo",
    "checklist_familia",
    "checklist_contencioso_administrativo",
    "checklist_recurso_nulidad_penal",
  ]) {
    assert.match(src, new RegExp(`"${name}"`));
  }
});
