import test from "node:test";
import assert from "node:assert/strict";
import {
  rankLegislacionResults,
  scoreLegislacionHit,
} from "../dist/sources/legislacion.js";

test("rankLegislacionResults filtra OR noise con baja cobertura", () => {
  const terms = ["responsabilidad", "medica", "diagnostico"];
  const ranked = rankLegislacionResults(
    [
      {
        source: "legislacion",
        title: "Ley de estudiantes cuidadores",
        citation: "Ley estudiantes",
        url: "https://www.bcn.cl/leychile/navegar?idNorma=1",
      },
      {
        source: "legislacion",
        title: "Responsabilidad médica por error de diagnóstico",
        citation: "responsabilidad medica diagnostico",
        url: "https://www.bcn.cl/leychile/navegar?idNorma=2",
      },
      {
        source: "legislacion",
        title: "Transparencia financiera del Estado",
        citation: "transparencia",
        url: "https://www.bcn.cl/leychile/navegar?idNorma=3",
      },
    ],
    terms,
  );
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].title, /Responsabilidad médica/i);
  assert.ok(scoreLegislacionHit(ranked[0], terms) > 0.5);
});

test("rankLegislacionResults con 2 términos exige ambos", () => {
  const terms = ["responsabilidad", "medica"];
  const ranked = rankLegislacionResults(
    [
      {
        source: "legislacion",
        title: "Ley de responsabilidad fiscal",
        citation: "responsabilidad fiscal",
        url: "https://www.bcn.cl/leychile/navegar?idNorma=10",
      },
      {
        source: "legislacion",
        title: "Responsabilidad médica en el ejercicio profesional",
        citation: "responsabilidad medica",
        url: "https://www.bcn.cl/leychile/navegar?idNorma=11",
      },
    ],
    terms,
  );
  assert.equal(ranked.length, 1);
  assert.match(ranked[0].title, /Responsabilidad médica/i);
});
