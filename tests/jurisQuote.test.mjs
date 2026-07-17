import test from "node:test";
import assert from "node:assert/strict";
import { citarJurisprudencia } from "../dist/sources/jurisQuote.js";

const FALLO_PEGADO = `
Corte Suprema
Sentencia
Rol 12345-2020

Y CONSIDERANDO:

PRIMERO: Que el recurso de unificación de jurisprudencia debe analizarse
conforme a los criterios establecidos por esta Corte en materia laboral.

SEGUNDO: Que la protección de datos personales y la dignidad del trabajador
constituyen principios rectores del ordenamiento jurídico chileno.

DÉCIMO QUINTO: Que, en consecuencia, corresponde acoger el recurso en los
términos que se dirán.

SE RESUELVE

1º. Que se acoge el recurso.
`;

test("citarJurisprudencia con texto pegado no requiere red", async () => {
  const quote = await citarJurisprudencia({
    rol: "12345-2020",
    tribunal: "Corte Suprema",
    tipoResolucion: "Sentencia",
    anio: "2020",
    url: "https://www.pjud.cl/portal-unificado-sentencias",
    texto: FALLO_PEGADO,
    considerando: "15",
    maxChars: 800,
  });
  assert.equal(quote.sourceMode, "texto_pegado");
  assert.equal(quote.evidence, "full_text");
  assert.equal(quote.tribunal, "Corte Suprema");
  assert.equal(quote.considerandoNumero, 15);
  assert.match(
    quote.citation,
    /Corte Suprema, Sentencia, rol 12345-2020, considerando 15º \(2020\)/,
  );
  assert.match(quote.texto, /acoger el recurso/i);
  assert.ok(quote.warnings.some((w) => /PJUD/i.test(w)));
});

test("citarJurisprudencia texto pegado elige por consulta", async () => {
  const quote = await citarJurisprudencia({
    rol: "12345-2020",
    tribunal: "Corte Suprema",
    texto: FALLO_PEGADO,
    consulta: "protección de datos personales",
  });
  assert.equal(quote.considerandoNumero, 2);
  assert.match(quote.texto, /protección de datos/i);
});

test("citarJurisprudencia rechaza texto demasiado corto", async () => {
  await assert.rejects(
    () =>
      citarJurisprudencia({
        rol: "1-2020",
        texto: "muy corto",
      }),
    /demasiado corto/i,
  );
});
