import test from "node:test";
import assert from "node:assert/strict";
import {
  integrityOf,
  sealSearchResponse,
  hasTraceableUrl,
  ANTI_HALLUCINATION_RULES,
} from "../dist/integrity.js";
import { formatSearchMarkdown } from "../dist/format.js";
import { citarJurisprudencia } from "../dist/sources/jurisQuote.js";

test("sealSearchResponse marca portal_stub y advierte si solo hay stubs", () => {
  const sealed = sealSearchResponse({
    query: "protección datos",
    source: "jurisprudencia",
    results: [
      {
        source: "jurisprudencia",
        title: "Portal PJUD",
        citation: "sugerido",
        url: "https://www.pjud.cl/portal-unificado-sentencias",
        evidence: "link_only",
        metadata: { provider: "portal_link" },
      },
    ],
  });
  assert.equal(sealed.results.length, 1);
  assert.equal(integrityOf(sealed.results[0]), "portal_stub");
  assert.ok(
    sealed.warnings?.some((w) => /portal_stub|portales/i.test(w)),
  );
});

test("sealSearchResponse descarta resultados sin URL", () => {
  const sealed = sealSearchResponse({
    query: "x",
    source: "doctrina",
    results: [
      {
        source: "doctrina",
        title: "Sin URL",
        citation: "x",
        url: "",
        evidence: "metadata",
      },
    ],
  });
  assert.equal(sealed.results.length, 0);
  assert.ok(sealed.warnings?.some((w) => /cero resultados/i.test(w)));
});

test("hasTraceableUrl exige http(s)", () => {
  assert.equal(
    hasTraceableUrl({
      source: "legislacion",
      title: "a",
      citation: "a",
      url: "https://www.bcn.cl/leychile",
    }),
    true,
  );
  assert.equal(
    hasTraceableUrl({
      source: "legislacion",
      title: "a",
      citation: "a",
      url: "javascript:alert(1)",
    }),
    false,
  );
});

test("formatSearchMarkdown incluye bloque de integridad y no inventar", () => {
  const md = formatSearchMarkdown({
    query: "nada",
    source: "jurisprudencia",
    results: [],
  });
  assert.match(md, /Integridad \(obligatorio\)/);
  assert.match(md, /No hay coincidencias verificables/i);
  assert.match(md, /Qué puedes hacer ahora/);
  assert.match(md, /Prohibido inventar/);
  for (const rule of ANTI_HALLUCINATION_RULES) {
    assert.match(md, new RegExp(rule.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("formatSearchMarkdown separa documentos de portales y muestra cita lista", () => {
  const md = formatSearchMarkdown({
    query: "protección",
    source: "jurisprudencia",
    results: [
      {
        source: "jurisprudencia",
        title: "TC rol 123-2020",
        citation: "Tribunal Constitucional, Sentencia, rol 123-2020",
        url: "https://buscador.tcchile.cl/#/ficha/1",
        evidence: "metadata",
        tribunal: "Tribunal Constitucional",
        rol: "123-2020",
        summary: "Que la protección de datos es un derecho fundamental.",
      },
      {
        source: "jurisprudencia",
        title: "Portal PJUD",
        citation: "sugerido",
        url: "https://www.pjud.cl/portal-unificado-sentencias",
        evidence: "link_only",
        metadata: { provider: "portal_link" },
      },
    ],
  });
  assert.match(md, /Cita lista para pegar/);
  assert.match(md, /Documentos y candidatos/);
  assert.match(md, /Portales sugeridos/);
  assert.match(md, /obtener_fallo_tc|citar_jurisprudencia/);
});

test("citarJurisprudencia rechaza considerando inexistente (no sustituye)", async () => {
  const texto = `
Corte Suprema
Sentencia
Rol 99-2021

Y CONSIDERANDO:

PRIMERO: Que el recurso debe analizarse conforme a derecho.

SEGUNDO: Que corresponde rechazar la pretensión.

SE RESUELVE
`;
  await assert.rejects(
    () =>
      citarJurisprudencia({
        rol: "99-2021",
        tribunal: "Corte Suprema",
        texto,
        considerando: "15",
      }),
    /NO VERIFICADO|no existe el considerando/i,
  );
});
