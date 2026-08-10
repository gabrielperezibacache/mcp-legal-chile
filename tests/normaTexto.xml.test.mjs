import test from "node:test";
import assert from "node:assert/strict";
import {
  findArticulo,
  findIncisoOrLiteral,
  normalizeArticleKey,
  normalizeFromNombreParte,
  parseNormaFromXml,
} from "../dist/sources/normaTexto.js";
import { loadFixture } from "./helpers/loadFixture.mjs";

test("normalizeFromNombreParte maneja bis/ter/quater typos", () => {
  assert.equal(normalizeFromNombreParte("37 BIS"), "37 bis");
  assert.equal(normalizeFromNombreParte("18 TER"), "18 ter");
  assert.equal(normalizeFromNombreParte("18 QUTER"), "18 quater");
  assert.equal(normalizeFromNombreParte("40 BIS A"), "40 bis A");
});

test("normalizeArticleKey pliega espacios y quater", () => {
  assert.equal(normalizeArticleKey("37 bis"), normalizeArticleKey("37bis"));
  assert.equal(
    normalizeArticleKey("18 quater"),
    normalizeArticleKey("18 quter"),
  );
});

test("parseNormaFromXml CPR: NombreParte bis + numerales art. 19", () => {
  const xml = loadFixture("leychile", "cpr-snippet.xml");
  const norma = parseNormaFromXml("242302", xml);
  assert.ok(findArticulo(norma, "1"));
  assert.equal(findArticulo(norma, "37 bis")?.numero, "37 bis");
  assert.equal(findArticulo(norma, "37bis")?.numeroSource, "nombreParte");

  const art19 = findArticulo(norma, "19");
  assert.ok(art19);
  assert.equal(art19.fragmentSource, "numerales");
  const inc1 = findIncisoOrLiteral(art19, { inciso: "1" });
  assert.equal(inc1.kind, "inciso");
  assert.match(inc1.texto, /vida/i);
  const inc2 = findIncisoOrLiteral(art19, { inciso: "2" });
  assert.match(inc2.texto, /igualdad/i);
});

test("parseNormaFromXml CT: literales y bis/ter/quater", () => {
  const xml = loadFixture("leychile", "ct-literales-bis.xml");
  const norma = parseNormaFromXml("207436", xml);
  const art13 = findArticulo(norma, "13");
  assert.ok(art13);
  assert.equal(findIncisoOrLiteral(art13, { letra: "a" }).kind, "literal");
  assert.equal(findIncisoOrLiteral(art13, { letra: "b" }).kind, "literal");
  assert.equal(findArticulo(norma, "18 bis")?.numero, "18 bis");
  assert.equal(findArticulo(norma, "18 ter")?.numero, "18 ter");
  assert.equal(findArticulo(norma, "18 quater")?.numero, "18 quater");
});
