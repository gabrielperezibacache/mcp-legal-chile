import test from "node:test";
import assert from "node:assert/strict";
import {
  getCachedFallo,
  importarFallo,
} from "../dist/sources/falloImport.js";
import { citarJurisprudencia } from "../dist/sources/jurisQuote.js";
import { parseCaseIdentifiers } from "../dist/parsers.js";
import { tryExtractCgrBody } from "../dist/sources/dictamenes.js";

const FALLO = `
Corte Suprema
Sentencia
Rol 55555-2021

Y CONSIDERANDO:

PRIMERO: Que el recurso debe analizarse conforme a la jurisprudencia laboral.

SEGUNDO: Que la tutela de derechos fundamentales exige proporcionalidad.

DECIMO: Que corresponde acoger el recurso en los terminos que se diran.

SE RESUELVE
1. Se acoge el recurso.
`;

test("importar_fallo cachea por ROL y habilita citar sin texto", async () => {
  const imported = await importarFallo({
    rol: "55555-2021",
    texto: FALLO,
    tribunal: "Corte Suprema",
  });
  assert.equal(imported.integrity, "verified");
  assert.ok(imported.considerandosCount >= 2);
  assert.equal(getCachedFallo("55555-2021")?.rol, "55555-2021");

  const quote = await citarJurisprudencia({
    rol: "55555-2021",
    considerando: "2",
    maxChars: 600,
  });
  assert.equal(quote.sourceMode, "texto_pegado");
  assert.equal(quote.considerandoNumero, 2);
  assert.match(quote.texto, /tutela/i);
  assert.ok(quote.warnings.some((w) => /importar_fallo/i.test(w)));
});

test("importar_fallo rechaza texto corto", async () => {
  await assert.rejects(
    () => importarFallo({ rol: "1-2020", texto: "corto" }),
    /demasiado corto/i,
  );
});

test("importar_fallo rechaza URL PDF", async () => {
  await assert.rejects(
    () =>
      importarFallo({
        rol: "1-2020",
        url: "https://example.com/fallo.pdf",
      }),
    /PDF/i,
  );
});

test("parseCaseIdentifiers detecta ROL bare en titulo", () => {
  const ids = parseCaseIdentifiers(
    "Sentencia 12345-2020 Corte Suprema - pjud.cl",
    "https://www.pjud.cl/portal-unificado-sentencias",
  );
  assert.equal(ids.rol, "12345-2020");
  assert.ok(ids.tribunal);
});

test("tryExtractCgrBody no inventa texto en PDF", async () => {
  const res = await tryExtractCgrBody(
    "https://www.contraloria.cl/documents/dictamen.pdf",
  );
  assert.ok(res.warning);
  assert.equal(res.excerpt, undefined);
});
