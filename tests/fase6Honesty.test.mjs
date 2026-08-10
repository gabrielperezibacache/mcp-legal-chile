import test from "node:test";
import assert from "node:assert/strict";
import {
  enforceVerifiedHasText,
  hasRecoveredText,
  integrityOf,
  sealSearchResponse,
} from "../dist/integrity.js";

test("hasRecoveredText exige resumen usable", () => {
  assert.equal(hasRecoveredText({ summary: "corto" }), false);
  assert.equal(
    hasRecoveredText({
      summary:
        "Extracto suficiente del dictamen con más de cuarenta caracteres de cuerpo.",
    }),
    true,
  );
});

test("enforceVerifiedHasText degrada verified sin texto", () => {
  const { result, demoted } = enforceVerifiedHasText({
    source: "dictamenes",
    title: "Dictamen vacío",
    citation: "Dictamen",
    url: "https://www.contraloria.cl/x",
    evidence: "full_text",
    summary: "",
    metadata: { integrity: "verified" },
  });
  assert.equal(demoted, true);
  assert.equal(integrityOf(result), "candidate");
  assert.equal(result.evidence, "link_only");
  assert.equal(result.metadata?.demotedFromVerified, true);
});

test("sealSearchResponse no deja verified sin texto", () => {
  const sealed = sealSearchResponse({
    query: "x",
    source: "dictamenes",
    results: [
      {
        source: "dictamenes",
        title: "Fake verified",
        citation: "x",
        url: "https://example.test/d",
        evidence: "full_text",
        summary: "   ",
        metadata: { integrity: "verified" },
      },
      {
        source: "dictamenes",
        title: "Real verified",
        citation: "y",
        url: "https://www.contraloria.cl/web/cgr/dictamenes?id=1",
        evidence: "full_text",
        summary:
          "Cuerpo HTML recuperado con contenido suficiente para citar el extracto oficial.",
        metadata: { integrity: "verified" },
      },
      {
        source: "dictamenes",
        title: "Off-domain fake",
        citation: "z",
        url: "https://dle.rae.es/dictamen",
        evidence: "full_text",
        summary:
          "Texto largo de diccionario que no debe pasar como dictamen oficial verified.",
        metadata: { integrity: "verified" },
      },
    ],
  });
  assert.equal(integrityOf(sealed.results[0]), "candidate");
  assert.equal(integrityOf(sealed.results[1]), "verified");
  assert.equal(integrityOf(sealed.results[2]), "candidate");
  assert.match(sealed.warnings?.join(" ") ?? "", /degradados/i);
});
