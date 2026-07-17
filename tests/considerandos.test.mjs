import test from "node:test";
import assert from "node:assert/strict";
import {
  findConsiderando,
  numberToOrdinalWords,
  ordinalWordsToNumber,
  parseConsiderandoRef,
  parseConsiderandos,
  pickSubstantiveConsiderando,
  rankConsiderandos,
} from "../dist/sources/considerandos.js";
import { formatChileanCitation } from "../dist/citation.js";

const SAMPLE = `
Y CONSIDERANDO:

PRIMERO: Que, llamado el Tribunal Pleno a pronunciarse respecto de las
normas cuestionadas, se obtuvo mayoría para acoger parcialmente el requerimiento.

SEGUNDO: Que la Constitución Política asegura el derecho a la vida y a la
protección de datos personales en el marco del artículo 19.

DÉCIMO QUINTO: Debiendo esta Magistratura resolver conforme al texto
constitucional vigente, en este caso preciso, el artículo 8°, inciso 2°.

VIGÉSIMO PRIMERO: Tal como se ha considerado en ocasiones anteriores,
entre otras las STC Roles N° 2246/2012.

SE RESUELVE

1º. Que se acoge parcialmente el requerimiento.
`;

test("ordinalWordsToNumber entiende rótulos chilenos", () => {
  assert.equal(ordinalWordsToNumber("PRIMERO"), 1);
  assert.equal(ordinalWordsToNumber("décimo quinto"), 15);
  assert.equal(ordinalWordsToNumber("VIGÉSIMO PRIMERO"), 21);
  assert.equal(ordinalWordsToNumber("centésimo sexto"), 106);
});

test("numberToOrdinalWords es invertible en rangos comunes", () => {
  for (const n of [1, 7, 10, 11, 15, 20, 21, 35, 100, 106]) {
    const words = numberToOrdinalWords(n);
    assert.ok(words, String(n));
    assert.equal(ordinalWordsToNumber(words), n);
  }
});

test("parseConsiderandoRef acepta número y palabras", () => {
  assert.equal(parseConsiderandoRef("15").numero, 15);
  assert.equal(parseConsiderandoRef("c. 15º").numero, 15);
  assert.equal(parseConsiderandoRef("considerando décimo quinto").numero, 15);
});

test("parseConsiderandos extrae rótulos y texto", () => {
  const items = parseConsiderandos(SAMPLE);
  assert.ok(items.length >= 4);
  assert.equal(items[0].numero, 1);
  assert.match(items[0].texto, /Tribunal Pleno/i);
  const c15 = findConsiderando(items, "15");
  assert.ok(c15);
  assert.match(c15.texto, /artículo 8/i);
  const c21 = findConsiderando(items, "vigésimo primero");
  assert.ok(c21);
  assert.equal(c21.numero, 21);
});

test("rankConsiderandos prioriza overlap semántico", () => {
  const items = parseConsiderandos(SAMPLE);
  const ranked = rankConsiderandos(items, "protección de datos personales");
  assert.ok(ranked.length);
  assert.match(ranked[0].texto, /protección de datos/i);
});

test("formatChileanCitation arma cita con considerando y tipo", () => {
  const cited = formatChileanCitation({
    tribunal: "Tribunal Constitucional",
    tipo: "Sentencia",
    rol: "9666-2020",
    considerando: "15",
    anio: "2022",
  });
  assert.equal(
    cited.citation,
    "Tribunal Constitucional, Sentencia, rol 9666-2020, considerando 15º (2022)",
  );
});

test("parseConsiderandos acepta headers arábigos 15º.-", () => {
  const text = `
Y CONSIDERANDO:

1º.- Que se notifica a las partes la resolución.

15º.- Que el derecho a la protección de datos personales exige ponderación constitucional.

SE RESUELVE
`;
  const items = parseConsiderandos(text);
  assert.ok(items.some((c) => c.numero === 1));
  const c15 = findConsiderando(items, "15");
  assert.ok(c15);
  assert.match(c15.texto, /protección de datos/i);
});

test("pickSubstantiveConsiderando evita el primero procesal", () => {
  const items = parseConsiderandos(`
Y CONSIDERANDO:

PRIMERO: Que se notifica a las partes y se provee el traslado.

SEGUNDO: Que el derecho a la vida privada y la protección de datos personales
constituyen principios rectores del ordenamiento constitucional chileno aplicables
al caso concreto conforme al artículo 19 de la Constitución.

SE RESUELVE
`);
  const picked = pickSubstantiveConsiderando(items);
  assert.ok(picked);
  assert.notEqual(picked.numero, 1);
  assert.match(picked.texto, /protección de datos|vida privada/i);
});

test("rankConsiderandos bonifica bigramas", () => {
  const items = parseConsiderandos(SAMPLE);
  const ranked = rankConsiderandos(items, "protección de datos personales");
  assert.match(ranked[0].texto, /protección de datos/i);
});
