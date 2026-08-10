import test from "node:test";
import assert from "node:assert/strict";
import {
  filterOfficialDictamenHits,
  tryExtractCgrBody,
} from "../dist/sources/dictamenes.js";
import {
  findConsiderando,
  parseConsiderandoRef,
  parseConsiderandos,
} from "../dist/sources/considerandos.js";
import { isAllowedHost } from "../dist/sources/hostAllowlist.js";
import { formatChileanCitation } from "../dist/citation.js";
import { legalExtractionFailure } from "../dist/tools/helpers.js";
import { HttpStatusError } from "../dist/util.js";

test("allowlist rechaza SpanishDict / RAE / Nexus Mods", () => {
  const poison = [
    "https://www.spanishdict.com/translate/dictamen",
    "https://dle.rae.es/dictamen",
    "https://www.nexusmods.com/skyrim",
    "https://concepto.de/responsabilidad",
  ];
  for (const url of poison) {
    assert.equal(isAllowedHost(url, ["contraloria.cl"]), false);
  }
  assert.equal(
    isAllowedHost(
      "https://www.contraloria.cl/web/cgr/dictamenes",
      ["contraloria.cl"],
    ),
    true,
  );
});

test("filterOfficialDictamenHits descarta SERP contaminada y quita verified", () => {
  const { kept, dropped } = filterOfficialDictamenHits(
    [
      {
        source: "dictamenes",
        title: "fake",
        citation: "fake",
        url: "https://dle.rae.es/foo",
        publisher: "Contraloría General de la República",
        evidence: "full_text",
        summary: "x".repeat(80),
        metadata: { integrity: "verified" },
      },
      {
        source: "dictamenes",
        title: "ok",
        citation: "ok",
        url: "https://www.contraloria.cl/web/cgr/dictamenes?id=1",
        publisher: "Contraloría General de la República",
        evidence: "link_only",
        metadata: { integrity: "candidate" },
      },
    ],
    ["contraloria.cl"],
  );
  assert.equal(dropped, 1);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].url.includes("contraloria.cl"), true);
  assert.equal(kept[0].metadata?.integrity, "candidate");
  assert.equal(kept[0].evidence, "link_only");
});

test("tryExtractCgrBody no scrapea hosts ajenos", async () => {
  const res = await tryExtractCgrBody("https://dle.rae.es/dictamen");
  assert.match(res.warning ?? "", /fuera de contraloria/i);
  assert.equal(res.excerpt, undefined);
});

test("parseConsiderandos ignora número de página 787", () => {
  const text = `
Y CONSIDERANDO:

PRIMERO: Que el requerimiento cumple con los requisitos de admisibilidad formal
establecidos en la Constitución Política de la República.

SEGUNDO: Que corresponde analizar el fondo de la controversia constitucional
planteada por la parte requirente en estos autos.

787. Texto de pie de página OCR o número de folio sin valor de considerando.

DECIMO CUARTO: Que, en consecuencia, se acoge parcialmente el requerimiento
de inaplicabilidad por inconstitucionalidad.

SE RESUELVE
`;
  const items = parseConsiderandos(text);
  assert.equal(findConsiderando(items, "787"), undefined);
  assert.equal(parseConsiderandoRef("787").numero, undefined);
  assert.ok(findConsiderando(items, "1"));
  assert.ok(findConsiderando(items, "14"));
});

test("citas de códigos no usan N° PENAL", () => {
  const penal = formatChileanCitation({
    tipo: "Código",
    numero: "PENAL",
    articulo: "454",
  });
  assert.match(penal.citation, /Código Penal/i);
  assert.doesNotMatch(penal.citation, /N°\s*PENAL/i);

  const civil = formatChileanCitation({
    tipo: "Decreto con Fuerza de Ley",
    numero: "1",
    articulo: "1437",
    titulo: "Código Civil",
  });
  assert.match(civil.citation, /Código Civil/i);
  assert.match(civil.citation, /1437/);
});

test("legalExtractionFailure distingue HTTP 401", () => {
  const out = legalExtractionFailure(
    new HttpStatusError(401, "https://www.leychile.cl/x"),
    "176595",
  );
  const text = out.content?.[0]?.text ?? "";
  assert.match(text, /401/);
  assert.match(text, /CloudFront|no autorizado|WAF/i);
  assert.equal(out.isError, undefined);
});
