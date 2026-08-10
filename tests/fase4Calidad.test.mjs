import test from "node:test";
import assert from "node:assert/strict";
import {
  abbreviateTribunal,
  formatCitation,
  formatChileanCitation,
} from "../dist/citation.js";
import {
  parseConsiderandos,
  pickSubstantiveConsiderando,
} from "../dist/sources/considerandos.js";
import { sealSearchResponse } from "../dist/integrity.js";
import { metrics } from "../dist/metrics.js";
import { loadFixture } from "./helpers/loadFixture.mjs";

test("formatCitation estilos chile / bluebook / iso", () => {
  const input = {
    tribunal: "Tribunal Constitucional",
    tipo: "Sentencia",
    rol: "9666-2020",
    considerando: "15",
    anio: "2022",
  };
  const chile = formatChileanCitation(input);
  assert.match(chile.citation, /Tribunal Constitucional/);
  assert.match(chile.citation, /considerando 15º/);

  const bb = formatCitation(input, "bluebook");
  assert.match(bb.citation, /TC \[Chile\]/);
  assert.match(bb.citation, /Rol 9666-2020/);
  assert.match(bb.citation, /c\. 15/);

  const iso = formatCitation(input, "iso");
  assert.match(iso.citation, /Tribunal Constitucional \(Chile\)/);
  assert.match(iso.citation, /rol 9666-2020/);
});

test("abbreviateTribunal CA con ciudad", () => {
  assert.equal(abbreviateTribunal("Tribunal Constitucional"), "TC");
  assert.equal(
    abbreviateTribunal("Corte de Apelaciones de Santiago"),
    "CA Santiago",
  );
});

test("pickSubstantiveConsiderando evita el primero procesal (fixture TC)", () => {
  const text = loadFixture("tc", "fallo-considerandos-sample.txt");
  const items = parseConsiderandos(text);
  assert.ok(items.length >= 2);
  const picked = pickSubstantiveConsiderando(items);
  assert.ok(picked);
  assert.notEqual(picked.numero, 1);
  assert.match(
    picked.texto,
    /protecci[oó]n de datos|Constituci[oó]n|indemnizaci[oó]n/i,
  );
});

test("sealSearchResponse incrementa contadores de integrity", () => {
  const before = metrics.snapshot().counters.integrity;
  sealSearchResponse({
    query: "x",
    source: "jurisprudencia",
    results: [
      {
        source: "jurisprudencia",
        title: "Portal",
        citation: "portal",
        url: "https://oficinajudicialvirtual.pjud.cl/",
        evidence: "link_only",
        metadata: { integrity: "portal_stub", provider: "portal_link" },
      },
      {
        source: "legislacion",
        title: "Ley",
        citation: "Ley",
        url: "https://www.bcn.cl/leychile/navegar?idNorma=1",
        evidence: "full_text",
        summary:
          "Texto oficial recuperado del artículo con extensión suficiente para integrity verified.",
        metadata: { integrity: "verified" },
      },
    ],
  });
  const after = metrics.snapshot();
  assert.ok(after.counters.integrity.portal_stub > before.portal_stub);
  assert.ok(after.counters.integrity.verified > before.verified);
  assert.ok(after.integrityRates.total > 0);
});
